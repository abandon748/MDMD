use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    #[serde(skip)]
    pub path: PathBuf,
    #[serde(skip)]
    root: PathBuf,
    pub display_path: String,
    pub display_root: String,
    pub can_go_up: bool,
    pub directories: Vec<String>,
    pub files: Vec<String>,
    pub empty: bool,
}

fn plain_metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("无法读取文件：{e}"))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(None);
        }
    }
    Ok((!metadata.file_type().is_symlink()).then_some(metadata))
}
fn regular_file(path: &Path) -> Result<bool, String> {
    Ok(plain_metadata(path)?.is_some_and(|m| m.is_file()))
}

impl Folder {
    pub fn read(path: &Path) -> Result<Self, String> {
        let path = path
            .canonicalize()
            .map_err(|e| format!("无法打开文件夹：{e}"))?;
        Self::read_with_root(&path, &path)
    }

    fn validate_directory(path: &Path, root: &Path) -> Result<(), String> {
        if !path.starts_with(root) {
            return Err("目录超出导航根目录。".into());
        }
        for part in path.ancestors() {
            if !plain_metadata(part)?.is_some_and(|m| m.is_dir()) {
                return Err("目录已失效或已被替换为链接。".into());
            }
            if part == root {
                break;
            }
        }
        if path
            .canonicalize()
            .map_err(|e| format!("无法打开目录：{e}"))?
            != path
        {
            return Err("目录路径已变化，请重新选择。".into());
        }
        Ok(())
    }

