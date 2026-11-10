use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};
use tauri::Url;

const WEB_LIMIT: usize = 1024 * 1024;
pub const MARKDOWN_LIMIT: usize = 256 * 1024;
type Result<T> = std::result::Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: &'static str,
    pub content: String,
    pub content_type: String,
}

pub fn web_url(value: &str) -> Result<Url> {
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return Err("preview-url".into());
    }
    let mut url = Url::parse(value).map_err(|_| "preview-url")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("preview-url".into());
    }
    url.set_fragment(None);
    Ok(url)
}

pub fn markdown(path: &Path, relative: &str, current: &str) -> Result<Source> {
    let root = path.parent().ok_or("preview-path")?;
    let relative = Path::new(relative);
    if relative.is_absolute() || relative.as_os_str().to_string_lossy().contains([':', '\0']) {
        return Err("preview-path".into());
    }
    let candidate = root.join(relative);
    let target = candidate.canonicalize().map_err(|_| "preview-missing")?;
    if !target.starts_with(root) {
        return Err("preview-path".into());
    }
    let ext = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["md", "markdown", "mdown"].contains(&ext.as_str()) {
        return Err("preview-type".into());
    }
    // Reject reparse paths, including junctions inside the permitted directory.
    for part in candidate.ancestors().take_while(|p| *p != root) {
        let meta = fs::symlink_metadata(part).map_err(|_| "preview-missing")?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("preview-path".into());
            }
        }
        if meta.file_type().is_symlink() {
            return Err("preview-path".into());
        }
    }
    let content = if target == path {
        if current.len() > MARKDOWN_LIMIT {
            return Err("preview-size".into());
        }
        current.to_owned()
    } else {
        let file = fs::File::open(&target).map_err(|_| "preview-missing")?;
        if !file.metadata().map_err(|_| "preview-missing")?.is_file() {
            return Err("preview-type".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
            let mut buffer = vec![0u16; 32768];
            let count = unsafe {
                GetFinalPathNameByHandleW(
                    file.as_raw_handle(),
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    0,
                )
            } as usize;
            if count == 0
                || count >= buffer.len()
                || std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..count])) != target
            {
                return Err("preview-path".into());
            }
        }
        let mut bytes = Vec::new();
        file.take((MARKDOWN_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "preview-missing")?;
        if bytes.len() > MARKDOWN_LIMIT {
            return Err("preview-size".into());
        }
        String::from_utf8(bytes).map_err(|_| "preview-encoding")?
    };
    if content.contains('\0') {
        return Err("preview-encoding".into());
    }
    Ok(Source {
        kind: "markdown",
        content: content.trim_start_matches('\u{feff}').into(),
        content_type: "text/markdown".into(),
    })
}

#[cfg(windows)]
pub fn web(value: &str) -> Result<Source> {
    fetch(value, false)
}

#[cfg(windows)]
pub fn image(value: &str) -> Result<Source> {
    fetch(value, true)
}

