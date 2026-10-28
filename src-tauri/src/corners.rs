use tauri::{AppHandle, Manager};

#[cfg(windows)]
fn physical_resize_grip(scale: f64) -> i32 {
    use windows::Win32::UI::{HiDpi::GetSystemMetricsForDpi, WindowsAndMessaging::SM_CXFRAME};
    ((crate::parameters::RESIZE_GRIP * scale).round() as i32)
        .max(unsafe { GetSystemMetricsForDpi(SM_CXFRAME, (scale * 96.).round() as u32) })
}

pub fn sync(app: &AppHandle, force: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            System::Threading::GetCurrentThreadId,
            UI::WindowsAndMessaging::GetWindowThreadProcessId,
        };
        let Some(browser) = app.get_webview_window("browser") else {
            return Ok(());
        };
        let hwnd = browser.hwnd().map_err(|e| e.to_string())?;
        if unsafe { GetWindowThreadProcessId(hwnd, None) == GetCurrentThreadId() } {
            return native::sync(app, force);
        }
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = send.send(native::sync(&handle, force));
        })
        .map_err(|e| e.to_string())?;
        receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "应用窗口圆角超时".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = force;
        if *app
            .state::<crate::state::AppState>()
            .effective_corner_radius
            .lock()
            .unwrap()
            == 0
        {
            Ok(())
        } else {
            Err("此平台尚未实现可调窗口圆角".into())
        }
    }
}

pub fn preview(app: &AppHandle, radius: u32) -> Result<(), String> {
    if radius > crate::parameters::MAX_CORNER_RADIUS {
        return Err(format!(
            "窗口圆角必须在 0～{} 之间",
            crate::parameters::MAX_CORNER_RADIUS
        ));
    }
    let state = app.state::<crate::state::AppState>();
    let previous = std::mem::replace(&mut *state.effective_corner_radius.lock().unwrap(), radius);
    if let Err(error) = crate::windows::sync_controls(app) {
        *state.effective_corner_radius.lock().unwrap() = previous;
        let _ = crate::windows::sync_controls(app);
        return Err(error);
    }
    Ok(())
}

pub fn try_resize_from_drag(
    app: &AppHandle,
    browser: &tauri::WebviewWindow,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{LPARAM, POINT, WPARAM},
            UI::{Input::KeyboardAndMouse::ReleaseCapture, WindowsAndMessaging::*},
        };
        let hwnd = browser.hwnd().map_err(|e| e.to_string())?;
        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.map_err(|e| e.to_string())?;
        let packed = LPARAM(((point.x as u16 as u32) | ((point.y as u16 as u32) << 16)) as isize);
        if let Some(hit) = resize_hit_test(app, hwnd, packed) {
            unsafe {
                let _ = ReleaseCapture();
                SendMessageW(
                    hwnd,
                    WM_NCLBUTTONDOWN,
                    Some(WPARAM(hit.0 as usize)),
                    Some(packed),
                );
            }
            return Ok(true);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, browser);
    Ok(false)
}

