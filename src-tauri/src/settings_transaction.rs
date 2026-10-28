use crate::{config::Settings, operation, shortcuts, state::AppState, windows};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub settings: Settings,
    pub warnings: Vec<String>,
    pub navigation_failed: bool,
    pub preview_epoch: u64,
}

pub fn apply(
    app: &AppHandle,
    mut settings: Settings,
    url_edited: bool,
    epoch: Option<u64>,
) -> Result<Outcome, String> {
    let _operation = operation::Guard::begin(app)?;
    operation::validate_preview(app, epoch)?;
    let state = app.state::<AppState>();
    let old = state.settings.lock().unwrap().clone();
    let browser = app.get_webview_window("browser").ok_or("浏览窗口已关闭")?;
    (settings.width, settings.height) =
        windows::current_size(app).unwrap_or((old.width, old.height));
    settings.validate()?;
    let target = if !url_edited {
        None
    } else if settings.startup_url.is_empty() {
        Some(
            app.get_webview_window("controls")
                .ok_or("设置界面已关闭")?
                .url()
                .map_err(|e| e.to_string())?
                .join("index.html?view=guide")
                .map_err(|e| e.to_string())?,
        )
    } else {
        Some(
            settings
                .startup_url
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        )
    };
    let old_key = shortcuts::parse(&old.shortcut)?;
    let new_key = shortcuts::parse(&settings.shortcut)?;
    let newly_registered = new_key.is_some_and(|key| !app.global_shortcut().is_registered(key));
    if newly_registered {
        if let Some(key) = new_key {
            shortcuts::register(app, key)?;
        }
    }
    // This invalidates requests submitted by a previous draft before doing any
    // native work. File replacement below is the sole commit boundary.
    state.preview_epoch.fetch_add(1, Ordering::SeqCst);
    let before_commit = (|| {
        windows::apply_window_settings(app, &settings)?;
        controls_topmost(app, settings.always_on_top)?;
        state.store.save(&settings)
    })();
    if let Err(error) = before_commit {
        let mut errors = vec![error];
        if let Err(e) = windows::apply_window_settings(app, &old) {
            errors.push(format!("恢复窗口失败：{e}"));
        }
        if let Err(e) = controls_topmost(app, old.always_on_top) {
            errors.push(format!("恢复置顶失败：{e}"));
        }
        if newly_registered {
            if let Some(key) = new_key {
                if let Err(e) = app.global_shortcut().unregister(key) {
                    errors.push(format!("恢复快捷键失败：{e}"));
                }
            }
        }
        return Err(errors.join("；"));
    }

    *state.settings.lock().unwrap() = settings.clone();
    state.preserve_config.store(false, Ordering::SeqCst);
    *state.warning.lock().unwrap() = None;
    crate::theme::sync(app, &settings.accent_color);
    let mut warnings = Vec::new();
    if old_key != new_key {
        if let Some(key) = old_key {
            if let Err(e) = app.global_shortcut().unregister(key) {
                warnings.push(format!("旧快捷键未能注销：{e}"));
            }
        }
    }
    let media = crate::test_support::fail("media_sync").and_then(|_| {
        browser
            .eval(format!(
                "window.__miniBrowserSetPause?.({})",
                settings.pause_media_on_hide
            ))
            .map_err(|e| e.to_string())
    });
    if let Err(error) = media {
        warnings.push(format!("媒体设置同步失败：{error}"));
    }
    let mut navigation_failed = false;
    if let Some(target) = target {
        let navigation = crate::test_support::fail("navigation")
            .and_then(|_| browser.navigate(target).map_err(|e| e.to_string()));
        if let Err(error) = navigation {
            navigation_failed = true;
            warnings.push(format!("无法打开新地址，当前网页保留：{error}"));
        }
    }
    if warnings.is_empty() {
        if let Err(error) = windows::close_panel(app) {
            warnings.push(format!("设置面板关闭失败：{error}"));
        }
    }
    if !warnings.is_empty() {
        *state.warning.lock().unwrap() = Some(format!("设置已保存；{}", warnings.join("；")));
    }
    Ok(Outcome {
        settings,
        warnings,
        navigation_failed,
        preview_epoch: state.preview_epoch.load(Ordering::SeqCst),
    })
}

fn controls_topmost(app: &AppHandle, value: bool) -> Result<(), String> {
    if let Some(controls) = app.get_webview_window("controls") {
        controls
            .set_always_on_top(value)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
