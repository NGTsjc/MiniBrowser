# MiniBrowser

**English** | [简体中文](README.zh-CN.md)

A small, portable browser window for keeping a webpage close at hand. Open a dashboard, a video, or a reference page in a window that fits your desktop.

## Features

- **A window that fits:** resize freely, pin it on top, and adjust opacity, rounded corners, accent color, and drag handle position.
- **Private sessions:** keep your login while browsing; closing or restarting the app starts fresh next time.
- **Easy to tuck away:** show or hide from the tray or with your own shortcut. Media pauses when hidden by default.
- **Simple browsing:** new-page links open in the same window. Use Ctrl + mouse wheel to zoom.
- **Portable:** no app installation. Settings and temporary browsing data stay beside the EXE.
- **Custom text:** choose a language JSON in Settings to change the interface immediately. A complete Chinese example is included.

## Get started

Requires **Windows 10/11 x64** and an installed **Microsoft Edge WebView2 Runtime**.

1. Download the portable package from [Releases](https://github.com/NGTsjc/MiniBrowser/releases) and extract it into a writable folder.
2. Run `MiniBrowser.exe`.
3. Right-click the start page or the corner drag handle, choose **Settings**, and enter a URL.

Hold the drag handle to move the window; drag an edge to resize it. The tray menu lets you show, hide, reset, restart, or close the app. By default, there is no taskbar button.

To use Chinese, copy `locale.example.json` into `MiniBrowser.data`, choose it under **Settings → Language file**, and confirm. Leave the field blank to restore English.

## Your settings and privacy

Settings are saved in `MiniBrowser.data` beside the EXE. Move that folder with the EXE to keep your preferences.

Hiding keeps the current session. **Clear session** removes cookies and site storage and reloads the page; closing discards the session. Files still in use are cleaned up on a later launch. This does not remove records maintained by Windows or WebView2 itself.

MiniBrowser runs one window at a time. Downloads, camera, microphone, location access, and separate login popups are currently unsupported. macOS support is not yet available.

## Further reading

The following guides are currently in Chinese:

- [Custom language files](docs/localization.md)
- [Development and build commands](docs/development.md)
- [Testing and verification](docs/verification.md)
