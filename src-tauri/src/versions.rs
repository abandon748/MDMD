use crate::document::{hash, read_optional, Document};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
type Result<T> = std::result::Result<T, String>;
#[derive(Serialize)]
pub struct Entry {
    pub key: String,
    pub modified: u64,
    pub bytes: u64,
}
#[derive(Serialize)]
pub struct Version {
    pub content: String,
    pub hash: String,
}
fn regular(path: &Path, directory: bool) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(|_| "version-read")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("version-path".into());
        }
    }
    if m.file_type().is_symlink() || (directory && !m.is_dir()) || (!directory && !m.is_file()) {
        return Err("version-path".into());
    }
    Ok(())
}
fn target(doc: &Document, key: &str) -> Result<PathBuf> {
    let path = doc.path().ok_or("version-unsaved")?;
    let (folder, name) = key.split_once('/').ok_or("version-path")?;
    if ![".mdmd-backups", ".moye-backups"].contains(&folder) || name.contains(['/', '\\']) {
        return Err("version-path".into());
    }
    let prefix = format!(
        "{}-",
        path.file_name().ok_or("version-path")?.to_string_lossy()
    );
    let uuid = name
        .strip_prefix(&prefix)
        .and_then(|s| s.strip_suffix(".bak"))
        .ok_or("version-path")?;
    uuid::Uuid::parse_str(uuid).map_err(|_| "version-path")?;
    let dir = path.parent().ok_or("version-path")?.join(folder);
    regular(&dir, true)?;
    let result = dir.join(name);
    regular(&result, false)?;
    Ok(result)
}
pub fn list(doc: &Document) -> Result<Vec<Entry>> {
    let path = doc.path().ok_or("version-unsaved")?;
    let parent = path.parent().ok_or("version-path")?;
    let mut result = Vec::new();
    for folder in [".mdmd-backups", ".moye-backups"] {
        let dir = parent.join(folder);
        if !dir.exists() {
            continue;
        }
        regular(&dir, true)?;
        for entry in fs::read_dir(dir).map_err(|_| "version-read")? {
            let entry = entry.map_err(|_| "version-read")?;
            let key = format!("{}/{}", folder, entry.file_name().to_string_lossy());
            if target(doc, &key).is_err() {
                continue;
            }
            let m = entry.metadata().map_err(|_| "version-read")?;
            result.push(Entry {
                key,
                modified: m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64),
                bytes: m.len(),
            });
        }
    }
    result.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.key.cmp(&b.key)));
    result.truncate(100);
    Ok(result)
}
pub fn read(doc: &Document, key: &str, expected: Option<&str>) -> Result<Version> {
    let bytes = read_optional(&target(doc, key)?)?.ok_or("version-read")?;
    let digest = hash(&bytes);
    if expected.is_some_and(|h| h != digest) {
        return Err("version-changed".into());
    }
    let source = std::str::from_utf8(&bytes)
        .map_err(|_| "version-encoding")?
        .trim_start_matches('\u{feff}');
    let rest = source.replace("\r\n", "");
    if source.contains('\0')
        || rest.contains('\r')
        || (source.contains("\r\n") && rest.contains('\n'))
    {
        return Err("version-encoding".into());
    }
    Ok(Version {
        content: source.replace("\r\n", "\n"),
        hash: digest,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_only_current_backups_and_refuses_changed_content() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("doc.md");
        fs::write(&p, "before").unwrap();
        let mut doc = Document::open(&p).unwrap();
        doc.update(&doc.state.id.clone(), 1, "after".into())
            .unwrap();
        doc.save(&doc.path().unwrap().to_path_buf(), None).unwrap();
        let entries = list(&doc).unwrap();
        assert_eq!(entries.len(), 1);
        let v = read(&doc, &entries[0].key, None).unwrap();
        assert_eq!(v.content, "before");
        assert!(read(&doc, &entries[0].key, Some("wrong")).is_err());
        assert!(read(&doc, "../doc.md", None).is_err());
        assert_eq!(fs::read_to_string(p).unwrap(), "after");
    }
}
