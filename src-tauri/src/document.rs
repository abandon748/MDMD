use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn io_error(error: std::io::Error) -> String {
    format!("文件操作失败：{error}。修改仍保留在编辑区。")
}
pub fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take((MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() > MAX_BYTES {
                return Err("磁盘文件超过 20 MB，已停止操作。".into());
            }
            Ok(Some(bytes))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error(e)),
    }
}
fn current_hash(path: &Path) -> Result<Option<String>> {
    Ok(read_optional(path)?.map(|b| hash(&b)))
}
pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.trim_start_matches(r"\\?\").to_string()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub content: String,
    pub revision: u64,
    pub dirty: bool,
    pub bom: bool,
    pub eol: String,
    pub read_only: bool,
    pub read_only_reason: String,
    pub external: bool,
    pub backup_path: Option<String>,
}
#[derive(Clone)]
pub struct Document {
    pub state: Snapshot,
    path: Option<PathBuf>,
    saved: String,
    disk_hash: Option<String>,
}
impl Document {
    pub fn new() -> Self {
        Self {
            state: Snapshot {
                id: Uuid::new_v4().to_string(),
                path: None,
                name: "未命名.md".into(),
                content: String::new(),
                revision: 0,
                dirty: false,
                bom: false,
                eol: "LF".into(),
                read_only: false,
                read_only_reason: String::new(),
                external: false,
                backup_path: None,
            },
            path: None,
            saved: String::new(),
            disk_hash: None,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state.clone()
    }
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
    pub fn create(path: &Path) -> Result<Self> {
        let target = Self::new_target(path)?;
        let mut doc = Self::new();
        // None requires an absent target; atomic_save also refuses racing creations.
        doc.save(&target, None)?;
        Ok(doc)
    }
    fn new_target(path: &Path) -> Result<PathBuf> {
        let mut path = path.to_path_buf();
        match path.extension().and_then(|s| s.to_str()) {
            None => {
                path.set_extension("md");
            }
            Some(ext) if ext.eq_ignore_ascii_case("md") => {}
            _ => return Err("新建文件仅支持 .md 扩展名，请重新选择文件名。".into()),
        }
        let target = fs::canonicalize(path.parent().ok_or("无效保存目录")?)
            .map_err(io_error)?
            .join(path.file_name().ok_or("无效文件名")?);
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                return Err("同名文件或目录已存在，新建不会覆盖。请重新选择名称或位置。".into())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_error(e)),
        }
        Ok(target)
    }
    pub fn editable_copy(&self, path: &Path) -> Result<Self> {
        if !self.state.read_only {
            return Err("仅混合换行的只读文档需要创建可编辑副本。".into());
        }
        if current_hash(self.path().ok_or("无效源文件")?)? != self.disk_hash {
            return Err("源文件已变化或被删除，请先重新载入再创建可编辑副本。".into());
        }
        let target = Self::new_target(path)?;
        let mut copy = Self::new();
        // Explicit copy only: normalized in-memory text, LF, original BOM.
        // Keep the original session and bytes intact if any write fails.
        copy.state.content = self.state.content.clone();
        copy.state.bom = self.state.bom;
        copy.save(&target, None)?;
        Ok(copy)
    }
    pub fn normalize_newlines(&mut self) -> Result<()> {
        if !self.state.read_only {
            return Err("当前文档无需转换换行。".into());
        }
        let target = self.path.clone().ok_or("无效源文件")?;
        // Prepare separately: failure must not unlock or alter the original session.
        let mut converted = self.clone();
        converted.state.read_only = false;
        converted.state.eol = "LF".into();
        converted.state.dirty = true; // Force format-only save even though text is unchanged.
        converted.save(&target, None)?;
        converted.state.read_only_reason.clear();
        *self = converted;
        Ok(())
    }
    pub fn open(path: &Path) -> Result<Self> {
        let path = fs::canonicalize(path).map_err(io_error)?;
        let meta = fs::metadata(&path).map_err(io_error)?;
        if !meta.is_file() {
            return Err("请选择文档文件。".into());
        }
        if meta.len() > MAX_BYTES as u64 {
            return Err("首版支持 20 MB 以内的文档。".into());
        }
        let bytes = read_optional(&path)?.ok_or("文件在打开过程中被删除。")?;
        let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
        let text = std::str::from_utf8(if bom { &bytes[3..] } else { &bytes })
            .map_err(|_| "此文件不是有效的 UTF-8。请转换编码后重试，避免保存损坏原文。")?;
        if text.contains('\0') {
            return Err("文件包含二进制或 UTF-16 内容，首版仅编辑 UTF-8。".into());
        }
        let crlf = text.contains("\r\n");
        let without_crlf = text.replace("\r\n", "");
        let mixed = (crlf && without_crlf.contains('\n')) || without_crlf.contains('\r');
        let mut doc = Self::new();
        doc.state.bom = bom;
        doc.state.eol = if crlf { "CRLF" } else { "LF" }.into();
        doc.state.read_only = mixed;
        if mixed {
            doc.state.read_only_reason =
                "混合换行或单独 CR：只读打开，避免静默改变文档格式。".into();
        }
        doc.state.content = text.replace("\r\n", "\n").replace('\r', "\n");
        doc.saved = doc.state.content.clone();
        doc.disk_hash = Some(hash(&bytes));
        doc.state.name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into();
        doc.state.path = Some(display_path(&path));
        doc.path = Some(path);
        Ok(doc)
    }
    pub fn update(&mut self, id: &str, revision: u64, content: String) -> Result<()> {
        if id != self.state.id {
            return Err("文档已切换，旧修改已忽略。".into());
        }
        if self.state.read_only {
            return Err(self.state.read_only_reason.clone());
        }
        // A lost IPC acknowledgement may be retried, but never with different text.
        if revision == self.state.revision && content == self.state.content {
            return Ok(());
        }
        if revision <= self.state.revision {
            return Err("编辑版本无效。".into());
        }
        if content.len() > MAX_BYTES {
            return Err("编辑内容超过 20 MB，请缩减后再保存。".into());
        }
        self.state.content = content;
        self.state.revision = revision;
        self.state.dirty = self.state.content != self.saved;
        Ok(())
    }
    pub fn check_external(&mut self) -> Result<bool> {
        self.state.external = if let Some(path) = &self.path {
            current_hash(path)? != self.disk_hash
        } else {
            false
        };
        Ok(self.state.external)
    }
    pub fn save(&mut self, target: &Path, expected: Option<String>) -> Result<()> {
        if self.state.read_only {
            return Err(self.state.read_only_reason.clone());
        }
        let same = self.path.as_deref().map(|p| p == target).unwrap_or(false);
        let expected = if same {
            self.disk_hash.clone()
        } else {
            expected
        };
        if current_hash(target)? != expected {
            self.state.external = same;
            return Err(
                "磁盘文件已改变或被删除，已停止保存。请重新载入，或另存副本保留你的修改。".into(),
            );
        }
        if same && !self.state.dirty {
            return Ok(());
        }
        if fs::metadata(target)
            .map(|m| m.permissions().readonly())
            .unwrap_or(false)
        {
            return Err("文件为只读，已停止保存。请另存副本。".into());
        }
        let text = if self.state.eol == "CRLF" {
            self.state.content.replace('\n', "\r\n")
        } else {
            self.state.content.clone()
        };
        let mut bytes = if self.state.bom {
            vec![0xef, 0xbb, 0xbf]
        } else {
            vec![]
        };
        bytes.extend(text.as_bytes());
        if bytes.len() > MAX_BYTES {
            return Err("编码后的文件超过 20 MB，请缩减内容后保存。".into());
        }
        let backup = atomic_save(target, &bytes, expected.as_deref())?;
        self.path = Some(target.to_path_buf());
        self.state.path = Some(display_path(target));
        self.state.name = target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into();
        self.disk_hash = Some(hash(&bytes));
        self.saved = self.state.content.clone();
        self.state.dirty = false;
        self.state.external = false;
        if let Some(p) = backup {
            self.state.backup_path = Some(display_path(&p));
        }
        Ok(())
    }
}

