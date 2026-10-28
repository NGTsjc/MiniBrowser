use crate::parameters as p;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub startup_url: String,
    pub width: f64,
    pub height: f64,
    pub always_on_top: bool,
    pub opacity: f64,
    pub shortcut: Option<String>,
    pub pause_media_on_hide: bool,
    pub accent_color: String,
    pub corner_radius: u32,
}

impl Default for Settings {
    fn default() -> Self {
        crate::parameters::defaults()
    }
}

pub fn valid_accent(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

pub fn normalize_url(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(String::new());
    }
    let candidate = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url = url::Url::parse(&candidate).map_err(|_| "请输入有效的网页地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持不包含用户名或密码的 HTTP / HTTPS 网页地址".into());
    }
    Ok(url.to_string())
}

impl Settings {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.corner_radius > p::MAX_CORNER_RADIUS {
            return Err(format!("窗口圆角必须在 0～{} 之间", p::MAX_CORNER_RADIUS));
        }
        if !valid_accent(&self.accent_color) {
            return Err("主题色必须为 #RRGGBB 格式".into());
        }
        self.accent_color.make_ascii_uppercase();
        self.version = p::CONFIG_VERSION;
        self.startup_url = normalize_url(&self.startup_url)?;
        if !self.opacity.is_finite() || !(p::MIN_OPACITY..=p::MAX_OPACITY).contains(&self.opacity) {
            return Err(format!(
                "不透明度必须在 {}%～{}% 之间",
                p::MIN_OPACITY * 100.,
                p::MAX_OPACITY * 100.
            ));
        }
        if !self.width.is_finite()
            || !self.height.is_finite()
            || !(p::MIN_WIDTH..=p::MAX_SIZE).contains(&self.width)
            || !(p::MIN_HEIGHT..=p::MAX_SIZE).contains(&self.height)
        {
            return Err("窗口尺寸无效".into());
        }
        self.shortcut = self
            .shortcut
            .as_ref()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        Ok(())
    }
}

pub struct PortableStore {
    pub root: PathBuf,
}

pub struct LoadedSettings {
    pub settings: Settings,
    pub warning: Option<String>,
    pub preserve_file: bool,
}

