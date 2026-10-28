# 脚本与自动化测试索引

所有命令均在仓库根目录执行，优先使用 `pnpm`；PowerShell 拦截 `pnpm.ps1` 时使用 `pnpm.cmd`。

当前共 16 个脚本：构建／版本工具 2 个、测试入口 4 个、单元测试 2 个、集成测试子模块 4 个、底层工具 3 个、早期图标工具 1 个。通常只运行 `package.json` 中的命令，子模块由入口自动调用。

```text
scripts/
  README.md              # 本索引
  package.mjs            # 发布产物检查与打包
  sync-version.mjs       # 版本管理
  create-icon.mjs        # 早期图标工具
  tests/                 # 全部测试脚本、子模块及原生探针
```

下表测试文件均位于 `scripts/tests/`，构建与版本工具保留在 `scripts/` 根目录。目录调整不改变 pnpm 命令；脚本仍以仓库根目录为工作目录。

## 构建与版本工具

| 文件 | 用途 | 入口 |
| --- | --- | --- |
| `package.mjs` | 检查 EXE 为 Windows x64 GUI、图标已嵌入、无测试入口及特定运行库旁置依赖；复制到 `release/` 并生成 SHA256 | `pnpm build` 自动调用 |
| `sync-version.mjs` | 同步 package.json、Tauri、Cargo 与 Cargo.lock 中的应用版本；校验 SemVer；支持只读一致性检查 | `pnpm version:set 0.2.0`；`node scripts/sync-version.mjs --check` |

## 测试入口

| 文件 | 命令 | 检查内容与前置条件 |
| --- | --- | --- |
| `smoke.mjs` | `pnpm test:smoke` | 完整桌面集成回归：设置、主题、拖动、缩放、圆角、透明度、菜单、托盘、快捷键、媒体、网站缩放、新页面拦截、单实例及会话清理；先 `pnpm build:debug` |
| `maintenance.mjs` | `pnpm test:maintenance` | 故障与竞争专项：保存前／后失败、草稿保护、预览失效、原生操作回滚、尺寸保存交错、重建期间关闭／重启、不可恢复错误退出；先 `pnpm build:debug` |
| `release-smoke.mjs` | `pnpm test:release` | 对实际打包 EXE 检查首显、70% 不透明度、任务栏样式、快捷键显隐、EXE 相对路径存储与正常关闭；先 `pnpm build` |
| `performance.mjs` | `pnpm test:performance` | 固定本地页面默认采样三轮，记录启动、移动／缩放／预览耗时、线程、工作集及 GDI 资源；先 `pnpm build:debug` |

性能脚本可指定调试 EXE、结果标签和轮数（1～10）：

```powershell
pnpm test:performance src-tauri/target/debug/MiniBrowser.exe current 3
```

性能采样不是功能测试，也没有自动判定“无退步”的阈值，需要结合相同环境下的基线与测量波动判断。

## Node.js 单元测试

| 文件 | 检查内容 |
| --- | --- |
| `preview.test.mjs` | 预览调度只保留进行中请求与最新值、确认刷新最终值、取消丢弃旧请求／错误，以及没有动画帧时的刷新 |
| `sync-version.test.mjs` | 版本格式、非法标签、四处版本同步、只读检查与修改前校验 |

统一执行 `pnpm test:unit`。该入口先把 `src/preview.ts` 编译到 `.cache/unit/`，再用 Node.js 内置的 `node:test` 和 `node:assert/strict` 执行断言。不要绕过编译直接运行预览测试。

Rust 单元测试不在本目录，位于 `src-tauri/src/*.rs` 的 `#[cfg(test)]` 模块，执行 `pnpm test:native`。覆盖配置兜底、原子写入／占用重试、几何、桌面边界、会话隔离、缩放记忆及 UI 线程任务等逻辑；命令名中的 native 不代表会启动 GUI。

## 完整回归的子模块

以下文件导出测试函数，由 `smoke.mjs` 传入实例、CDP 连接、原生探针和结果收集器。无需单独执行。

| 文件 | 职责 |
| --- | --- |
| `corner-checks.mjs` | 原生圆角、透明处鼠标穿透、视频／透明度组合、圆角设置预览／保存／取消 |
| `control-layout-checks.mjs` | 小圆角方形拖动区、大圆角圆弧条、原生区域与界面几何一致性、最小窗口面板及四角缩放 |
| `new-page-checks.mjs` | target 链接、Ctrl／中键、脚本／命名窗口、iframe 新窗口请求在当前窗口打开；拒绝不支持请求 |
| `zoom-checks.mjs` | Ctrl＋滚轮／加减号／0、网站临时缩放记忆、跨域 iframe、普通滚动及应用控件尺寸保持 |

