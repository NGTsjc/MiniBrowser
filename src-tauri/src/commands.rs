use crate::{config::Settings, lifecycle, shortcuts, state::AppState, windows};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

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
    if app.state::<AppState>().visible.load(Ordering::SeqCst) {
        caller.show().map_err(|e| e.to_string())?;
        windows::sync_controls(&app)?;
    }
    if app.state::<AppState>().warning.lock().unwrap().is_some() {
        windows::open_panel(&app)?;
    } else if crate::context_menu::is_open(&app) {
        crate::context_menu::emit_open(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_opacity(caller: WebviewWindow, app: AppHandle, opacity: f64) -> Result<(), String> {
    authorize(&caller)?;
    if !(0.2..=1.).contains(&opacity) {
        return Err("不透明度无效".into());
    }
    windows::set_opacity(&app, opacity)
}

#[tauri::command]
pub fn cancel_settings(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    let opacity = app.state::<AppState>().settings.lock().unwrap().opacity;
    windows::set_opacity(&app, opacity)?;
    windows::close_panel(&app)
}

#[tauri::command]
pub fn drag_window(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
    if let Some(browser) = app.get_webview_window("browser") {
        browser.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn refresh_page(caller: WebviewWindow, app: AppHandle) -> Result<(), String> {
    authorize(&caller)?;
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
    mut settings: Settings,
    url_edited: bool,
) -> Result<(), String> {
    authorize(&caller)?;
    let state = app.state::<AppState>();
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("正在处理，请稍候".into());
    }
    let result = apply_inner(&app, &mut settings, url_edited);
    state.busy.store(false, Ordering::SeqCst);
    result
}

fn apply_inner(app: &AppHandle, settings: &mut Settings, url_edited: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let old = state.settings.lock().unwrap().clone();
    // Dimensions are controlled by native resizing, not by frontend input.
    (settings.width, settings.height) =
        windows::current_size(app).unwrap_or((old.width, old.height));
    settings.validate()?;
    let old_key = shortcuts::parse(&old.shortcut).ok().flatten();
    let new_key = shortcuts::parse(&settings.shortcut)?;
    let changed = old_key != new_key;
    let newly_registered = new_key.is_some_and(|key| !app.global_shortcut().is_registered(key));
    if newly_registered {
        if let Some(key) = new_key {
            shortcuts::register(app, key)?;
        }
    }
    let browser = app.get_webview_window("browser").ok_or("浏览窗口已关闭")?;
    let result = (|| {
        windows::apply_window_settings(app, settings)?;
        caller_topmost(app, settings.always_on_top)?;
        state.store.save(settings)?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = windows::apply_window_settings(app, &old);
        let _ = caller_topmost(app, old.always_on_top);
        if newly_registered {
            if let Some(key) = new_key {
                let _ = app.global_shortcut().unregister(key);
            }
        }
        return Err(error);
    }
    if changed {
        if let Some(key) = old_key {
            let _ = app.global_shortcut().unregister(key);
        }
    }
    *state.settings.lock().unwrap() = settings.clone();
    state.preserve_config.store(false, Ordering::SeqCst);
    *state.warning.lock().unwrap() = None;
    // Update existing documents and future top-level documents. The original
    // initialization script is replaced in the platform hook below when needed.
    let media_script = format!(
        "window.__miniBrowserSetPause?.({})",
        settings.pause_media_on_hide
    );
    browser.eval(&media_script).map_err(|e| e.to_string())?;
    if url_edited {
        let target = if settings.startup_url.is_empty() {
            // Resolve the embedded guide against the same local origin as controls.
            let controls = app.get_webview_window("controls").ok_or("设置界面已关闭")?;
            controls
                .url()
                .map_err(|e| e.to_string())?
                .join("index.html?view=guide")
                .map_err(|e| e.to_string())?
        } else {
            settings
                .startup_url
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?
        };
        browser.navigate(target).map_err(|e| e.to_string())?;
    }
    windows::close_panel(app)
}

fn caller_topmost(app: &AppHandle, value: bool) -> Result<(), String> {
    if let Some(controls) = app.get_webview_window("controls") {
        controls
            .set_always_on_top(value)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
