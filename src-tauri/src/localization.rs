use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path},
    sync::OnceLock,
};

pub type Catalog = BTreeMap<String, String>;
static ENGLISH: OnceLock<Catalog> = OnceLock::new();
static ACTIVE: OnceLock<Catalog> = OnceLock::new();

pub fn english() -> &'static Catalog {
    ENGLISH.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/locales/en.json"))
            .expect("valid built-in English catalog")
    })
}
pub fn text(key: &str) -> &'static str {
    ACTIVE
        .get()
        .unwrap_or_else(|| english())
        .get(key)
        .map(String::as_str)
        .unwrap_or("[Missing text]")
}
pub fn format(key: &str, params: &[(&str, String)]) -> String {
    render(text(key), params)
}
pub fn menu_text(key: &str) -> String {
    // Muda treats '&' as a mnemonic on Windows. Custom labels are plain text.
    text(key).replace('&', "&&")
}
fn render(template: &str, params: &[(&str, String)]) -> String {
    let mut output = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        output.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}').map(|i| start + i) else {
            output.push_str(&rest[start..]);
            return output;
        };
        let name = &rest[start + 1..end];
        match params.iter().find(|(key, _)| *key == name) {
            Some((_, value)) => output.push_str(value),
            None => output.push_str(&rest[start..=end]),
        }
        rest = &rest[end + 1..];
    }
    output.push_str(rest);
    output
}
fn placeholders(value: &str) -> Option<BTreeSet<&str>> {
    let mut names = BTreeSet::new();
    let mut rest = value;
    while let Some(start) = rest.find('{') {
        if rest[..start].contains('}') {
            return None;
        }
        let end = rest[start..].find('}')? + start;
        let name = &rest[start + 1..end];
        if name.is_empty() || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') {
            return None;
        }
        names.insert(name);
        rest = &rest[end + 1..];
    }
    if rest.contains('}') {
        None
    } else {
        Some(names)
    }
}
pub fn valid_relative(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(':')
        && !value.starts_with('\\')
        && !Path::new(value).is_absolute()
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}
fn valid_tag(value: &str) -> bool {
    let mut parts = value.split('-');
    parts
        .next()
        .is_some_and(|p| (2..=8).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_alphabetic()))
        && parts.all(|p| (1..=8).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_alphanumeric()))
}
pub fn parse(content: &str) -> Result<(Catalog, Vec<String>), String> {
    let value: serde_json::Value =
        serde_json::from_str(content.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| text("errors.localeObject").to_owned())?;
    let mut catalog = english().clone();
    let mut invalid = Vec::new();
    for (key, original) in english() {
        let Some(raw) = object.get(key) else { continue };
        let value = raw
            .as_str()
            .map(|s| {
                if key == "common.separator" {
                    s
                } else {
                    s.trim()
                }
            })
            .filter(|s| !s.trim().is_empty());
        let multiline = key.starts_with("errors.")
            || key.starts_with("guide.")
            || key.ends_with("Hint")
            || key.ends_with("Body");
        if let Some(value) = value.filter(|s| {
            !s.chars()
                .any(|c| c.is_control() && !(multiline && c == '\n'))
                && placeholders(s).is_some()
                && placeholders(s) == placeholders(original)
                && (key != "meta.languageTag" || valid_tag(s))
        }) {
            catalog.insert(key.clone(), value.to_owned());
        } else {
            invalid.push(key.clone());
        }
    }
    Ok((catalog, invalid))
}
fn load(root: &Path, file: &str) -> Result<(Catalog, Vec<String>), String> {
    if !valid_relative(file) {
        return Err(text("errors.localePath").into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(file).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err(text("errors.localeOutside").into());
    }
    parse(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
}
pub fn init(root: &Path, file: Option<&str>) -> Option<String> {
    let file = file.map(str::trim).filter(|s| !s.is_empty());
    let (catalog, invalid, failure) = match file.map(|f| load(root, f)) {
        Some(Ok((catalog, invalid))) => (catalog, invalid, None),
        Some(Err(error)) => (english().clone(), Vec::new(), Some(error)),
        None => (english().clone(), Vec::new(), None),
    };
    let _ = ACTIVE.set(catalog);
    if let Some(error) = failure {
        Some(format(
            "errors.localeFile",
            &[("path", file.unwrap_or_default().into()), ("error", error)],
        ))
    } else if !invalid.is_empty() {
        Some(format(
            "errors.localeFields",
            &[("keys", invalid.join(", "))],
        ))
    } else {
        None
    }
}
pub fn script() -> String {
    // AddScriptToExecuteOnDocumentCreated executes JS, not HTML. JSON encoding
    // quotes every value; the guard never publishes it to remote pages/frames.
    crate::parameters::local_script(
        "__MINIBROWSER_LOCALE__",
        &serde_json::json!(ACTIVE.get().unwrap_or_else(|| english())),
    )
}

#[cfg(test)]
#[path = "localization_tests.rs"]
mod tests;
