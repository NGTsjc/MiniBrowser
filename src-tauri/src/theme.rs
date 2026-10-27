use tauri::{AppHandle, Manager};

// This script grants no IPC access and does nothing in remote documents/frames.
// Re-read committed settings on page load so an existing WebView's original
// initialization script cannot restore an obsolete color after navigation.
pub fn script(color: &str) -> String {
    let color = serde_json::to_string(color).expect("color serializes");
    format!(
        "(()=>{{const u=new URL(location.href);const local=u.protocol==='tauri:'||\
         (u.protocol==='http:'&&u.hostname==='tauri.localhost')||\
         ({debug}&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port==='1420');\
         if(!local||window.top!==window)return;\
         window.__MINIBROWSER_ACCENT__={color};\
         window.dispatchEvent(new Event('minibrowser-theme'));}})()",
        debug = cfg!(debug_assertions)
    )
}

pub fn sync(app: &AppHandle, color: &str) {
    for label in ["browser", "controls"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.eval(script(color));
        }
    }
}
