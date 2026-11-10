use crate::{integration, storage};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use windows::{
    core::{Interface, PCWSTR},
    Win32::{System::Com::*, UI::Shell::*},
};
use windows_sys::Win32::{System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*};

const DEFAULT: &[u8] = include_bytes!("../icons/icon.ico");
const MAX_BYTES: u64 = 2 * 1024 * 1024;
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "icon-read")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "icon-read")?;
    if bytes.len() as u64 > limit {
        return Err("icon-size".into());
    }
    Ok(bytes)
}
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 22 || bytes.len() as u64 > MAX_BYTES || bytes[..4] != [0, 0, 1, 0] {
        return Err("icon-format".into());
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    if count == 0 || count > 32 || bytes.len() < 6 + 16 * count {
        return Err("icon-format".into());
    }
    for index in 0..count {
        let e = &bytes[6 + 16 * index..6 + 16 * (index + 1)];
        let size = |b: u8| if b == 0 { 256 } else { u32::from(b) };
        let (w, h) = (size(e[0]), size(e[1]));
        let len = u32::from_le_bytes(e[8..12].try_into().unwrap()) as usize;
        let start = u32::from_le_bytes(e[12..16].try_into().unwrap()) as usize;
        if w != h
            || w < 16
            || start < 6 + 16 * count
            || len < 40
            || start.checked_add(len).is_none_or(|end| end > bytes.len())
        {
            return Err("icon-format".into());
        }
        let frame = &bytes[start..start + len];
        if frame.starts_with(b"\x89PNG\r\n\x1a\n") {
            if frame.get(12..16) != Some(b"IHDR")
                || u32::from_be_bytes(frame[16..20].try_into().unwrap()) != w
                || u32::from_be_bytes(frame[20..24].try_into().unwrap()) != h
            {
                return Err("icon-format".into());
            }
        } else {
            let header = u32::from_le_bytes(frame[..4].try_into().unwrap());
            let bw = i32::from_le_bytes(frame[4..8].try_into().unwrap());
            let bh = i32::from_le_bytes(frame[8..12].try_into().unwrap());
            if header < 40 || header as usize > len || bw != w as i32 || bh != h as i32 * 2 {
                return Err("icon-format".into());
            }
        }
    }
    Ok(())
}
#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u32,
    file: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    custom: bool,
    preview: String,
    warning: Option<String>,
    can_change: bool,
    can_reset: bool,
    cancelled: bool,
    shortcuts: usize,
}
struct Handles {
    small: isize,
    large: isize,
}
impl Handles {
    fn load(path: Option<&Path>) -> Result<Self, String> {
        let text = path.map(|p| wide(&p.to_string_lossy()));
        let instance = if path.is_some() {
            null_mut()
        } else {
            unsafe { GetModuleHandleW(null()) }
        };
        let name = text
            .as_ref()
            .map_or(32512usize as *const u16, |v| v.as_ptr());
        let flags = if path.is_some() { LR_LOADFROMFILE } else { 0 };
        let small = unsafe { LoadImageW(instance, name, IMAGE_ICON, 16, 16, flags) } as isize;
        let large = unsafe { LoadImageW(instance, name, IMAGE_ICON, 32, 32, flags) } as isize;
        let handles = Self { small, large };
        if small == 0 || large == 0 {
            return Err("icon-format".into());
        }
        Ok(handles)
    }
    fn apply(&self, hwnd: isize) -> Result<(), String> {
        let hwnd = hwnd as *mut std::ffi::c_void;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Err("icon-window".into());
        }
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, self.small);
            SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, self.large);
            if SendMessageW(hwnd, WM_GETICON, ICON_SMALL as usize, 0) != self.small
                || SendMessageW(hwnd, WM_GETICON, ICON_BIG as usize, 0) != self.large
            {
                return Err("icon-window".into());
            }
        }
        Ok(())
    }
}
impl Drop for Handles {
    fn drop(&mut self) {
        unsafe {
            if self.small != 0 {
                DestroyIcon(self.small as _);
            }
            if self.large != 0 {
                DestroyIcon(self.large as _);
            }
        }
    }
}

