use crate::document::{display_path, Document};
use std::{fs, path::Path};

// Public project identity only. Never put feedback recipient credentials here.
pub const PROJECT_REPOSITORY: &str = "https://github.com/abandon748/MDMD";

pub fn validate(text: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 65536 || text.contains('\0') {
        Err("feedback-invalid".into())
    } else {
        Ok(())
    }
}
pub fn save(path: &Path, text: &str) -> Result<String, String> {
    validate(text)?;
    let mut path = path.to_path_buf();
    match path.extension().and_then(|s| s.to_str()) {
        None => {
            path.set_extension("md");
        }
        Some(ext) if ext.eq_ignore_ascii_case("md") => {}
        _ => return Err("feedback-extension".into()),
    }
    let target = fs::canonicalize(path.parent().ok_or("feedback-write")?)
        .map_err(|_| "feedback-write")?
        .join(path.file_name().ok_or("feedback-write")?);
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("feedback-exists".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("feedback-write".into()),
    }
    // A separate document uses the existing no-overwrite save transaction without touching the editor.
    let mut report = Document::new();
    report
        .update(
            &report.state.id.clone(),
            1,
            text.replace("\r\n", "\n").replace('\r', "\n"),
        )
        .map_err(|_| "feedback-invalid")?;
    report.save(&target, None).map_err(|_| "feedback-write")?;
    Ok(display_path(&target))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_repository_is_the_configured_public_https_address() {
        let url = crate::attachments::web_url(PROJECT_REPOSITORY).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert_eq!(url.path(), "/abandon748/MDMD");
        assert_eq!(url.query(), None);
        assert_eq!(url.fragment(), None);
        assert!(url.username().is_empty());
    }
    #[test]
    fn feedback_is_bounded_and_export_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("反馈");
        let text = "# MDMD 问题反馈\r\n\r\n中文 😀";
        save(&file, text).unwrap();
        let target = file.with_extension("md");
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            text.replace("\r\n", "\n").replace('\r', "\n")
        );
        assert_eq!(save(&target, "replace").unwrap_err(), "feedback-exists");
        assert_eq!(
            save(&dir.path().join("wrong.txt"), text).unwrap_err(),
            "feedback-extension"
        );
        assert!(save(&target.join("no.md"), text).is_err());
        assert!(validate("").is_err());
        assert!(validate("\0").is_err());
        assert!(validate(&"x".repeat(65537)).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
