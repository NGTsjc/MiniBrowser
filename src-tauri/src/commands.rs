use crate::{config::Settings, lifecycle, state::AppState, windows};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() != "controls" {
        return Err("此界面没有应用控制权限".into());
    }
    let url = caller.url().map_err(|e| e.to_string())?;
    let local = url.scheme() == "tauri"
        || (url.host_str() == Some("tauri.localhost") && url.scheme() == "http")
        || (cfg!(debug_assertions)
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420));
    if !local {
        return Err("仅允许本地设置界面调用".into());
    }
    Ok(())
}

#[tauri::command]
pub fn show_window(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    windows::show(&app)
}

#[tauri::command]
pub fn hide_window(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    windows::hide(&app)
}

#[tauri::command]
pub fn restart_app(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    lifecycle::exit(&app, true);
    Ok(())
}

#[tauri::command]
pub fn get_settings(caller: WebviewWindow, app: AppHandle) -> Result<windows::Snapshot, String> {
    authorize(&caller)?;
    Ok(windows::snapshot(&app))
}

#[tauri::command]
pub fn open_settings(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    windows::open_panel(&app)
}

#[tauri::command]
pub fn show_context_menu(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    crate::context_menu::show(&app, "controls")
}

#[tauri::command]
pub fn dismiss_context_menu(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    crate::context_menu::dismiss(&app)?;
    if let Some(browser) = app.get_webview_window("browser") {
        let _ = browser.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn context_menu_action(
    caller: WebviewWindow,
    app: AppHandle,
    action: String,
) -> Result<(), String> {
    authorize(&caller)?;
    crate::context_menu::perform(&app, &action)
}

#[tauri::command]
pub fn restore_window(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    windows::restore(&app)
}

#[tauri::command]
pub fn frontend_ready(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    let state = app.state::<AppState>();
    state.controls_ready.store(true, Ordering::SeqCst);
    if state.pending_exit.load(Ordering::SeqCst) != 0 {
        return Ok(());
    }
    let main_visible = app
        .get_webview_window("browser")
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    if state.visible.load(Ordering::SeqCst) && main_visible {
        caller.show().map_err(|e| e.to_string())?;
        windows::sync_controls(&app)?;
        let opacity = *state.effective_opacity.lock().unwrap();
        windows::set_opacity(&app, opacity)?;
    }
    if state.panel_open.load(Ordering::SeqCst) {
        // A command can arrive before the JS event subscriptions are ready.
        app.emit_to("controls", "settings-open", windows::snapshot(&app))
            .map_err(|e| e.to_string())?;
    } else if state.warning.lock().unwrap().is_some() {
        windows::open_panel(&app)?;
    } else if crate::context_menu::is_open(&app) {
        crate::context_menu::emit_open(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_opacity(
    caller: WebviewWindow,
    app: AppHandle,
    opacity: f64,
    epoch: Option<u64>,
) -> Result<(), String> {
    authorize(&caller)?;
    crate::ui_thread::run(&app, move |app| {
        let _operation = crate::operation::Guard::begin(app)?;
        crate::operation::validate_preview(app, epoch)?;
        if !(crate::parameters::MIN_OPACITY..=crate::parameters::MAX_OPACITY).contains(&opacity) {
            return Err("不透明度无效".into());
        }
        crate::test_support::fail("opacity_preview")?;
        windows::set_opacity(app, opacity)
    })
}

#[tauri::command]
pub fn preview_corner_radius(
    caller: WebviewWindow,
    app: AppHandle,
    radius: u32,
    epoch: Option<u64>,
) -> Result<(), String> {
    authorize(&caller)?;
    crate::ui_thread::run(&app, move |app| {
        let _operation = crate::operation::Guard::begin(app)?;
        crate::operation::validate_preview(app, epoch)?;
        crate::test_support::fail("corner_preview")?;
        crate::corners::preview(app, radius)
    })
}

#[tauri::command]
pub fn cancel_settings(
    caller: WebviewWindow,
    app: AppHandle,
    epoch: Option<u64>,
) -> Result<(), String> {
    authorize(&caller)?;
    crate::ui_thread::run(&app, move |app| {
        let _operation = crate::operation::Guard::begin(app)?;
        crate::operation::validate_preview(app, epoch)?;
        let state = app.state::<AppState>();
        state.preview_epoch.fetch_add(1, Ordering::SeqCst);
        let settings = state.settings.lock().unwrap().clone();
        let opacity = windows::set_opacity(app, settings.opacity);
        let corners = crate::corners::preview(app, settings.corner_radius);
        opacity?;
        corners?;
        windows::close_panel(app)
    })
}

#[tauri::command]
pub fn drag_window(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    if let Some(browser) = app.get_webview_window("browser") {
        if crate::corners::try_resize_from_drag(&app, &browser)? {
            return Ok(());
        }
        browser.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn refresh_page(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    let _operation = crate::operation::Guard::begin(&app)?;
    if let Some(browser) = app.get_webview_window("browser") {
        browser.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_session(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    lifecycle::reset_session(&app)
}

#[tauri::command]
pub fn close_app(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    lifecycle::exit(&app, false);
    Ok(())
}

#[tauri::command]
pub fn apply_settings(
    caller: WebviewWindow,
    app: AppHandle,
    settings: Settings,
    url_edited: bool,
    epoch: Option<u64>,
) -> Result<crate::settings_transaction::Outcome, String> {
    authorize(&caller)?;
    crate::ui_thread::run(&app, move |app| {
        crate::settings_transaction::apply(app, settings, url_edited, epoch)
    })
}
