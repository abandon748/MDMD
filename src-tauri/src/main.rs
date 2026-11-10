#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app_icon;
mod attachments;
mod document;
mod engines;
mod external_editor;
mod favorites;
mod feedback;
mod folder;
mod history;
mod integration;
mod language;
mod link_preview;
mod output;
mod storage;
mod versions;
use base64::Engine;
use document::{Document, Snapshot};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    doc: Mutex<Document>,
    folder: Mutex<Option<folder::Folder>>,
    history: Mutex<history::History>,
    favorites: Mutex<favorites::Favorites>,
    allow_close: AtomicBool,
    title_path: AtomicBool,
    ui_english: AtomicBool,
    preview_busy: Mutex<()>,
    feedback_busy: Mutex<()>,
    external_editor: Mutex<Option<external_editor::Editor>>,
    icons: Mutex<Option<app_icon::Icons>>,
    engines: Mutex<Option<Arc<engines::Manager>>>,
}
type Shared = Arc<AppState>;
#[tauri::command]
async fn configure_external_editor(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    action: String,
) -> Result<external_editor::View, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared
            .external_editor
            .try_lock()
            .map_err(|_| "外部编辑器正在处理，请稍后重试。")?;
        let editor = guard.as_mut().ok_or("外部编辑器尚未初始化。")?;
        match action.as_str() {
            "state" => {}
            "default" => editor.configure(None)?,
            "choose" => {
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title(shared.ui("选择外部编辑器", "Choose external editor"))
                    .add_filter("Executable", &["exe"])
                    .blocking_pick_file()
                {
                    editor.configure(Some(&file.into_path().map_err(|e| e.to_string())?))?;
                }
            }
            _ => return Err("未知外部编辑器操作。".into()),
        }
        Ok(editor.view())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn project_repository(open: bool) -> Result<String, String> {
    if open {
        tauri::async_runtime::spawn_blocking(|| {
            attachments::open_web(feedback::PROJECT_REPOSITORY)
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    Ok(feedback::PROJECT_REPOSITORY.to_owned())
}

#[tauri::command]
async fn export_feedback(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    text: String,
) -> Result<Option<String>, String> {
    feedback::validate(&text)?;
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = shared
            .feedback_busy
            .try_lock()
            .map_err(|_| "feedback-busy")?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title(shared.ui("导出问题反馈", "Export feedback"))
            .add_filter("Markdown", &["md"])
            .set_file_name("MDMD-feedback.md")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| "feedback-write")?;
        feedback::save(&path, &text).map(Some)
    })
    .await
    .map_err(|_| "feedback-write".to_owned())?
}
#[tauri::command]
async fn export_document(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    text: String,
    kind: String,
) -> Result<Option<String>, String> {
    if !["html", "csv"].contains(&kind.as_str()) || text.len() > 50 * 1024 * 1024 {
        return Err("output-invalid".into());
    }
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = shared.feedback_busy.try_lock().map_err(|_| "output-busy")?;
        let doc = shared.doc.lock().map_err(|_| "output-busy")?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("output-stale".into());
        }
        let name = Path::new(&doc.state.name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let Some(file) = app
            .dialog()
            .file()
            .set_title(shared.ui("导出文档", "Export document"))
            .add_filter(&kind, &[kind.as_str()])
            .set_file_name(format!("{}.{}", name, kind))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        output::save(&file.into_path().map_err(|_| "output-write")?, &text, &kind).map(Some)
    })
    .await
    .map_err(|_| "output-write".to_owned())?
}

#[tauri::command]
async fn document_versions(
    state: State<'_, Shared>,
    id: String,
    revision: u64,
) -> Result<Vec<versions::Entry>, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|_| "version-busy")?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("version-stale".into());
        }
        versions::list(&doc)
    })
    .await
    .map_err(|_| "version-read".to_owned())?
}
#[tauri::command]
async fn read_version(
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    key: String,
    expected: Option<String>,
) -> Result<versions::Version, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|_| "version-busy")?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("version-stale".into());
        }
        versions::read(&doc, &key, expected.as_deref())
    })
    .await
    .map_err(|_| "version-read".to_owned())?
}

