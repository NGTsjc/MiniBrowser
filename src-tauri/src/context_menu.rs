use crate::{lifecycle, platform, state::AppState, windows};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

pub fn is_open(app: &AppHandle) -> bool {
    app.state::<AppState>()
        .context_menu
        .lock()
        .unwrap()
        .is_some()
}

pub fn emit_open(app: &AppHandle) -> Result<(), String> {
    let shortcut = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .shortcut
        .clone();
    app.emit_to("controls", "context-menu-open", shortcut)
        .map_err(|e| e.to_string())
}

pub fn show(app: &AppHandle, source: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) || !state.visible.load(Ordering::SeqCst) {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(source) else {
        return Ok(());
    };
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    *state.context_menu.lock().unwrap() = Some((cursor.x as i32, cursor.y as i32));
    windows::sync_controls(app)?;
    emit_open(app)?;
    if let Some(controls) = app.get_webview_window("controls") {
        controls.show().map_err(|e| e.to_string())?;
        controls.set_focus().map_err(|e| e.to_string())?;
        platform::set_opacity(&controls, 1.)?;
    }
    Ok(())
}

// Reuse the trusted control WebView rather than creating another browser process.
pub fn layout(app: &AppHandle) -> Result<Option<(i32, i32, u32, u32)>, String> {
    let anchor = *app.state::<AppState>().context_menu.lock().unwrap();
    let Some((x, y)) = anchor else {
        return Ok(None);
    };
    let Some(browser) = app.get_webview_window("browser") else {
        return Ok(None);
    };
    let monitor = browser
        .monitor_from_point(x as f64, y as f64)
        .map_err(|e| e.to_string())?
        .or(browser.current_monitor().map_err(|e| e.to_string())?);
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = ((252. * scale).round() as u32).min(area.size.width);
        let height = ((282. * scale).round() as u32).min(area.size.height);
        let x = x.clamp(
            area.position.x,
            area.position.x + area.size.width.saturating_sub(width) as i32,
        );
        let y = y.clamp(
            area.position.y,
            area.position.y + area.size.height.saturating_sub(height) as i32,
        );
        Ok(Some((x, y, width, height)))
    } else {
        Ok(Some((x, y, 252, 282)))
    }
}

pub fn dismiss(app: &AppHandle) -> Result<(), String> {
    if app
        .state::<AppState>()
        .context_menu
        .lock()
        .unwrap()
        .take()
        .is_some()
    {
        app.emit_to("controls", "context-menu-close", ())
            .map_err(|e| e.to_string())?;
        windows::sync_controls(app)?;
    }
    Ok(())
}

pub fn perform(app: &AppHandle, action: &str) -> Result<(), String> {
    if !matches!(action, "refresh" | "hide" | "close" | "restore" | "restart") {
        return Err("不支持的菜单操作".into());
    }
    if app.state::<AppState>().busy.load(Ordering::SeqCst) {
        return Ok(());
    }
    dismiss(app)?;
    match action {
        "refresh" => {
            if let Some(browser) = app.get_webview_window("browser") {
                browser.reload().map_err(|e| e.to_string())?;
                let _ = browser.set_focus();
            }
        }
        "hide" => windows::hide(app)?,
        "close" => lifecycle::exit(app, false),
        "restore" => {
            windows::restore(app)?;
            if let Some(browser) = app.get_webview_window("browser") {
                let _ = browser.set_focus();
            }
        }
        "restart" => lifecycle::exit(app, true),
        _ => unreachable!(),
    }
    Ok(())
}

pub fn install_browser(browser: &tauri::WebviewWindow, app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app = app.clone();
        browser
            .with_webview(move |webview| unsafe {
                use ::windows::core::Interface;
                use webview2_com::{
                    ContextMenuRequestedEventHandler,
                    Microsoft::Web::WebView2::Win32::ICoreWebView2_11,
                };
                if let Ok(core) = webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|c| c.cast::<ICoreWebView2_11>())
                {
                    let handler =
                        ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                            if let Some(args) = args {
                                args.SetHandled(true)?;
                            }
                            let handle = app.clone();
                            std::thread::spawn(move || {
                                let menu_app = handle.clone();
                                let _ = handle.run_on_main_thread(move || {
                                    if let Err(error) = show(&menu_app, "browser") {
                                        windows::notify(&menu_app, &error);
                                    }
                                });
                            });
                            Ok(())
                        }));
                    let mut token = 0;
                    let _ = core.add_ContextMenuRequested(&handler, &mut token);
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (browser, app);
    Ok(())
}
