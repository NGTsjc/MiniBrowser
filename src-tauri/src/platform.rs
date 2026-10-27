use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

#[cfg(windows)]
pub struct StartupGate(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for StartupGate {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Threading::ReleaseMutex(self.0);
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
pub fn startup_gate() -> Result<StartupGate, String> {
    use windows::{
        core::w,
        Win32::{
            Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0},
            System::Threading::{CreateMutexW, WaitForSingleObject},
        },
    };
    unsafe {
        let mutex = CreateMutexW(None, false, w!("Local\\MiniBrowser.Portable.StartupGate"))
            .map_err(|e| e.to_string())?;
        let status = WaitForSingleObject(mutex, 30_000);
        if status != WAIT_OBJECT_0 && status != WAIT_ABANDONED {
            let _ = CloseHandle(mutex);
            return Err("另一个实例正在启动，请稍后重试。".into());
        }
        Ok(StartupGate(mutex))
    }
}

#[cfg(not(windows))]
pub fn startup_gate() -> Result<(), String> {
    Ok(())
}

pub fn check_runtime() -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use webview2_com::{
            CoTaskMemPWSTR,
            Microsoft::Web::WebView2::Win32::{
                CompareBrowserVersions, GetAvailableCoreWebView2BrowserVersionString,
            },
        };
        use windows::core::{w, PCWSTR, PWSTR};
        let mut pointer = PWSTR::null();
        GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut pointer)
            .map_err(|_| "未找到 Microsoft Edge WebView2 Runtime，请先安装后重试。".to_string())?;
        let version = CoTaskMemPWSTR::from(pointer);
        let mut comparison = 0;
        CompareBrowserVersions(
            *version.as_ref().as_pcwstr(),
            w!("101.0.1210.39"),
            &mut comparison,
        )
        .map_err(|e| e.to_string())?;
        if comparison < 0 {
            return Err("WebView2 Runtime 版本过旧，无法保证无痕模式，请更新后重试。".into());
        }
    }
    Ok(())
}

pub fn fatal(message: &str) {
    #[cfg(debug_assertions)]
    if std::env::var_os("MINIBROWSER_TEST_CDP").is_some() {
        eprintln!("MiniBrowser: {message}");
        return;
    }
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
        };
        let message: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "MiniBrowser".encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                None,
                PCWSTR(message.as_ptr()),
                PCWSTR(title.as_ptr()),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("MiniBrowser: {message}");
}

pub fn set_opacity(window: &WebviewWindow, opacity: f64) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{Win32::Foundation::HWND, Win32::UI::WindowsAndMessaging::*};
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0 as _);
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let desired_style = (style & !(WS_EX_APPWINDOW.0 as isize))
                | WS_EX_LAYERED.0 as isize
                | WS_EX_TOOLWINDOW.0 as isize;
            if style != desired_style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired_style);
            }
            let desired_alpha = (opacity.clamp(0.2, 1.) * 255.).round() as u8;
            let mut alpha = 0;
            let mut flags = LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
            if GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), Some(&mut flags)).is_ok()
                && alpha == desired_alpha
                && flags.contains(LWA_ALPHA)
            {
                return Ok(());
            }
            SetLayeredWindowAttributes(
                hwnd,
                windows::Win32::Foundation::COLORREF(0),
                desired_alpha,
                LWA_ALPHA,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, opacity);
        Err("此平台的窗口不透明度尚未实现".into())
    }
}

pub fn center_at_cursor(window: &WebviewWindow) -> Result<(), String> {
    let point = window.cursor_position().map_err(|e| e.to_string())?;
    if let Some(monitor) = window
        .monitor_from_point(point.x, point.y)
        .map_err(|e| e.to_string())?
    {
        let area = monitor.work_area();
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let width = size.width.min(area.size.width);
        let height = size.height.min(area.size.height);
        if width != size.width || height != size.height {
            window
                .set_size(tauri::PhysicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
        }
        window
            .set_position(PhysicalPosition::new(
                area.position.x + (area.size.width.saturating_sub(width) / 2) as i32,
                area.position.y + (area.size.height.saturating_sub(height) / 2) as i32,
            ))
            .map_err(|e| e.to_string())?;
    } else {
        window.center().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure_visible(window: &WebviewWindow) {
    let _ = crate::bounds::settle_window(window);
}

pub fn mute(app: &AppHandle, muted: bool) {
    #[cfg(windows)]
    if let Some(browser) = app.get_webview_window("browser") {
        let _ = browser.with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows::core::Interface;
            unsafe {
                if let Ok(core) = webview.controller().CoreWebView2() {
                    if let Ok(audio) = core.cast::<ICoreWebView2_8>() {
                        let _ = audio.SetIsMuted(muted);
                    }
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, muted);
}

pub fn track_process(window: &WebviewWindow, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    window
        .with_webview(move |webview| unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let mut id = 0;
                if core.BrowserProcessId(&mut id).is_ok() && id != 0 {
                    let state = app.state::<crate::state::AppState>();
                    let mut processes = state.browser_processes.lock().unwrap();
                    if !processes.contains(&id) {
                        processes.push(id);
                    }
                    // Recovery metadata contains no URLs or browsing data.
                    if let Ok(bytes) = serde_json::to_vec(&*processes) {
                        let _ = std::fs::write(
                            state.session.lock().unwrap().join("processes.json"),
                            bytes,
                        );
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = (window, app);
    Ok(())
}

pub fn close_controller(window: &WebviewWindow) {
    #[cfg(windows)]
    let _ = window.with_webview(|webview| unsafe {
        let _ = webview.controller().Close();
    });
    #[cfg(not(windows))]
    let _ = window;
}

pub fn wait_for_browsers(processes: &[u32]) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let started = std::time::Instant::now();
        for &id in processes {
            if let Ok(handle) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, id) } {
                let remaining = 5000u32.saturating_sub(started.elapsed().as_millis() as u32);
                let status = unsafe { WaitForSingleObject(handle, remaining) };
                unsafe {
                    let _ = CloseHandle(handle);
                }
                if status != WAIT_OBJECT_0 {
                    return false;
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = processes;
    true
}

pub fn secure_webview(browser: &WebviewWindow, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    browser
        .with_webview(move |webview| unsafe {
            use webview2_com::{
                Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
            };
            if let Ok(core) = webview.controller().CoreWebView2() {
                let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                    }
                    crate::windows::notify(&app, "首版暂不支持摄像头、麦克风、定位等网站权限。");
                    Ok(())
                }));
                let mut token = 0;
                let _ = core.add_PermissionRequested(&handler, &mut token);
            }
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = (browser, app);
    Ok(())
}

// Resize happens on the native host; an owned control surface must not steal focus
// while the browser is being moved or resized.
pub fn place_controls(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{Win32::Foundation::HWND, Win32::UI::WindowsAndMessaging::*};
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0 as _);
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
        }
        .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())
    }
}
