//! Tao rebuilds native styles on visibility/topmost changes. Remove decorations
//! before USER32 sees them; otherwise DWM can draw a caption during hide even
//! though Tao's ordinary client-area calculation hides it while visible.
use tauri::{AppHandle, WebviewWindow};

pub fn install(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = window.clone();
        crate::ui_thread::run(app, move |_| {
            use windows::Win32::{
                Foundation::*,
                Graphics::Dwm::*,
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
                if message == WM_NCPAINT {
                    return LRESULT(0);
                }
                if message == WM_NCACTIVATE {
                    // Keep Tao's activation/focus bookkeeping, but ask USER32
                    // not to repaint a native nonclient frame.
                    return DefSubclassProc(hwnd, message, wparam, LPARAM(-1));
                }
                if message == WM_STYLECHANGING && lparam.0 != 0 {
                    let result = DefSubclassProc(hwnd, message, wparam, lparam);
                    let styles = &mut *(lparam.0 as *mut STYLESTRUCT);
                    if wparam.0 as i32 == GWL_STYLE.0 {
                        styles.styleNew = frameless_style(styles.styleNew);
                    } else if wparam.0 as i32 == GWL_EXSTYLE.0 {
                        styles.styleNew = frameless_extended_style(styles.styleNew);
                    }
                    return result;
                }
                if message == WM_NCDESTROY {
                    let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
                }
                DefSubclassProc(hwnd, message, wparam, lparam)
            }
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            if !unsafe { SetWindowSubclass(hwnd, Some(procedure), 0x4d41, 0) }.as_bool() {
                return Err(crate::localization::text("errors.appearance"));
            }
            // Normalize the initially hidden window too, before its first show.
            unsafe {
                let policy = DWMNCRP_DISABLED;
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_NCRENDERING_POLICY,
                    &policy as *const _ as _,
                    std::mem::size_of_val(&policy) as u32,
                )
                .map_err(|e| e.to_string())?;
                SetWindowLongPtrW(
                    hwnd,
                    GWL_STYLE,
                    frameless_style(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32) as isize,
                );
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    frameless_extended_style(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) as isize,
                );
                SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })?;
    }
    #[cfg(not(windows))]
    let _ = (window, app);
    Ok(())
}

#[cfg(any(windows, test))]
fn frameless_style(style: u32) -> u32 {
    // Preserve WS_THICKFRAME/WS_SIZEBOX: the existing native resize borders and
    // system move/resize loop still need it, even on a captionless window.
    // WS_SYSMENU also stays: it enables Alt+F4 without drawing a caption.
    style & !(0x00c0_0000 | 0x0002_0000 | 0x0001_0000)
}
#[cfg(any(windows, test))]
fn frameless_extended_style(style: u32) -> u32 {
    // USER32 may retain WS_EX_WINDOWEDGE for WS_THICKFRAME. DWM/nonclient paint
    // is disabled separately; do not fight this resize bookkeeping flag.
    (style & !(0x0004_0000 | 0x0000_0200 | 0x0000_0001 | 0x0002_0000)) | 0x0008_0000 | 0x0000_0080
}

#[cfg(test)]
mod tests {
    #[test]
    fn caption_and_edge_flags_never_replace_resize_visibility_or_topmost_state() {
        for visible in [0, 0x1000_0000] {
            let style = visible | 0x0400_0000 | 0x00cf_0000;
            let clean = super::frameless_style(style);
            assert_eq!(clean & 0x00c3_0000, 0);
            assert_eq!(clean & 0x0008_0000, 0x0008_0000);
            assert_eq!(clean & 0x0004_0000, 0x0004_0000);
            assert_eq!(clean & 0x1000_0000, visible);
            assert_eq!(super::frameless_style(clean), clean);
        }
        let extended = super::frameless_extended_style(0x0006_0319);
        assert_eq!(extended & 0x0006_0201, 0);
        assert_eq!(extended & 0x0008_0080, 0x0008_0080);
        assert_eq!(extended & 0x18, 0x18);
    }
}
