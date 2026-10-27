use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(self) -> i64 {
        self.x as i64 + self.width as i64
    }
    fn bottom(self) -> i64 {
        self.y as i64 + self.height as i64
    }
    fn intersection(self, other: Self) -> Option<Self> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = self.right().min(other.right());
        let bottom = self.bottom().min(other.bottom());
        (right > x as i64 && bottom > y as i64).then(|| Self {
            x,
            y,
            width: (right - x as i64) as u32,
            height: (bottom - y as i64) as u32,
        })
    }
    fn subtract(self, other: Self) -> Vec<Self> {
        let Some(i) = self.intersection(other) else {
            return vec![self];
        };
        [
            Self {
                x: self.x,
                y: self.y,
                width: self.width,
                height: (i.y as i64 - self.y as i64) as u32,
            },
            Self {
                x: self.x,
                y: i.bottom() as i32,
                width: self.width,
                height: (self.bottom() - i.bottom()) as u32,
            },
            Self {
                x: self.x,
                y: i.y,
                width: (i.x as i64 - self.x as i64) as u32,
                height: i.height,
            },
            Self {
                x: i.right() as i32,
                y: i.y,
                width: (self.right() - i.right()) as u32,
                height: i.height,
            },
        ]
        .into_iter()
        .filter(|r| r.width > 0 && r.height > 0)
        .collect()
    }
}

// A window may span adjoining displays. A virtual-desktop bounding box alone
// would incorrectly treat gaps between displays as usable desktop space.
pub fn safe_rect(window: Rect, monitors: &[Rect]) -> Rect {
    let mut remaining = vec![window];
    for &monitor in monitors {
        remaining = remaining
            .into_iter()
            .flat_map(|part| part.subtract(monitor))
            .collect();
    }
    if remaining.is_empty() {
        return window;
    }
    let Some(area) = monitors
        .iter()
        .filter(|m| m.width > 0 && m.height > 0)
        .max_by_key(|&&m| {
            let overlap = window
                .intersection(m)
                .map_or(0, |r| r.width as i128 * r.height as i128);
            let cx = window.x as i128 + window.width as i128 / 2;
            let cy = window.y as i128 + window.height as i128 / 2;
            let dx = cx - cx.clamp(m.x as i128, m.right() as i128);
            let dy = cy - cy.clamp(m.y as i128, m.bottom() as i128);
            (overlap, -(dx * dx + dy * dy))
        })
    else {
        return window;
    };
    let width = window.width.min(area.width);
    let height = window.height.min(area.height);
    Rect {
        x: (window.x as i64).clamp(area.x as i64, area.right() - width as i64) as i32,
        y: (window.y as i64).clamp(area.y as i64, area.bottom() - height as i64) as i32,
        width,
        height,
    }
}

pub fn settle_window(window: &WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let areas: Vec<_> = window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect {
                x: a.position.x,
                y: a.position.y,
                width: a.size.width,
                height: a.size.height,
            }
        })
        .collect();
    let current = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let safe = safe_rect(current, &areas);
    if current.width != safe.width || current.height != safe.height {
        window
            .set_size(PhysicalSize::new(safe.width, safe.height))
            .map_err(|e| e.to_string())?;
    }
    if current.x != safe.x || current.y != safe.y {
        window
            .set_position(PhysicalPosition::new(safe.x, safe.y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn install(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
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
            data: usize,
        ) -> LRESULT {
            if message == WM_NCHITTEST {
                if let Some(hit) =
                    crate::corners::resize_hit_test(&*(data as *const AppHandle), hwnd, lparam)
                {
                    return hit;
                }
            }
            if message == WM_EXITSIZEMOVE {
                let app = (&*(data as *const AppHandle)).clone();
                let handle = app.clone();
                std::thread::spawn(move || {
                    let _ = app.run_on_main_thread(move || {
                        if !handle
                            .state::<crate::state::AppState>()
                            .busy
                            .load(std::sync::atomic::Ordering::SeqCst)
                        {
                            if let Some(browser) = handle.get_webview_window("browser") {
                                if let Err(error) = settle_window(&browser) {
                                    crate::windows::notify(&handle, &error);
                                }
                                let _ = crate::windows::sync_controls(&handle);
                                crate::lifecycle::save_size_later(&handle);
                            }
                        }
                    });
                });
            } else if message == WM_NCDESTROY {
                let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
                drop(Box::from_raw(data as *mut AppHandle));
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        let window = window.clone();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Ok(hwnd) = window.hwnd() {
                let data = Box::into_raw(Box::new(handle.clone()));
                if !unsafe {
                    SetWindowSubclass(HWND(hwnd.0 as _), Some(procedure), 0x4d42, data as usize)
                }
                .as_bool()
                {
                    unsafe {
                        drop(Box::from_raw(data));
                    }
                    crate::windows::notify(&handle, "无法安装窗口边界保护。");
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (window, app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn clamp_all_edges_and_oversized_window() {
        let a = [r(0, 0, 1920, 1040)];
        assert_eq!(safe_rect(r(-40, -20, 960, 600), &a), r(0, 0, 960, 600));
        assert_eq!(safe_rect(r(1500, 800, 960, 600), &a), r(960, 440, 960, 600));
        assert_eq!(safe_rect(r(-500, 0, 3000, 2000), &a), r(0, 0, 1920, 1040));
    }
    #[test]
    fn adjoining_displays_and_negative_coordinates() {
        let a = [r(-1920, 0, 1920, 1040), r(0, 0, 1920, 1040)];
        let spanning = r(-200, 100, 960, 600);
        assert_eq!(safe_rect(spanning, &a), spanning);
        assert_eq!(
            safe_rect(r(-2500, 100, 960, 600), &a),
            r(-1920, 100, 960, 600)
        );
    }
    #[test]
    fn desktop_gaps_and_disconnected_display() {
        let a = [r(0, 0, 1920, 1040), r(2200, 0, 1920, 1040)];
        assert_eq!(
            safe_rect(r(1800, 100, 960, 600), &a),
            r(2200, 100, 960, 600)
        );
        assert_eq!(safe_rect(r(-3000, 200, 960, 600), &a), r(0, 200, 960, 600));
        assert_eq!(safe_rect(r(2000, 0, 960, 600), &[]), r(2000, 0, 960, 600));
    }
}