#[cfg(windows)]
fn fetch(value: &str, image: bool) -> Result<Source> {
    use base64::Engine;
    use std::{
        ffi::c_void,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::Networking::WinHttp::*;
    struct Handle(*mut c_void);
    impl Handle {
        fn new(raw: *mut c_void) -> Result<Self> {
            if raw.is_null() {
                Err("preview-network".into())
            } else {
                Ok(Self(raw))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn check(ok: i32) -> Result<()> {
        if ok == 0 {
            let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            Err(if code == ERROR_WINHTTP_TIMEOUT {
                "preview-timeout"
            } else {
                "preview-network"
            }
            .into())
        } else {
            Ok(())
        }
    }
    fn header(request: &Handle, key: u32) -> Result<String> {
        let mut buffer = vec![0u16; 4096];
        let mut length = (buffer.len() * 2) as u32;
        unsafe {
            check(WinHttpQueryHeaders(
                request.0,
                key,
                null(),
                buffer.as_mut_ptr().cast(),
                &mut length,
                null_mut(),
            ))?;
        }
        Ok(String::from_utf16_lossy(&buffer[..length as usize / 2])
            .trim_end_matches('\0')
            .to_owned())
    }
    let started = Instant::now();
    let deadline = || {
        if started.elapsed() > Duration::from_secs(8) {
            Err("preview-timeout".to_string())
        } else {
            Ok(())
        }
    };
    let mut url = web_url(value)?;
    unsafe {
        // One anonymous, direct session per hover: no cookie jar, proxy or ambient Windows credentials.
        let session = Handle::new(WinHttpOpen(
            wide("MDMD/0.1 link-preview").as_ptr(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            null(),
            null(),
            0,
        ))?;
        check(WinHttpSetTimeouts(session.0, 3000, 3000, 3000, 3000))?;
        for redirects in 0..=3 {
            deadline()?;
            let host = url
                .host_str()
                .ok_or("preview-url")?
                .trim_matches(['[', ']']);
            let connection = Handle::new(WinHttpConnect(
                session.0,
                wide(host).as_ptr(),
                url.port_or_known_default().ok_or("preview-url")?,
                0,
            ))?;
            let resource = format!(
                "{}{}",
                url.path(),
                url.query().map(|q| format!("?{q}")).unwrap_or_default()
            );
            let request = Handle::new(WinHttpOpenRequest(
                connection.0,
                wide("GET").as_ptr(),
                wide(&resource).as_ptr(),
                null(),
                null(),
                null(),
                if url.scheme() == "https" {
                    WINHTTP_FLAG_SECURE
                } else {
                    0
                },
            ))?;
            let disabled = WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_REDIRECTS;
            check(WinHttpSetOption(
                request.0,
                WINHTTP_OPTION_DISABLE_FEATURE,
                (&disabled as *const u32).cast(),
                4,
            ))?;
            let auth = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
            check(WinHttpSetOption(
                request.0,
                WINHTTP_OPTION_AUTOLOGON_POLICY,
                (&auth as *const u32).cast(),
                4,
            ))?;
            check(WinHttpSendRequest(
                request.0,
                wide(if image { "Accept: image/png, image/jpeg, image/gif, image/webp, image/bmp, image/avif\r\nAccept-Encoding: identity\r\n" } else { "Accept: text/html, application/xhtml+xml\r\nAccept-Encoding: identity\r\n" })
                    .as_ptr(),
                u32::MAX,
                null(),
                0,
                0,
                0,
            ))?;
            deadline()?;
            check(WinHttpReceiveResponse(request.0, null_mut()))?;
            deadline()?;
            let status = header(&request, WINHTTP_QUERY_STATUS_CODE)?;
            if ["301", "302", "303", "307", "308"].contains(&status.as_str()) {
                if redirects == 3 {
                    return Err("preview-redirect".into());
                }
                let next = web_url(
                    url.join(&header(&request, WINHTTP_QUERY_LOCATION)?)
                        .map_err(|_| "preview-url")?
                        .as_str(),
                )?;
                if url.scheme() == "https" && next.scheme() != "https" {
                    return Err("preview-redirect".into());
                }
                url = next;
                continue;
            }
            if status != "200" {
                return Err("preview-http".into());
            }
            let content_type = header(&request, WINHTTP_QUERY_CONTENT_TYPE)?;
            let mime = content_type
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if if image {
                ![
                    "image/png",
                    "image/jpeg",
                    "image/gif",
                    "image/webp",
                    "image/bmp",
                    "image/avif",
                ]
                .contains(&mime.as_str())
            } else {
                !["text/html", "application/xhtml+xml"].contains(&mime.as_str())
            } {
                return Err("preview-type".into());
            }
            let mut bytes = Vec::new();
            loop {
                deadline()?;
                let mut chunk = [0u8; 16384];
                let mut count = 0;
                check(WinHttpReadData(
                    request.0,
                    chunk.as_mut_ptr().cast(),
                    chunk.len() as u32,
                    &mut count,
                ))?;
                if count == 0 {
                    break;
                }
                if bytes.len() + count as usize
                    > if image {
                        crate::attachments::LIMIT
                    } else {
                        WEB_LIMIT
                    }
                {
                    return Err("preview-size".into());
                }
                bytes.extend_from_slice(&chunk[..count as usize]);
            }
            if image {
                let kind = crate::attachments::image_type(&bytes)?;
                let expected = if kind == "jpg" {
                    "image/jpeg".to_string()
                } else {
                    format!("image/{kind}")
                };
                if mime != expected {
                    return Err("preview-type".into());
                }
            }
            return Ok(Source {
                kind: if image { "image" } else { "web" },
                content: base64::engine::general_purpose::STANDARD.encode(bytes),
                content_type,
            });
        }
    }
    Err("preview-redirect".into())
}

#[cfg(not(windows))]
pub fn web(_value: &str) -> Result<Source> {
    Err("preview-network".into())
}

#[cfg(not(windows))]
pub fn image(_value: &str) -> Result<Source> {
    Err("preview-network".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_are_anonymous_http_only() {
        for bad in [
            "file:///c:/x.md",
            "javascript:alert(1)",
            "http://user:pass@example.com/",
            "https://example.com/\n",
        ] {
            assert!(web_url(bad).is_err());
        }
        assert_eq!(
            web_url("https://example.com/a?q=1#part").unwrap().as_str(),
            "https://example.com/a?q=1"
        );
    }
    #[test]
    fn markdown_is_bounded_read_only_and_document_relative() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        let path = root.join("docs/main.md");
        fs::write(&path, "# disk").unwrap();
        fs::write(root.join("outside.md"), "secret").unwrap();
        fs::write(root.join("docs/other.MD"), "\u{feff}# Other").unwrap();
        assert_eq!(
            markdown(&path, "main.md", "# unsaved").unwrap().content,
            "# unsaved"
        );
        assert_eq!(markdown(&path, "other.MD", "").unwrap().content, "# Other");
        for bad in ["../outside.md", "C:\\outside.md", "missing.md"] {
            assert!(markdown(&path, bad, "").is_err());
        }
        fs::write(root.join("docs/big.md"), vec![b'x'; MARKDOWN_LIMIT + 1]).unwrap();
        fs::write(root.join("docs/binary.md"), [0xff, 0]).unwrap();
        assert!(markdown(&path, "big.md", "").is_err());
        assert!(markdown(&path, "binary.md", "").is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "# disk");
    }
}
