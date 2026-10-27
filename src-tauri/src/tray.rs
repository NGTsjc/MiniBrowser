use crate::{lifecycle, state::AppState, windows};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "隐藏窗口", true, None::<&str>)?;
    let close = MenuItem::with_id(app, "close", "关闭", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &close, &restart])?;
    *app.state::<AppState>().toggle_item.lock().unwrap() = Some(toggle);
    let mut pixels = vec![0u8; 32 * 32 * 4];
    for y in 3..29 {
        for x in 3..29 {
            let i = (y * 32 + x) * 4;
            let border = !(6..=25).contains(&x) || !(6..=25).contains(&y) || y == 11;
            pixels[i..i + 4].copy_from_slice(if border {
                &[160, 239, 208, 255]
            } else {
                &[24, 36, 42, 255]
            });
        }
    }
    TrayIconBuilder::with_id("main-tray")
        .icon(Image::new_owned(pixels, 32, 32))
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
