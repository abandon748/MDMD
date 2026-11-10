use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub kind: Kind,
    pub path: String,
    pub added_at: u64,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    schema_version: u32,
    entries: Vec<Entry>,
}
#[derive(Serialize)]
pub struct View {
    entries: Vec<Entry>,
    warning: Option<String>,
    blocked: bool,
}
pub struct Favorites {
    file: Option<PathBuf>,
    entries: Vec<Entry>,
    warning: Option<String>,
    blocked: bool,
}
fn same(entry: &Entry, kind: Kind, path: &str) -> bool {
    entry.kind == kind && entry.path.to_lowercase() == path.to_lowercase()
}
pub fn checked_path(path: &Path, kind: Kind) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("路径不可用：{e}"))?;
    if crate::document::display_path(&canonical).to_lowercase()
        != crate::document::display_path(path).to_lowercase()
    {
        return Err("路径已重定向，请重新选择文件或目录。".into());
    }
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !(match kind {
        Kind::File => metadata.is_file(),
        Kind::Folder => metadata.is_dir(),
    }) {
        return Err("路径类型已变化，请重新选择。".into());
    }
    Ok(canonical)
}
impl Favorites {
    pub fn load(directory: Result<PathBuf, String>) -> Self {
        let mut result = Self {
            file: None,
            entries: vec![],
            warning: None,
            blocked: false,
        };
        let loaded = (|| -> Result<(), String> {
            let file = directory?.join("favorites.json");
            result.file = Some(file.clone());
            let reader = match fs::File::open(&file) {
                Ok(reader) => reader,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(e) => return Err(e.to_string()),
            };
            let mut bytes = Vec::new();
            reader
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("收藏记录过大".into());
            }
            let record: Record = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if record.schema_version != 1 {
                return Err("不支持的收藏版本".into());
            }
            if record.entries.len() > 1000
                || record.entries.iter().any(|e| {
                    !Path::new(&e.path).is_absolute()
                        || e.path.contains('\0')
                        || e.added_at > 8_640_000_000_000_000
                })
            {
                return Err("收藏格式无效".into());
            }
            result.entries = record.entries;
            result.entries.sort_by(|a, b| {
                b.added_at
                    .cmp(&a.added_at)
                    .then_with(|| a.path.cmp(&b.path))
                    .then(a.kind.cmp(&b.kind))
            });
            let mut seen = std::collections::HashSet::new();
            result
                .entries
                .retain(|e| seen.insert((e.kind as u8, e.path.to_lowercase())));
            Ok(())
        })();
        if let Err(e) = loaded {
            result.blocked = true;
            result.warning = Some(format!(
                "收藏读取失败，已保留原记录并暂停变更：{e}。修复后重启应用。"
            ));
        }
        result
    }
    pub fn view(&self) -> View {
        View {
            entries: self.entries.clone(),
            warning: self.warning.clone(),
            blocked: self.blocked,
        }
    }
    pub fn entry(&self, kind: Kind, path: &str) -> Result<PathBuf, String> {
        self.entries
            .iter()
            .find(|e| same(e, kind, path))
            .map(|e| PathBuf::from(&e.path))
            .ok_or_else(|| "路径不在收藏中。".into())
    }
    pub fn failed(&mut self, kind: Kind, path: &str, error: Option<String>) {
        if let Some(entry) = self.entries.iter_mut().find(|e| same(e, kind, path)) {
            entry.error = error;
        }
    }
    pub fn add(&mut self, kind: Kind, path: &Path) -> Result<(), String> {
        let path = crate::document::display_path(&checked_path(path, kind)?);
        if self.entries.iter().any(|e| same(e, kind, &path)) {
            return Ok(());
        }
        if self.entries.len() >= 1000 {
            return Err("收藏已达 1000 条，请先取消不需要的收藏。".into());
        }
        let mut next = self.entries.clone();
        next.push(Entry {
            kind,
            path,
            added_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            error: None,
        });
        next.sort_by(|a, b| {
            b.added_at
                .cmp(&a.added_at)
                .then_with(|| a.path.cmp(&b.path))
                .then(a.kind.cmp(&b.kind))
        });
        self.commit(next)
    }
    pub fn remove(&mut self, kind: Kind, path: &str) -> Result<(), String> {
        self.entry(kind, path)?;
        let next = self
            .entries
            .iter()
            .filter(|e| !same(e, kind, path))
            .cloned()
            .collect();
        self.commit(next)
    }
    fn commit(&mut self, next: Vec<Entry>) -> Result<(), String> {
        if self.blocked {
            return Err("收藏记录不可写，请修复原记录后重启。".into());
        }
        let result = (|| -> Result<(), String> {
            let entries = next
                .iter()
                .cloned()
                .map(|mut e| {
                    e.error = None;
                    e
                })
                .collect();
            let bytes = serde_json::to_vec(&Record {
                schema_version: 1,
                entries,
            })
            .map_err(|e| e.to_string())?;
            crate::storage::write_atomic(self.file.as_ref().ok_or("收藏目录不可用")?, &bytes)
        })();
        match result {
            Ok(()) => {
                self.entries = next;
                self.warning = None;
                Ok(())
            }
            Err(e) => {
                let message = format!("收藏保存失败，已保留原列表：{e}。修复后重新操作。");
                self.warning = Some(message.clone());
                Err(message)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn add_dedup_reopen_remove_and_transactional_failure() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("same.md");
        fs::write(&file, "text").unwrap();
        let mut f = Favorites::load(Ok(dir.path().into()));
        f.add(Kind::File, &file).unwrap();
        f.add(Kind::Folder, dir.path()).unwrap();
        let stored = dir.path().join("favorites.json");
        let old = fs::read(&stored).unwrap();
        f.add(
            Kind::File,
            Path::new(&file.to_string_lossy().to_uppercase()),
        )
        .unwrap();
        assert_eq!(f.entries.len(), 2);
        assert_eq!(fs::read(&stored).unwrap(), old);
        assert_eq!(Favorites::load(Ok(dir.path().into())).entries.len(), 2);
        assert!(f.entry(Kind::Folder, &file.to_string_lossy()).is_err());
        fs::remove_file(&stored).unwrap();
        fs::create_dir(&stored).unwrap();
        assert!(f.remove(Kind::File, &file.to_string_lossy()).is_err());
        assert_eq!(f.entries.len(), 2);
        fs::remove_dir(&stored).unwrap();
        fs::write(&stored, old).unwrap();
        fs::remove_file(&file).unwrap();
        assert!(checked_path(&file, Kind::File).is_err());
        fs::create_dir(&file).unwrap();
        assert!(checked_path(&file, Kind::File).is_err());
        f.remove(Kind::File, &file.to_string_lossy()).unwrap();
        assert_eq!(Favorites::load(Ok(dir.path().into())).entries.len(), 1);
    }
    #[test]
    fn corrupt_unknown_schema_and_capacity_never_destroy_favorites() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("favorites.json");
        for raw in ["{bad", "{\"schemaVersion\":99,\"entries\":[]}"] {
            fs::write(&file, raw).unwrap();
            let mut f = Favorites::load(Ok(dir.path().into()));
            assert!(f.add(Kind::Folder, dir.path()).is_err());
            assert_eq!(fs::read_to_string(&file).unwrap(), raw);
        }
        fs::remove_file(&file).unwrap();
        let mut f = Favorites::load(Ok(dir.path().into()));
        f.entries = (0..1000)
            .map(|i| Entry {
                kind: Kind::File,
                path: dir.path().join(format!("{i}.md")).to_string_lossy().into(),
                added_at: i,
                error: None,
            })
            .collect();
        assert!(f.add(Kind::Folder, dir.path()).is_err());
        assert_eq!(f.entries.len(), 1000);
    }
}
