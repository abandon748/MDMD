use crate::{document::display_path, storage};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    version: u8,
    executable: Option<String>,
}
#[derive(Serialize)]
pub struct View {
    pub executable: String,
    pub custom: bool,
    pub warning: Option<String>,
}
pub struct Editor {
    file: PathBuf,
    custom: Option<PathBuf>,
    blocked: Option<String>,
}
impl Editor {
    pub fn load(root: PathBuf) -> Self {
        let file = root.join("external-editor.json");
        let mut editor = Self {
            file,
            custom: None,
            blocked: None,
        };
        match fs::read(&editor.file) {
            Ok(bytes) => match serde_json::from_slice::<Config>(&bytes) {
                Ok(config) if config.version == 1 => {
                    editor.custom = config.executable.map(PathBuf::from);
                }
                _ => {
                    editor.blocked =
                        Some("外部编辑器配置损坏或版本不支持，请备份修复后重启。".into())
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => editor.blocked = Some(e.to_string()),
        }
        editor
    }
    fn executable(&self) -> PathBuf {
        self.custom.clone().unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                .join("System32/notepad.exe")
        })
    }
    pub fn view(&self) -> View {
        View {
            executable: display_path(&self.executable()),
            custom: self.custom.is_some(),
            warning: self.blocked.clone(),
        }
    }
    pub fn configure(&mut self, path: Option<&Path>) -> Result<(), String> {
        if let Some(error) = &self.blocked {
            return Err(error.clone());
        }
        let selected = path.map(validate).transpose()?;
        let config = Config {
            version: 1,
            executable: selected.as_deref().map(display_path),
        };
        storage::write_atomic(
            &self.file,
            &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
        )?;
        self.custom = selected;
        Ok(())
    }
    pub fn launch(&self, document: &Path) -> Result<(), String> {
        if let Some(error) = &self.blocked {
            return Err(error.clone());
        }
        let executable = validate(&self.executable())?;
        let file = fs::canonicalize(document).map_err(|e| e.to_string())?;
        if !file.is_file() {
            return Err("外部编辑目标不是文件。".into());
        }
        // Exactly one filename argument: never execute a shell command or a file association.
        let mut child = Command::new(executable)
            .arg(display_path(&file))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("外部编辑器启动失败：{e}"))?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}
pub fn validate(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("exe"))
    {
        return Err("请选择本机编辑器的 .exe 文件。".into());
    }
    let path = fs::canonicalize(path).map_err(|e| format!("外部编辑器不可用：{e}"))?;
    if !path.is_file() {
        return Err("请选择本机编辑器的 .exe 文件。".into());
    }
    let own = fs::canonicalize(std::env::current_exe().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if display_path(&path).eq_ignore_ascii_case(&display_path(&own)) {
        return Err("不能将 MDMD 自身作为外部编辑器。".into());
    }
    Ok(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_validation_and_failed_write_preserve_choice() {
        let dir = tempfile::tempdir().unwrap();
        let mut editor = Editor::load(dir.path().to_path_buf());
        assert!(!editor.view().custom);
        assert!(validate(&std::env::current_exe().unwrap()).is_err());
        assert!(validate(Path::new("relative.exe")).is_err());
        let exe = dir.path().join("editor.exe");
        fs::write(&exe, b"invalid executable").unwrap();
        editor.configure(Some(&exe)).unwrap();
        assert!(Editor::load(dir.path().to_path_buf()).view().custom);
        let doc = dir.path().join("note.md");
        fs::write(&doc, "original").unwrap();
        assert!(editor.launch(&doc).is_err());
        assert_eq!(fs::read_to_string(&doc).unwrap(), "original");
        fs::remove_file(&editor.file).unwrap();
        fs::create_dir(&editor.file).unwrap();
        assert!(editor.configure(None).is_err());
        assert!(editor.view().custom);
        fs::remove_dir(&editor.file).unwrap();
        fs::write(&editor.file, br#"{"version":99,"executable":null}"#).unwrap();
        let mut blocked = Editor::load(dir.path().to_path_buf());
        assert!(blocked.configure(None).is_err());
    }
}