pub fn install_controls(app: &AppHandle, controls: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let handle = app.clone();
        let controls = controls.clone();
        app.run_on_main_thread(move || {
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
                if let Some(main) = native::resize_target(hwnd) {
                    if message == WM_NCHITTEST {
                        if let Some(hit) =
                            resize_hit_test(&*(data as *const AppHandle), main, lparam)
                        {
                            return hit;
                        }
                    } else if message == WM_NCLBUTTONDOWN
                        && matches!(
                            wparam.0 as u32,
                            HTTOPLEFT | HTTOPRIGHT | HTBOTTOMLEFT | HTBOTTOMRIGHT
                        )
                    {
                        let _ = windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture();
                        return SendMessageW(main, message, Some(wparam), Some(lparam));
                    }
                }
                if message == WM_NCDESTROY {
                    let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
                    drop(Box::from_raw(data as *mut AppHandle));
                }
                DefSubclassProc(hwnd, message, wparam, lparam)
            }
            if let Ok(hwnd) = controls.hwnd() {
                let data = Box::into_raw(Box::new(handle.clone()));
                if !unsafe { SetWindowSubclass(hwnd, Some(procedure), 0x4d43, data as usize) }
                    .as_bool()
                {
                    unsafe {
                        drop(Box::from_raw(data));
                    }
                    crate::windows::notify(&handle, "无法安装圆角缩放控制。");
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (app, controls);
    Ok(())
}

#[cfg(windows)]
pub fn resize_hit_test(
    app: &AppHandle,
    hwnd: windows::Win32::Foundation::HWND,
    point: windows::Win32::Foundation::LPARAM,
) -> Option<windows::Win32::Foundation::LRESULT> {
    use windows::Win32::{
        Foundation::{LRESULT, RECT},
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::GetWindowRect},
    };
    let radius = *app
        .state::<crate::state::AppState>()
        .effective_corner_radius
        .lock()
        .unwrap();
    if radius == 0 {
        return None;
    }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
    let scale = unsafe { GetDpiForWindow(hwnd) } as f64 / 96.;
    let x = (point.0 as u16 as i16) as i32 - rect.left;
    let y = ((point.0 >> 16) as u16 as i16) as i32 - rect.top;
    curved_resize_hit(
        x,
        y,
        rect.right - rect.left,
        rect.bottom - rect.top,
        crate::control_layout::effective_radius(
            radius,
            rect.right - rect.left,
            rect.bottom - rect.top,
            scale,
        ),
        physical_resize_grip(scale),
    )
    .map(|hit| LRESULT(hit as isize))
}

#[cfg(any(windows, test))]
fn curved_resize_hit(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    radius: i32,
    grip: i32,
) -> Option<i32> {
    if radius == 0 || x < 0 || y < 0 || x >= width || y >= height {
        return None;
    }
    let left = x < width / 2;
    let top = y < height / 2;
    let dx = if left { x } else { width - 1 - x };
    let dy = if top { y } else { height - 1 - y };
    if dx > radius + grip || dy > radius + grip {
        return None;
    }
    let distance =
        (((radius - dx).max(0) as f64).powi(2) + ((radius - dy).max(0) as f64).powi(2)).sqrt();
    if distance > radius as f64 + 1.
        || (dx >= grip && dy >= grip && distance < (radius - grip).max(0) as f64)
    {
        return None;
    }
    Some(match (left, top) {
        (true, true) => 13,
        (false, true) => 14,
        (true, false) => 16,
        (false, false) => 17,
    })
}

#[cfg(test)]
mod tests {
    use super::curved_resize_hit;
    #[test]
    fn resize_grips_follow_curved_boundary_without_covering_web_content() {
        for (x, y, hit) in [(12, 12, 13), (387, 12, 14), (12, 287, 16), (387, 287, 17)] {
            assert_eq!(curved_resize_hit(x, y, 400, 300, 32, 6), Some(hit));
        }
        for (x, y) in [(0, 0), (32, 32), (200, 150), (-1, 12)] {
            assert_eq!(curved_resize_hit(x, y, 400, 300, 32, 6), None);
        }
        assert_eq!(curved_resize_hit(12, 12, 400, 300, 0, 6), None);
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        sync::atomic::Ordering,
    };
    use windows::Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::*,
        UI::WindowsAndMessaging::GetWindowRect,
    };

    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Geometry {
        browser: isize,
        controls: isize,
        width: i32,
        height: i32,
        radius: i32,
        dx: i32,
        dy: i32,
        control_width: i32,
        control_height: i32,
        overlay_radius: i32,
        menu: bool,
    }
    thread_local! {
        static LAST: RefCell<Option<Geometry>> = const { RefCell::new(None) };
        static APPLYING: Cell<bool> = const { Cell::new(false) };
    }
    pub fn resize_target(controls: HWND) -> Option<HWND> {
        LAST.with(|last| {
            last.borrow()
                .filter(|key| {
                    key.controls == controls.0 as isize && !key.menu && key.overlay_radius == 0
                })
                .map(|key| HWND(key.browser as *mut _))
        })
    }
    struct Applying;
    impl Drop for Applying {
        fn drop(&mut self) {
            APPLYING.set(false);
        }
    }

    // SetWindowRgn owns the HRGN only on success. All temporary/intersection
    // and rollback regions remain owned here until transferred or dropped.
    struct Region(HRGN);
    impl Drop for Region {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(self.0.into());
            }
        }
    }
    impl Region {
        fn new(width: i32, height: i32, radius: i32) -> Result<Self, String> {
            let radius = radius.min(width / 2).min(height / 2).max(0);
            let handle = unsafe {
                if radius == 0 {
                    CreateRectRgn(0, 0, width, height)
                } else {
                    CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2)
                }
            };
            if handle.0.is_null() {
                Err("无法创建窗口圆角区域".into())
            } else {
                Ok(Self(handle))
            }
        }
        fn apply(self, hwnd: HWND) -> Result<(), String> {
            if unsafe { SetWindowRgn(hwnd, Some(self.0), true) } == 0 {
                return Err("无法应用窗口圆角区域".into());
            }
            std::mem::forget(self);
            Ok(())
        }
        fn polygon(points: &[[i32; 2]]) -> Result<Self, String> {
            use windows::Win32::Foundation::POINT;
            let points: Vec<POINT> = points.iter().map(|p| POINT { x: p[0], y: p[1] }).collect();
            let region = unsafe { CreatePolygonRgn(&points, WINDING) };
            if region.0.is_null() {
                Err("无法创建圆弧拖动区域".into())
            } else {
                Ok(Self(region))
            }
        }
    }

    fn bounds(hwnd: HWND) -> Result<RECT, String> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| e.to_string())?;
        Ok(rect)
    }

    // Reuse Tauri's native border child, which already sits above the renderer.
    // A parent-only hit test cannot receive clicks consumed by WebView2 HWNDs.
    fn resize_band(
        app: &AppHandle,
        main: HWND,
        geometry: Geometry,
        scale: f64,
    ) -> Result<(), String> {
        use windows::{
            core::w,
            Win32::{
                Foundation::*,
                UI::{Shell::*, WindowsAndMessaging::*},
            },
        };
        unsafe extern "system" fn procedure(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
            id: usize,
            data: usize,
        ) -> LRESULT {
            if let Ok(main) = GetParent(hwnd) {
                if message == WM_NCHITTEST || message == WM_NCLBUTTONDOWN {
                    if let Some(hit) =
                        super::resize_hit_test(&*(data as *const AppHandle), main, lparam)
                    {
                        if message == WM_NCHITTEST {
                            return hit;
                        }
                        let _ = windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture();
                        let _ = PostMessageW(
                            Some(main),
                            WM_NCLBUTTONDOWN,
                            WPARAM(hit.0 as usize),
                            lparam,
                        );
                        return LRESULT(0);
                    }
                }
            }
            if message == WM_NCDESTROY {
                let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
                drop(Box::from_raw(data as *mut AppHandle));
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        let child = unsafe {
            FindWindowExW(
                Some(main),
                None,
                w!("TAURI_DRAG_RESIZE_BORDERS"),
                w!("TAURI_DRAG_RESIZE_WINDOW"),
            )
        }
        .map_err(|_| "无法找到原生窗口缩放边缘".to_string())?;
        let main_rect = bounds(main)?;
        let child_rect = bounds(child)?;
        let dx = child_rect.left - main_rect.left;
        let dy = child_rect.top - main_rect.top;
        let grip = physical_resize_grip(scale);
        let outer = Region::new(geometry.width, geometry.height, geometry.radius)?;
        let inner = Region::new(
            (geometry.width - 2 * grip).max(1),
            (geometry.height - 2 * grip).max(1),
            (geometry.radius - grip).max(0),
        )?;
        unsafe {
            if OffsetRgn(outer.0, -dx, -dy).0 == ERROR
                || OffsetRgn(inner.0, grip - dx, grip - dy).0 == ERROR
                || CombineRgn(Some(outer.0), Some(outer.0), Some(inner.0), RGN_DIFF).0 == ERROR
            {
                return Err("无法创建圆角缩放边缘".into());
            }
            let mut existing = 0_usize;
            if !GetWindowSubclass(child, Some(procedure), 0x4d44, Some(&mut existing)).as_bool() {
                let data = Box::into_raw(Box::new(app.clone()));
                if !SetWindowSubclass(child, Some(procedure), 0x4d44, data as usize).as_bool() {
                    drop(Box::from_raw(data));
                    return Err("无法安装圆角缩放边缘".into());
                }
            }
        }
        outer.apply(child)
    }

    pub fn sync(app: &AppHandle, force: bool) -> Result<(), String> {
        if APPLYING.replace(true) {
            return Ok(());
        }
        let _applying = Applying;
        let (Some(browser), Some(controls)) = (
            app.get_webview_window("browser"),
            app.get_webview_window("controls"),
        ) else {
            return Ok(());
        };
        let main = browser.hwnd().map_err(|e| e.to_string())?;
        let overlay = controls.hwnd().map_err(|e| e.to_string())?;
        let rect = bounds(main)?;
        let control = bounds(overlay)?;
        let scale = browser.scale_factor().map_err(|e| e.to_string())?;
        let state = app.state::<crate::state::AppState>();
        let menu = crate::context_menu::is_open(app);
        let panel = state.panel_open.load(Ordering::SeqCst);
        let radius = *state.effective_corner_radius.lock().unwrap();
        let geometry = Geometry {
            browser: main.0 as isize,
            controls: overlay.0 as isize,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            radius: crate::control_layout::effective_radius(
                radius,
                rect.right - rect.left,
                rect.bottom - rect.top,
                scale,
            ),
            dx: control.left - rect.left,
            dy: control.top - rect.top,
            control_width: control.right - control.left,
            control_height: control.bottom - control.top,
            overlay_radius: (if menu {
                crate::parameters::MENU_RADIUS
            } else if panel {
                crate::parameters::PANEL_RADIUS
            } else {
                0.
            } * scale)
                .round() as i32,
            menu,
        };
        if !force && LAST.with(|last| *last.borrow() == Some(geometry)) {
            return Ok(());
        }
        if geometry.width <= 0
            || geometry.height <= 0
            || geometry.control_width <= 0
            || geometry.control_height <= 0
        {
            return Ok(());
        }
        let main_region = Region::new(geometry.width, geometry.height, geometry.radius)?;
        let drag = crate::windows::current_drag_shape(app);
        let control_region = if !menu && !panel && drag.arc {
            Region::polygon(&drag.points)?
        } else {
            Region::new(
                geometry.control_width,
                geometry.control_height,
                geometry.overlay_radius,
            )?
        };
        if !menu {
            let parent = Region::new(geometry.width, geometry.height, geometry.radius)?;
            unsafe {
                if OffsetRgn(parent.0, -geometry.dx, -geometry.dy).0 == ERROR
                    || CombineRgn(
                        Some(control_region.0),
                        Some(control_region.0),
                        Some(parent.0),
                        RGN_AND,
                    )
                    .0 == ERROR
                {
                    return Err("无法裁剪窗口控制区域".into());
                }
            }
        }
        let old = Region::new(1, 1, 0)?;
        let had_region = unsafe { GetWindowRgn(main, old.0) }.0 != ERROR;
        main_region.apply(main)?;
        if let Err(error) = control_region.apply(overlay) {
            if had_region {
                let _ = old.apply(main);
            } else {
                unsafe {
                    SetWindowRgn(main, None, true);
                }
            }
            return Err(error);
        }
        resize_band(app, main, geometry, scale)?;
        LAST.with(|last| *last.borrow_mut() = Some(geometry));
        Ok(())
    }
}
