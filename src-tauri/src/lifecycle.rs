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
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    state.resize_generation.fetch_add(1, Ordering::SeqCst);
    let _ = app.global_shortcut().unregister_all();
    save_size(app);
    let session = state.session.lock().unwrap().clone();
    let processes = std::mem::take(&mut *state.browser_processes.lock().unwrap());
    let app = app.clone();
    std::thread::spawn(move || {
        destroy_windows(&app);
        remove_session(&session, &processes);
        let handle = app.clone();
        // Keep automatic last-window exits blocked until cleanup is complete.
        // Set the exit gate and request exit/restart in the same event-loop turn.
        let _ = app.run_on_main_thread(move || {
            handle
                .state::<AppState>()
                .exiting
                .store(true, Ordering::SeqCst);
            if restart {
                handle.request_restart();
            } else {
                handle.exit(0);
            }
        });
    });
}

pub fn reset_session(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("正在处理会话，请稍候".into());
    }
    let url = windows::current_url(app);
    save_size(app);
    let new_session = match state.store.new_session() {
        Ok(path) => path,
        Err(e) => {
            state.busy.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let old_session = std::mem::replace(&mut *state.session.lock().unwrap(), new_session);
    let processes = std::mem::take(&mut *state.browser_processes.lock().unwrap());
    let _ = app.emit_to("controls", "session-reset", ());
    let app = app.clone();
    std::thread::spawn(move || {
        #[cfg(debug_assertions)]
        eprintln!("session reset: destroy hosts");
        destroy_windows(&app);
        #[cfg(debug_assertions)]
        eprintln!("session reset: clean old session");
        remove_session(&old_session, &processes);
        #[cfg(debug_assertions)]
        eprintln!("session reset: build hosts");
        if let Err(error) = windows::build(&app, &url) {
            crate::platform::fatal(&error);
            app.exit(1);
        }
        app.state::<AppState>().busy.store(false, Ordering::SeqCst);
        #[cfg(debug_assertions)]
        eprintln!("session reset: ready");
    });
    Ok(())
}

pub fn save_size(app: &AppHandle) {
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
            if let Err(error) = state.store.save(&settings) {
                drop(settings);
                windows::notify(app, &error);
            }
        }
    }
}

pub fn save_size_later(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.busy.load(Ordering::SeqCst) {
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
        if state.busy.load(Ordering::SeqCst) {
            state.size_save_scheduled.store(false, Ordering::SeqCst);
            return;
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
            }
        });
        return;
    });
}
