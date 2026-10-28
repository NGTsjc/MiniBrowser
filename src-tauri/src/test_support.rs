// Faults are available only in the isolated debug harness. No test IPC or
// runtime flag is included in the portable release binary.
pub fn fail(name: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if value(name).as_bool() == Some(true) {
        return Err(format!("测试故障：{name}"));
    }
    let _ = name;
    Ok(())
}

pub fn delay(name: &str) {
    #[cfg(debug_assertions)]
    if let Some(ms) = value(name).as_u64() {
        std::thread::sleep(std::time::Duration::from_millis(ms.min(1000)));
    }
    let _ = name;
}

#[cfg(debug_assertions)]
fn value(name: &str) -> serde_json::Value {
    if std::env::var_os("MINIBROWSER_TEST_CDP").is_none() {
        return serde_json::Value::Null;
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("test-faults.json")))
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|data| data.get(name).cloned())
        .unwrap_or_default()
}