pub fn atomic_save(target: &Path, bytes: &[u8], expected: Option<&str>) -> Result<Option<PathBuf>> {
    let parent = target.parent().ok_or("无效保存目录")?;
    let temp = parent.join(format!(".mdmd-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(io_error)?;
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        drop(file);
        if current_hash(target)?.as_deref() != expected {
            return Err("保存期间文件被外部修改，已取消替换。".into());
        }
        let backup = if expected.is_some() {
            let dir = parent.join(".mdmd-backups");
            fs::create_dir_all(&dir).map_err(io_error)?;
            Some(dir.join(format!(
                "{}-{}.bak",
                target.file_name().unwrap_or_default().to_string_lossy(),
                Uuid::new_v4()
            )))
        } else {
            None
        };
        platform_replace(target, &temp, backup.as_deref()).map_err(|e| {
            // ReplaceFile can partially move files on unusual filesystem failures.
            // Preserve staging/backup and report their locations; never delete the original to retry.
            format!(
                "保存未完成：{e}。请保留恢复文件 {}{}",
                display_path(&temp),
                backup
                    .as_ref()
                    .map(|p| format!("；备份 {}", display_path(p)))
                    .unwrap_or_default()
            )
        })?;
        Ok(backup)
    })();
    // On success rename consumed temp. On failure retain the flushed staging file for recovery.
    result
}

