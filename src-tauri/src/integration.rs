//! Per-user shell integration. No UserChoice writes and no account/activation.
use serde::{Deserialize, Serialize};
use std::{ptr::null, ptr::null_mut, sync::Mutex};
use windows_sys::Win32::{
    Foundation::*,
    System::Registry::*,
    System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
    UI::{Shell::*, WindowsAndMessaging::SW_SHOWNORMAL},
};

static LOCK: Mutex<()> = Mutex::new(());
const PROG_ID: &str = "MDMD.Markdown";
const CAPABILITIES: &str = r"Software\MDMD\Capabilities";
const APPLICATION: &str = r"Software\Classes\Applications\mdmd.exe";
const MENU: &str = r"Software\Classes\SystemFileAssociations\.md\shell\MDMD.Open";

fn classify_default(prog: Option<&str>, exe: Option<&str>, own: &str) -> &'static str {
    let same = |a: &str, b: &str| {
        a.trim_start_matches(r"\\?\")
            .eq_ignore_ascii_case(b.trim_start_matches(r"\\?\"))
    };
    if exe.is_some_and(|s| same(s, own)) {
        "current"
    } else if prog.is_some_and(|s| s.eq_ignore_ascii_case(PROG_ID)) {
        // A stale/overridden MDMD ProgID is not proof that this executable opens .md.
        "unknown"
    } else if prog.is_some() || exe.is_some() {
        "other"
    } else {
        "unknown"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    Refresh,
    SetDefault,
    RemoveAssociation,
    AddMenu,
    RemoveMenu,
    DefaultSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    association: &'static str,
    menu: &'static str,
    default_app: &'static str,
    executable: String,
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn check(code: u32) -> Result<(), String> {
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("registry:{code}"))
    }
}
struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            RegCloseKey(self.0);
        }
    }
}
pub(crate) struct ProcessLock(HANDLE);
impl ProcessLock {
    fn new() -> Result<Self, String> {
        Self::named(r"Local\MDMD.SystemIntegration")
    }
    pub(crate) fn icons() -> Result<Self, String> {
        Self::named(r"Local\MDMD.ApplicationIcon")
    }
    fn named(name: &str) -> Result<Self, String> {
        let handle = unsafe { CreateMutexW(null(), 0, wide(name).as_ptr()) };
        if handle.is_null() {
            return Err("busy".into());
        }
        match unsafe { WaitForSingleObject(handle, 5000) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(Self(handle)),
            _ => {
                unsafe {
                    CloseHandle(handle);
                }
                Err("busy".into())
            }
        }
    }
}
impl Drop for ProcessLock {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Value {
    kind: u32,
    bytes: Vec<u8>,
}
impl Value {
    fn text(&self) -> Option<String> {
        if self.kind != REG_SZ || self.bytes.len() % 2 != 0 {
            return None;
        }
        let units: Vec<u16> = self
            .bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        let text = String::from_utf16(&units).ok()?;
        let text = text.strip_suffix('\0')?;
        (!text.contains('\0')).then(|| text.to_string())
    }
    fn string(text: &str) -> Self {
        Self {
            kind: REG_SZ,
            bytes: wide(text).iter().flat_map(|c| c.to_le_bytes()).collect(),
        }
    }
}
struct Entry {
    key: String,
    name: &'static str,
    value: Value,
}
fn entry(key: impl Into<String>, name: &'static str, value: &str) -> Entry {
    Entry {
        key: key.into(),
        name,
        value: Value::string(value),
    }
}
struct Context {
    prefix: String,
    exe: String,
    icon: Option<String>,
}
impl Context {
    fn current() -> Result<Self, String> {
        // Tests can only redirect into this fixed UUID namespace, never an arbitrary key.
        let prefix = match std::env::var("MDMD_INTEGRATION_TEST_ID") {
            Ok(id) => format!(
                r"Software\MDMD\IntegrationTests\{}\",
                uuid::Uuid::parse_str(&id).map_err(|_| "test-context")?
            ),
            Err(std::env::VarError::NotPresent) => String::new(),
            Err(_) => return Err("test-context".into()),
        };
        let exe = std::env::current_exe()
            .map_err(|_| "executable")?
            .into_os_string()
            .into_string()
            .map_err(|_| "executable")?;
        if exe.contains(['"', '\0']) {
            return Err("executable".into());
        }
        Ok(Self {
            prefix,
            exe,
            icon: None,
        })
    }
    fn open(&self, path: &str, write: bool, create: bool) -> Result<Option<Key>, String> {
        let path = wide(&format!("{}{path}", self.prefix));
        let mut key = null_mut();
        let code = unsafe {
            if create {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    path.as_ptr(),
                    0,
                    null(),
                    0,
                    KEY_READ | KEY_WRITE,
                    null(),
                    &mut key,
                    null_mut(),
                )
            } else {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    path.as_ptr(),
                    0,
                    if write {
                        KEY_READ | KEY_WRITE
                    } else {
                        KEY_READ
                    },
                    &mut key,
                )
            }
        };
        if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
            return Ok(None);
        }
        check(code)?;
        Ok(Some(Key(key)))
    }
    fn read(&self, path: &str, name: &str) -> Result<Option<Value>, String> {
        let Some(key) = self.open(path, false, false)? else {
            return Ok(None);
        };
        let name = wide(name);
        let mut kind = 0;
        let mut size = 0;
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                null(),
                &mut kind,
                null_mut(),
                &mut size,
            )
        };
        if result == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        check(result)?;
        if size > 65536 {
            return Err("conflict".into());
        }
        let mut bytes = vec![0; size as usize];
        check(unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                null(),
                &mut kind,
                bytes.as_mut_ptr(),
                &mut size,
            )
        })?;
        bytes.truncate(size as usize);
        Ok(Some(Value { kind, bytes }))
    }
    fn entries(&self, menu: bool) -> Vec<Entry> {
        let command = format!("\"{}\" \"%1\"", self.exe);
        let icon = self
            .icon
            .clone()
            .unwrap_or_else(|| format!("\"{}\",0", self.exe));
        if menu {
            return vec![
                entry(MENU, "", "MDMD"),
                entry(MENU, "MDMD.Owner", &self.exe),
                entry(MENU, "Icon", &icon),
                entry(MENU, "MultiSelectModel", "Single"),
                entry(format!(r"{MENU}\command"), "", &command),
            ];
        }
        let prog = format!(r"Software\Classes\{PROG_ID}");
        vec![
            entry(&prog, "", "MDMD Markdown"),
            entry(&prog, "MDMD.Owner", &self.exe),
            entry(format!(r"{prog}\DefaultIcon"), "", &icon),
            entry(format!(r"{prog}\shell\open\command"), "", &command),
            Entry {
                key: r"Software\Classes\.md\OpenWithProgids".into(),
                name: PROG_ID,
                value: Value {
                    kind: REG_NONE,
                    bytes: vec![],
                },
            },
            entry(CAPABILITIES, "ApplicationName", "MDMD"),
            entry(
                CAPABILITIES,
                "ApplicationDescription",
                "MDMD Markdown reader and editor",
            ),
            entry(CAPABILITIES, "MDMD.Owner", &self.exe),
            entry(format!(r"{CAPABILITIES}\FileAssociations"), ".md", PROG_ID),
            entry(r"Software\RegisteredApplications", "MDMD", CAPABILITIES),
            entry(APPLICATION, "FriendlyAppName", "MDMD"),
            entry(APPLICATION, "MDMD.Owner", &self.exe),
            entry(format!(r"{APPLICATION}\DefaultIcon"), "", &icon),
            entry(format!(r"{APPLICATION}\shell\open\command"), "", &command),
            entry(format!(r"{APPLICATION}\SupportedTypes"), ".md", ""),
            // Default-app Settings and the ProgID-based chooser use application
            // metadata, not only the document's DefaultIcon.
            entry(CAPABILITIES, "ApplicationIcon", &icon),
            entry(format!(r"{prog}\Application"), "ApplicationName", "MDMD"),
            entry(format!(r"{prog}\Application"), "ApplicationIcon", &icon),
        ]
    }
    // Only a missing executable with a consistent MDMD registration may be replaced.
    // A live second copy, inaccessible path or modified command remains a conflict.
    fn stale_registration(&self, menu: bool) -> Result<Option<Self>, String> {
        let prog = format!(r"Software\Classes\{PROG_ID}");
        let owner = if menu { MENU } else { &prog };
        let Some(exe) = self.read(owner, "MDMD.Owner")?.and_then(|v| v.text()) else {
            return Ok(None);
        };
        let path = std::path::Path::new(&exe);
        if exe.eq_ignore_ascii_case(&self.exe)
            || exe.contains(['"', '\0'])
            || !path.is_absolute()
            || exe.starts_with(r"\\")
            || !path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("mdmd.exe"))
            || !matches!(path.try_exists(), Ok(false))
        {
            return Ok(None);
        }
        let previous = Self {
            prefix: self.prefix.clone(),
            exe,
            icon: None,
        };
        // Require the original ownership and launch target, even for partial records.
        if self.read(
            &format!(
                r"{owner}\{}",
                if menu {
                    "command"
                } else {
                    r"shell\open\command"
                }
            ),
            "",
        )? != Some(Value::string(&format!("\"{}\" \"%1\"", previous.exe)))
            || (!menu
                && self.read(CAPABILITIES, "MDMD.Owner")? != Some(Value::string(&previous.exe)))
        {
            return Ok(None);
        }
        for e in previous.entries(menu) {
            if self.read(&e.key, e.name)?.is_some_and(|v| v != e.value) {
                return Ok(None);
            }
        }
        Ok(Some(previous))
    }
    fn status(&self, menu: bool) -> Result<&'static str, String> {
        let mut present = 0;
        let entries = self.entries(menu);
        for e in &entries {
            if let Some(value) = self.read(&e.key, e.name)? {
                if value != e.value {
                    return Ok(if self.stale_registration(menu)?.is_some() {
                        "stale"
                    } else {
                        "conflict"
                    });
                }
                present += 1;
            }
        }
        Ok(if present == entries.len() {
            "ready"
        } else if present == 0 {
            "absent"
        } else {
            "partial"
        })
    }
    fn default_app(&self) -> Result<&'static str, String> {
        if !self.prefix.is_empty() {
            return Ok(match self.read("Control", "Default")? {
                Some(v) if v == Value::string("MDMD") => "current",
                Some(v) if v == Value::string("unknown") => "unknown",
                _ => "other",
            });
        }
        let query = |kind| {
            let mut buffer = vec![0u16; 32768];
            let mut size = buffer.len() as u32;
            let result = unsafe {
                AssocQueryStringW(
                    ASSOCF_NOTRUNCATE,
                    kind,
                    wide(".md").as_ptr(),
                    null(),
                    buffer.as_mut_ptr(),
                    &mut size,
                )
            };
            if result < 0 {
                return None;
            }
            Some(String::from_utf16_lossy(
                &buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())],
            ))
        };
        let prog = query(ASSOCSTR_PROGID);
        let exe = query(ASSOCSTR_EXECUTABLE);
        Ok(classify_default(prog.as_deref(), exe.as_deref(), &self.exe))
    }
    fn view(&self) -> Result<View, String> {
        Ok(View {
            association: self.status(false)?,
            menu: self.status(true)?,
            default_app: self.default_app()?,
            executable: self.exe.clone(),
        })
    }
    fn settings(&self) -> Result<(), String> {
        if !self.prefix.is_empty() {
            if self.read("Control", "LaunchFailure")?.is_some() {
                return Err("settings-launch".into());
            }
            return Ok(());
        }
        let result = unsafe {
            ShellExecuteW(
                null_mut(),
                wide("open").as_ptr(),
                wide("ms-settings:defaultapps?registeredAppUser=MDMD").as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            Err("settings-launch".into())
        } else {
            Ok(())
        }
    }
    fn write(&self, entry: &Entry, value: Option<&Value>) -> Result<(), String> {
        if let Some(key) = self.open(&entry.key, true, value.is_some())? {
            let code = unsafe {
                match value {
                    Some(v) => RegSetValueExW(
                        key.0,
                        wide(entry.name).as_ptr(),
                        0,
                        v.kind,
                        v.bytes.as_ptr(),
                        v.bytes.len() as u32,
                    ),
                    None => RegDeleteValueW(key.0, wide(entry.name).as_ptr()),
                }
            };
            if !(value.is_none() && code == ERROR_FILE_NOT_FOUND) {
                check(code)?;
            }
        }
        Ok(())
    }
    fn prune(&self, entries: &[Entry]) -> Result<(), String> {
        let mut paths = std::collections::BTreeSet::new();
        let prog = format!(r"Software\Classes\{PROG_ID}");
        for e in entries {
            // Shared .md/OpenWithProgids and RegisteredApplications containers stay intact.
            let Some(root) = [prog.as_str(), CAPABILITIES, MENU, APPLICATION]
                .into_iter()
                .find(|root| e.key == *root || e.key.starts_with(&format!("{root}\\")))
            else {
                continue;
            };
            let mut p = e.key.as_str();
            loop {
                paths.insert(p.to_string());
                if p == root {
                    break;
                }
                p = p.rsplit_once('\\').unwrap().0;
            }
        }
        for p in paths.iter().rev() {
            if let Some(key) = self.open(p, true, false)? {
                let (mut children, mut values) = (0, 0);
                check(unsafe {
                    RegQueryInfoKeyW(
                        key.0,
                        null_mut(),
                        null_mut(),
                        null(),
                        &mut children,
                        null_mut(),
                        null_mut(),
                        &mut values,
                        null_mut(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                })?;
                drop(key);
                if children == 0 && values == 0 {
                    // RegDeleteKey refuses nonempty subkeys. Never recursively delete production keys.
                    check(unsafe {
                        RegDeleteKeyW(
                            HKEY_CURRENT_USER,
                            wide(&format!("{}{p}", self.prefix)).as_ptr(),
                        )
                    })?;
                }
            }
        }
        Ok(())
    }
    fn mutate(&self, menu: bool, remove: bool) -> Result<(), String> {
        let entries = self.entries(menu);
        let previous = if remove {
            None
        } else {
            self.stale_registration(menu)?
        };
        let previous_entries = previous.as_ref().map(|c| c.entries(menu));
        let mut before = Vec::new();
        for (index, e) in entries.iter().enumerate() {
            let old = self.read(&e.key, e.name)?;
            if old.as_ref().is_some_and(|v| {
                *v != e.value
                    && !previous_entries
                        .as_ref()
                        .is_some_and(|entries| *v == entries[index].value)
            }) {
                return Err("conflict".into());
            }
            before.push(old);
        }
        let mut changed = Vec::new();
        let result = (|| {
            for (index, e) in entries.iter().enumerate() {
                if previous.as_ref().is_some_and(|c| {
                    !matches!(std::path::Path::new(&c.exe).try_exists(), Ok(false))
                }) {
                    return Err("conflict".into());
                }
                if self.read(&e.key, e.name)? != before[index] {
                    return Err("conflict".into());
                }
                let wanted = if remove { None } else { Some(&e.value) };
                if before[index].as_ref() != wanted {
                    self.write(e, wanted)?;
                    changed.push(index);
                }
                if !self.prefix.is_empty()
                    && self.read("Control", "FailAfter")?
                        == Some(Value::string(&(index + 1).to_string()))
                {
                    return Err("injected-failure".into());
                }
            }
            if remove {
                self.prune(&entries)?;
            }
            if self.status(menu)? != if remove { "absent" } else { "ready" } {
                return Err("conflict".into());
            }
            Ok(())
        })();
        if result.is_err() {
            let mut recovered = true;
            for &index in changed.iter().rev() {
                let e = &entries[index];
                let written = if remove { None } else { Some(e.value.clone()) };
                // Do not overwrite another program's intervening changes during rollback.
                if self.read(&e.key, e.name).ok() != Some(written)
                    || self.write(e, before[index].as_ref()).is_err()
                {
                    recovered = false;
                }
            }
            if self.prune(&entries).is_err() {
                recovered = false;
            }
            if !recovered {
                return Err("rollback-failed".into());
            }
        }
        if self.prefix.is_empty() {
            unsafe {
                SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, null(), null());
            }
        }
        result
    }
}

pub struct IconUndo(Vec<(Entry, Value)>);
impl IconUndo {
    pub fn restore(&self) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|_| "busy")?;
        let _process_guard = ProcessLock::new()?;
        let context = Context::current()?;
        let mut failed = false;
        for (entry, previous) in self.0.iter().rev() {
            if context.read(&entry.key, entry.name).ok() != Some(Some(entry.value.clone()))
                || context.write(entry, Some(previous)).is_err()
            {
                failed = true;
            }
        }
        notify_icons();
        if failed {
            Err("icon-rollback".into())
        } else {
            Ok(())
        }
    }
}
pub fn notify_icons() {
    if std::env::var_os("MDMD_INTEGRATION_TEST_ID").is_none() {
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, null(), null());
        }
    }
}
pub fn set_icons(value: &str, allowed: &[String]) -> Result<IconUndo, String> {
    let mut undo = IconUndo(Vec::new());
    let result = {
        let _guard = LOCK.lock().map_err(|_| "busy")?;
        let _process_guard = ProcessLock::new()?;
        let context = Context::current()?;
        (|| {
            let prog = format!(r"Software\Classes\{PROG_ID}");
            let targets = [
                (format!(r"{prog}\DefaultIcon"), "", prog.clone()),
                (MENU.into(), "Icon", MENU.into()),
                (
                    format!(r"{APPLICATION}\DefaultIcon"),
                    "",
                    APPLICATION.into(),
                ),
                (CAPABILITIES.into(), "ApplicationIcon", CAPABILITIES.into()),
                (format!(r"{prog}\Application"), "ApplicationIcon", prog),
            ];
            let mut changes = Vec::new();
            for (key, name, owner) in targets {
                if let Some(previous) = context.read(&key, name)? {
                    if context.read(&owner, "MDMD.Owner")? != Some(Value::string(&context.exe))
                        || !allowed.iter().any(|v| Value::string(v) == previous)
                    {
                        return Err("icon-conflict".into());
                    }
                    changes.push((entry(key, name, value), previous));
                }
            }
            for (entry, previous) in changes {
                if context.read(&entry.key, entry.name)? != Some(previous.clone()) {
                    return Err("icon-conflict".into());
                }
                if entry.value != previous {
                    context.write(&entry, Some(&entry.value))?;
                    undo.0.push((entry, previous));
                }
            }
            Ok(())
        })()
    };
    if let Err(error) = result {
        undo.restore()?;
        return Err(error);
    }
    notify_icons();
    Ok(undo)
}

