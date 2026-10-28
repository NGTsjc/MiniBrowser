use crate::config::{PortableStore, Settings};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64},
        Mutex,
    },
};
use tauri::menu::MenuItem;

pub struct AppState {
    pub store: PortableStore,
    pub settings: Mutex<Settings>,
    pub effective_opacity: Mutex<f64>,
    pub effective_corner_radius: Mutex<u32>,
    pub drag_shape: Mutex<Option<crate::control_layout::DragShape>>,
    pub context_menu: Mutex<Option<(i32, i32)>>,
    pub session: Mutex<PathBuf>,
    pub browser_processes: Mutex<Vec<u32>>,
    pub warning: Mutex<Option<String>>,
    pub preserve_config: AtomicBool,
    pub visible: AtomicBool,
    pub panel_open: AtomicBool,
    pub busy: AtomicBool,
    pub exiting: AtomicBool,
    pub resize_generation: AtomicU64,
    pub size_save_scheduled: AtomicBool,
    #[cfg(debug_assertions)]
    pub debug_generation: AtomicU64,
    pub toggle_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl AppState {
    pub fn new(
        store: PortableStore,
        settings: Settings,
        session: PathBuf,
        warning: Option<String>,
        preserve_config: bool,
    ) -> Self {
        Self {
            store,
            effective_opacity: Mutex::new(settings.opacity),
            effective_corner_radius: Mutex::new(settings.corner_radius),
            drag_shape: Mutex::new(None),
            context_menu: Mutex::new(None),
            settings: Mutex::new(settings),
            session: Mutex::new(session),
            browser_processes: Mutex::new(Vec::new()),
            warning: Mutex::new(warning),
            preserve_config: AtomicBool::new(preserve_config),
            visible: AtomicBool::new(true),
            panel_open: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
            resize_generation: AtomicU64::new(0),
            size_save_scheduled: AtomicBool::new(false),
            #[cfg(debug_assertions)]
            debug_generation: AtomicU64::new(0),
            toggle_item: Mutex::new(None),
        }
    }
}
