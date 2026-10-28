use crate::{state::AppState, windows};
use std::{path::Path, sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn remove_session(path: &Path, processes: &[u32]) {
    if !crate::platform::wait_for_browsers(processes) {
        return;
    }
    for _ in 0..20 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => std::thread::sleep(Duration::from_millis(150)),
        }
    }
}

fn destroy_windows(app: &AppHandle) {
    if let Some(controls) = app.get_webview_window("controls") {
        crate::platform::close_controller(&controls);
        let _ = controls.destroy();
    }
    if let Some(browser) = app.get_webview_window("browser") {
        crate::platform::close_controller(&browser);
        let _ = browser.destroy();
    }
}

pub fn exit(app: &AppHandle, restart: bool) {
    let state = app.state::<AppState>();
    if state.exiting.load(Ordering::SeqCst) {
        return;
    }
    // Latest explicit request wins, even while saving/resetting/cleaning up.
    state
        .pending_exit
        .store(if restart { 2 } else { 1 }, Ordering::SeqCst);
    start_pending_exit(app);
}

pub fn start_pending_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.pending_exit.load(Ordering::SeqCst) == 0
        || state
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        return;
    }
    state.shutting_down.store(true, Ordering::SeqCst);
    state.preview_epoch.fetch_add(1, Ordering::SeqCst);
    state.resize_generation.fetch_add(1, Ordering::SeqCst);
    let _ = app.global_shortcut().unregister_all();
    save_size_for_operation(app);
    let session = state.session.lock().unwrap().clone();
    let processes = std::mem::take(&mut *state.browser_processes.lock().unwrap());
    let app = app.clone();
    std::thread::spawn(move || {
        destroy_windows(&app);
        remove_session(&session, &processes);
        let handle = app.clone();
        let result = app.run_on_main_thread(move || {
            let state = handle.state::<AppState>();
            state.exiting.store(true, Ordering::SeqCst);
            if state.pending_exit.load(Ordering::SeqCst) == 2 {
                handle.request_restart();
            } else {
                handle.exit(0);
            }
        });
        if result.is_err() {
            app.exit(1);
        }
    });
}

pub fn reset_session(app: &AppHandle) -> Result<(), String> {
    let operation = crate::operation::Guard::begin(app)?;
    let state = app.state::<AppState>();
    state.preview_epoch.fetch_add(1, Ordering::SeqCst);
    let url = windows::current_url(app);
    save_size_for_operation(app);
    let new_session = state.store.new_session()?;
    let old_session = std::mem::replace(&mut *state.session.lock().unwrap(), new_session);
    let processes = std::mem::take(&mut *state.browser_processes.lock().unwrap());
    let _ = app.emit_to("controls", "session-reset", ());
    let app = app.clone();
    std::thread::spawn(move || {
        let _operation = operation;
        crate::test_support::delay("session_reset_delay_ms");
        #[cfg(debug_assertions)]
        eprintln!("session reset: destroy hosts");
        destroy_windows(&app);
        #[cfg(debug_assertions)]
        eprintln!("session reset: clean old session");
        remove_session(&old_session, &processes);
        #[cfg(debug_assertions)]
        eprintln!("session reset: build hosts");
        if app.state::<AppState>().pending_exit.load(Ordering::SeqCst) != 0 {
            return;
        }
        if let Err(error) =
            crate::test_support::fail("session_build").and_then(|_| windows::build(&app, &url))
        {
            crate::platform::fatal(&error);
            app.exit(1);
        }

        #[cfg(debug_assertions)]
        eprintln!("session reset: ready");
    });
    Ok(())
}

pub fn save_size(app: &AppHandle) {
    save_size_impl(app, false);
}
fn save_size_for_operation(app: &AppHandle) {
    save_size_impl(app, true);
}
fn save_size_impl(app: &AppHandle, force: bool) {
    let result = crate::ui_thread::run(app, move |app| {
        if !force && app.state::<AppState>().busy.load(Ordering::SeqCst) {
            return Ok(());
        }
        save_size_inner(app);
        Ok(())
    });
    if let Err(error) = result {
        windows::notify(app, &error);
    }
}
fn save_size_inner(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Some((width, height)) = windows::current_size(app) {
        let mut settings = state.settings.lock().unwrap();
        if width < crate::parameters::MIN_WIDTH || height < crate::parameters::MIN_HEIGHT {
            return;
        }
        settings.width = width;
        settings.height = height;
        // Do not overwrite damaged user config as a side effect of resizing/exiting.
        if !state.preserve_config.load(Ordering::SeqCst) {
            let snapshot = settings.clone();
            drop(settings);
            if let Err(error) = state.store.save(&snapshot) {
                windows::notify(app, &error);
            }
        }
    }
}

pub fn save_size_later(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.shutting_down.load(Ordering::SeqCst) || state.exiting.load(Ordering::SeqCst) {
        return;
    }
    let mut generation = state.resize_generation.fetch_add(1, Ordering::SeqCst) + 1;
    if state.size_save_scheduled.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let state = app.state::<AppState>();
        let latest = state.resize_generation.load(Ordering::SeqCst);
        if state.shutting_down.load(Ordering::SeqCst) {
            state.size_save_scheduled.store(false, Ordering::SeqCst);
            return;
        }
        if state.busy.load(Ordering::SeqCst) {
            generation = latest;
            continue;
        }
        if latest != generation {
            generation = latest;
            continue;
        }
        state.size_save_scheduled.store(false, Ordering::SeqCst);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<AppState>();
            if state.resize_generation.load(Ordering::SeqCst) == generation
                && !state.busy.load(Ordering::SeqCst)
            {
                save_size(&handle);
            } else if state.busy.load(Ordering::SeqCst)
                && !state.shutting_down.load(Ordering::SeqCst)
            {
                save_size_later(&handle);
            }
        });
        return;
    });
}
