use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

/// Busy ownership always ends, including validation/IO errors and early returns.
pub struct Guard(AppHandle);
impl Guard {
    pub fn begin(app: &AppHandle) -> Result<Self, String> {
        let state = app.state::<AppState>();
        if state.shutting_down.load(Ordering::SeqCst)
            || state.exiting.load(Ordering::SeqCst)
            || state.pending_exit.load(Ordering::SeqCst) != 0
        {
            return Err(crate::localization::text("errors.exiting").into());
        }
        state
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| crate::localization::text("errors.busy").to_string())?;
        Ok(Self(app.clone()))
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.0
            .state::<AppState>()
            .busy
            .store(false, Ordering::SeqCst);
        crate::lifecycle::start_pending_exit(&self.0);
    }
}

pub fn validate_preview(app: &AppHandle, epoch: Option<u64>) -> Result<(), String> {
    if epoch
        .is_some_and(|epoch| epoch != app.state::<AppState>().preview_epoch.load(Ordering::SeqCst))
    {
        return Err(crate::localization::text("errors.previewExpired").into());
    }
    Ok(())
}

pub fn is_current_session(app: &AppHandle, session: &std::path::Path) -> bool {
    let state = app.state::<AppState>();
    !state.exiting.load(Ordering::SeqCst)
        && !state.shutting_down.load(Ordering::SeqCst)
        && state.session.lock().unwrap().as_path() == session
}
