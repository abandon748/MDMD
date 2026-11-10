use crate::document::{atomic_save, display_path};
use std::path::Path;
pub fn save(path: &Path, text: &str, kind: &str) -> Result<String, String> {
    if !["html", "csv"].contains(&kind) || text.len() > 50 * 1024 * 1024 || text.contains('\0') {
        return Err("output-invalid".into());
    }
    let mut target = path.to_path_buf();
    if target.extension().is_none() {
        target.set_extension(kind);
    }
    if !target
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(kind))
    {
        return Err("output-extension".into());
    }
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err("output-exists".into());
    }
    atomic_save(&target, text.as_bytes(), None).map_err(|_| "output-write")?;
    Ok(display_path(&target))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_preserves_existing_files_and_validates_type() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("result");
        save(&p, "<h1>中文</h1>", "html").unwrap();
        assert_eq!(
            std::fs::read_to_string(p.with_extension("html")).unwrap(),
            "<h1>中文</h1>"
        );
        assert_eq!(
            save(&p, "replacement", "html").unwrap_err(),
            "output-exists"
        );
        assert!(save(&dir.path().join("wrong.md"), "x", "html").is_err());
        assert!(save(&dir.path().join("x.exe"), "x", "exe").is_err());
    }
}