fn engine_manager(state: &Shared) -> Result<Arc<engines::Manager>, String> {
    state
        .engines
        .lock()
        .map_err(|_| "engine-busy")?
        .clone()
        .ok_or("engine-unavailable".into())
}
#[tauri::command]
fn engine_state(state: State<'_, Shared>) -> Result<engines::View, String> {
    engine_manager(&state)?.view()
}
#[tauri::command]
async fn engine_action(
    state: State<'_, Shared>,
    action: String,
    id: String,
) -> Result<engines::View, String> {
    let manager = engine_manager(&state)?;
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "refresh" => manager.refresh(),
        "download" => manager.start(&id),
        "cancel" => manager.stop(&id),
        _ => Err("engine-action".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn engine_assets(
    state: State<'_, Shared>,
    id: String,
) -> Result<Vec<engines::Asset>, String> {
    let manager = engine_manager(&state)?;
    tauri::async_runtime::spawn_blocking(move || manager.assets(&id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn system_integration(
    state: State<'_, Shared>,
    action: integration::Action,
) -> Result<integration::View, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let icons = shared.icons.lock().map_err(|_| "icon-busy")?;
        let _process_guard = integration::ProcessLock::icons()?;
        // A damaged appearance record must not block removing system integration.
        let icon = icons
            .as_ref()
            .ok_or("icon-unavailable")?
            .location()
            .ok()
            .flatten();
        integration::execute(action, icon)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum IconAction {
    Refresh,
    Choose,
    Reset,
}
#[tauri::command]
async fn application_icon(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    action: IconAction,
) -> Result<app_icon::View, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut icons = shared.icons.lock().map_err(|_| "icon-busy")?;
        let icons = icons.as_mut().ok_or("icon-unavailable")?;
        match action {
            IconAction::Refresh => Ok(icons.view(false)),
            IconAction::Reset => icons.change(None),
            IconAction::Choose => {
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title(shared.ui("选择应用图标", "Choose application icon"))
                    .add_filter("Windows Icon", &["ico"])
                    .blocking_pick_file()
                {
                    icons.change(Some(file.into_path().map_err(|_| "icon-read")?))
                } else {
                    Ok(icons.view(true))
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
impl AppState {
    fn ui<'a>(&self, chinese: &'a str, english: &'a str) -> &'a str {
        if self.ui_english.load(Ordering::Relaxed) {
            english
        } else {
            chinese
        }
    }
}
#[tauri::command]
fn set_ui_language(state: State<Shared>, language: language::Language) -> &'static str {
    let locale = language.locale();
    state.ui_english.store(locale == "en", Ordering::Relaxed);
    locale
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum TitleFormat {
    Path,
    Name,
}
fn title_text(s: &Snapshot, path: bool) -> String {
    if s.path.is_none() && s.content.is_empty() && !s.dirty {
        return "MDMD".into();
    }
    let label = if path {
        s.path.as_deref().unwrap_or(&s.name)
    } else {
        &s.name
    };
    format!("{}{} — MDMD", if s.dirty { "● " } else { "" }, label)
}
fn title(app: &tauri::AppHandle, s: &Snapshot) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let path = app.state::<Shared>().title_path.load(Ordering::Relaxed);
    win.set_title(&title_text(s, path))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn set_title_format(
    app: tauri::AppHandle,
    state: State<Shared>,
    format: TitleFormat,
) -> Result<(), String> {
    // Share the document lock with edit/open/save to avoid applying a stale title.
    let doc = state.doc.lock().map_err(|e| e.to_string())?;
    let previous = state
        .title_path
        .swap(matches!(format, TitleFormat::Path), Ordering::Relaxed);
    if let Err(error) = title(&app, &doc.snapshot()) {
        state.title_path.store(previous, Ordering::Relaxed);
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
fn document_state(state: State<Shared>) -> Snapshot {
    state.doc.lock().unwrap().snapshot()
}

#[tauri::command]
async fn history_state(
    state: State<'_, Shared>,
    retry: Option<bool>,
) -> Result<history::View, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut history = shared.history.lock().map_err(|e| e.to_string())?;
        if retry.unwrap_or(false) {
            history.retry();
        }
        Ok(history.view())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn favorites_state(state: State<'_, Shared>) -> Result<favorites::View, String> {
    Ok(state.favorites.lock().map_err(|e| e.to_string())?.view())
}
#[tauri::command]
async fn favorite_action(
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    action: String,
    kind: favorites::Kind,
    entry: Option<String>,
) -> Result<favorites::View, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("文档版本已变化，请重试。".into());
        }
        let path = match action.as_str() {
            "file" if kind == favorites::Kind::File => {
                Some(doc.path().ok_or("请先保存文档再收藏。")?.to_path_buf())
            }
            "parent" if kind == favorites::Kind::Folder => Some(
                doc.path()
                    .and_then(Path::parent)
                    .ok_or("没有当前文件目录。")?
                    .to_path_buf(),
            ),
            "folder" if kind == favorites::Kind::Folder => Some(
                shared
                    .folder
                    .lock()
                    .map_err(|e| e.to_string())?
                    .as_ref()
                    .map(|f| f.path.clone())
                    .or_else(|| doc.path().and_then(Path::parent).map(Path::to_path_buf))
                    .ok_or("没有当前目录。")?,
            ),
            "remove" => None,
            _ => return Err("未知收藏操作。".into()),
        };
        let mut favorites = shared.favorites.lock().map_err(|e| e.to_string())?;
        if let Some(path) = path {
            favorites.add(kind, &path)?;
        } else {
            favorites.remove(kind, entry.as_deref().ok_or("未指定收藏。")?)?;
        }
        Ok(favorites.view())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn select_folder(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    id: String,
    revision: u64,
) -> Result<Option<folder::Folder>, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id
            || doc.state.revision != revision
            || doc.state.dirty
            || doc.path().is_some()
            || !doc.state.content.is_empty()
        {
            return Err("请先返回首页再打开文件夹。".into());
        }
        let Some(selected) = app
            .dialog()
            .file()
            .set_title(shared.ui("打开 Markdown 文件夹", "Open Markdown folder"))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let folder = folder::Folder::read(&selected.into_path().map_err(|e| e.to_string())?)?;
        *shared.folder.lock().map_err(|e| e.to_string())? = Some(folder.clone());
        Ok(Some(folder))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn navigate_folder(
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    action: String,
    entry: Option<String>,
) -> Result<folder::Folder, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("文档版本已变化，请重试。".into());
        }
        let mut folders = shared.folder.lock().map_err(|e| e.to_string())?;
        let next = if action == "favorite" {
            let entry = entry.as_deref().ok_or("未指定收藏目录。")?;
            let mut favorites = shared.favorites.lock().map_err(|e| e.to_string())?;
            let path = favorites.entry(favorites::Kind::Folder, entry)?;
            let next = favorites::checked_path(&path, favorites::Kind::Folder)
                .and_then(|path| folder::Folder::read(&path));
            favorites.failed(favorites::Kind::Folder, entry, next.as_ref().err().cloned());
            next?
        } else if action == "locate" {
            folder::Folder::locate(
                folders.as_ref(),
                doc.path().ok_or("请先保存当前文档再定位。")?,
            )?
        } else {
            folders
                .as_ref()
                .ok_or("尚未选择文件夹。")?
                .navigate(&action, entry.as_deref())?
        };
        *folders = Some(next.clone());
        Ok(next)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn document_edit(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    content: String,
) -> Result<Snapshot, String> {
    let mut doc = state.doc.lock().map_err(|e| e.to_string())?;
    doc.update(&id, revision, content)?;
    let s = doc.snapshot();
    let _ = title(&app, &s);
    Ok(s)
}

#[derive(serde::Serialize)]
struct ActionSnapshot {
    #[serde(flatten)]
    document: Snapshot,
    cancelled: bool,
}

#[tauri::command]
async fn document_action(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    name: String,
    discard: bool,
    entry: Option<String>,
) -> Result<ActionSnapshot, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("文档版本已变化，请重试。".into());
        }
        if [
            "home",
            "open",
            "open-entry",
            "open-link",
            "open-history",
            "open-favorite",
            "new",
            "new-file",
            "reload",
            "close",
        ]
        .contains(&name.as_str())
            && doc.state.dirty
            && !discard
        {
            return Err("存在未保存修改，请先保存或明确放弃修改。".into());
        }
        let old_id = doc.state.id.clone();
        let old_path = doc.state.path.clone();
        let mut cancelled = false;
        match name.as_str() {
            "open-history" | "open-favorite" => {
                let entry = entry.as_deref().ok_or("未指定条目。")?;
                let favorite = name == "open-favorite";
                let path = if favorite {
                    shared
                        .favorites
                        .lock()
                        .map_err(|e| e.to_string())?
                        .entry(favorites::Kind::File, entry)?
                } else {
                    shared
                        .history
                        .lock()
                        .map_err(|e| e.to_string())?
                        .entry(entry)?
                };
                let opened = favorites::checked_path(&path, favorites::Kind::File)
                    .and_then(|path| Document::open(&path));
                if favorite {
                    shared.favorites.lock().map_err(|e| e.to_string())?.failed(
                        favorites::Kind::File,
                        entry,
                        opened.as_ref().err().cloned(),
                    );
                }
                match opened {
                    Ok(opened) => {
                        *doc = opened;
                        *shared.folder.lock().map_err(|e| e.to_string())? = None;
                    }
                    Err(e) => {
                        if !favorite {
                            shared
                                .history
                                .lock()
                                .map_err(|e| e.to_string())?
                                .failed(entry, e.clone());
                        }
                        return Err(e);
                    }
                }
            }
            "open-link" => {
                let path = attachments::markdown(
                    doc.path().ok_or("attachment-unsaved")?,
                    entry.as_deref().ok_or("attachment-link")?,
                )?;
                let opened = Document::open(&path)?;
                *doc = opened;
                *shared.folder.lock().map_err(|e| e.to_string())? = None;
            }
            "open-entry" => {
                let folders = shared.folder.lock().map_err(|e| e.to_string())?;
                let folder = folders.as_ref().ok_or("尚未选择文件夹。")?;
                let path = folder.file_path(entry.as_deref().ok_or("未指定文件。")?)?;
                *doc = Document::open(&path)?;
            }
            "open" => {
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title(shared.ui("打开 Markdown 文件", "Open Markdown file"))
                    .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
                    .blocking_pick_file()
                {
                    let path = file.into_path().map_err(|e| e.to_string())?;
                    let opened = Document::open(&path)?;
                    *doc = opened;
                    *shared.folder.lock().map_err(|e| e.to_string())? = None;
                } else {
                    cancelled = true;
                }
            }
            "new-file" => {
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title(shared.ui("新建 Markdown 文件", "New Markdown file"))
                    .add_filter("Markdown", &["md"])
                    .set_file_name(shared.ui("未命名.md", "Untitled.md"))
                    .blocking_save_file()
                {
                    let path = file.into_path().map_err(|e| e.to_string())?;
                    let created = Document::create(&path)?;
                    *doc = created;
                    *shared.folder.lock().map_err(|e| e.to_string())? = None;
                } else {
                    cancelled = true;
                }
            }
            "new" | "home" => {
                *doc = Document::new();
                *shared.folder.lock().map_err(|e| e.to_string())? = None;
            }
            "reload" => {
                if let Some(path) = doc.path() {
                    let opened = Document::open(path)?;
                    *doc = opened;
                }
            }
            "normalize-newlines" => doc.normalize_newlines()?,
            "editable-copy" => {
                if !doc.state.read_only {
                    return Err("仅混合换行的只读文档需要创建可编辑副本。".into());
                }
                let source = doc.path().ok_or("无效源文件")?;
                let stem = source.file_stem().unwrap_or_default().to_string_lossy();
                let mut dialog = app
                    .dialog()
                    .file()
                    .add_filter("Markdown", &["md"])
                    .set_title(shared.ui("另存为可编辑副本", "Save editable copy"))
                    .set_file_name(format!(
                        "{stem}{}.md",
                        shared.ui("-可编辑副本", "-editable-copy")
                    ));
                if let Some(parent) = source.parent() {
                    dialog = dialog.set_directory(parent);
                }
                if let Some(file) = dialog.blocking_save_file() {
                    let copy = doc.editable_copy(&file.into_path().map_err(|e| e.to_string())?)?;
                    *doc = copy;
                    *shared.folder.lock().map_err(|e| e.to_string())? = None;
                } else {
                    cancelled = true;
                }
            }
            "save" | "save-as" => {
                let target = if name == "save" && doc.path().is_some() {
                    doc.path().unwrap().to_path_buf()
                } else {
                    let mut dialog = app
                        .dialog()
                        .file()
                        .add_filter("Markdown", &["md"])
                        .set_title(shared.ui("另存 Markdown 文件", "Save Markdown file as"))
                        .set_file_name(&doc.state.name);
                    if let Some(parent) = doc.path().and_then(Path::parent) {
                        dialog = dialog.set_directory(parent);
                    }
                    let Some(file) = dialog.blocking_save_file() else {
                        return Ok(ActionSnapshot {
                            document: doc.snapshot(),
                            cancelled: true,
                        });
                    };
                    let file = file.into_path().map_err(|e| e.to_string())?;
                    if file.exists() {
                        std::fs::canonicalize(file).map_err(|e| e.to_string())?
                    } else {
                        std::fs::canonicalize(file.parent().ok_or("无效路径")?)
                            .map_err(|e| e.to_string())?
                            .join(file.file_name().ok_or("无效文件名")?)
                    }
                };
                let expected = document::read_optional(&target)?.map(|b| document::hash(&b));
                doc.save(&target, expected)?;
            }
            "external-edit" => {
                if doc.state.dirty {
                    return Err("请先保存当前修改，再使用外部编辑器。".into());
                }
                if doc.check_external()? {
                    return Err("磁盘文件已变化，请先重新载入或另存副本。".into());
                }
                let path = doc.path().ok_or("请先将文档保存到文件。")?;
                shared
                    .external_editor
                    .try_lock()
                    .map_err(|_| "外部编辑器正在处理，请稍后重试。")?
                    .as_ref()
                    .ok_or("外部编辑器尚未初始化。")?
                    .launch(path)?;
            }
            "close" => {
                shared.allow_close.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => return Err("未知命令。".into()),
        }
        let opened = old_id != doc.state.id
            && [
                "editable-copy",
                "open",
                "open-entry",
                "open-link",
                "open-history",
                "open-favorite",
                "new-file",
            ]
            .contains(&name.as_str());
        let saved_new_path =
            old_path != doc.state.path && ["save", "save-as"].contains(&name.as_str());
        if opened || saved_new_path {
            if let Some(path) = doc.path() {
                shared
                    .history
                    .lock()
                    .map_err(|e| e.to_string())?
                    .record(path);
            }
        }
        let s = doc.snapshot();
        let _ = title(&app, &s);
        Ok(ActionSnapshot {
            document: s,
            cancelled,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_disk(state: State<'_, Shared>, id: String) -> Result<Option<bool>, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Idle polling must not hold up typing or a native dialog.
        let Ok(mut doc) = shared.doc.try_lock() else {
            return Ok(None);
        };
        if doc.state.id != id {
            return Ok(None);
        }
        doc.check_external().map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preview_link(
    state: State<'_, Shared>,
    id: String,
    kind: String,
    target: String,
) -> Result<link_preview::Source, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = shared.preview_busy.try_lock().map_err(|_| "preview-busy")?;
        let local = {
            let doc = shared.doc.lock().map_err(|_| "preview-stale")?;
            if doc.state.id != id {
                return Err("preview-stale".into());
            }
            if kind == "markdown" {
                if target.len() > 4096 {
                    return Err("preview-path".into());
                }
                Some((
                    doc.path().ok_or("preview-unsaved")?.to_path_buf(),
                    doc.state.content.clone(),
                ))
            } else {
                None
            }
        };
        match kind.as_str() {
            "web" => link_preview::web(&target),
            "image" => link_preview::image(&target),
            "markdown" => {
                let (path, content) = local.unwrap();
                link_preview::markdown(&path, &target, &content)
            }
            _ => Err("preview-type".into()),
        }
    })
    .await
    .map_err(|_| "preview-network".to_string())?
}

#[tauri::command]
async fn import_image(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    id: String,
    revision: u64,
    data: Option<String>,
) -> Result<Option<String>, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id || doc.state.revision != revision {
            return Err("attachment-stale".into());
        }
        if doc.state.read_only {
            return Err("attachment-readonly".into());
        }
        let path = doc.path().ok_or("attachment-unsaved")?;
        let bytes = if let Some(data) = data {
            if data.len() > (attachments::LIMIT + 2) / 3 * 4 {
                return Err("attachment-size".into());
            }
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| "attachment-type")?
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .set_title(shared.ui("插入图片", "Insert image"))
                .add_filter(
                    "Images",
                    &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"],
                )
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            attachments::read(&file.into_path().map_err(|e| e.to_string())?)?
        };
        attachments::store(path, &bytes).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_web_link(state: State<'_, Shared>, id: String, url: String) -> Result<(), String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let doc = shared.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id {
            return Err("attachment-stale".into());
        }
        attachments::open_web(&url)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_image(
    state: State<'_, Shared>,
    id: String,
    relative: String,
) -> Result<String, String> {
    let path = {
        let doc = state.doc.lock().map_err(|e| e.to_string())?;
        if doc.state.id != id {
            return Err("文档已切换".into());
        }
        doc.path().ok_or("请先保存文档")?.to_path_buf()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let target = attachments::relative(&path, &relative)?;
        let mime = match target
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "bmp" => "image/bmp",
            _ => return Err("不支持的图片类型".into()),
        };
        let bytes = attachments::read(&target)?;
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--uninstall-integration") {
        std::process::exit(if integration::uninstall().is_ok() {
            0
        } else {
            1
        });
    }
    match tauri::webview_version() {
        Ok(version) if version.split('.').next().and_then(|v| v.parse::<u32>().ok()).is_some_and(|v| v >= 130) => {}
        result => startup_failure(&format!("需要 Microsoft Edge WebView2 Runtime 130 或更新版本。请安装／修复运行时后重试。\nRequires Microsoft Edge WebView2 Runtime 130 or newer. Install or repair the runtime and retry.\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\n{result:?}")),
    }
    let initial = std::env::args().skip(1).find(|s| {
        !s.starts_with('-')
            && ["md", "markdown", "mdown", "txt"].contains(
                &Path::new(s)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase()
                    .as_str(),
            )
    });
    let mut doc = Document::new();
    let mut startup_error = None;
    if let Some(file) = initial {
        match Document::open(Path::new(&file)) {
            Ok(opened) => doc = opened,
            Err(e) => startup_error = Some(e),
        }
    }
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState {
            doc: Mutex::new(doc),
            folder: Mutex::new(None),
            history: Mutex::new(history::History::load(Err("尚未初始化".into()))),
            favorites: Mutex::new(favorites::Favorites::load(Err("尚未初始化".into()))),
            allow_close: AtomicBool::new(false),
            title_path: AtomicBool::new(true),
            preview_busy: Mutex::new(()),
            feedback_busy: Mutex::new(()),
            external_editor: Mutex::new(None),
            icons: Mutex::new(None),
            engines: Mutex::new(None),
            ui_english: AtomicBool::new(language::Language::System.locale() == "en"),
        }))
        .invoke_handler(tauri::generate_handler![
            document_state,
            configure_external_editor,
            system_integration,
            application_icon,
            export_feedback,
            project_repository,
            export_document,
            document_versions,
            read_version,
            engine_state,
            engine_action,
            engine_assets,
            set_title_format,
            set_ui_language,
            preview_link,
            history_state,
            favorites_state,
            favorite_action,
            select_folder,
            navigate_folder,
            document_edit,
            document_action,
            check_disk,
            read_image,
            import_image,
            open_web_link
        ])
        .setup(move |app| {
            let state = app.state::<Shared>();
            let directory = match std::env::var_os("MDMD_DATA_DIR") {
                Some(path) => Ok(PathBuf::from(path)),
                None => app.path().app_data_dir().map_err(|e| e.to_string()),
            };
            let mut history = history::History::load(directory.clone());
            if let Ok(root) = &directory {
                *state.external_editor.lock().unwrap() =
                    Some(external_editor::Editor::load(root.clone()));
                *state.engines.lock().unwrap() =
                    Some(Arc::new(engines::Manager::new(root.clone())));
            }
            if let (Ok(root), Some(window)) = (&directory, app.get_webview_window("main")) {
                if let Ok(hwnd) = window.hwnd() {
                    *state.icons.lock().unwrap() =
                        Some(app_icon::Icons::new(root.clone(), hwnd.0 as isize));
                }
            }
            *state.favorites.lock().unwrap() = favorites::Favorites::load(directory);
            let doc = state.doc.lock().unwrap();
            if let Some(path) = doc.path() {
                history.record(path);
            }
            let _ = title(app.handle(), &doc.snapshot());
            *state.history.lock().unwrap() = history;
            if let Some(error) = startup_error {
                app.dialog()
                    .message(error)
                    .title("无法打开文档")
                    .show(|_| {});
            }
            Ok(())
        })
        .on_window_event(|win, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !win.state::<Shared>().allow_close.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = win.emit("request-close", ());
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        startup_failure(&format!("无法启动 MDMD。请检查 WebView2 运行时和用户数据目录权限后重试。\nCould not start MDMD. Check WebView2 and user data folder permissions.\n\n{error}"));
    }
}

fn startup_failure(message: &str) -> ! {
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            std::ptr::null_mut(),
            wide(message).as_ptr(),
            wide("MDMD 启动失败 / Startup failed").as_ptr(),
            windows_sys::Win32::UI::WindowsAndMessaging::MB_OK
                | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
        );
    }
    std::process::exit(1)
}

#[cfg(test)]
mod title_tests {
    use super::*;
    #[test]
    fn title_formats_and_document_states() {
        let mut s = Document::new().snapshot();
        assert_eq!(title_text(&s, true), "MDMD");
        s.name = "未命名.md".into();
        s.content = "draft".into();
        s.dirty = true;
        assert_eq!(title_text(&s, true), "● 未命名.md — MDMD");
        s.path = Some(r"D:\中文 空格\同名.md".into());
        s.name = "同名.md".into();
        assert_eq!(title_text(&s, true), "● D:\\中文 空格\\同名.md — MDMD");
        assert_eq!(title_text(&s, false), "● 同名.md — MDMD");
        s.dirty = false;
        s.content.clear();
        assert_eq!(title_text(&s, false), "同名.md — MDMD");
        assert_eq!(title_text(&s, true), "D:\\中文 空格\\同名.md — MDMD");
    }
}
