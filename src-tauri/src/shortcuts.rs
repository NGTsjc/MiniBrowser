use crate::{state::AppState, windows};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn parse(value: &Option<String>) -> Result<Option<Shortcut>, String> {
    value
        .as_ref()
        .map(|s| {
            s.parse::<Shortcut>()
                .map_err(|_| "快捷键无效，请使用修饰键加字母、数字或功能键".to_string())
        })
        .transpose()
}

pub fn register(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                let handle = app.clone();
                // Serialize native window operations through the event loop.
                let _ = app.run_on_main_thread(move || {
                    let _ = windows::toggle(&handle);
                });
            }
        })
        .map_err(|e| format!("无法注册快捷键，它可能已被其他应用占用：{e}"))
}

pub fn startup(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    if let Some(value) = settings.shortcut.as_ref() {
        let result =
            parse(&settings.shortcut).and_then(|shortcut| register(app, shortcut.unwrap()));
        if let Err(error) = result {
            *state.warning.lock().unwrap() = Some(format!(
                "快捷键 {value} 未生效：{error}。可通过托盘恢复窗口。"
            ));
        }
    }
}