    fn read_with_root(path: &Path, root: &Path) -> Result<Self, String> {
        Self::validate_directory(path, root)?;
        let entries = fs::read_dir(&path).map_err(|e| format!("无法读取文件夹：{e}"))?;
        let mut folder = Self {
            display_path: crate::document::display_path(&path),
            display_root: crate::document::display_path(root),
            path: path.to_path_buf(),
            root: root.to_path_buf(),
            can_go_up: path != root,
            directories: Vec::new(),
            files: Vec::new(),
            empty: true,
        };
        // ponytail: one immediate-directory snapshot; add pagination if measured large-directory costs require it.
        for entry in entries {
            let entry = entry.map_err(|e| format!("无法读取文件夹条目：{e}"))?;
            folder.empty = false;
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let Some(metadata) = plain_metadata(&path)? else {
                continue;
            };
            if metadata.is_dir()
                || (metadata.is_file() && ["md", "markdown", "mdown"].contains(&ext.as_str()))
            {
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| "文件名编码不受支持")?;
                if metadata.is_dir() {
                    folder.directories.push(name);
                } else {
                    folder.files.push(name);
                }
            }
        }
        folder
            .files
            .sort_by_cached_key(|name| (name.to_lowercase(), name.clone()));
        folder
            .directories
            .sort_by_cached_key(|name| (name.to_lowercase(), name.clone()));
        Ok(folder)
    }

    pub fn navigate(&self, action: &str, entry: Option<&str>) -> Result<Self, String> {
        let target = match action {
            "child" => {
                let name = entry.ok_or("未指定子目录。")?;
                if !self.directories.iter().any(|d| d == name) {
                    return Err("子目录不在当前列表中。".into());
                }
                self.path.join(name)
            }
            "up" if self.can_go_up => self.path.parent().ok_or("已经到达根目录。")?.to_path_buf(),
            "up" => return Err("已经到达所选根目录。".into()),
            _ => return Err("未知目录操作。".into()),
        };
        Self::read_with_root(&target, &self.root)
    }

    pub fn locate(current: Option<&Self>, file: &Path) -> Result<Self, String> {
        if !regular_file(file)? {
            return Err("当前文件已失效或不是普通文件。".into());
        }
        let parent = file.parent().ok_or("当前文件没有父目录。")?;
        let root = current
            .filter(|f| file.starts_with(&f.root))
            .map(|f| f.root.as_path())
            .unwrap_or(parent);
        let mut folder = Self::read_with_root(parent, root)?;
        let name = file
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("文件名编码不受支持")?;
        if !folder.files.iter().any(|f| f == name) {
            folder.files.push(name.into());
            folder
                .files
                .sort_by_cached_key(|name| (name.to_lowercase(), name.clone()));
        }
        // Recheck after scanning so a vanished current file never appears located successfully.
        folder.file_path(name)?;
        Ok(folder)
    }

    pub fn file_path(&self, name: &str) -> Result<PathBuf, String> {
        Self::validate_directory(&self.path, &self.root)?;
        if !self.files.iter().any(|entry| entry == name) {
            return Err("文件不在当前目录列表中。".into());
        }
        let path = self.path.join(name);
        if !regular_file(&path)? {
            return Err("目标不是普通 Markdown 文件，请重新选择文件夹。".into());
        }
        let path = path
            .canonicalize()
            .map_err(|e| format!("无法打开文件：{e}"))?;
        if path.parent() != Some(self.path.as_path()) {
            return Err("文件超出当前目录。".into());
        }
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_snapshot_filters_sorts_and_distinguishes_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Folder::read(dir.path()).unwrap().empty);
        fs::create_dir(dir.path().join("子目录.md")).unwrap();
        fs::write(dir.path().join("ignore.txt"), "text").unwrap();
        fs::write(dir.path().join("子目录.md/child.md"), "nested").unwrap();
        let folder = Folder::read(dir.path()).unwrap();
        assert!(!folder.empty);
        assert!(folder.files.is_empty());
        for name in ["z.md", "A.MD", "中文.markdown", "a.mdown"] {
            fs::write(dir.path().join(name), "# md").unwrap();
        }
        let folder = Folder::read(dir.path()).unwrap();
        assert_eq!(folder.files, ["A.MD", "a.mdown", "z.md", "中文.markdown"]);
        assert!(folder.file_path("A.MD").unwrap().is_file());
        assert!(folder.file_path("../outside.md").is_err());
        assert!(folder.file_path("ignore.txt").is_err());
        fs::remove_file(dir.path().join("A.MD")).unwrap();
        assert!(folder.file_path("A.MD").is_err());
        fs::create_dir(dir.path().join("A.MD")).unwrap();
        assert!(folder.file_path("A.MD").is_err());
        assert!(Folder::read(&dir.path().join("missing")).is_err());
        assert!(Folder::read(&dir.path().join("z.md")).is_err());
    }

    #[test]
    fn navigation_bounds_locate_and_failure_keep_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        let child = root.join("中文 子目录");
        fs::create_dir_all(child.join("deep")).unwrap();
        let file = child.join("current.md");
        fs::write(&file, "original").unwrap();
        let initial = Folder::read(&root).unwrap();
        assert!(!initial.can_go_up);
        assert!(initial.navigate("up", None).is_err());
        assert!(initial.navigate("child", Some("../outside")).is_err());
        let nested = initial.navigate("child", Some("中文 子目录")).unwrap();
        assert!(nested.can_go_up);
        assert_eq!(nested.navigate("up", None).unwrap().path, initial.path);
        let deep = nested.navigate("child", Some("deep")).unwrap();
        let located = Folder::locate(Some(&deep), &file.canonicalize().unwrap()).unwrap();
        assert_eq!(located.path, nested.path);
        assert_eq!(located.root, initial.root);
        assert_eq!(fs::read_to_string(&file).unwrap(), "original");
        let outside = dir.path().join("outside.txt");
        fs::write(&outside, "text").unwrap();
        let reset = Folder::locate(Some(&initial), &outside.canonicalize().unwrap()).unwrap();
        assert!(!reset.can_go_up);
        assert!(reset.files.contains(&"outside.txt".into()));
        fs::remove_file(&file).unwrap();
        assert!(Folder::locate(Some(&nested), &nested.path.join("current.md")).is_err());
        fs::remove_dir(child.join("deep")).unwrap();
        assert!(nested.navigate("child", Some("deep")).is_err());
        assert_eq!(nested.directories, ["deep"]);
    }
}
