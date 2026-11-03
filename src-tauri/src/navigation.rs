use crate::{state::AppState, windows};
use std::{path::Path, sync::atomic::Ordering};
use tauri::{AppHandle, Manager};

fn session_allows_navigation(source: &Path, current: &Path, busy: bool, exiting: bool) -> bool {
    !busy && !exiting && source == current
}

fn is_current(app: &AppHandle, source: &Path) -> bool {
    let state = app.state::<AppState>();
    let current = state.session.lock().unwrap();
    session_allows_navigation(
        source,
        &current,
        state.busy.load(Ordering::SeqCst),
        state.exiting.load(Ordering::SeqCst),
    )
}

// NewWindowRequested is always denied by the caller. Only its destination URL
// is transferred; no popup, window handle, opener or extra session is created.
pub fn new_page(app: &AppHandle, source_session: &Path, target: &url::Url) {
    if !is_current(app, source_session) {
        return;
    }
    if !matches!(target.scheme(), "http" | "https") || target.host_str().is_none() {
        windows::notify(app, &crate::localization::text("errors.newPageUnsupported"));
        return;
    }
    let handle = app.clone();
    let session = source_session.to_path_buf();
    let target = target.clone();
    let result = app.run_on_main_thread(move || {
        // A reset/exit can start after the request was received but before this
        // queued operation runs. Never navigate the replacement browser.
        if !is_current(&handle, &session) {
            return;
        }
        let result = handle
            .get_webview_window("browser")
            .ok_or_else(|| crate::localization::text("errors.browserClosed").to_string())
            .and_then(|browser| browser.navigate(target).map_err(|e| e.to_string()));
        if let Err(error) = result {
            windows::notify(
                &handle,
                &crate::localization::format("errors.newPage", &[("error", (error).to_string())]),
            );
        }
    });
    if let Err(error) = result {
        if is_current(app, source_session) {
            windows::notify(
                app,
                &crate::localization::format(
                    "errors.newPageQueue",
                    &[("error", (error).to_string())],
                ),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_requests_cannot_cross_session_or_shutdown_boundaries() {
        let old = Path::new("sessions/old");
        let new = Path::new("sessions/new");
        assert!(session_allows_navigation(old, old, false, false));
        assert!(!session_allows_navigation(old, old, true, false));
        assert!(!session_allows_navigation(old, old, false, true));
        assert!(!session_allows_navigation(old, new, false, false));
        assert!(!session_allows_navigation(old, new, true, true));
        assert!(session_allows_navigation(new, new, false, false));
    }
}