pub struct Icons {
    root: PathBuf,
    hwnd: isize,
    handles: Option<Handles>,
    warning: Option<String>,
    shortcuts: usize,
}
impl Icons {
    pub fn new(root: PathBuf, hwnd: isize) -> Self {
        let mut icons = Self {
            root: root.join("appearance"),
            hwnd,
            handles: None,
            warning: None,
            shortcuts: 0,
        };
        let loaded = (|| {
            let rec = icons.record()?;
            let path = icons.asset(&rec)?;
            Handles::load(path.as_deref())
        })();
        match loaded {
            Ok(h) => match h.apply(hwnd) {
                Ok(()) => icons.handles = Some(h),
                Err(e) => icons.warning = Some(e),
            },
            Err(e) => icons.warning = Some(e),
        }
        icons
    }
    fn record(&self) -> Result<Record, String> {
        let path = self.root.join("icon.json");
        if !path.exists() {
            return Ok(Record {
                schema: 1,
                file: None,
            });
        }
        let bytes = read(&path, 4096).map_err(|_| "icon-record")?;
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "icon-record")?;
        if value
            .get("schema")
            .and_then(|v| v.as_u64())
            .is_some_and(|v| v > 1)
        {
            return Err("icon-future".into());
        }
        let r: Record = serde_json::from_value(value).map_err(|_| "icon-record")?;
        if r.schema != 1 || r.file.as_ref().is_some_and(|s| !valid_hash(s)) {
            return Err("icon-record".into());
        }
        Ok(r)
    }
    fn asset(&self, r: &Record) -> Result<Option<PathBuf>, String> {
        let Some(id) = &r.file else { return Ok(None) };
        let p = self.root.join("icons").join(format!("{id}.ico"));
        let bytes = read(&p, MAX_BYTES).map_err(|_| "icon-missing")?;
        if hash(&bytes) != *id {
            return Err("icon-missing".into());
        }
        validate(&bytes)?;
        Ok(Some(p))
    }
    fn location_for(&self, r: &Record) -> Result<String, String> {
        let p = match &r.file {
            Some(id) => self.root.join("icons").join(format!("{id}.ico")),
            None => std::env::current_exe().map_err(|_| "icon-read")?,
        };
        Ok(format!("\"{}\",0", p.to_string_lossy()))
    }
    pub fn location(&self) -> Result<Option<String>, String> {
        Ok(Some(self.location_for(&self.record()?)?))
    }
    pub fn view(&self, cancelled: bool) -> View {
        let record = self.record();
        let future = record.as_ref().err().is_some_and(|s| s == "icon-future");
        let custom = record.as_ref().is_ok_and(|r| r.file.is_some());
        let data = record
            .as_ref()
            .ok()
            .and_then(|r| self.asset(r).ok().flatten())
            .and_then(|p| read(&p, MAX_BYTES).ok());
        let missing = custom && data.is_none();
        let pending = self.root.join("icon.pending").exists();
        let warning = if future {
            Some("icon-future".into())
        } else if pending {
            Some("icon-pending".into())
        } else if missing {
            Some("icon-missing".into())
        } else {
            record.err().or(self.warning.clone())
        };
        View {
            custom,
            preview: format!(
                "data:image/x-icon;base64,{}",
                base64::engine::general_purpose::STANDARD
                    .encode(data.as_deref().unwrap_or(DEFAULT))
            ),
            can_change: warning.is_none(),
            can_reset: !future && (custom || warning.is_some()),
            warning,
            cancelled,
            shortcuts: self.shortcuts,
        }
    }
    fn test_failure(&self, stage: &str) -> bool {
        std::env::var("MDMD_INTEGRATION_TEST_ID")
            .ok()
            .and_then(|s| uuid::Uuid::parse_str(&s).ok())
            .is_some()
            && fs::read_to_string(self.root.join("icon-test-failure"))
                .is_ok_and(|s| s.trim() == stage)
    }
    pub fn change(&mut self, source: Option<PathBuf>) -> Result<View, String> {
        let _process_guard = integration::ProcessLock::icons()?;
        let old = self.record();
        if old.as_ref().err().is_some_and(|s| s == "icon-future") {
            return Err("icon-future".into());
        }
        if source.is_some() && !self.view(false).can_change {
            return Err("icon-recover".into());
        }
        let file = if let Some(source) = source {
            if !source
                .extension()
                .is_some_and(|s| s.eq_ignore_ascii_case("ico"))
            {
                return Err("icon-format".into());
            }
            let bytes = read(&source, MAX_BYTES)?;
            validate(&bytes)?;
            let id = hash(&bytes);
            let asset = self.root.join("icons").join(format!("{id}.ico"));
            if read(&asset, MAX_BYTES).ok().as_deref() != Some(bytes.as_slice()) {
                if !asset.exists()
                    && fs::read_dir(self.root.join("icons"))
                        .map(|d| d.count())
                        .unwrap_or(0)
                        >= 100
                {
                    return Err("icon-limit".into());
                }
                storage::write_atomic(&asset, &bytes).map_err(|_| "icon-write")?;
            }
            Some(id)
        } else {
            None
        };
        let next = Record { schema: 1, file };
        let path = self.asset(&next)?;
        let handles = Handles::load(path.as_deref())?;
        let location = self.location_for(&next)?;
        let exe = std::env::current_exe().map_err(|_| "icon-read")?;
        let link_icon = path.as_deref().unwrap_or(&exe);
        let mut links = prepare_links(&self.root, &exe, link_icon)?;
        let mut allowed = vec![format!("\"{}\",0", exe.to_string_lossy())];
        if let Ok(r) = &old {
            allowed.push(self.location_for(r)?);
        }
        if let Ok(files) = fs::read_dir(self.root.join("icons")) {
            for entry in files.flatten() {
                if entry
                    .path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(valid_hash)
                {
                    allowed.push(format!("\"{}\",0", entry.path().to_string_lossy()));
                }
            }
        }
        let state = self.root.join("icon.json");
        let previous = if state.exists() {
            Some(read(&state, MAX_BYTES)?)
        } else {
            None
        };
        // Preserve a corrupt record before explicit recovery; future schemas stay untouched.
        if old.is_err() {
            if let Some(bytes) = &previous {
                storage::write_atomic(
                    &self
                        .root
                        .join(format!("icon-invalid-{}.json", uuid::Uuid::new_v4())),
                    bytes,
                )
                .map_err(|_| "icon-write")?;
            }
        }
        storage::write_atomic(
            &self.root.join("icon.pending"),
            b"Incomplete icon update; restore default from Settings.",
        )
        .map_err(|_| "icon-write")?;
        let mut registry = None;
        let mut applied = 0;
        let result = (|| {
            handles.apply(self.hwnd)?;
            if self.test_failure("window") {
                return Err("icon-window".into());
            }
            registry = Some(integration::set_icons(&location, &allowed)?);
            if self.test_failure("registry") {
                return Err("icon-write".into());
            }
            for link in &mut links {
                if read(&link.path, 1024 * 1024)? != link.before {
                    return Err("icon-link-conflict".into());
                }
                storage::write_atomic(&link.path, &link.after).map_err(|_| "icon-shortcut")?;
                applied += 1;
                if self.test_failure("shortcut") {
                    return Err("icon-shortcut".into());
                }
            }
            if self.test_failure("persist") {
                return Err("icon-write".into());
            }
            let current = if state.exists() {
                Some(read(&state, MAX_BYTES)?)
            } else {
                None
            };
            if current != previous {
                return Err("icon-record-conflict".into());
            }
            storage::write_atomic(&state, &serde_json::to_vec(&next).unwrap())
                .map_err(|_| "icon-write")?;
            Ok(())
        })();
        if let Err(error) = result {
            let mut recovered = true;
            for link in links[..applied].iter().rev() {
                if read(&link.path, 1024 * 1024).ok() != Some(link.after.clone())
                    || storage::write_atomic(&link.path, &link.before).is_err()
                {
                    recovered = false;
                }
            }
            if registry.as_ref().is_some_and(|u| u.restore().is_err()) {
                recovered = false;
            }
            if let Some(old) = &self.handles {
                if old.apply(self.hwnd).is_err() {
                    recovered = false;
                }
            } else {
                match Handles::load(None) {
                    Ok(h) => {
                        if h.apply(self.hwnd).is_err() {
                            recovered = false;
                        }
                        self.handles = Some(h)
                    }
                    Err(_) => recovered = false,
                }
            }
            if recovered {
                let _ = fs::remove_file(self.root.join("icon.pending"));
            } else {
                self.warning = Some("icon-rollback".into());
                return Err("icon-rollback".into());
            }
            return Err(error);
        }
        self.handles = Some(handles);
        self.warning = None;
        self.shortcuts = links.len();
        if fs::remove_file(self.root.join("icon.pending")).is_err() {
            self.warning = Some("icon-pending".into());
        }
        integration::notify_icons();
        Ok(self.view(false))
    }
}

