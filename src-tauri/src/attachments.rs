use crate::document::Result;
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const LIMIT: usize = 10 * 1024 * 1024;

fn plain(path: &Path) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("attachment-path".into());
        }
    }
    if meta.file_type().is_symlink() {
        return Err("attachment-path".into());
    }
    Ok(meta)
}

// Paths from Markdown are relative to the current document, never shell arguments.
pub fn relative(document: &Path, value: &str) -> Result<PathBuf> {
    let root = document.parent().ok_or("attachment-unsaved")?;
    if value.is_empty()
        || value.len() > 4096
        || value.contains([':', '\0'])
        || value.chars().any(char::is_control)
    {
        return Err("attachment-path".into());
    }
    let mut path = root.to_path_buf();
    for part in Path::new(value).components() {
        match part {
            Component::Normal(name) => {
                path.push(name);
                plain(&path)?;
            }
            Component::CurDir => (),
            _ => return Err("attachment-path".into()),
        }
    }
    let target = path.canonicalize().map_err(|e| e.to_string())?;
    if !target.starts_with(root) || !target.is_file() {
        return Err("attachment-path".into());
    }
    Ok(target)
}

pub fn markdown(document: &Path, value: &str) -> Result<PathBuf> {
    let path = relative(document, value)?;
    if !matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "md" | "markdown" | "mdown"
    ) {
        return Err("attachment-link".into());
    }
    Ok(path)
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("attachment-path".into());
    }
    let mut bytes = Vec::new();
    file.take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("attachment-size".into());
    }
    Ok(bytes)
}

pub fn image_type(bytes: &[u8]) -> Result<&'static str> {
    if bytes.len() > LIMIT {
        return Err("attachment-size".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("webp")
    } else if bytes.len() >= 14 && bytes.starts_with(b"BM") {
        Ok("bmp")
    } else if bytes.len() >= 16
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Ok("avif")
    } else {
        Err("attachment-type".into())
    }
}

pub fn store(document: &Path, bytes: &[u8]) -> Result<String> {
    let kind = image_type(bytes)?;
    let root = document.parent().ok_or("attachment-unsaved")?;
    let assets = root.join("assets");
    match fs::create_dir(&assets) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.to_string()),
    }
    if !plain(&assets)?.is_dir() || assets.canonicalize().map_err(|e| e.to_string())? != assets {
        return Err("attachment-path".into());
    }
    let name = format!("image-{}.{}", uuid::Uuid::new_v4(), kind);
    let target = assets.join(&name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| e.to_string())?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&target);
        return Err(e.to_string());
    }
    Ok(format!("assets/{name}"))
}

pub fn web_url(value: &str) -> Result<tauri::Url> {
    // Reuse the anonymous HTTP(S) validator; preserve the clicked fragment.
    crate::link_preview::web_url(value)?;
    tauri::Url::parse(value).map_err(|_| "attachment-link".into())
}

pub fn open_web(value: &str) -> Result<()> {
    let url = web_url(value)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                wide("open").as_ptr(),
                wide(url.as_str()).as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            return Err("attachment-browser".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("attachment-browser".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unique_assets_and_invalid_inputs() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().canonicalize().unwrap().join("中文 空格.md");
        fs::write(&doc, "source").unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        let a = store(&doc, bytes).unwrap();
        let b = store(&doc, bytes).unwrap();
        assert_ne!(a, b);
        assert_eq!(read(&relative(&doc, &a).unwrap()).unwrap(), bytes);
        assert!(store(&doc, b"<svg/>").is_err());
        assert!(image_type(&vec![0; LIMIT + 1]).is_err());
        assert_eq!(fs::read_to_string(&doc).unwrap(), "source");
        for value in [
            "../outside.md",
            "C:\\file.md",
            "//server/a.md",
            "assets/../中文 空格.md",
            "file.md:stream",
            "missing.md",
        ] {
            assert!(relative(&doc, value).is_err(), "{value}");
        }
        assert!(markdown(&doc, &a).is_err());
        assert_eq!(markdown(&doc, "./中文 空格.md").unwrap(), doc);
    }
    #[test]
    fn blocked_assets_preserves_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().canonicalize().unwrap().join("a.md");
        fs::write(temp.path().join("assets"), "keep").unwrap();
        assert!(store(&doc, b"GIF89a data").is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("assets")).unwrap(),
            "keep"
        );
    }
    #[test]
    fn browser_only_anonymous_http() {
        for url in [
            "file:///C:/a.exe",
            "javascript:alert(1)",
            "mailto:a@b.c",
            "https://user:pass@example.com",
            "https://example.com\n",
            "cmd:/c start",
        ] {
            assert!(web_url(url).is_err());
        }
        assert_eq!(
            web_url("https://example.com/a?q=b#标题")
                .unwrap()
                .fragment(),
            Some("%E6%A0%87%E9%A2%98")
        );
    }
}
