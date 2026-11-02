# 默认英文与自定义文案

MiniBrowser 内置英文，不根据系统语言自动切换。无需语言文件即可单独运行 EXE。可通过外部 JSON 覆盖设置、引导页、应用菜单、托盘及应用自己的提示／错误说明；网页、WebView2 原生菜单、开发者工具和系统／第三方技术详情保留原有语言。

## 启用中文或自定义文案

1. 正常运行并退出应用，确保已创建 `MiniBrowser.data/settings.json`。
2. 将发布包附带的 `locale.example.json` 复制为 `MiniBrowser.data/locale.json`。源码中的完整中文示例位于 [assets/locales/locale.example.json](../assets/locales/locale.example.json)。
3. 编辑现有 `settings.json`，保留其他设置，增加或修改：

```json
{
  "languageFile": "locale.json"
}
```

4. 重新启动应用。上面的 JSON 仅展示新增字段，不是完整配置，不必用它替换整个设置文件。

目录示例：

```text
MiniBrowser.exe
locale.example.json           # 发布包示例，不会自动启用
MiniBrowser.data/
  settings.json
  locale.json                 # 实际读取的自定义文案
  sessions/
```

`languageFile` 相对于 `MiniBrowser.data`，也可填写 `locales/zh-CN.json`。不接受绝对路径、上级路径或通过符号链接／目录联接越出数据目录的文件。这个路径基准与 TaskbarAudio 的 EXE 目录不同，以保持 MiniBrowser 的便携数据约束。

设置 `null`、空白字符串或移除 `languageFile` 即恢复英文；单纯放置文件不会启用。修改配置或文案后都需要重启。请在应用退出后手动修改配置，避免运行中的尺寸／设置保存覆盖手工修改。语言文件不会被应用改写，清空会话不会删除它。

## 文件格式与回退

使用 UTF-8 JSON（允许 BOM），顶层为扁平对象；可以只写需要覆盖的键，其余使用英文。例如：

```json
{
  "meta.languageTag": "zh-CN",
  "settings.title": "窗口设置",
  "settings.confirm": "确认",
  "menu.refresh": "刷新",
  "tray.show": "显示窗口",
  "tray.hide": "隐藏窗口",
  "errors.save": "设置保存失败：{error}"
}
```

- 完整键名和英文原文见 [英文词典](../assets/locales/en.json)。新增版本增加文案时，旧文件缺失的键自动使用英文；未知键忽略。
- 缺失、非字符串、空白或不符合规则的字段逐项回退。菜单／按钮等短标签不能包含控制字符；正文提示支持 `\n` 换行。
- 动态文本必须保留英文原文中的命名占位符集合，如 `{error}`、`{min}`、`{max}`、`{shortcut}`、`{warnings}`；允许调整位置，不能删除、改名或新增。占位符不合法时，该项使用英文。
- 所有文案都按纯文本处理，不能使用 HTML／脚本；`<b>` 等标签只会作为文字显示。短菜单里的长标签会省略显示，悬停可查看完整标签。
- `meta.languageTag` 设置本地页面的 HTML 语言标记，默认 `en`，可用 `zh-CN`、`de` 等；不会改变网页语言、键盘快捷键或系统区域设置。
- 文件缺失、损坏、无法读取或路径被拒绝时，应用正常启动并使用英文。问题显示在现有设置提示区域，不写日志文件，不反复弹窗。
- 应用读取配置及语言文件前的启动错误只能使用内置英文；系统和第三方返回的原始技术详情不保证可翻译。

修改设置、取消草稿、导航、隐藏和显示，以及清空会话都不会重新加载语言文件；只有完整进程重启才生效。不提供热加载、语言选择器、复数语法或多级继承。

## 开发维护

英文 JSON 是前后端唯一文案来源：Rust 编译时嵌入，TypeScript 构建时导入。Rust 合并外部文件后，通过现有可信本地页面初始化脚本提供文案，远程页面和子框架不获得词典或额外 IPC 权限。`languageFile` 使用现有配置原子保存流程，不提升配置版本。

添加文案时，同时更新英文 JSON 和完整中文示例；需要参数时使用命名占位符。前端使用统一取词／转义工具，不能把未转义译文拼入 DOM。布局需检查长英文、自定义长词和极小窗口。

```powershell
pnpm test:unit
pnpm test:native
pnpm build:debug
pnpm test:localization
pnpm test:smoke
pnpm test:maintenance
pnpm build
pnpm test:release
```

桌面测试串行运行。语言专项报告与截图保存在 `.cache/localization-checks/<时间戳>/`；CI 运行纯逻辑测试和构建，本地桌面专项不作为云端已完成的验收。