struct Com;
impl Com {
    fn new() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|_| "icon-shortcut")?;
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}
struct LinkChange {
    path: PathBuf,
    before: Vec<u8>,
    after: Vec<u8>,
}
fn folder(id: &windows::core::GUID) -> Result<PathBuf, String> {
    let p =
        unsafe { SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) }.map_err(|_| "icon-shortcut")?;
    let s = unsafe { p.to_string() };
    unsafe { CoTaskMemFree(Some(p.0.cast())) };
    Ok(PathBuf::from(s.map_err(|_| "icon-shortcut")?))
}
fn prepare_links(root: &Path, exe: &Path, icon: &Path) -> Result<Vec<LinkChange>, String> {
    let _com = Com::new()?;
    let roots = match std::env::var("MDMD_INTEGRATION_TEST_ID") {
        Ok(id) => {
            uuid::Uuid::parse_str(&id).map_err(|_| "icon-test-context")?;
            vec![(root.join("test-shortcuts"), 8)]
        }
        Err(std::env::VarError::NotPresent) => vec![
            (folder(&FOLDERID_Desktop)?, 0),
            (folder(&FOLDERID_Programs)?, 8),
            (
                folder(&FOLDERID_RoamingAppData)?
                    .join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"),
                0,
            ),
        ],
        Err(_) => return Err("icon-test-context".into()),
    };
    let mut stack: Vec<_> = roots.into_iter().map(|(p, limit)| (p, 0, limit)).collect();
    let mut scanned = 0;
    let mut result = Vec::new();
    while let Some((dir, depth, limit)) = stack.pop() {
        if !dir.exists() {
            continue;
        }
        for item in fs::read_dir(dir).map_err(|_| "icon-shortcut")? {
            let item = item.map_err(|_| "icon-shortcut")?;
            let path = item.path();
            let meta = fs::symlink_metadata(&path).map_err(|_| "icon-shortcut")?;
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            scanned += 1;
            if scanned > 10000 {
                return Err("icon-scan-limit".into());
            }
            if meta.is_dir() {
                if depth < limit {
                    stack.push((path, depth + 1, limit));
                }
                continue;
            }
            if !path
                .extension()
                .is_some_and(|s| s.eq_ignore_ascii_case("lnk"))
            {
                continue;
            }
            let link: IShellLinkW =
                unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
                    .map_err(|_| "icon-shortcut")?;
            let persist: IPersistFile = link.cast().map_err(|_| "icon-shortcut")?;
            if unsafe { persist.Load(PCWSTR(wide(&path.to_string_lossy()).as_ptr()), STGM_READ) }
                .is_err()
            {
                continue;
            }
            let mut target = vec![0u16; 32768];
            if unsafe { link.GetPath(&mut target, null_mut(), SLGP_RAWPATH.0 as u32) }.is_err() {
                continue;
            }
            let target = String::from_utf16_lossy(
                &target[..target.iter().position(|c| *c == 0).unwrap_or(target.len())],
            );
            let same = Path::new(&target)
                .canonicalize()
                .ok()
                .zip(exe.canonicalize().ok())
                .is_some_and(|(a, b)| {
                    a.to_string_lossy()
                        .eq_ignore_ascii_case(&b.to_string_lossy())
                });
            if !same {
                continue;
            }
            if meta.permissions().readonly() {
                return Err("icon-shortcut".into());
            }
            let before = read(&path, 1024 * 1024)?;
            unsafe { link.SetIconLocation(PCWSTR(wide(&icon.to_string_lossy()).as_ptr()), 0) }
                .map_err(|_| "icon-shortcut")?;
            fs::create_dir_all(root).map_err(|_| "icon-write")?;
            let temp = root.join(format!(".icon-link-{}.lnk", uuid::Uuid::new_v4()));
            let saved =
                unsafe { persist.Save(PCWSTR(wide(&temp.to_string_lossy()).as_ptr()), false) };
            let after = if saved.is_ok() {
                read(&temp, 1024 * 1024)
            } else {
                Err("icon-shortcut".into())
            };
            let _ = fs::remove_file(temp);
            result.push(LinkChange {
                path,
                before,
                after: after?,
            });
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_ico_validation() {
        validate(DEFAULT).unwrap();
        for bytes in [
            vec![],
            vec![0; 50],
            b"not an ico".to_vec(),
            DEFAULT[..20].to_vec(),
        ] {
            assert!(validate(&bytes).is_err());
        }
        let mut bad = DEFAULT.to_vec();
        bad[6] = 15;
        assert!(validate(&bad).is_err());
        let mut bad = DEFAULT.to_vec();
        bad[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(validate(&bad).is_err());
        assert!(!valid_hash("../icon"));
        assert!(valid_hash(&hash(DEFAULT)));
    }
}
