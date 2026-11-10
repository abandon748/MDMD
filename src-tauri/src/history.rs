use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub opened_at: u64,
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
#[serde(rename_all = "camelCase")]
pub struct View {
    entries: Vec<Entry>,
    warning: Option<String>,
    can_retry: bool,
}
pub struct History {
    file: Option<PathBuf>,
    entries: Vec<Entry>,
    warning: Option<String>,
    blocked: bool,
}
fn key(path: &str) -> String {
    path.to_lowercase()
}
impl History {
    pub fn load(directory: Result<PathBuf, String>) -> Self {
        let mut history = Self {
            file: None,
            entries: vec![],
            warning: None,
            blocked: false,
        };
        let loaded = (|| -> Result<(), String> {
            let file = directory?.join("history.json");
            history.file = Some(file.clone());
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
                return Err("记录文件过大".into());
            }
            let record: Record = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if record.schema_version != 1 {
                return Err("不支持的历史版本".into());
            }
            if record.entries.len() > 100
                || record.entries.iter().any(|e| {
                    !Path::new(&e.path).is_absolute()
                        || e.path.contains('\0')
                        || e.opened_at > 8_640_000_000_000_000
                })
            {
                return Err("历史内容格式无效".into());
            }
            history.entries = record.entries;
            history.sort();
            let mut seen = std::collections::HashSet::new();
            history.entries.retain(|e| seen.insert(key(&e.path)));
            Ok(())
        })();
        if let Err(e) = loaded {
            history.blocked = true;
            history.warning = Some(format!(
                "历史读取失败，已保留原记录并暂停写入：{e}。修复后重启应用。"
            ));
        }
        history
    }
    fn sort(&mut self) {
        self.entries.sort_by(|a, b| {
            b.opened_at
                .cmp(&a.opened_at)
                .then_with(|| a.path.cmp(&b.path))
        });
        self.entries.truncate(100);
    }
    pub fn view(&self) -> View {
        View {
            entries: self.entries.clone(),
            warning: self.warning.clone(),
            can_retry: self.warning.is_some() && !self.blocked,
        }
    }
    pub fn record(&mut self, path: &Path) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.record_at(path, now);
    }
    fn record_at(&mut self, path: &Path, now: u64) {
        let path = crate::document::display_path(path);
        self.entries.retain(|e| key(&e.path) != key(&path));
        self.entries.push(Entry {
            path,
            opened_at: now,
            error: None,
        });
        self.sort();
        self.retry();
    }
    pub fn entry(&self, path: &str) -> Result<PathBuf, String> {
        self.entries
            .iter()
            .find(|e| e.path == path)
            .map(|e| PathBuf::from(&e.path))
            .ok_or_else(|| "文件不在历史记录中。".into())
    }
    pub fn failed(&mut self, path: &str, error: String) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.path == path) {
            entry.error = Some(error);
        }
    }
    pub fn retry(&mut self) {
        if self.blocked {
            return;
        }
        self.warning = self
            .persist()
            .err()
            .map(|e| format!("历史未能保存，本次会话记录仍保留：{e}。可重试保存。"));
    }
    fn persist(&self) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("历史目录不可用")?;
        let entries = self
            .entries
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
        crate::storage::write_atomic(file, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_order_dedup_capacity_restart_and_write_retry() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = History::load(Ok(dir.path().into()));
        for i in 0..102 {
            h.record_at(&dir.path().join(format!("{i}.md")), i);
        }
        assert_eq!(h.entries.len(), 100);
        assert_eq!(h.entries[0].opened_at, 101);
        let duplicate = h.entries[1].path.to_uppercase();
        h.record_at(Path::new(&duplicate), 200);
        assert_eq!(h.entries.len(), 100);
        assert_eq!(h.entries[0].opened_at, 200);
        let loaded = History::load(Ok(dir.path().into()));
        assert_eq!(loaded.entries[0].path, duplicate);
        assert!(loaded.entry("not registered").is_err());
        let file = dir.path().join("history.json");
        let old = fs::read(&file).unwrap();
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        h.record_at(&dir.path().join("retry.md"), 300);
        assert!(h.warning.is_some());
        assert!(h.entries[0].path.ends_with("retry.md"));
        fs::remove_dir(&file).unwrap();
        fs::write(&file, old).unwrap();
        h.retry();
        assert!(h.warning.is_none());
        assert_eq!(
            History::load(Ok(dir.path().into())).entries[0].opened_at,
            300
        );
    }
    #[test]
    fn corrupt_and_future_history_are_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        for raw in ["{bad", "{\"schemaVersion\":99,\"entries\":[]}"] {
            fs::write(dir.path().join("history.json"), raw).unwrap();
            let mut h = History::load(Ok(dir.path().into()));
            h.record_at(&dir.path().join("new.md"), 100);
            h.retry();
            assert!(h.blocked);
            assert_eq!(
                fs::read_to_string(dir.path().join("history.json")).unwrap(),
                raw
            );
        }
    }
}