impl PortableStore {
    pub fn beside_executable() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = exe.parent().ok_or("无法定位 EXE 目录")?;
        Self::at(parent.join("MiniBrowser.data"))
    }

    pub fn at(root: PathBuf) -> Result<Self, String> {
        let store = Self { root };
        fs::create_dir_all(store.root.join("sessions")).map_err(portable_error)?;
        let probe = store.root.join(".write-check");
        fs::write(&probe, b"portable").map_err(portable_error)?;
        fs::remove_file(&probe).map_err(portable_error)?;
        Ok(store)
    }

    pub fn load(&self) -> LoadedSettings {
        let path = self.root.join("settings.json");
        let value: Value = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(Value::Object(map)) => Value::Object(map),
                _ => return fallback("配置文件损坏，已使用默认值；确认设置前将保留原文件。"),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return LoadedSettings {
                    settings: Settings::default(),
                    warning: None,
                    preserve_file: false,
                }
            }
            Err(_) => return fallback("无法读取配置，已使用默认值；确认设置前将保留原文件。"),
        };
        if value
            .get("version")
            .and_then(Value::as_u64)
            .is_some_and(|v| v != p::CONFIG_VERSION as u64)
        {
            return fallback("配置版本不受支持，已使用默认值；确认设置前将保留原文件。");
        }
        let mut settings = Settings::default();
        let mut invalid = false;
        macro_rules! read {
            ($key:literal, $field:ident, $ty:ty, $valid:expr) => {
                if let Some(raw) = value.get($key) {
                    match serde_json::from_value::<$ty>(raw.clone()) {
                        Ok(v) if ($valid)(&v) => settings.$field = v,
                        _ => invalid = true,
                    }
                }
            };
        }
        read!("startupUrl", startup_url, String, |v: &String| {
            normalize_url(v).is_ok()
        });
        settings.startup_url = normalize_url(&settings.startup_url).unwrap_or_default();
        read!("width", width, f64, |v: &f64| v.is_finite()
            && (p::MIN_WIDTH..=p::MAX_SIZE).contains(v));
        read!("height", height, f64, |v: &f64| v.is_finite()
            && (p::MIN_HEIGHT..=p::MAX_SIZE).contains(v));
        read!("opacity", opacity, f64, |v: &f64| v.is_finite()
            && (p::MIN_OPACITY..=p::MAX_OPACITY).contains(v));
        read!("alwaysOnTop", always_on_top, bool, |_: &bool| true);
        read!("accentColor", accent_color, String, |v: &String| {
            valid_accent(v)
        });
        settings.accent_color.make_ascii_uppercase();
        read!("cornerRadius", corner_radius, u32, |v: &u32| *v
            <= p::MAX_CORNER_RADIUS);
        read!("pauseMediaOnHide", pause_media_on_hide, bool, |_: &bool| {
            true
        });
        read!("shortcut", shortcut, Option<String>, |_: &Option<
            String,
        >| true);
        settings.shortcut = settings
            .shortcut
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        if settings
            .shortcut
            .as_ref()
            .is_some_and(|s| s.parse::<tauri_plugin_global_shortcut::Shortcut>().is_err())
        {
            settings.shortcut = None;
            invalid = true;
        }
        LoadedSettings {
            settings,
            warning: invalid.then(|| "部分配置字段无效，已对这些字段使用默认值。".into()),
            preserve_file: invalid,
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
        let temp = self.root.join("settings.json.tmp");
        let result = (|| {
            let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            atomic_replace(&temp, &self.root.join("settings.json"))
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result.map_err(|e| format!("设置保存失败：{e}"))
    }

    pub fn new_session(&self) -> Result<PathBuf, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let path = self
            .root
            .join("sessions")
            .join(format!("{}-{stamp}", std::process::id()));
        fs::create_dir(&path).map_err(portable_error)?;
        Ok(path)
    }

    pub fn clean_stale_sessions(&self) {
        let started = std::time::Instant::now();
        if let Ok(entries) = fs::read_dir(self.root.join("sessions")) {
            for entry in entries.flatten() {
                if started.elapsed().as_secs() >= 5 {
                    break;
                }
                // Never follow a junction/symlink out of the portable tree.
                if entry
                    .file_type()
                    .is_ok_and(|t| t.is_dir() && !t.is_symlink())
                {
                    let processes: Vec<u32> = fs::read(entry.path().join("processes.json"))
                        .ok()
                        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                        .unwrap_or_default();
                    if !crate::platform::wait_for_browsers(&processes) {
                        continue;
                    }
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }
}

fn fallback(message: &str) -> LoadedSettings {
    LoadedSettings {
        settings: Settings::default(),
        warning: Some(message.into()),
        preserve_file: true,
    }
}

fn portable_error(error: std::io::Error) -> String {
    format!("无法写入 EXE 同级的 MiniBrowser.data 目录，请将程序移到可写目录。\n{error}")
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> PortableStore {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        PortableStore::at(
            std::env::current_dir()
                .unwrap()
                .join("target")
                .join(format!("config-test-{stamp}")),
        )
        .unwrap()
    }
    #[test]
    fn urls_are_normalized_and_unsafe_schemes_rejected() {
        assert_eq!(
            normalize_url("example.com/path").unwrap(),
            "https://example.com/path"
        );
        for bad in [
            "file:///C:/secret",
            "javascript:alert(1)",
            "https://user:pass@example.com",
            "https://",
        ] {
            assert!(normalize_url(bad).is_err(), "{bad}");
        }
        assert_eq!(normalize_url(" ").unwrap(), "");
    }
    #[test]
    fn config_falls_back_per_field_and_preserves_broken_file() {
        let store = store();
        let path = store.root.join("settings.json");
        fs::write(
            &path,
            br#"{"opacity":0,"width":700,"alwaysOnTop":true,"height":"bad"}"#,
        )
        .unwrap();
        let loaded = store.load();
        assert_eq!(loaded.settings.width, 700.);
        assert_eq!(loaded.settings.height, 600.);
        assert_eq!(loaded.settings.opacity, 1.);
        assert!(loaded.settings.always_on_top && loaded.preserve_file);
        fs::write(&path, "broken").unwrap();
        assert!(store.load().preserve_file);
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn accent_color_legacy_fallback_validation_and_round_trip() {
        let store = store();
        let path = store.root.join("settings.json");
        fs::write(&path, r##"{"width":700,"accentColor":"#abcdef"}"##).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.settings.accent_color, "#ABCDEF");
        assert_eq!(loaded.settings.width, 700.);
        assert!(!loaded.preserve_file);
        for value in ["white", "#FFF", "#12345G", "#FFFFFF00", "#ééé"] {
            fs::write(
                &path,
                serde_json::json!({"width":700,"accentColor":value}).to_string(),
            )
            .unwrap();
            let loaded = store.load();
            assert_eq!(loaded.settings.accent_color, "#2563EB");
            assert_eq!(loaded.settings.width, 700.);
            assert!(loaded.preserve_file);
            let mut settings = Settings {
                accent_color: value.into(),
                ..Settings::default()
            };
            assert!(settings.validate().is_err());
        }
        fs::write(&path, r#"{"width":700}"#).unwrap();
        let mut loaded = store.load();
        assert_eq!(loaded.settings.accent_color, "#2563EB");
        assert!(!loaded.preserve_file);
        loaded.settings.accent_color = "#FFFFFF".into();
        store.save(&loaded.settings).unwrap();
        assert_eq!(store.load().settings, loaded.settings);
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn corner_radius_legacy_fallback_range_and_persistence() {
        let store = store();
        let path = store.root.join("settings.json");
        fs::write(&path, r#"{"width":700}"#).unwrap();
        assert_eq!(store.load().settings.corner_radius, 0);
        assert!(!store.load().preserve_file);
        for value in [
            serde_json::json!(-1),
            serde_json::json!(p::MAX_CORNER_RADIUS + 1),
            serde_json::json!(1.5),
            serde_json::json!("12"),
        ] {
            fs::write(
                &path,
                serde_json::json!({"width":700,"cornerRadius":value}).to_string(),
            )
            .unwrap();
            let loaded = store.load();
            assert_eq!(loaded.settings.corner_radius, 0);
            assert_eq!(loaded.settings.width, 700.);
            assert!(loaded.preserve_file);
        }
        for radius in [0, 12, 32, 64, p::MAX_CORNER_RADIUS] {
            let mut settings = Settings {
                corner_radius: radius,
                ..Settings::default()
            };
            settings.validate().unwrap();
            store.save(&settings).unwrap();
            assert_eq!(store.load().settings.corner_radius, radius);
        }
        let mut invalid = Settings {
            corner_radius: p::MAX_CORNER_RADIUS + 1,
            ..Settings::default()
        };
        assert!(invalid.validate().is_err());
        fs::remove_dir_all(store.root).unwrap();
    }
    #[test]
    fn atomic_save_round_trip_and_session_cleanup_preserve_preferences() {
        let store = store();
        let settings = Settings {
            startup_url: "https://example.com/".into(),
            ..Settings::default()
        };
        store.save(&settings).unwrap();
        store.save(&settings).unwrap();
        assert_eq!(store.load().settings, settings);
        let session = store.new_session().unwrap();
        fs::write(session.join("cookie"), "private").unwrap();
        store.clean_stale_sessions();
        assert!(!session.exists());
        assert!(store.root.join("settings.json").exists());
        fs::remove_dir_all(store.root).unwrap();
    }
}
