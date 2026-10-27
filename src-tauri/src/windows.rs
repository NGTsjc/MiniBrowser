use crate::{config::Settings, lifecycle, platform, state::AppState};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const GUIDE: &str = "index.html?view=guide";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub current_url: String,
    pub warning: Option<String>,
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let warning = state.warning.lock().unwrap().clone();
    Snapshot {
        settings,
        current_url: current_url(app),
        warning,
    }
}

pub fn current_url(app: &AppHandle) -> String {
    app.get_webview_window("browser")
        .and_then(|w| w.url().ok())
        .filter(|u| {
            matches!(u.scheme(), "http" | "https")
                && u.host_str() != Some("tauri.localhost")
                && !(cfg!(debug_assertions)
                    && u.host_str() == Some("127.0.0.1")
                    && u.port() == Some(1420))
        })
        .map(|u| u.to_string())
        .unwrap_or_default()
}

pub fn notify(app: &AppHandle, message: &str) {
    *app.state::<AppState>().warning.lock().unwrap() = Some(message.into());
    let _ = app.emit_to("controls", "notice", message);
}

pub fn build(app: &AppHandle, url: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let session = state.session.lock().unwrap().clone();
    *state.effective_corner_radius.lock().unwrap() = settings.corner_radius;
    #[cfg(debug_assertions)]
    let debug_port = 9223 + state.debug_generation.fetch_add(1, Ordering::SeqCst) * 2;
    let target = if url.is_empty() {
        WebviewUrl::App(GUIDE.into())
    } else {
        WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?)
    };
    let handle = app.clone();
    let new_handle = app.clone();
    let new_session = session.clone();
    let download_handle = app.clone();
    let load_handle = app.clone();
    let script = include_str!("media.js").replace(
        "__PAUSE_ON_HIDE__",
        if settings.pause_media_on_hide {
            "true"
        } else {
            "false"
        },
    );
    let browser_builder = WebviewWindowBuilder::new(app, "browser", target)
        .title("MiniBrowser")
        .inner_size(settings.width, settings.height)
        .min_inner_size(280., 200.)
        .decorations(false)
        .shadow(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .visible(false)
        .always_on_top(settings.always_on_top)
        .data_directory(session.join("browser"))
        .incognito(true)
        .disable_drag_drop_handler()
        .devtools(true)
        .zoom_hotkeys_enabled(cfg!(windows))
        .initialization_script_for_all_frames(script)
        .initialization_script(crate::theme::script(&settings.accent_color))
        .on_navigation(move |url| {
            let local = url.scheme() == "tauri"
                || (matches!(url.host_str(), Some("tauri.localhost" | "127.0.0.1"))
                    && url.path() == "/index.html");
            let allowed = local || matches!(url.scheme(), "http" | "https");
            if !allowed {
                notify(
                    &handle,
                    "已阻止外部协议或本地文件跳转，仅支持 HTTP / HTTPS 网页。",
                );
            }
            allowed
        })
        .on_new_window(move |url, _features| {
            crate::navigation::new_page(&new_handle, &new_session, &url);
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_, event| {
            if matches!(event, tauri::webview::DownloadEvent::Requested { .. }) {
                notify(&download_handle, "精简浏览模式暂不支持下载。");
            }
            false
        })
        .on_page_load(move |webview, payload| {
            let accent = load_handle
                .state::<AppState>()
                .settings
                .lock()
                .unwrap()
                .accent_color
                .clone();
            let _ = webview.eval(crate::theme::script(&accent));
            let url = payload.url().to_string();
            let _ = load_handle.emit_to("controls", "url-changed", url);
            let pause = load_handle
                .state::<AppState>()
                .settings
                .lock()
                .unwrap()
                .pause_media_on_hide;
            let _ = webview.eval(format!("window.__miniBrowserSetPause?.({pause})"));
            // Native IsVisible drives document.visibilityState in every frame.
            if !load_handle
                .state::<AppState>()
                .visible
                .load(Ordering::SeqCst)
            {
                platform::mute(
                    &load_handle,
                    load_handle
                        .state::<AppState>()
                        .settings
                        .lock()
                        .unwrap()
                        .pause_media_on_hide,
                );
            }
        });
    #[cfg(debug_assertions)]
    let browser_builder = if std::env::var_os("MINIBROWSER_TEST_CDP").is_some() {
        browser_builder.additional_browser_args(&format!(
            "--remote-debugging-port={debug_port} --remote-debugging-address=127.0.0.1"
        ))
    } else {
        browser_builder
    };
    #[cfg(debug_assertions)]
    eprintln!("browser host: creating");
    let browser = browser_builder
        .build()
        .map_err(|e| format!("无法创建浏览窗口，请检查 WebView2 Runtime 是否已安装。\n{e}"))?;
    #[cfg(debug_assertions)]
    eprintln!("browser host: created");
    platform::set_opacity(&browser, settings.opacity)?;
    platform::secure_webview(&browser, app.clone())?;
    crate::zoom::install(&browser, app)?;
    platform::track_process(&browser, app.clone())?;
    crate::bounds::install(&browser, app)?;
    crate::context_menu::install_browser(&browser, app)?;
    platform::center_at_cursor(&browser)?;
    let controls_builder = WebviewWindowBuilder::new(
        app,
        "controls",
        WebviewUrl::App("index.html?view=controls".into()),
    )
    .title("MiniBrowser 设置")
    .devtools(false)
    .zoom_hotkeys_enabled(false)
    .inner_size(36., 40.)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .visible(false)
    .always_on_top(settings.always_on_top)
    .data_directory(session.join("controls"))
    .incognito(true)
    .initialization_script(crate::theme::script(&settings.accent_color))
    .parent(&browser)
    .map_err(|e| e.to_string())?
    .on_navigation(|url| {
        url.scheme() == "tauri"
            || (url.host_str() == Some("tauri.localhost")
                && url.scheme() == "http"
                && url.path() == "/index.html")
            || (cfg!(debug_assertions)
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(1420)
                && (url.path() == "/" || url.path() == "/index.html"))
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(debug_assertions)]
    let controls_builder = if std::env::var_os("MINIBROWSER_TEST_CDP").is_some() {
        controls_builder.additional_browser_args(&format!(
            "--remote-debugging-port={} --remote-debugging-address=127.0.0.1",
            debug_port + 1
        ))
    } else {
        controls_builder
    };
    let controls = controls_builder.build().map_err(|e| e.to_string())?;
    crate::corners::install_controls(app, &controls)?;
    platform::track_process(&controls, app.clone())?;
    #[cfg(debug_assertions)]
    eprintln!("control host: created");
    let handle = app.clone();
    browser.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            lifecycle::exit(&handle, false);
        }
        WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. } => {
            let _ = sync_controls(&handle);
        }
        WindowEvent::Resized(_) => {
            // Tauri rebuilds its rectangular resize border on WM_SIZE, even
            // when a preceding move event already updated our geometry cache.
            let _ = sync_controls_inner(&handle, true);
            lifecycle::save_size_later(&handle);
        }
        _ => {}
    });
    let handle = app.clone();
    controls.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = crate::context_menu::dismiss(&handle);
        }
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            lifecycle::exit(&handle, false);
        }
    });
    state.visible.store(true, Ordering::SeqCst);
    state.panel_open.store(false, Ordering::SeqCst);
    *state.context_menu.lock().unwrap() = None;
    sync_controls(app)?;
    browser.show().map_err(|e| e.to_string())?;
    browser.set_focus().map_err(|e| e.to_string())?;
    // Showing a Tao host can rebuild its extended styles; reapply native alpha
    // and tool-window flags after the first show/focus transition.
    set_opacity(app, settings.opacity)?;
    crate::corners::sync(app, true)?;
    // The controls reveal themselves once their embedded UI has finished loading.
    Ok(())
}

