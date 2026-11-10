use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Deserialize, Serialize)]
pub struct File {
    pub path: String,
    pub url: String,
    pub bytes: usize,
    pub sha256: String,
    pub kind: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Spec {
    pub id: String,
    pub version: String,
    pub files: Vec<File>,
}
fn specs() -> Vec<Spec> {
    serde_json::from_str(include_str!("../../config/engines.lock.json"))
        .expect("compiled engine manifest")
}
fn spec(id: &str) -> Result<Spec> {
    specs()
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("engine-id".into())
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn revision(spec: &Spec) -> String {
    hash(&serde_json::to_vec(spec).unwrap())
}
fn marker(root: &Path, spec: &Spec) -> PathBuf {
    root.join(format!("{}-{}.installed", spec.id, revision(spec)))
}
fn checked(root: &Path, file: &File) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(root.join("blobs").join(&file.sha256))
        .map_err(|_| "engine-missing")?
        .take(file.bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "engine-read")?;
    if bytes.len() != file.bytes || hash(&bytes) != file.sha256 {
        return Err("engine-integrity".into());
    }
    Ok(bytes)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub version: String,
    pub bytes: usize,
    pub status: String,
    pub error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub rows: Vec<Row>,
    pub busy: Option<String>,
    pub downloaded: usize,
    pub total: usize,
    pub committing: bool,
}
#[derive(Serialize)]
pub struct Asset {
    pub path: String,
    pub kind: String,
    pub content: String,
}
pub struct Manager {
    root: PathBuf,
    state: Mutex<View>,
    cancel: AtomicBool,
}
impl Manager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: root.join("engines"),
            state: Mutex::new(View {
                rows: vec![],
                busy: None,
                downloaded: 0,
                total: 0,
                committing: false,
            }),
            cancel: AtomicBool::new(false),
        }
    }
    pub fn view(&self) -> Result<View> {
        Ok(self.state.lock().map_err(|_| "engine-busy")?.clone())
    }
    pub fn refresh(&self) -> Result<View> {
        let mut state = self.state.lock().map_err(|_| "engine-busy")?;
        if state.busy.is_some() {
            return Ok(state.clone());
        }
        state.rows = self.rows();
        Ok(state.clone())
    }
    fn rows(&self) -> Vec<Row> {
        specs()
            .iter()
            .map(|s| {
                let status = if !marker(&self.root, s).exists() {
                    "missing"
                } else if fs::read_to_string(marker(&self.root, s))
                    .is_ok_and(|text| text == revision(s))
                    && s.files.iter().all(|f| checked(&self.root, f).is_ok())
                {
                    "installed"
                } else {
                    "damaged"
                };
                Row {
                    id: s.id.clone(),
                    version: s.version.clone(),
                    bytes: s.files.iter().map(|f| f.bytes).sum(),
                    status: status.into(),
                    error: None,
                }
            })
            .collect()
    }
    pub fn assets(&self, id: &str) -> Result<Vec<Asset>> {
        let spec = spec(id)?;
        if !fs::read_to_string(marker(&self.root, &spec)).is_ok_and(|text| text == revision(&spec))
        {
            return Err("engine-missing".into());
        }
        spec.files
            .iter()
            .map(|f| {
                Ok(Asset {
                    path: f.path.clone(),
                    kind: f.kind.clone(),
                    content: base64::engine::general_purpose::STANDARD
                        .encode(checked(&self.root, f)?),
                })
            })
            .collect()
    }
    pub fn stop(&self, id: &str) -> Result<View> {
        let state = self.view()?;
        if state.busy.as_deref() != Some(id) || state.committing {
            return Err("engine-busy".into());
        }
        self.cancel.store(true, Ordering::SeqCst);
        Ok(state)
    }
    pub fn start(self: &Arc<Self>, id: &str) -> Result<View> {
        let spec = spec(id)?;
        {
            let mut state = self.state.lock().map_err(|_| "engine-busy")?;
            if state.busy.is_some() {
                return Err("engine-busy".into());
            }
            // ponytail: one download per process; parallel transfers only if measured need justifies them.
            state.busy = Some(id.into());
            state.downloaded = 0;
            state.total = spec.files.iter().map(|f| f.bytes).sum();
            state.committing = false;
            for row in &mut state.rows {
                row.error = None;
            }
            self.cancel.store(false, Ordering::SeqCst);
        }
        let manager = Arc::clone(self);
        std::thread::spawn(move || {
            let result = manager.install(&spec);
            if let Ok(mut state) = manager.state.lock() {
                state.rows = manager.rows();
                if let Err(error) = result {
                    if let Some(row) = state.rows.iter_mut().find(|r| r.id == spec.id) {
                        row.error = Some(error);
                    }
                }
                state.busy = None;
                state.committing = false;
            }
        });
        self.view()
    }
    fn progress(&self, n: usize) -> Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err("engine-cancelled".into());
        }
        self.state.lock().map_err(|_| "engine-busy")?.downloaded += n;
        Ok(())
    }
    fn install(&self, spec: &Spec) -> Result<()> {
        let stage = self
            .root
            .join(format!(".download-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&stage).map_err(|_| "engine-write")?;
        let result = (|| {
            for file in &spec.files {
                self.progress(0)?;
                let bytes = download(&download_url(file)?, file.bytes, |n| self.progress(n))?;
                if bytes.len() != file.bytes || hash(&bytes) != file.sha256 {
                    return Err("engine-integrity".into());
                }
                crate::storage::write_atomic(&stage.join(&file.sha256), &bytes)
                    .map_err(|_| "engine-write")?;
            }
            self.progress(0)?;
            self.state.lock().map_err(|_| "engine-busy")?.committing = true;
            for file in &spec.files {
                if checked(&self.root, file).is_err() {
                    let bytes = fs::read(stage.join(&file.sha256)).map_err(|_| "engine-read")?;
                    crate::storage::write_atomic(
                        &self.root.join("blobs").join(&file.sha256),
                        &bytes,
                    )
                    .map_err(|_| "engine-write")?;
                }
            }
            if test_mode()
                && fs::read_to_string(self.root.join("test-failure"))
                    .is_ok_and(|s| s.trim() == "commit")
            {
                return Err("engine-write".into());
            }
            crate::storage::write_atomic(&marker(&self.root, spec), revision(spec).as_bytes())
                .map_err(|_| "engine-write")?;
            Ok(())
        })();
        // Only the exact UUID staging directory created by this operation is removed.
        let _ = fs::remove_dir_all(stage);
        result
    }
}
fn test_mode() -> bool {
    std::env::var("MDMD_INTEGRATION_TEST_ID")
        .ok()
        .and_then(|s| uuid::Uuid::parse_str(&s).ok())
        .is_some()
}
fn download_url(file: &File) -> Result<String> {
    if let Ok(base) = std::env::var("MDMD_ENGINE_TEST_URL") {
        let url = tauri::Url::parse(&base).map_err(|_| "engine-test-context")?;
        if !test_mode()
            || url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("engine-test-context".into());
        }
        return Ok(format!("{base}{}", file.sha256));
    }
    if !file.url.starts_with("https://cdn.jsdelivr.net/npm/") {
        return Err("engine-source".into());
    }
    Ok(file.url.clone())
}
// Fixed pinned assets use a stricter policy than link previews: no redirects, credentials or cookies.
fn download(
    url: &str,
    limit: usize,
    mut progress: impl FnMut(usize) -> Result<()>,
) -> Result<Vec<u8>> {
    use std::{
        ffi::c_void,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::Networking::WinHttp::*;
    struct Handle(*mut c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let handle = |p| {
        if p == null_mut() {
            Err("engine-network".to_owned())
        } else {
            Ok(Handle(p))
        }
    };
    let check = |n| {
        if n == 0 {
            Err("engine-network".to_owned())
        } else {
            Ok(())
        }
    };
    let url = tauri::Url::parse(url).map_err(|_| "engine-source")?;
    let began = Instant::now();
    unsafe {
        let session = handle(WinHttpOpen(
            wide("MDMD/0.1 engine-download").as_ptr(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            null(),
            null(),
            0,
        ))?;
        check(WinHttpSetTimeouts(session.0, 5000, 5000, 5000, 5000))?;
        let connection = handle(WinHttpConnect(
            session.0,
            wide(url.host_str().ok_or("engine-source")?).as_ptr(),
            url.port_or_known_default().ok_or("engine-source")?,
            0,
        ))?;
        let request = handle(WinHttpOpenRequest(
            connection.0,
            wide("GET").as_ptr(),
            wide(url.path()).as_ptr(),
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
            wide("Accept-Encoding: identity\r\n").as_ptr(),
            u32::MAX,
            null(),
            0,
            0,
            0,
        ))?;
        progress(0)?;
        check(WinHttpReceiveResponse(request.0, null_mut()))?;
        let mut status = 0u32;
        let mut size = 4;
        check(WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            (&mut status as *mut u32).cast(),
            &mut size,
            null_mut(),
        ))?;
        if status != 200 {
            return Err("engine-http".into());
        }
        let mut bytes = Vec::new();
        loop {
            progress(0)?;
            if began.elapsed() > Duration::from_secs(90) {
                return Err("engine-timeout".into());
            }
            let mut chunk = [0u8; 32768];
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
            if bytes.len() + count as usize > limit {
                return Err("engine-integrity".into());
            }
            bytes.extend_from_slice(&chunk[..count as usize]);
            progress(count as usize)?;
        }
        Ok(bytes)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_and_cache_integrity() {
        let all = specs();
        assert_eq!(all.len(), 4);
        assert!(spec("../unknown").is_err());
        for s in all {
            assert!(s.files.len() >= 2);
            assert!(s.files.iter().all(|f| f.bytes > 0
                && f.bytes < 8 * 1024 * 1024
                && f.sha256.len() == 64
                && !f.path.contains("..")
                && f.url.starts_with("https://cdn.jsdelivr.net/npm/")));
        }
        let root = tempfile::tempdir().unwrap();
        let file = File {
            path: "a.js".into(),
            url: "".into(),
            bytes: 3,
            sha256: hash(b"abc"),
            kind: "js".into(),
        };
        crate::storage::write_atomic(&root.path().join("blobs").join(&file.sha256), b"abc")
            .unwrap();
        assert_eq!(checked(root.path(), &file).unwrap(), b"abc");
        fs::write(root.path().join("blobs").join(&file.sha256), b"bad").unwrap();
        assert_eq!(checked(root.path(), &file).unwrap_err(), "engine-integrity");
    }
}
