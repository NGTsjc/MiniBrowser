use crate::{lifecycle, state::AppState, windows};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "隐藏窗口", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset_window", "重置窗口", true, None::<&str>)?;
    let close = MenuItem::with_id(app, "close", "关闭", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &reset, &close, &restart])?;
    *app.state::<AppState>().toggle_item.lock().unwrap() = Some(toggle);
    TrayIconBuilder::with_id("main-tray")
        .icon(
            app.default_window_icon()
                .expect("embedded application icon")
                .clone(),
        )
        .tooltip("MiniBrowser")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Err(e) = windows::toggle(app) {
                    windows::notify(app, &e);
                }
            }
            "close" => lifecycle::exit(app, false),
            "reset_window" => {
                if let Err(e) = reset_window(app) {
                    windows::notify(app, &e);
                }
            }
            "restart" => lifecycle::exit(app, true),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = windows::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn reset_window(app: &AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) || state.exiting.load(Ordering::SeqCst) {
        return Ok(());
    }
    crate::context_menu::dismiss(app)?;
    windows::restore(app)?;
    windows::show(app)?;
    if state.panel_open.load(Ordering::SeqCst) {
        if let Some(controls) = app.get_webview_window("controls") {
            controls.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
