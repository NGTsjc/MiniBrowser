fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_settings",
            "apply_settings",
            "preview_opacity",
            "preview_corner_radius",
            "cancel_settings",
            "open_settings",
            "drag_window",
            "refresh_page",
            "clear_session",
            "close_app",
            "frontend_ready",
            "show_window",
            "hide_window",
            "restart_app",
            "show_context_menu",
            "restore_window",
            "dismiss_context_menu",
            "context_menu_action",
        ]),
    ))
    .expect("failed to build Tauri resources");
}
