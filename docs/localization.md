# 默认英文与自定义文案

MiniBrowser 内置英文，不根据系统语言自动切换。无需语言文件即可单独运行 EXE。可通过外部 JSON 覆盖设置、引导页、应用菜单、托盘及应用自己的提示／错误说明；网页、WebView2 原生菜单、开发者工具和系统／第三方技术详情保留原有语言。

## 启用中文或自定义文案

1. 运行应用，确保已创建 EXE 同级的 `MiniBrowser.data`。
2. 将发布包附带的 `locale.example.json` 复制为 `MiniBrowser.data/locale.json`。源码中的完整中文示例位于 [assets/locales/locale.example.json](../assets/locales/locale.example.json)。
3. 打开设置，在 **Language file** 输入 `locale.json`，或点击 **Browse…** 选择数据目录内的 JSON 文件。
4. 点击确认，保存成功后立即切换设置、引导页、应用菜单、托盘和后续提示的语言，不刷新网页或清除登录状态。取消不修改语言；输入框留空并确认可恢复英文。

路径仍保存在 `settings.json` 的 `languageFile` 字段，不需要手动编辑配置。输入和浏览只修改草稿；每次确认都会重新读取文件，即使路径没有变化。修改文案文件后重新打开设置并确认即可加载，不自动监视文件。

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

浏览选择仅接受数据目录内的 JSON，外部文件不会被复制。语言文件不会被应用改写，清空会话不会删除它。仍可在退出应用后手动修改配置，但运行时应使用设置面板，避免配置被其他保存操作覆盖。

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

确认设置时，如果文件缺失、不可读、JSON 损坏或路径越界，会阻止整次保存，保留当前语言和全部草稿。非法文案条目则逐项回退英文，保存成功并显示警告。配置保存失败不会切换语言，保存后的同步问题按“设置已保存但存在警告”处理。

取消草稿、导航、隐藏／显示和清空会话不重新读取磁盘文件，继续使用已确认的运行期词典；进程重启会重新读取。不提供自动文件监视、语言列表、复数语法或多级继承。

## 开发维护

英文 JSON 是前后端唯一文案来源：Rust 编译时嵌入，TypeScript 构建时导入。Rust 在保存前加载候选词典，原子保存成功后替换运行期词典并同步原生控件；前端原位更新文本和辅助属性，不重建表单。可信本地页面首次渲染前读取当前词典，避免导航时使用旧初始化快照。远程页面和子框架不获得词典或应用控制权限。`languageFile` 使用现有配置原子保存流程，不提升配置版本。

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
