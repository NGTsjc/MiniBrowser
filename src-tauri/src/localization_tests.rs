use super::*;

#[test]
fn defaults_and_complete_chinese_example_share_keys_and_placeholders() {
    let example = include_str!("../../assets/locales/locale.example.json");
    let value: Catalog = serde_json::from_str(example).unwrap();
    assert_eq!(
        english().keys().collect::<Vec<_>>(),
        value.keys().collect::<Vec<_>>()
    );
    let (catalog, invalid) = parse(example).unwrap();
    assert!(invalid.is_empty(), "{invalid:?}");
    assert_eq!(catalog["settings.confirm"], "确认");
    assert_eq!(catalog["meta.languageTag"], "zh-CN");
    assert_eq!(parse("{}").unwrap().0, *english());
    assert_eq!(
        parse(include_str!("../../assets/locales/en.json"))
            .unwrap()
            .0,
        *english()
    );
}

#[test]
fn partial_bom_unknown_keys_and_plain_markup_are_supported() {
    let (catalog,invalid)=parse("\u{feff}{\"settings.title\":\" <img src=x onerror=alert(1)> \u{4f60}\u{597d} \",\"future.key\":42}").unwrap();
    assert!(invalid.is_empty());
    assert_eq!(
        catalog["settings.title"],
        "<img src=x onerror=alert(1)> 你好"
    );
    assert_eq!(catalog["settings.confirm"], "Confirm");
    assert!(!catalog.contains_key("future.key"));
}

#[test]
fn invalid_values_and_placeholder_changes_fall_back_per_entry() {
    for bad in [
        serde_json::json!(null),
        serde_json::json!(23),
        serde_json::json!(false),
        serde_json::json!([]),
        serde_json::json!({}),
        serde_json::json!("  "),
        serde_json::json!("A\nB"),
        serde_json::json!("A\tB"),
        serde_json::json!("A\0B"),
        serde_json::json!("{unexpected}"),
    ] {
        let (catalog, invalid) =
            parse(&serde_json::json!({"menu.refresh":bad,"settings.title":"Custom"}).to_string())
                .unwrap();
        assert_eq!(invalid, vec!["menu.refresh"]);
        assert_eq!(catalog["menu.refresh"], "Refresh");
        assert_eq!(catalog["settings.title"], "Custom");
    }
    for bad in ["Failed", "{different}", "{error", "error}"] {
        let (catalog, invalid) =
            parse(&serde_json::json!({"errors.save":bad}).to_string()).unwrap();
        assert_eq!(invalid, vec!["errors.save"]);
        assert_eq!(catalog["errors.save"], english()["errors.save"]);
    }
    let (catalog, invalid) =
        parse(r#"{"errors.save":"Failure:\n{error}","meta.languageTag":"not a language!"}"#)
            .unwrap();
    assert_eq!(invalid, vec!["meta.languageTag"]);
    assert_eq!(catalog["meta.languageTag"], "en");
    assert_eq!(catalog["errors.save"], "Failure:\n{error}");
    for bad in ["{", "null", "[]", "42", "\"text\""] {
        assert!(parse(bad).is_err());
    }
}

#[test]
fn formatting_is_single_pass_and_never_interprets_parameter_text() {
    assert_eq!(
        render(
            "{max} / {min} / {max}",
            &[("min", "1".into()), ("max", "{min}<b>".into())]
        ),
        "{min}<b> / 1 / {min}<b>"
    );
}

#[test]
fn files_stay_in_portable_tree_and_fail_safely() {
    let dir = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!(
            "locale-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    std::fs::create_dir_all(dir.join("locales")).unwrap();
    let file = dir.join("locales/custom.json");
    std::fs::write(&file, "\u{feff}{\"menu.refresh\":\"Reload now\"}").unwrap();
    assert_eq!(
        load(&dir, "locales/custom.json").unwrap().0["menu.refresh"],
        "Reload now"
    );
    for bad in [
        "../outside.json",
        "C:\\outside.json",
        "/tmp/outside.json",
        "\\\\server\\share\\locale.json",
        "locales/../../outside.json",
        "",
    ] {
        assert!(!valid_relative(bad), "{bad}");
    }
    assert!(load(&dir, file.to_str().unwrap()).is_err());
    assert!(load(&dir, "missing.json").is_err());
    assert!(load(&dir, "locales").is_err());
    for bytes in [b"{".as_slice(), b"[]".as_slice(), &[0xff, 0xfe]] {
        std::fs::write(&file, bytes).unwrap();
        assert!(load(&dir, "locales/custom.json").is_err());
    }
    assert_eq!(prepare(&dir, None).unwrap().0, *english());
    std::fs::write(&file, r#"{"menu.refresh":"Reload now"}"#).unwrap();
    let candidate = prepare(&dir, Some("locales/custom.json")).unwrap().0;
    std::fs::write(&file, "{}").unwrap();
    assert_eq!(candidate["menu.refresh"], "Reload now");
    assert_eq!(
        prepare(&dir, Some("locales/custom.json")).unwrap().0,
        *english()
    );
    assert_eq!(
        crate::language_picker::relative(&dir, &file).unwrap(),
        "locales/custom.json"
    );
    std::fs::write(&file, "[]").unwrap();
    assert!(prepare(&dir, Some("locales/custom.json")).is_err());
    assert!(prepare(&dir, Some("missing.json")).is_err());
    assert!(
        crate::language_picker::relative(&dir.join("locales"), &dir.join("not-json.txt")).is_err()
    );
    std::fs::remove_dir_all(dir).unwrap();
}
