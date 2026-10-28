//! Serialize short native state/configuration transactions on the event loop.
use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc::{Receiver, RecvTimeoutError},
    Arc,
};
use tauri::AppHandle;

fn receive<T>(
    receive: Receiver<Result<T, String>>,
    phase: &AtomicU8,
    timeout: std::time::Duration,
) -> Result<T, String> {
    match receive.recv_timeout(timeout) {
        Ok(value) => value,
        Err(RecvTimeoutError::Timeout) => {
            // A queued operation can be abandoned, but an already-started
            // commit must report its actual result, never a false save failure.
            if phase
                .compare_exchange(0, 2, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                Err("等待窗口操作超时".into())
            } else {
                receive.recv().map_err(|_| "窗口操作已中断".to_string())?
            }
        }
        Err(RecvTimeoutError::Disconnected) => Err("窗口操作已中断".into()),
    }
}

pub fn run<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    let phase = Arc::new(AtomicU8::new(0));
    let dispatched = phase.clone();
    // Tauri executes this directly when already on the event-loop thread.
    app.run_on_main_thread(move || {
        if dispatched
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            let _ = send.send(operation(&handle));
        }
    })
    .map_err(|e| e.to_string())?;
    self::receive(receive, &phase, std::time::Duration::from_secs(5))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeout_cancels_queued_work_before_it_can_mutate_state() {
        let (send, recv) = std::sync::mpsc::sync_channel(1);
        let phase = AtomicU8::new(0);
        assert!(receive::<()>(recv, &phase, std::time::Duration::from_millis(1)).is_err());
        assert!(phase
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_err());
        drop(send);
    }
    #[test]
    fn started_commit_reports_its_result_even_if_the_wait_timeout_elapses() {
        let (send, recv) = std::sync::mpsc::sync_channel(1);
        let phase = AtomicU8::new(1);
        let worker = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(10));
            send.send(Ok(42)).unwrap();
        });
        assert_eq!(
            receive(recv, &phase, std::time::Duration::from_millis(1)).unwrap(),
            42
        );
        worker.join().unwrap();
    }
}