pub fn sync_controls(app: &AppHandle) -> Result<(), String> {
    sync_controls_inner(app, false)
}

fn sync_controls_inner(app: &AppHandle, force_corners: bool) -> Result<(), String> {
    let Some(browser) = app.get_webview_window("browser") else {
        return Ok(());
    };
    let Some(controls) = app.get_webview_window("controls") else {
        return Ok(());
    };
    if let Some((x, y, width, height)) = crate::context_menu::layout(app)? {
        platform::place_controls(&controls, x, y, width, height)?;
        platform::set_opacity(&controls, 1.)?;
        return crate::corners::sync(app, force_corners);
    }
    let position = browser.inner_position().map_err(|e| e.to_string())?;
    let size = browser.inner_size().map_err(|e| e.to_string())?;
    let scale = browser.scale_factor().map_err(|e| e.to_string())?;
    let open = app.state::<AppState>().panel_open.load(Ordering::SeqCst);
    let padding = (8. * scale).round() as i32;
    let (x, y, width, height) = if open {
        let width = size
            .width
            .saturating_sub(2 * padding as u32)
            .min((400. * scale) as u32);
        let height = size
            .height
            .saturating_sub(2 * padding as u32)
            .min((620. * scale) as u32);
        (
            position.x + ((size.width - width) / 2) as i32,
            position.y + ((size.height - height) / 2) as i32,
            width,
            height,
        )
    } else {
        (
            position.x,
            position.y,
            (36. * scale) as u32,
            (40. * scale) as u32,
        )
    };
    platform::place_controls(&controls, x, y, width, height)?;
    let opacity = if open {
        1.
    } else {
        *app.state::<AppState>().effective_opacity.lock().unwrap()
    };
    platform::set_opacity(&controls, opacity)?;
    crate::corners::sync(app, force_corners)
}

