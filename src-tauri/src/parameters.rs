//! Product defaults and shared native/UI constraints. Keep platform protocol
//! constants and ordinary CSS typography/spacing in their own modules.
use crate::config::Settings;
use serde_json::{json, Value};

pub const CONFIG_VERSION: u32 = 1;
pub const DEFAULT_WIDTH: f64 = 960.;
pub const DEFAULT_HEIGHT: f64 = 600.;
pub const MIN_WIDTH: f64 = 80.;
pub const MIN_HEIGHT: f64 = 40.;
pub const MAX_SIZE: f64 = 16384.;
pub const MIN_OPACITY: f64 = 0.1;
pub const MAX_OPACITY: f64 = 1.;
pub const MAX_CORNER_RADIUS: u32 = 256;
pub const DEFAULT_ACCENT: &str = "#2563EB";
pub const DRAG_SIZE: f64 = 36.;
pub const ARC_THRESHOLD: f64 = 64.;
pub const ARC_THICKNESS: f64 = 24.;
pub const ARC_LENGTH: f64 = 64.;
pub const ARC_INSET: f64 = 8.;
pub const PANEL_PADDING: f64 = 8.;
pub const MENU_WIDTH: f64 = 224.;
pub const MENU_HEIGHT: f64 = 281.;
pub const MENU_RADIUS: f64 = 8.;
pub const RESIZE_GRIP: f64 = 6.;

pub fn defaults() -> Settings {
    Settings {
        version: CONFIG_VERSION,
        startup_url: String::new(),
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        always_on_top: false,
        opacity: MAX_OPACITY,
        shortcut: None,
        pause_media_on_hide: true,
        accent_color: DEFAULT_ACCENT.into(),
        corner_radius: 0,
    }
}

pub fn public() -> Value {
    json!({"defaults": defaults(), "limits": {
        "minWidth": MIN_WIDTH, "minHeight": MIN_HEIGHT, "maxSize": MAX_SIZE,
        "minOpacity": MIN_OPACITY, "maxOpacity": MAX_OPACITY,
        "minCornerRadius": 0, "maxCornerRadius": MAX_CORNER_RADIUS, "cornerRadiusStep": 1
    }, "layout": {
        "dragWidth": DRAG_SIZE, "dragHeight": DRAG_SIZE,
        "arcThreshold": ARC_THRESHOLD, "arcThickness": ARC_THICKNESS,
        "arcLength": ARC_LENGTH, "arcInset": ARC_INSET,
        "panelPadding": PANEL_PADDING, "menuWidth": MENU_WIDTH, "menuHeight": MENU_HEIGHT,
        "menuRadius": MENU_RADIUS, "resizeGrip": RESIZE_GRIP
    }})
}

pub fn script() -> String {
    format!(
        "(()=>{{const u=new URL(location.href);if(window.top!==window)return;\
        const local=(u.protocol==='tauri:'||u.origin==='http://tauri.localhost'||\
        ({debug}&&u.origin==='http://127.0.0.1:1420'))&&\
        (u.pathname==='/'||u.pathname==='/index.html');if(!local)return;\
        window.__MINIBROWSER_PARAMETERS__={data};}})()",
        debug = cfg!(debug_assertions),
        data = public()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_public_limits_agree() {
        let mut settings = defaults();
        assert_eq!(settings, Settings::default());
        settings.validate().unwrap();
        assert_eq!(public()["limits"]["maxCornerRadius"], MAX_CORNER_RADIUS);
        settings.corner_radius = MAX_CORNER_RADIUS;
        settings.validate().unwrap();
        settings.corner_radius += 1;
        assert!(settings.validate().is_err());
    }
}
