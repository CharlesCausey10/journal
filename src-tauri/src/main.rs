#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
mod journal;
mod storage;
struct Store {
    directory: PathBuf,
    db: Mutex<Option<rusqlite::Connection>>,
}

struct StartupReady(Arc<AtomicBool>);

#[tauri::command]
fn show_ready_window(
    window: tauri::WebviewWindow,
    ready: tauri::State<StartupReady>,
) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    ready.0.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn journal_request(
    action: String,
    input: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<_> {
        let store = app.state::<Store>();
        let mut db = store
            .db
            .lock()
            .map_err(|_| anyhow::anyhow!("Database lock failed"))?;
        if action == "recovery:folder" {
            app.opener()
                .open_path(store.directory.to_string_lossy(), None::<&str>)?;
            return Ok(serde_json::Value::Null);
        }
        if action == "recovery:restore" {
            anyhow::ensure!(
                db.is_none(),
                "Recovery is only available before the journal opens"
            );
            if let Some(file) = app
                .dialog()
                .file()
                .add_filter("SQLite backup", &["sqlite", "db"])
                .blocking_pick_file()
            {
                let path = file.into_path()?;
                if app
                    .dialog()
                    .message(format!(
                        "Restore {}? Your current database will be kept in the recovery folder.",
                        path.display()
                    ))
                    .buttons(MessageDialogButtons::OkCancel)
                    .blocking_show()
                {
                    storage::restore(&store.directory, &path)?;
                    return Ok(serde_json::json!(true));
                }
            }
            return Ok(serde_json::json!(false));
        }
        if db.is_none() {
            *db = Some(storage::open(&store.directory)?);
        }
        journal::request(db.as_mut().unwrap(), &action, &input)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    if option_env!("JOURNAL_UPDATER_PUBLIC_KEY").is_none() {
        return Ok(None);
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    Ok(updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .map(|u| u.version))
}

#[tauri::command]
async fn apply_update(app: tauri::AppHandle) -> Result<(), String> {
    if option_env!("JOURNAL_UPDATER_PUBLIC_KEY").is_none() {
        return Err("This build uses manual updates".into());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if std::env::var_os("JOURNAL_SMOKE_TEST_DATA").is_none() {
                app.handle().plugin(
                    tauri_plugin_window_state::Builder::default()
                        .with_state_flags(
                            tauri_plugin_window_state::StateFlags::all()
                                & !tauri_plugin_window_state::StateFlags::VISIBLE,
                        )
                        .build(),
                )?;
                if let Some(key) = option_env!("JOURNAL_UPDATER_PUBLIC_KEY") {
                    app.handle()
                        .plugin(tauri_plugin_updater::Builder::new().pubkey(key).build())?;
                }
            }
            let directory = match std::env::var_os("JOURNAL_SMOKE_TEST_DATA") {
                Some(path) => PathBuf::from(path),
                None => app.path().app_data_dir()?,
            };
            let config = &app.config().app.windows[0];
            let handle = app.handle().clone();
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(|url| {
                    matches!(
                        (url.scheme(), url.host_str()),
                        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
                    ) || (cfg!(debug_assertions)
                        && url.origin().ascii_serialization() == "http://127.0.0.1:1420")
                })
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    tauri::webview::NewWindowResponse::Deny
                });
            let window = if std::env::var_os("JOURNAL_SMOKE_TEST_DATA").is_some() {
                window.data_directory(directory.join("webview"))
            } else {
                window
            };
            app.manage(Store {
                directory,
                db: Mutex::new(None),
            });
            let ready = Arc::new(AtomicBool::new(false));
            app.manage(StartupReady(ready.clone()));
            let window = window.build()?;
            // Keep startup failures accessible even if the frontend never signals ready.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(15));
                if !ready.swap(true, Ordering::Relaxed) {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            journal_request,
            show_ready_window,
            check_update,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Journal");
}
