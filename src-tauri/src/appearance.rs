//! Tao recomputes extended styles on visibility/topmost changes. Preserve the
//! layered/tool-window contract before the new styles reach USER32, so alpha
//! never depends on a later JS-ready/focus event to become correct again.
use tauri::{AppHandle, WebviewWindow};

pub fn install(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = window.clone();
        crate::ui_thread::run(app, move |_| {
            use windows::Win32::{
                Foundation::*,
                UI::{Shell::*, WindowsAndMessaging::*},
            };
            unsafe extern "system" fn procedure(
                hwnd: HWND,
                message: u32,
                wparam: WPARAM,
                lparam: LPARAM,
                id: usize,
                _: usize,
            ) -> LRESULT {
                if message == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 && lparam.0 != 0
                {
                    let result = DefSubclassProc(hwnd, message, wparam, lparam);
                    let styles = &mut *(lparam.0 as *mut STYLESTRUCT);
                    styles.styleNew = (styles.styleNew & !WS_EX_APPWINDOW.0)
                        | WS_EX_LAYERED.0
                        | WS_EX_TOOLWINDOW.0;
                    return result;
                }
                if message == WM_NCDESTROY {
                    let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
                }
                DefSubclassProc(hwnd, message, wparam, lparam)
            }
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            if !unsafe { SetWindowSubclass(hwnd, Some(procedure), 0x4d41, 0) }.as_bool() {
                return Err("无法安装窗口外观保护".into());
            }
            Ok(())
        })?;
    }
    #[cfg(not(windows))]
    let _ = (window, app);
    Ok(())
}
