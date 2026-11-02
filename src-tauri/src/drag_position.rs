use crate::{control_layout::DragPosition, state::AppState};
use tauri::{AppHandle, Manager};

/// Commit both geometry preview values in one UI-thread update so native regions,
/// renderer placement and rollback always describe the same corner and radius.
pub fn apply(app: &AppHandle, radius: u32, position: DragPosition) -> Result<(), String> {
    if radius > crate::parameters::MAX_CORNER_RADIUS {
        return Err(crate::localization::format(
            "errors.radius",
            &[("max", crate::parameters::MAX_CORNER_RADIUS.to_string())],
        ));
    }
    let state = app.state::<AppState>();
    let old_radius = std::mem::replace(&mut *state.effective_corner_radius.lock().unwrap(), radius);
    let old_position = std::mem::replace(
        &mut *state.effective_drag_position.lock().unwrap(),
        position,
    );
    if let Err(error) = crate::windows::sync_controls(app) {
        *state.effective_corner_radius.lock().unwrap() = old_radius;
        *state.effective_drag_position.lock().unwrap() = old_position;
        if let Err(rollback) = crate::windows::sync_controls(app) {
            return Err(crate::localization::format(
                "errors.dragRollback",
                &[("error", error), ("rollback", rollback)],
            ));
        }
        return Err(error);
    }
    Ok(())
}

pub fn preview(app: &AppHandle, position: DragPosition) -> Result<(), String> {
    let radius = *app
        .state::<AppState>()
        .effective_corner_radius
        .lock()
        .unwrap();
    apply(app, radius, position)
}
