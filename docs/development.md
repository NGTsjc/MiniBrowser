# 开发维护速查

以下命令均在仓库根目录执行，优先使用 pnpm。Windows PowerShell 若拦截 `pnpm.ps1`，将命令中的 `pnpm` 换成 `pnpm.cmd`。

## 环境与启动

Windows 10/11 x64；Node.js 22.12+、pnpm 10.32.1、Rust 1.96+、Visual Studio C++ Build Tools（含 Windows SDK）、系统 WebView2 Runtime。

```powershell
# 首次拉取／依赖变更后安装，保持锁文件版本
pnpm install --frozen-lockfile

# 启动桌面应用：前端热更新，Rust 修改后重新编译
pnpm dev
```

`pnpm dev:ui` 仅启动 Vite，供 Tauri 开发流程使用；浏览器直接打开不具备原生参数与 IPC 环境。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm build:ui` | 类型检查并构建前端到 `dist/` |
| `pnpm test:native` | Rust 单元测试 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml` | 格式化 Rust |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | Rust 静态检查 |
| `pnpm build:debug` | 构建嵌入前端资源的调试 EXE，供集成测试使用 |
| `pnpm test:smoke` | 真实 WebView2 集成检查，需要先构建调试版 |
| `pnpm build` | 构建、检查并打包便携 EXE，生成 SHA256 文件 |
| `pnpm test:release` | 检查已打包 EXE 的原生启动、样式、快捷键与关闭 |
| `git diff --check` | 检查补丁空白问题 |

集成测试会操作真实桌面和鼠标，请等待结束后再使用键鼠，避免并行运行其他原生界面测试。调试测试使用独立实例标识，结果和截图保存在 `.cache/smoke-portable/<时间戳>/`。发布版测试前先关闭正在运行的正式应用，避免单实例机制影响结果。

## 常见修改位置

| 内容 | 位置与说明 |
| --- | --- |
| 默认值、配置版本、范围和窗口／浮层尺寸 | `src-tauri/src/parameters.rs`，`defaults()` 定义默认设置；前端自动读取 |
| 圆角上限、拖动块大小、弧条切换阈值 | 同上：`MAX_CORNER_RADIUS`、`DRAG_SIZE`、`ARC_THRESHOLD` |
| 配置读取、校验与原子保存 | `src-tauri/src/config.rs` |
| 拖动区与面板几何、原生圆角裁剪 | `src-tauri/src/control_layout.rs`、`corners.rs` |
| 窗口生命周期与浮层同步 | `src-tauri/src/windows.rs`、`lifecycle.rs` |
| 设置界面、样式、主题 | `src/main.ts`、`style.css`、`theme.ts` |
| 右键菜单／托盘 | 前后端的 `context-menu.*`／`context_menu.rs`，以及 `tray.rs` |
| 应用／托盘图标 | `src-tauri/icons/icon.ico`；源图位于 `assets/branding/` |
| 应用名称、版本、标识与构建配置 | `src-tauri/tauri.conf.json`；版本同步维护 `package.json`、`src-tauri/Cargo.toml` 及相关锁文件 |

修改默认值后需重新构建；已有有效的 `MiniBrowser.data/settings.json` 字段仍优先使用。测试新默认值时，先关闭应用并备份配置，再移除对应字段；不要直接删除整个数据目录。窗口位置不保存，网站缩放仅保留在本次会话。

新增原生命令时同步检查 `commands.rs`、`main.rs` 的命令注册、`build.rs` 命令清单和 `capabilities/controls.json` 权限。远程网页始终不得获得应用控制权限。

## 更新图标

先生成到缓存目录，再只复制 Windows 所需 ICO，避免把其他平台的整套图标加入源码。

```powershell
pnpm tauri icon assets/branding/minibrowser-logo-personal.png --output .cache/app-icons
Copy-Item -LiteralPath .cache/app-icons/icon.ico -Destination src-tauri/icons/icon.ico -Force
pnpm build
```

应用与托盘共用图标。构建脚本跟踪 ICO 变化，打包脚本会检查当前图标是否嵌入 EXE。

## 发布流程

```powershell
pnpm check
pnpm test:native
pnpm build:debug
pnpm test:smoke
pnpm build
pnpm test:release
```

产物为 `release/MiniBrowser.exe` 和 `release/MiniBrowser.exe.sha256`。用户仅需 EXE 与系统 WebView2；携带偏好时另带 EXE 同级的 `MiniBrowser.data/settings.json`，不要分发测试会话目录。

构建不会关闭正在运行的旧版本；文件占用时会保留 `MiniBrowser.previous-<时间戳>.exe`。退出旧应用后重新打开新版生效，旧文件在释放占用后可手动删除。开发、调试和发布 EXE 各自使用实际所在目录的数据，不按终端工作目录定位。

提交代码时保留 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock`，不要提交 `dist/`、`release/`、`src-tauri/target/`、`.cache/` 或个人运行配置。单个代码文件接近 1000 行时先提出拆分建议，由用户决定。原生验收步骤见 [verification.md](verification.md)。