pub fn open_panel(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) {
        return Err("正在处理会话，请稍候".into());
    }
    crate::context_menu::dismiss(app)?;
    state.panel_open.store(true, Ordering::SeqCst);
    sync_controls(app)?;
    app.emit_to("controls", "settings-open", snapshot(app))
        .map_err(|e| e.to_string())?;
    if let Some(controls) = app.get_webview_window("controls") {
        let _ = controls.set_focus();
    }
    Ok(())
}

pub fn close_panel(app: &AppHandle) -> Result<(), String> {
    app.state::<AppState>()
        .panel_open
        .store(false, Ordering::SeqCst);
    sync_controls(app)?;
    let _ = app.emit_to("controls", "settings-close", ());
    if let Some(browser) = app.get_webview_window("browser") {
        let _ = browser.set_focus();
    }
    Ok(())
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(browser) = app.get_webview_window("browser") {
        platform::ensure_visible(&browser);
        let webview: &tauri::Webview = browser.as_ref();
        let _ = webview.show();
        browser.show().map_err(|e| e.to_string())?;
        browser.set_focus().map_err(|e| e.to_string())?;
        state.visible.store(true, Ordering::SeqCst);
        platform::mute(app, false);
        sync_controls(app)?;
        if let Some(controls) = app.get_webview_window("controls") {
            let _ = controls.show();
        }
        let opacity = *state.effective_opacity.lock().unwrap();
        set_opacity(app, opacity)?;
        crate::corners::sync(app, true)?;
        update_visibility(app, true);
    }
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) {
        return Ok(());
    }
    crate::context_menu::dismiss(app)?;
    if let Some(browser) = app.get_webview_window("browser") {
        if state.settings.lock().unwrap().pause_media_on_hide {
            platform::mute(app, true);
            let _ = browser.eval("document.querySelectorAll('video,audio').forEach(e=>e.pause())");
        }
        if let Some(controls) = app.get_webview_window("controls") {
            let _ = controls.hide();
        }
        let webview: &tauri::Webview = browser.as_ref();
        let _ = webview.hide();
        browser.hide().map_err(|e| e.to_string())?;
        state.visible.store(false, Ordering::SeqCst);
        update_visibility(app, false);
    }
    Ok(())
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppState>().visible.load(Ordering::SeqCst) {
        hide(app)
    } else {
        show(app)
    }
}

fn update_visibility(app: &AppHandle, visible: bool) {
    if let Some(item) = app.state::<AppState>().toggle_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if visible {
            "隐藏窗口"
        } else {
            "显示窗口"
        });
    }
    let _ = app.emit_to("controls", "visibility-changed", visible);
}

pub fn set_opacity(app: &AppHandle, opacity: f64) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        platform::set_opacity(&browser, opacity)?;
    }
    let state = app.state::<AppState>();
    if let Some(controls) = app.get_webview_window("controls") {
        platform::set_opacity(
            &controls,
            if state.panel_open.load(Ordering::SeqCst) || crate::context_menu::is_open(app) {
                1.
            } else {
                opacity
            },
        )?;
    }
    *state.effective_opacity.lock().unwrap() = opacity;
    Ok(())
}

pub fn apply_window_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    if let Some(browser) = app.get_webview_window("browser") {
        browser
            .set_always_on_top(settings.always_on_top)
            .map_err(|e| e.to_string())?;
    }
    set_opacity(app, settings.opacity)?;
    crate::corners::preview(app, settings.corner_radius)
}

pub fn restore(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppState>().busy.load(Ordering::SeqCst) {
        return Err("正在处理，请稍候".into());
    }
    if let Some(browser) = app.get_webview_window("browser") {
        let defaults = Settings::default();
        let monitor = browser.current_monitor().map_err(|e| e.to_string())?;
        browser
            .set_size(tauri::LogicalSize::new(defaults.width, defaults.height))
            .map_err(|e| e.to_string())?;
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let size = browser.outer_size().map_err(|e| e.to_string())?;
            browser
                .set_position(tauri::PhysicalPosition::new(
                    area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32,
                    area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32,
                ))
                .map_err(|e| e.to_string())?;
        } else {
            platform::center_at_cursor(&browser)?;
        }
        crate::bounds::settle_window(&browser)?;
        sync_controls(app)?;
        let opacity = *app.state::<AppState>().effective_opacity.lock().unwrap();
        set_opacity(app, opacity)?;
        lifecycle::save_size(app);
    }
    Ok(())
}

pub fn current_size(app: &AppHandle) -> Option<(f64, f64)> {
    let browser = app.get_webview_window("browser")?;
    let size: PhysicalSize<u32> = browser.inner_size().ok()?;
    let scale = browser.scale_factor().ok()?;
    Some((size.width as f64 / scale, size.height as f64 / scale))
}