#[cfg(windows)]
fn platform_replace(target: &Path, temp: &Path, backup: Option<&Path>) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |p: &Path| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let t = wide(target);
    let s = wide(temp);
    let ok = if let Some(backup) = backup {
        let b = wide(backup);
        unsafe {
            ReplaceFileW(
                t.as_ptr(),
                s.as_ptr(),
                b.as_ptr(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        }
    } else {
        // No REPLACE_EXISTING: a file created by someone else after our check is never overwritten.
        unsafe { MoveFileExW(s.as_ptr(), t.as_ptr(), MOVEFILE_WRITE_THROUGH) }
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn platform_replace(target: &Path, temp: &Path, backup: Option<&Path>) -> std::io::Result<()> {
    if let Some(backup) = backup {
        fs::copy(target, backup)?;
        fs::rename(temp, target)
    } else {
        fs::hard_link(temp, target)?;
        fs::remove_file(temp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_acknowledged_edit_without_accepting_stale_or_changed_content() {
        let mut doc = Document::new();
        let id = doc.state.id.clone();
        doc.update(&id, 1, "draft 😀".into()).unwrap();
        doc.update(&id, 1, "draft 😀".into()).unwrap();
        assert!(doc.state.dirty);
        assert!(doc.update(&id, 1, "different".into()).is_err());
        assert!(doc.update("old-session", 2, "wrong".into()).is_err());
        doc.update(&id, 2, String::new()).unwrap();
        assert!(!doc.state.dirty);
        assert!(doc.update(&id, 1, "draft 😀".into()).is_err());
        assert_eq!(doc.state.revision, 2);
        assert_eq!(doc.state.content, "");
    }
    #[test]
    fn create_markdown_then_edit_and_save_utf8_lf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文 新建");
        let mut doc = Document::create(&path).unwrap();
        let target = doc.path.clone().unwrap();
        assert_eq!(target.file_name().unwrap(), "中文 新建.md");
        assert!(!path.exists());
        assert!(fs::read(&target).unwrap().is_empty());
        assert!(!doc.state.dirty);
        assert!(!doc.state.bom);
        assert_eq!(doc.state.eol, "LF");
        doc.update(&doc.state.id.clone(), 1, "# 新文档\n\n中文 😀\n".into())
            .unwrap();
        doc.save(&target, None).unwrap();
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "# 新文档\n\n中文 😀\n"
        );
        assert_eq!(
            Document::open(&target).unwrap().state.content,
            doc.state.content
        );
        assert!(fs::read(doc.state.backup_path.unwrap()).unwrap().is_empty());
        assert_eq!(
            Document::create(&dir.path().join("大写.MD"))
                .unwrap()
                .state
                .name,
            "大写.MD"
        );
    }
    #[test]
    fn create_rejects_collisions_invalid_extension_and_missing_parent() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("existing.md");
        let original = b"\xef\xbb\xbfkeep\r\n";
        fs::write(&file, original).unwrap();
        assert!(Document::create(&file).err().unwrap().contains("已存在"));
        let folder = dir.path().join("folder.md");
        fs::create_dir(&folder).unwrap();
        assert!(Document::create(&folder).err().unwrap().contains("已存在"));
        assert!(Document::create(&dir.path().join("wrong.txt")).is_err());
        assert!(Document::create(&dir.path().join("missing").join("new.md")).is_err());
        // A file used as a parent is a deterministic filesystem failure.
        assert!(Document::create(&file.join("new.md")).is_err());
        assert_eq!(fs::read(&file).unwrap(), original);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn final_move_never_overwrites_a_racing_creation() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("race.md");
        let temp = dir.path().join("staging.tmp");
        fs::write(&temp, []).unwrap();
        // Simulate another process creating the target after the hash check.
        fs::write(&target, "other writer").unwrap();
        assert!(platform_replace(&target, &temp, None).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "other writer");
        assert!(temp.exists());
    }
    #[test]
    fn oversized_external_file_is_rejected_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("growing.md");
        fs::write(&file, "original").unwrap();
        let mut doc = Document::open(&file).unwrap();
        let target = doc.path.clone().unwrap();
        doc.update(&doc.state.id.clone(), 1, "my draft".into())
            .unwrap();
        OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_len((MAX_BYTES + 1) as u64)
            .unwrap();
        assert!(doc.save(&target, None).is_err());
        assert!(doc.state.dirty);
        assert_eq!(fs::metadata(&file).unwrap().len(), (MAX_BYTES + 1) as u64);
        assert!(Document::open(&file).is_err());
    }
    #[test]
    fn failed_backup_keeps_original_dirty_buffer_and_recovery_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("no-newline.md");
        fs::write(&file, "original without final newline").unwrap();
        let mut doc = Document::open(&file).unwrap();
        let target = doc.path.clone().unwrap();
        let id = doc.state.id.clone();
        doc.update(&id, 1, "changed\nline two".into()).unwrap();
        assert!(doc.update(&id, 1, "stale".into()).is_err());
        fs::write(
            dir.path().join(".mdmd-backups"),
            "block backup directory creation",
        )
        .unwrap();
        assert!(doc.save(&target, None).is_err());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "original without final newline"
        );
        assert!(doc.state.dirty);
        assert_eq!(doc.state.content, "changed\nline two");
        let recovery = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().is_some_and(|s| s == "tmp"))
            .unwrap();
        assert_eq!(
            fs::read_to_string(recovery.path()).unwrap(),
            "changed\nline two"
        );
        assert!(recovery.file_name().to_string_lossy().starts_with(".mdmd-"));
        doc.update(&id, 2, "original without final newline".into())
            .unwrap();
        assert!(!doc.state.dirty);
        let copy = dir.path().join("fresh.md");
        doc.save(&copy, None).unwrap();
        assert_eq!(
            fs::read_to_string(copy).unwrap(),
            "original without final newline"
        );
    }
    #[test]
    fn save_roundtrip_conflict_backup_and_stale_session() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("中文 文档.md");
        let original = b"\xef\xbb\xbf# Title\r\n\r\nHello\r\n";
        fs::write(&file, original).unwrap();
        let mut doc = Document::open(&file).unwrap();
        let target = doc.path.clone().unwrap();
        doc.save(&target, None).unwrap();
        assert_eq!(fs::read(&file).unwrap(), original);
        doc.update(&doc.state.id.clone(), 1, "# 中文\n\nHello 😀\n".into())
            .unwrap();
        doc.save(&target, None).unwrap();
        assert_eq!(
            fs::read(&file).unwrap(),
            "\u{feff}# 中文\r\n\r\nHello 😀\r\n".as_bytes()
        );
        assert_eq!(
            fs::read(doc.state.backup_path.as_ref().unwrap()).unwrap(),
            original
        );
        assert!(!doc.state.dirty);
        doc.update(&doc.state.id.clone(), 2, "my change".into())
            .unwrap();
        fs::write(&file, "external change").unwrap();
        assert!(doc.save(&target, None).is_err());
        assert!(doc.state.dirty);
        assert_eq!(fs::read_to_string(&file).unwrap(), "external change");
        assert!(doc.update("old-document", 3, "wrong file".into()).is_err());
        assert_eq!(doc.state.content, "my change");
        let copy = dir.path().join("copy.md");
        doc.save(&copy, None).unwrap();
        assert!(!doc.state.dirty);
        assert_eq!(fs::read_to_string(&file).unwrap(), "external change");
    }
    #[test]
    fn editable_copy_normalizes_without_overwriting_or_using_stale_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("原件.md");
        let original = "\u{feff}# 中文\r\n第一行\n末行\r结束".as_bytes();
        fs::write(&source, original).unwrap();
        let mut doc = Document::open(&source).unwrap();
        let id = doc.state.id.clone();
        let target = dir.path().join("副本");
        // Ordinary save/update remain blocked; explicit conversion is copy-only.
        assert!(doc.save(&target, None).is_err());
        assert!(doc.editable_copy(&source).is_err());
        assert!(doc.editable_copy(&dir.path().join("bad.txt")).is_err());
        let mut copy = doc.editable_copy(&target).unwrap();
        let target = target.with_extension("md");
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(
            fs::read(&target).unwrap(),
            "\u{feff}# 中文\n第一行\n末行\n结束".as_bytes()
        );
        assert!(doc.state.read_only);
        assert_eq!(doc.state.id, id);
        assert_ne!(copy.state.id, id);
        assert!(!copy.state.read_only);
        assert!(!copy.state.dirty);
        assert_eq!(copy.state.eol, "LF");
        assert!(doc.editable_copy(&target).is_err());
        let existing_dir = dir.path().join("existing.md");
        fs::create_dir(&existing_dir).unwrap();
        assert!(doc.editable_copy(&existing_dir).is_err());
        copy.update(&copy.state.id.clone(), 1, "修改\n".into())
            .unwrap();
        copy.save(&copy.path.clone().unwrap(), None).unwrap();
        let reopened = Document::open(&target).unwrap();
        assert!(!reopened.state.read_only);
        assert_eq!(reopened.state.content, "修改\n");
        assert!(reopened
            .editable_copy(&dir.path().join("unused.md"))
            .is_err());
        fs::write(&source, "外部修改\r\n第二行\n").unwrap();
        let stale = dir.path().join("stale.md");
        assert!(doc
            .editable_copy(&stale)
            .err()
            .unwrap()
            .contains("源文件已变化"));
        assert!(!stale.exists());
        fs::remove_file(&source).unwrap();
        assert!(doc.editable_copy(&stale).is_err());
        assert!(!stale.exists());
        assert_eq!(doc.state.id, id);
        assert!(doc.state.read_only);
        // No BOM and CR-only files also produce editable LF copies.
        fs::write(&source, "甲\r乙").unwrap();
        let plain = Document::open(&source).unwrap();
        plain.editable_copy(&stale).unwrap();
        assert_eq!(fs::read_to_string(&stale).unwrap(), "甲\n乙");
        assert_eq!(fs::read_to_string(&source).unwrap(), "甲\r乙");
    }
    #[test]
    fn normalize_original_preserves_backup_and_readonly_state_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("混合换行.md");
        let raw = "\u{feff}# 标题\r\n第一行\n末行\r结束".as_bytes();
        fs::write(&file, raw).unwrap();
        let mut doc = Document::open(&file).unwrap();
        let before = serde_json::to_value(doc.snapshot()).unwrap();
        let backup_dir = dir.path().join(".mdmd-backups");
        fs::write(&backup_dir, "block backup").unwrap();
        assert!(doc.normalize_newlines().is_err());
        assert_eq!(fs::read(&file).unwrap(), raw);
        assert_eq!(serde_json::to_value(doc.snapshot()).unwrap(), before);
        fs::remove_file(&backup_dir).unwrap();
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();
        assert!(doc.normalize_newlines().is_err());
        assert_eq!(fs::read(&file).unwrap(), raw);
        assert_eq!(serde_json::to_value(doc.snapshot()).unwrap(), before);
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&file, permissions).unwrap();
        fs::write(&file, "外部修改").unwrap();
        assert!(doc.normalize_newlines().is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "外部修改");
        assert_eq!(serde_json::to_value(doc.snapshot()).unwrap(), before);
        fs::remove_file(&file).unwrap();
        assert!(doc.normalize_newlines().is_err());
        assert!(!file.exists());
        fs::write(&file, raw).unwrap();
        doc.normalize_newlines().unwrap();
        assert!(!doc.state.read_only);
        assert!(doc.state.read_only_reason.is_empty());
        assert!(!doc.state.dirty);
        assert_eq!(doc.state.eol, "LF");
        assert_eq!(doc.state.id, before["id"]);
        assert_eq!(
            doc.state.path.as_ref().unwrap(),
            before["path"].as_str().unwrap()
        );
        let backup = doc.state.backup_path.clone().unwrap();
        assert_eq!(fs::read(&backup).unwrap(), raw);
        assert_eq!(
            fs::read(&file).unwrap(),
            "\u{feff}# 标题\n第一行\n末行\n结束".as_bytes()
        );
        assert!(!Document::open(&file).unwrap().state.read_only);
        assert!(doc.normalize_newlines().is_err());
        doc.update(&doc.state.id.clone(), 1, "编辑后\n".into())
            .unwrap();
        doc.save(&doc.path.clone().unwrap(), None).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), raw);
        // Byte restoration is deliberately distinct from text-only version restore.
        fs::copy(&backup, &file).unwrap();
        assert!(Document::open(&file).unwrap().state.read_only);
        assert_eq!(fs::read(&file).unwrap(), raw);
        fs::write(&file, "甲\r乙").unwrap();
        let mut plain = Document::open(&file).unwrap();
        plain.normalize_newlines().unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "甲\n乙");
        assert_eq!(
            fs::read_to_string(plain.state.backup_path.unwrap()).unwrap(),
            "甲\r乙"
        );
    }
    #[test]
    fn malformed_mixed_deleted_readonly_and_new_file_collision() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("case.md");
        fs::write(&file, [0xff, 0xfe, 0x41, 0]).unwrap();
        assert!(Document::open(&file).is_err());
        fs::write(&file, "a\r\nb\nc").unwrap();
        let mut doc = Document::open(&file).unwrap();
        assert!(doc.state.read_only);
        assert!(doc
            .update(&doc.state.id.clone(), 1, "modified".into())
            .is_err());
        fs::write(&file, "old").unwrap();
        doc = Document::open(&file).unwrap();
        let target = doc.path.clone().unwrap();
        doc.update(&doc.state.id.clone(), 1, "new".into()).unwrap();
        let mut perm = fs::metadata(&file).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&file, perm).unwrap();
        assert!(doc.save(&target, None).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "old");
        let mut perm = fs::metadata(&file).unwrap().permissions();
        perm.set_readonly(false);
        fs::set_permissions(&file, perm).unwrap();
        fs::remove_file(&file).unwrap();
        assert!(doc.save(&target, None).is_err());
        assert!(doc.state.dirty);
        fs::write(&file, "someone created this").unwrap();
        assert!(atomic_save(&file, b"bad", None).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "someone created this");
    }
}