## 底层工具

| 文件 | 职责 | 调用方 |
| --- | --- | --- |
| `cdp.mjs` | 简单的 Chrome DevTools Protocol 客户端，通过 WebSocket 查询 DOM、执行脚本、调用本地控制界面 IPC、获取页面状态 | smoke、maintenance、performance |
| `native-probe.ps1` | PowerShell 内嵌 C#，通过 P/Invoke 调用 Win32 API，检查窗口区域／样式／透明度并模拟鼠标、键盘、拖动、缩放、托盘与菜单操作 | smoke、maintenance、release-smoke |
| `profile-native.ps1` | 采样宿主线程／GDI 与进程树资源，计时移动和尺寸调整；操作后恢复窗口几何 | performance |

## 早期图标工具

`create-icon.mjs` 用像素代码生成早期 32×32 占位图标，**不参与当前构建或测试**。直接运行会覆盖 `src-tauri/icons/icon.ico`，不用于当前个人 Logo 图标更新。

当前图标以 `assets/branding/minibrowser-logo-personal.png` 为源，通过 Tauri 图标命令生成，步骤见 [开发维护速查](../docs/development.md#更新图标)。保留早期脚本仅便于追溯。

## 自动化如何工作

项目使用自建的轻量测试组合，没有引入 Playwright、Selenium、Jest 或 Vitest：

1. Rust 内置测试与 Node.js 内置测试验证不需要桌面的逻辑。
2. 集成入口复制调试 EXE 到 `.cache/` 的独立目录，启动固定本地 HTTP 测试页和真实 WebView2 应用。
3. CDP 读取页面／控件状态并触发部分操作；Win32 探针检查原生窗口并模拟真实输入，补足 DOM 测试无法覆盖的拖动、缩放、透明度和系统交互。
4. 维护专项利用 `src-tauri/src/test_support.rs` 的调试故障注入，主动制造保存后导航失败、原生部分失败和清理延迟等场景。
5. 发布版检查通过原生探针操作打包后的 EXE，不依赖测试 CDP 或故障注入。打包脚本检查这两类测试标记没有进入发布 EXE。

CDP／故障注入仅在设置测试环境变量的调试实例生效，不向远程网页增加应用 IPC 权限。自动化断言通过不等于所有 Windows、DPI、多显示器和输入设备均已验证。

## 常用运行顺序

日常修改后先运行无需桌面的检查：

```powershell
pnpm check
pnpm test:unit
pnpm test:native
```

涉及窗口、设置、生命周期或浏览行为时，再串行运行：

```powershell
pnpm build:debug
pnpm test:smoke
pnpm test:maintenance
```

性能相关修改额外执行 `pnpm test:performance`；发布前执行 `pnpm build` 和 `pnpm test:release`。Rust 格式和 Clippy 命令见 [开发维护速查](../docs/development.md#常用命令)。

桌面测试会移动鼠标、使用快捷键和打开窗口，运行期间避免操作键鼠。各入口使用固定测试端口（HTTP 18765／18766／18767、CDP 9223 起），**不能并行运行**。发布版沿用正式单实例标识，测试前先自行退出正式应用，避免测试操作被转交给已有会话。

| 结果位置 | 内容 |
| --- | --- |
| `.cache/smoke-portable/<时间戳>/` | 完整回归报告、截图与隔离数据 |
| `.cache/maintenance-checks/<时间戳>/` | 专项报告、失败现场与隔离数据 |
| `.cache/maintenance-performance/<标签>-<时间戳>/` | 每轮性能样本、汇总与被测 EXE 哈希 |
| `.cache/release-smoke/<时间戳>/` | 发布版检查使用的隔离 EXE 与数据目录；通过结果输出到终端 |
| `.cache/version-tests/`、`.cache/unit/` | 版本测试临时夹具与编译后的预览模块 |

这些结果不进入发布包，也不应提交 Git。测试结束并确认相关进程退出后，可按需清理对应缓存目录。

## GitHub Actions 覆盖范围

`check.yml` 和 `release.yml` 均执行版本检查、Node.js 单元测试、前端构建／类型检查、Rust 格式／Clippy／单元测试以及发布构建。后者另执行版本同步、ZIP／SHA256 打包与 Release 发布。

目前 CI 不执行真实桌面的 smoke、maintenance、performance 和 release-smoke；它们在本地 Windows 桌面串行运行。CI 构建通过不能代替本地原生验收。实机验证范围与未覆盖环境见 [原生验收说明](../docs/verification.md)，本地各轮实际结果以 `.cache/` 中的报告为准。
