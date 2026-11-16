#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod markdown;

use engine::{Edit, Engine, FileInfo, Preview, Status};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

type Store = Mutex<Engine>;

#[tauri::command]
fn import_files(paths: Vec<String>, state: State<Store>) -> Result<Vec<FileInfo>, String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .import(paths)
}

#[tauri::command]
fn clear_files(state: State<Store>) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .clear();
    Ok(())
}

#[tauri::command]
fn preview_names(edits: Vec<Edit>, state: State<Store>) -> Result<Vec<Preview>, String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .preview(edits)
}

#[tauri::command]
async fn apply_names(edits: Vec<Edit>, state: State<'_, Store>) -> Result<Vec<FileInfo>, String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .apply(edits)
}

#[tauri::command]
async fn undo_batch(state: State<'_, Store>) -> Result<Vec<FileInfo>, String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .undo()
}

#[tauri::command]
fn session_status(state: State<Store>) -> Result<Status, String> {
    state
        .lock()
        .map_err(|_| "Sesi tidak tersedia. Buka ulang aplikasi.")?
        .status()
}

fn main() {
    let initial = markdown::file_argument(
        &std::env::args().collect::<Vec<_>>(),
        &std::env::current_dir().unwrap_or_default(),
    );
    tauri::Builder::default()
        .manage(markdown::PendingMarkdown(Mutex::new(initial)))
        .manage(Mutex::new(markdown::MarkdownStore::default()))
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(path) = markdown::file_argument(&args, std::path::Path::new(&cwd)) {
                if let Ok(mut pending) = app.state::<markdown::PendingMarkdown>().0.lock() {
                    *pending = Some(path);
                }
                let _ = app.emit("markdown-open", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let lock = std::fs::File::options()
                .create(true)
                .read(true)
                .write(true)
                .truncate(false)
                .open(data_dir.join("session.lock"))?;
            if lock.try_lock().is_err() {
                app.dialog()
                    .message("Saku sudah terbuka. Gunakan jendela yang sedang aktif.")
                    .title("Aplikasi sudah terbuka")
                    .blocking_show();
                return Err("Another desktop session is active".into());
            }
            app.manage(lock);
            let journal = data_dir.join("last-rename.json");
            app.manage(Mutex::new(Engine::new(journal)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_files,
            clear_files,
            preview_names,
            apply_names,
            undo_batch,
            session_status,
            markdown::open_markdown,
            markdown::new_markdown,
            markdown::new_markdown_tab,
            markdown::prepare_markdown_save,
            markdown::save_markdown,
            markdown::close_markdown_tab,
            markdown::markdown_image,
            markdown::markdown_link,
            markdown::open_external_target,
            markdown::take_pending_markdown,
            markdown::open_web_link
        ])
        .run(tauri::generate_context!())
        .expect("Tidak bisa menjalankan Saku");
}
