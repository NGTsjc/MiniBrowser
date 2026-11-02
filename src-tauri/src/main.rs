#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appearance;
mod bounds;
mod commands;
mod config;
mod context_menu;
mod control_layout;
mod corners;
mod drag_position;
mod lifecycle;
mod localization;
mod navigation;
mod operation;
mod parameters;
mod platform;
mod settings_transaction;
mod shortcuts;
mod state;
mod test_support;
mod theme;
mod tray;
mod ui_thread;
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
            commands::preview_drag_position,
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
                platform::fatal(&localization::format(
                    "errors.startup",
                    &[("error", error.to_string())],
                ));
                app.cleanup_before_exit();
                std::process::exit(1);
            }
            Ok(())
        })
        .build(context);
    drop(startup_gate);
    match app {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if code.is_none() && !state.exiting.load(Ordering::SeqCst) {
                        // Destroying both hosts during a session reset can enqueue
                        // an automatic last-window exit after the replacement exists.
                        // Explicit exits, including fatal rebuild errors, must not be trapped.
                        api.prevent_exit();
                    }
                }
            }
        }),
        Err(error) => {
            platform::fatal(&localization::format(
                "errors.startupBuild",
                &[("error", error.to_string())],
            ));
            std::process::exit(1);
        }
    }
}

fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    platform::check_runtime()?;
    let store = config::PortableStore::beside_executable()?;
    store.clean_stale_sessions();
    let loaded = store.load();
    let locale_warning = localization::init(&store.root, loaded.settings.language_file.as_deref());
    let warning = loaded.warning.map(|key| localization::text(key).to_owned());
    let warnings: Vec<String> = warning.into_iter().chain(locale_warning).collect();
    let warning =
        (!warnings.is_empty()).then(|| warnings.join(localization::text("common.separator")));
    let session = store.new_session()?;
    let url = loaded.settings.startup_url.clone();
    app.manage(AppState::new(
        store,
        loaded.settings,
        session,
        warning,
        loaded.preserve_file,
    ));
    tray::setup(app.handle())?;
    shortcuts::startup(app.handle());
    windows::build(app.handle(), &url)?;
    Ok(())
}
