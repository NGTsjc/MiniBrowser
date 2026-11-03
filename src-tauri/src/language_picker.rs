use std::path::Path;
use tauri::WebviewWindow;

pub fn relative(root: &Path, selected: &Path) -> Result<String, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let selected = selected.canonicalize().map_err(|e| e.to_string())?;
    if !selected.is_file()
        || !selected
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err(crate::localization::text("errors.localeSelection"));
    }
    selected
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|_| crate::localization::text("errors.localeOutside"))
}

#[cfg(windows)]
pub fn choose(owner: &WebviewWindow, root: &Path) -> Result<Option<String>, String> {
    use windows::{
        core::*,
        Win32::{
            Foundation::*,
            System::Com::*,
            UI::Shell::{Common::COMDLG_FILTERSPEC, *},
        },
    };
    // Tauri's UI thread already owns the STA. Balance only our successful init.
    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() }
            }
        }
    }
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        initialized.ok().map_err(|e| e.to_string())?;
        let _com = ComGuard(true);
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        let options = dialog.GetOptions().map_err(|e| e.to_string())?;
        dialog
            .SetOptions(
                options
                    | FOS_FILEMUSTEXIST
                    | FOS_PATHMUSTEXIST
                    | FOS_FORCEFILESYSTEM
                    | FOS_DONTADDTORECENT
                    | FOS_NOCHANGEDIR,
            )
            .map_err(|e| e.to_string())?;
        dialog
            .SetFileTypes(&[COMDLG_FILTERSPEC {
                pszName: w!("JSON"),
                pszSpec: w!("*.json"),
            }])
            .map_err(|e| e.to_string())?;
        let title = HSTRING::from(crate::localization::text("settings.languageBrowseTitle"));
        dialog.SetTitle(&title).map_err(|e| e.to_string())?;
        let folder: IShellItem =
            SHCreateItemFromParsingName(&HSTRING::from(root.as_os_str()), None)
                .map_err(|e| e.to_string())?;
        dialog.SetFolder(&folder).map_err(|e| e.to_string())?;
        if let Err(error) = dialog.Show(Some(owner.hwnd().map_err(|e| e.to_string())?)) {
            if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
                return Ok(None);
            }
            return Err(error.to_string());
        }
        let result = dialog.GetResult().map_err(|e| e.to_string())?;
        let name = result
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|e| e.to_string())?;
        let path = name.to_string();
        CoTaskMemFree(Some(name.0 as _));
        relative(root, Path::new(&path.map_err(|e| e.to_string())?)).map(Some)
    }
}
#[cfg(not(windows))]
pub fn choose(_: &WebviewWindow, _: &Path) -> Result<Option<String>, String> {
    Err(crate::localization::text("errors.localePickerUnsupported"))
}
