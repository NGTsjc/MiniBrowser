use crate::{state::AppState, windows};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn parse(value: &Option<String>) -> Result<Option<Shortcut>, String> {
    value
        .as_ref()
        .map(|s| {
            s.parse::<Shortcut>()
                .map_err(|_| crate::localization::text("errors.shortcutInvalid").to_string())
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
        .map_err(|e| {
            crate::localization::format("errors.shortcutRegister", &[("error", (e).to_string())])
        })
}

pub fn startup(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    if let Some(value) = settings.shortcut.as_ref() {
        let result =
            parse(&settings.shortcut).and_then(|shortcut| register(app, shortcut.unwrap()));
        if let Err(error) = result {
            let message = crate::localization::format(
                "errors.shortcutStartup",
                &[
                    ("shortcut", (value).to_string()),
                    ("error", (error).to_string()),
                ],
            );
            let mut warning = state.warning.lock().unwrap();
            *warning = Some(match warning.take() {
                Some(previous) => {
                    [previous, message].join(&crate::localization::text("common.separator"))
                }
                None => message,
            });
        }
    }
}
