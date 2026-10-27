use tauri::{AppHandle, WebviewWindow};

// Gesture handling remains native. WebView2 resets user zoom on navigation,
// so keep only explicitly changed origins in this controller's session memory.
#[cfg(any(windows, test))]
#[derive(Default)]
struct Memory {
    factors: std::collections::HashMap<String, f64>,
    origin: Option<String>,
    navigation: Option<u64>,
    loading: bool,
    applying: bool,
    restored: bool,
}

#[cfg(any(windows, test))]
fn origin_key(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        .then(|| url.origin().ascii_serialization())
}

#[cfg(any(windows, test))]
impl Memory {
    fn factor(&self) -> f64 {
        self.origin
            .as_ref()
            .and_then(|origin| self.factors.get(origin))
            .copied()
            .unwrap_or(1.)
    }
    fn record(&mut self, factor: f64) {
        if self.loading || self.applying || !factor.is_finite() || factor <= 0. {
            return;
        }
        if let Some(origin) = &self.origin {
            if (factor - 1.).abs() < 0.0001 {
                self.factors.remove(origin);
            } else {
                self.factors.insert(origin.clone(), factor);
            }
        }
    }
}

pub fn install(browser: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let session = app
            .state::<crate::state::AppState>()
            .session
            .lock()
            .unwrap()
            .clone();
        let handle = app.clone();
        browser
            .with_webview(move |webview| {
                if let Err(error) = native::install(webview.controller(), &handle, &session) {
                    crate::windows::notify(&handle, &format!("无法启用网站缩放记忆：{error}"));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (browser, app);
    Ok(())
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        path::{Path, PathBuf},
        sync::{atomic::Ordering, Arc, Mutex},
    };
    use tauri::Manager;
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, CoTaskMemPWSTR, ContentLoadingEventHandler,
        Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
        NavigationStartingEventHandler, ZoomFactorChangedEventHandler,
    };
    use windows::{
        core::{BOOL, PWSTR},
        Win32::UI::Input::KeyboardAndMouse::*,
    };
    type Shared = Arc<Mutex<Memory>>;

    fn current_session(app: &AppHandle, session: &Path) -> bool {
        let state = app.state::<crate::state::AppState>();
        let current = state.session.lock().unwrap();
        !state.exiting.load(Ordering::SeqCst) && current.as_path() == session
    }

    fn queue(app: &AppHandle, session: &Path, memory: &Shared, reset: bool) {
        let (navigation, origin) = {
            let state = memory.lock().unwrap();
            (state.navigation, state.origin.clone())
        };
        let handle = app.clone();
        let session = session.to_path_buf();
        let memory = memory.clone();
        // Do not call the controller from a synchronous keyboard callback or
        // hold a COM controller reference in its own event handlers.
        std::thread::spawn(move || {
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if !current_session(&app, &session) {
                    return;
                }
                let Some(browser) = app.get_webview_window("browser") else {
                    return;
                };
                let error_app = app.clone();
                let _ = browser.with_webview(move |webview| {
                    let factor = {
                        let mut state = memory.lock().unwrap();
                        if state.navigation != navigation
                            || state.origin != origin
                            || (!reset && state.restored)
                        {
                            return;
                        }
                        state.applying = true;
                        if reset {
                            1.
                        } else {
                            state.factor()
                        }
                    };
                    let result = unsafe { webview.controller().SetZoomFactor(factor) };
                    let mut state = memory.lock().unwrap();
                    state.applying = false;
                    if result.is_ok()
                        && state.navigation == navigation
                        && state.origin == origin
                        && !reset
                    {
                        state.loading = false;
                        state.restored = true;
                    }
                    if let Err(error) = result {
                        state.loading = false;
                        drop(state);
                        if current_session(&error_app, &session)
                            && !error_app
                                .state::<crate::state::AppState>()
                                .busy
                                .load(Ordering::SeqCst)
                        {
                            crate::windows::notify(
                                &error_app,
                                &format!("无法恢复网页缩放：{error}"),
                            );
                        }
                    }
                });
            });
        });
    }

    unsafe fn source(core: &ICoreWebView2) -> windows::core::Result<Option<String>> {
        let mut value = PWSTR::null();
        core.Source(&mut value)?;
        let value = CoTaskMemPWSTR::from(value);
        Ok(origin_key(&value.as_ref().as_pcwstr().to_string()?))
    }

    pub fn install(
        controller: ICoreWebView2Controller,
        app: &AppHandle,
        session: &Path,
    ) -> windows::core::Result<()> {
        unsafe {
            let core = controller.CoreWebView2()?;
            let memory = Arc::new(Mutex::new(Memory {
                origin: source(&core)?,
                ..Memory::default()
            }));
            let state = memory.clone();
            let zoom = ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut factor = 1.;
                    sender.ZoomFactor(&mut factor)?;
                    state.lock().unwrap().record(factor);
                }
                Ok(())
            }));
            let mut token = 0;
            controller.add_ZoomFactorChanged(&zoom, &mut token)?;
            let state = memory.clone();
            let starting = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut cancelled = BOOL::default();
                    args.Cancel(&mut cancelled)?;
                    if !cancelled.as_bool() {
                        let mut id = 0;
                        args.NavigationId(&mut id)?;
                        let mut state = state.lock().unwrap();
                        state.navigation = Some(id);
                        state.loading = true;
                        state.restored = false;
                    }
                }
                Ok(())
            }));
            core.add_NavigationStarting(&starting, &mut token)?;
            let state = memory.clone();
            let handle = app.clone();
            let path = session.to_path_buf();
            let content = ContentLoadingEventHandler::create(Box::new(move |sender, args| {
                if let (Some(sender), Some(args)) = (sender, args) {
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    let mut memory = state.lock().unwrap();
                    if memory.navigation.is_some_and(|current| current != id) {
                        return Ok(());
                    }
                    memory.navigation = Some(id);
                    memory.origin = source(&sender)?;
                    memory.loading = true;
                    memory.restored = false;
                    drop(memory);
                    queue(&handle, &path, &state, false);
                }
                Ok(())
            }));
            core.add_ContentLoading(&content, &mut token)?;
            let state = memory.clone();
            let handle = app.clone();
            let path = session.to_path_buf();
            let completed = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    let memory = state.lock().unwrap();
                    let pending = memory.navigation == Some(id) && !memory.restored;
                    drop(memory);
                    if pending {
                        queue(&handle, &path, &state, false);
                    }
                }
                Ok(())
            }));
            core.add_NavigationCompleted(&completed, &mut token)?;
            let handle = app.clone();
            let path: PathBuf = session.to_path_buf();
            let accelerator =
                AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut key = 0;
                        args.VirtualKey(&mut key)?;
                        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP;
                        args.KeyEventKind(&mut kind)?;
                        if matches!(key, 0x30 | 0x60)
                            && kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                            && GetKeyState(VK_CONTROL.0 as i32) < 0
                            && GetKeyState(VK_MENU.0 as i32) >= 0
                            && GetKeyState(VK_SHIFT.0 as i32) >= 0
                        {
                            args.SetHandled(true)?;
                            let mut physical = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                            args.PhysicalKeyStatus(&mut physical)?;
                            if !physical.WasKeyDown.as_bool() {
                                let mut state = memory.lock().unwrap();
                                if let Some(origin) = state.origin.clone() {
                                    state.factors.remove(&origin);
                                }
                                drop(state);
                                queue(&handle, &path, &memory, true);
                            }
                        }
                    }
                    Ok(())
                }));
            controller.add_AcceleratorKeyPressed(&accelerator, &mut token)?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_zoom_is_origin_scoped_and_navigation_resets_do_not_replace_user_choices() {
        let a = origin_key("https://example.com/path?private=1");
        assert_eq!(a.as_deref(), Some("https://example.com"));
        assert_ne!(a, origin_key("https://example.com:8443/path"));
        assert_ne!(a, origin_key("http://example.com/path"));
        assert_eq!(origin_key("about:blank"), None);
        let mut memory = Memory {
            origin: a.clone(),
            ..Memory::default()
        };
        memory.record(1.5);
        memory.loading = true;
        memory.record(1.);
        assert_eq!(memory.factor(), 1.5);
        memory.origin = origin_key("https://other.example/");
        assert_eq!(memory.factor(), 1.);
        memory.origin = a;
        memory.loading = false;
        memory.record(1.);
        assert_eq!(memory.factor(), 1.);
        assert!(memory.factors.is_empty());
        assert!(Memory::default().factors.is_empty());
    }
}
