#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bounds;
mod commands;
mod config;
mod context_menu;
mod corners;
mod lifecycle;
mod navigation;
mod platform;
mod shortcuts;
mod state;
mod theme;
mod tray;
mod windows;
mod zoom;

use state::AppState;
use std::sync::atomic::Ordering;
use tauri::Manager;

fn main() {
    // Serialize startup through plugin registration + setup so two simultaneous
    // launches cannot race before the single-instance message window exists.
    let startup_gate = match platform::startup_gate() {
        Ok(gate) => gate,
        Err(error) => {
            platform::fatal(&error);
            return;
        }
    };
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    if std::env::var_os("MINIBROWSER_TEST_CDP").is_some() {
        context
            .config_mut()
            .identifier
            .push_str(".integration-tests");
    }
    let app = tauri::Builder::default()
        // Must be registered before setup touches portable configuration/session data.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if handle.try_state::<AppState>().is_some() {
                    let _ = windows::show(&handle);
                }
            });
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::apply_settings,
            commands::preview_opacity,
            commands::preview_corner_radius,
            commands::cancel_settings,
            commands::open_settings,
            commands::drag_window,
            commands::refresh_page,
            commands::clear_session,
            commands::close_app,
            commands::frontend_ready,
            commands::show_window,
            commands::hide_window,
            commands::restart_app,
            commands::show_context_menu,
            commands::restore_window,
            commands::dismiss_context_menu,
            commands::context_menu_action,
        ])
        .setup(|app| {
            if let Err(error) = initialize(app) {
                platform::fatal(&format!("启动失败：{error}\n\nWebView2 安装说明：https://developer.microsoft.com/microsoft-edge/webview2/"));
                app.cleanup_before_exit();
                std::process::exit(1);
            }
            Ok(())
        })
        .build(context);
    drop(startup_gate);
    match app {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if !state.exiting.load(Ordering::SeqCst) {
                        // Destroying both hosts during a session reset can enqueue
                        // an automatic last-window exit after the replacement exists.
                        // Only explicit close/restart paths are allowed to exit.
                        api.prevent_exit();
                    }
                }
            }
        }),
        Err(error) => {
            platform::fatal(&format!("启动失败：{error}\n\n请确认 EXE 所在目录可写，且系统已安装 Microsoft Edge WebView2 Runtime。\nhttps://developer.microsoft.com/microsoft-edge/webview2/"));
            std::process::exit(1);
        }
    }
}

fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    platform::check_runtime()?;
    let store = config::PortableStore::beside_executable()?;
    store.clean_stale_sessions();
    let loaded = store.load();
    let session = store.new_session()?;
    let url = loaded.settings.startup_url.clone();
    app.manage(AppState::new(
        store,
        loaded.settings,
        session,
        loaded.warning,
        loaded.preserve_file,
    ));
    tray::setup(app.handle())?;
    shortcuts::startup(app.handle());
    windows::build(app.handle(), &url)?;
    Ok(())
}