pub fn execute(action: Action, icon: Option<String>) -> Result<View, String> {
    let _guard = LOCK.lock().map_err(|_| "busy")?;
    let _process_guard = ProcessLock::new()?;
    let mut context = Context::current()?;
    context.icon = icon;
    match action {
        Action::Refresh => {}
        Action::SetDefault => {
            context.mutate(false, false)?;
            context.settings()?;
        }
        Action::RemoveAssociation => {
            if context.status(false)? != "absent" {
                match context.default_app()? {
                    "current" => {
                        context.settings()?;
                        return Err("choose-other".into());
                    }
                    "unknown" => return Err("default-unknown".into()),
                    _ => context.mutate(false, true)?,
                }
            }
        }
        Action::AddMenu => context.mutate(true, false)?,
        Action::RemoveMenu => context.mutate(true, true)?,
        Action::DefaultSettings => context.settings()?,
    }
    context.view()
}

// Called only by this installation's uninstaller, before deleting its binary.
// Other installations and UserChoice remain untouched. A conflict blocks removal.
pub fn uninstall() -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "busy")?;
    let _process_guard = ProcessLock::new()?;
    let mut context = Context::current()?;
    context.remove_owned()
}

impl Context {
    fn remove_owned(&mut self) -> Result<(), String> {
        let prog = format!(r"Software\Classes\{PROG_ID}");
        for menu in [true, false] {
            let owner = if menu { MENU } else { &prog };
            if self.read(owner, "MDMD.Owner")? != Some(Value::string(&self.exe)) {
                continue;
            }
            let (key, name) = if menu {
                (MENU.to_string(), "Icon")
            } else {
                (format!(r"{prog}\DefaultIcon"), "")
            };
            self.icon = match self.read(&key, name)? {
                None => None,
                Some(v) if v.kind == REG_SZ && v.bytes.len() % 2 == 0 => {
                    let units: Vec<u16> = v
                        .bytes
                        .chunks_exact(2)
                        .map(|b| u16::from_le_bytes([b[0], b[1]]))
                        .collect();
                    let text = String::from_utf16(&units).map_err(|_| "conflict")?;
                    Some(text.trim_end_matches('\0').to_string())
                }
                _ => return Err("conflict".into()),
            };
            self.mutate(menu, true)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repairs_only_missing_owned_paths_with_rollback_and_application_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let old_exe = directory.path().join("mdmd.exe");
        std::fs::write(&old_exe, b"test executable placeholder").unwrap();
        let old = Context {
            prefix: format!(r"Software\MDMD\IntegrationTests\{}\", uuid::Uuid::new_v4()),
            exe: old_exe.to_str().unwrap().into(),
            icon: None,
        };
        let current = Context {
            prefix: old.prefix.clone(),
            exe: directory
                .path()
                .join("installed/mdmd.exe")
                .to_str()
                .unwrap()
                .into(),
            icon: None,
        };
        old.mutate(false, false).unwrap();
        // Reproduce registrations created before Applications metadata was added.
        for e in old
            .entries(false)
            .iter()
            .filter(|e| e.key.starts_with(APPLICATION))
        {
            old.write(e, None).unwrap();
        }
        assert_eq!(current.status(false).unwrap(), "conflict");
        assert_eq!(current.mutate(false, false).unwrap_err(), "conflict");
        std::fs::remove_file(&old_exe).unwrap();
        assert_eq!(current.status(false).unwrap(), "stale");
        let command = entry(
            format!(r"Software\Classes\{PROG_ID}\shell\open\command"),
            "",
            "foreign-command",
        );
        let original = old.read(&command.key, "").unwrap();
        old.write(&command, Some(&command.value)).unwrap();
        assert_eq!(current.mutate(false, false).unwrap_err(), "conflict");
        old.write(&command, original.as_ref()).unwrap();
        let choice = entry(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice",
            "ProgId",
            "Other.App",
        );
        let foreign = entry(
            format!(r"Software\Classes\{PROG_ID}"),
            "Foreign.Value",
            "preserve",
        );
        old.write(&choice, Some(&choice.value)).unwrap();
        old.write(&foreign, Some(&foreign.value)).unwrap();
        let before: Vec<_> = old
            .entries(false)
            .iter()
            .map(|e| old.read(&e.key, e.name).unwrap())
            .collect();
        let fail = entry("Control", "FailAfter", "4");
        old.write(&fail, Some(&fail.value)).unwrap();
        assert_eq!(
            current.mutate(false, false).unwrap_err(),
            "injected-failure"
        );
        for (e, value) in old.entries(false).iter().zip(before) {
            assert_eq!(old.read(&e.key, e.name).unwrap(), value);
        }
        old.write(&fail, None).unwrap();
        current.mutate(false, false).unwrap();
        assert_eq!(current.status(false).unwrap(), "ready");
        assert_eq!(
            current.read(APPLICATION, "FriendlyAppName").unwrap(),
            Some(Value::string("MDMD"))
        );
        assert_eq!(
            current
                .read(&format!(r"{APPLICATION}\DefaultIcon"), "")
                .unwrap(),
            Some(Value::string(&format!("\"{}\",0", current.exe)))
        );
        assert_eq!(
            current
                .read(&format!(r"{APPLICATION}\shell\open\command"), "")
                .unwrap(),
            Some(Value::string(&format!("\"{}\" \"%1\"", current.exe)))
        );
        current.mutate(false, false).unwrap();
        current.mutate(false, true).unwrap();
        assert_eq!(current.status(false).unwrap(), "absent");
        assert_eq!(
            current.read(&choice.key, choice.name).unwrap(),
            Some(choice.value)
        );
        assert_eq!(
            current.read(&foreign.key, foreign.name).unwrap(),
            Some(foreign.value)
        );
        // Only this generated test UUID is removed, never real file associations.
        check(unsafe {
            RegDeleteTreeW(
                HKEY_CURRENT_USER,
                wide(old.prefix.trim_end_matches('\\')).as_ptr(),
            )
        })
        .unwrap();
        unsafe {
            RegDeleteKeyW(
                HKEY_CURRENT_USER,
                wide(old.prefix.trim_end_matches('\\')).as_ptr(),
            );
        }
    }
    #[test]
    fn uninstall_preserves_foreign_owners_and_rolls_back_conflicts() {
        let mut context = Context {
            prefix: format!(r"Software\MDMD\IntegrationTests\{}\", uuid::Uuid::new_v4()),
            exe: r"D:\中文 空格\MDMD.exe".into(),
            icon: Some(r#""D:\数据\custom.ico",0"#.into()),
        };
        context.mutate(true, false).unwrap();
        context.mutate(false, false).unwrap();
        let foreign = entry(MENU, "Foreign.Value", "preserve");
        context.write(&foreign, Some(&foreign.value)).unwrap();
        let command = entry(format!(r"{MENU}\command"), "", "foreign-command");
        let original = context.read(&command.key, "").unwrap();
        context.write(&command, Some(&command.value)).unwrap();
        assert!(context.remove_owned().is_err());
        assert_eq!(
            context.read(MENU, "MDMD.Owner").unwrap(),
            Some(Value::string(&context.exe))
        );
        context.write(&command, original.as_ref()).unwrap();
        let owner = entry(MENU, "MDMD.Owner", r"D:\other\MDMD.exe");
        context.write(&owner, Some(&owner.value)).unwrap();
        context.remove_owned().unwrap();
        assert_eq!(
            context.read(MENU, "MDMD.Owner").unwrap(),
            Some(owner.value.clone())
        );
        assert_eq!(context.status(false).unwrap(), "absent");
        context
            .write(&owner, Some(&Value::string(&context.exe)))
            .unwrap();
        context.remove_owned().unwrap();
        assert_eq!(context.status(true).unwrap(), "absent");
        assert_eq!(
            context.read(MENU, "Foreign.Value").unwrap(),
            Some(foreign.value)
        );
        // Delete only the generated test UUID subtree.
        check(unsafe {
            RegDeleteTreeW(
                HKEY_CURRENT_USER,
                wide(context.prefix.trim_end_matches('\\')).as_ptr(),
            )
        })
        .unwrap();
        unsafe {
            RegDeleteKeyW(
                HKEY_CURRENT_USER,
                wide(context.prefix.trim_end_matches('\\')).as_ptr(),
            );
        }
    }
    #[test]
    fn actual_executable_not_only_progid_proves_default() {
        let own = r"D:\中文 空格\MDMD.exe";
        assert_eq!(classify_default(Some(PROG_ID), Some(own), own), "current");
        assert_eq!(
            classify_default(None, Some(r"\\?\D:\中文 空格\mdmd.EXE"), own),
            "current"
        );
        assert_eq!(
            classify_default(Some(PROG_ID), Some(r"C:\other\app.exe"), own),
            "unknown"
        );
        assert_eq!(classify_default(Some(PROG_ID), None, own), "unknown");
        assert_eq!(classify_default(Some("Other.App"), None, own), "other");
        assert_eq!(classify_default(None, None, own), "unknown");
    }
    #[test]
    fn quoted_unicode_commands_and_registry_roundtrip() {
        let context = Context {
            prefix: format!(r"Software\MDMD\IntegrationTests\{}\", uuid::Uuid::new_v4()),
            exe: r"D:\中文 空格\MDMD.exe".into(),
            icon: None,
        };
        assert_eq!(context.status(false).unwrap(), "absent");
        for menu in [false, true] {
            context.mutate(menu, false).unwrap();
            context.mutate(menu, false).unwrap();
            assert_eq!(context.status(menu).unwrap(), "ready");
            let entries = context.entries(menu);
            assert!(entries
                .iter()
                .any(|e| e.value == Value::string(r#""D:\中文 空格\MDMD.exe" "%1""#)));
            context.mutate(menu, true).unwrap();
            context.mutate(menu, true).unwrap();
            assert_eq!(context.status(menu).unwrap(), "absent");
        }
        // Scoped cleanup of only this test's UUID root (not production registration).
        check(unsafe {
            RegDeleteTreeW(
                HKEY_CURRENT_USER,
                wide(context.prefix.trim_end_matches('\\')).as_ptr(),
            )
        })
        .unwrap();
        unsafe {
            RegDeleteKeyW(
                HKEY_CURRENT_USER,
                wide(context.prefix.trim_end_matches('\\')).as_ptr(),
            );
        }
    }
}
