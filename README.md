<div align="center">

# 🔥 抖音续火花助手

**每天自动为抖音好友续火花的 Microsoft Edge 扩展**

开机后在后台静默完成，不抢焦点、不弹窗、不重复打扰。

[![版本](https://img.shields.io/badge/version-1.9.1-fe2c55)](https://github.com/TomShi11/douyin-spark-keeper/releases/latest)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285f4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![测试](https://img.shields.io/badge/tests-172%20passed-12a150)](#开发)
[![License](https://img.shields.io/badge/license-MIT-666)](LICENSE)

[**⬇️ 下载安装**](https://huohua.11s.space) · [安装说明](#安装) · [工作原理](#工作原理) · [常见问题](#常见问题)

</div>

---

## 简介

抖音的「火花」需要双方每天互发消息才能延续。好友一多，每天挨个点开对话框发消息就成了负担。

本扩展把这件事自动化：**浏览器启动后随机延迟 1–5 分钟，在后台标签页打开抖音私信，扫描全部会话，识别带火花标记的好友，逐个发送一条消息，完成后自动关闭标签页。**

设计上有两条硬约束：

- **无感** —— 后台非激活标签页执行，不切换、不抢焦点、不弹窗。仅在需要人工介入（未登录 / 安全验证）时才通知你。
- **宁可漏发，不重复打扰** —— 是否已发一律以页面聊天记录为准；任何无法确认的情形都跳过而非重试。

## 功能

| | |
|---|---|
| 🕐 **定时执行** | 浏览器启动后随机延迟 1–5 分钟，每天仅成功执行一次 |
| 🔍 **自动识别** | 滚动扫描完整会话列表，识别火花标记与「重燃中」状态 |
| 🎯 **精准发送** | 以头像指纹认人，点开后二次校验身份，避免发错对象 |
| 🛡️ **四重防重复** | 每日闸门 → 身份校验 → 页面聊天记录判定 → 失败不重试 |
| 📋 **名单控制** | 白名单强制纳入、黑名单永久排除，支持模糊匹配 |
| 📊 **状态可视** | 图标角标显示进度，弹窗查看执行日志与结果明细 |
| ⚙️ **改版自救** | 选择器集中配置，支持设置页 JSON 覆盖，无需改代码 |
| 🌗 **深色模式** | 界面自动跟随系统主题 |

## 安装

> 本扩展未上架商店，需以「开发人员模式」加载。

1. [**下载压缩包**](https://huohua.11s.space) 并解压到一个**长期保留**的目录（Edge 每次启动都会读取该目录）
2. 打开 `edge://extensions/`
3. 启用左下角 **开发人员模式**
4. 点击 **加载解压缩的扩展**，选择解压后含 `manifest.json` 的文件夹
5. 建议将扩展图标固定到工具栏
6. 确认浏览器已登录抖音网页版且能正常打开私信

**更新时**：覆盖原目录后，回到 `edge://extensions/` 点击本扩展的 **重新加载**。Edge 会把扩展复制到内部目录运行，不点重新加载则仍执行旧代码。

## 使用

点击工具栏图标查看状态与日志。

**角标含义**

| 角标 | 状态 |
|---|---|
| `…` 灰色 | 正在执行 |
| 数字 绿色 | 今日已成功发送的人数 |
| `!` 红色 | 需要人工处理 |

**可配置项**（弹窗 → 设置）

| 项目 | 默认值 |
|---|---|
| 自动执行 | 开启 |
| 发送内容 | `续火花` |
| 单次上限 | 50 人（最大 100） |
| 发送间隔 | 2000–5000 毫秒随机 |
| 白名单 / 黑名单 | 空 |
| 聊天页地址 | `/chat?isPopup=1`，失败时自动回退 `/chat`、`/im` |

## 工作原理

### 防重复机制

按顺序四道闸门，任一命中即跳过：

1. **每日闸门** —— 自动触发前检查当日是否已完成（手动执行可绕过）
2. **身份校验** —— 点开会话后比对头像指纹，确认是目标本人（列表会因新消息重排）
3. **页面判定** —— 读取聊天记录，今日已有我方消息则跳过（含你手动发送的）
4. **失败不重试** —— 发送校验失败仅记录，绝不重发

> 判定完全基于页面实时状态，不依赖本地记录。本地记录仅用于统计展示。

### 虚拟列表处理

抖音会话列表仅渲染可视区域，滚动时 DOM 节点会被回收复用。因此：

- **不能只修改 `scrollTop`** —— 后台标签页的 `requestAnimationFrame` 被浏览器暂停，滚动位置变化但渲染不更新，导致只能扫到首屏。实际做法是 `scrollIntoView` + 修改 `scrollTop` + 派发 `scroll` 事件三者并用，并轮询等待渲染内容真正变化。
- **待发名单不由预扫描决定** —— 预扫描漏看的人将永远无法送达。改为边滚动边就地判断。
- **身份标识只用头像文件名** —— 昵称包含天数与相对时间会持续变化；`data-index` 是虚拟列表位置序号，会被复用给其他用户。

### 时间判定

消息区无「今天」分隔线，仅有每条消息的时间标签。抖音的显示规则是：数小时内显示「刚刚 / N分钟前」，更早显示 `13:10` 形式的时刻，跨天则带「昨天 / 8月30日」前缀。

因此**不带日期前缀的纯时刻即为今天**。遗漏此规则会把当日早间消息误判为历史记录，造成重复发送。

### 输入处理

抖音使用字节自研的 editor-kit 富文本编辑器，其空状态本身是一个空段落，直接插入文本会在消息上方产生空行。正确做法是全选已有内容后使用 `insertText` 替换，随后清理残留空块。

## 抖音改版后的处理

识别逻辑集中在 `content/dom-selectors.js`，每类目标均为「语义选择器优先，结构特征兜底」。

**方式一：设置页覆盖**（推荐，无需改代码）

在「选择器覆盖（JSON）」中仅覆盖失效项，深合并生效：

```json
{ "conversationList": { "css": [".新的类名"] } }
```

**方式二：采集页面结构**

在抖音私信页按 F12 打开控制台（若提示不允许粘贴，先输入 `allow pasting`），将左上角上下文由 `top` 切换为本扩展，执行：

```js
console.log(JSON.stringify(
  DSK_SELECTORS.collectDiagnostics(document, DSK_SELECTORS.getSelectors(null)), null, 2
));
```

**当前页面结构**（2026-09 采集）

| 目标 | 选择器 |
|---|---|
| 页面地址 | `/chat?isPopup=1` |
| 滚动容器 | `.conversationConversationListwrapper` |
| 会话项 | `[data-e2e="conversation-item"]` |
| 当前选中 | class 含 `curConversation` |
| 昵称 | `.conversationConversationItemtitle` |
| 火花标记 | `.commonStreakstreakContainer` |
| 火花天数 | `.commonStreaknormalText` |
| 消息气泡 | `.messageMessageBoxmessageBox` |
| 我方消息 | class 含 `isFromMe` |
| 消息时间 | `.MessageBoxTimetimeLayout` |
| 输入框 | `.messageEditorinputArea` |
| 发送方式 | 回车（无独立发送按钮） |

## 常见问题

<details>
<summary><b>发送内容能用表情吗？</b></summary>

可以，在设置页填入 emoji 字符即可。但**不要填 `[火花]` 这类方括号写法**，抖音不会解析为表情，会原样显示为文字。

默认值 `续火花` 为纯文本，最不易触发富文本编辑器的换行问题。
</details>

<details>
<summary><b>为什么火花还是断了？</b></summary>

火花规则由抖音制定，通常要求双方当日均发送消息。本扩展只能保证你这一侧发出，对方未回复仍可能中断。
</details>

<details>
<summary><b>会不会触发风控？</b></summary>

默认间隔 2–5 秒已刻意放缓，且每人每天仅一条。不建议调快。
</details>

<details>
<summary><b>数据会上传吗？</b></summary>

不会。所有配置与日志仅存于本地浏览器，无任何外部网络通信。
</details>

<details>
<summary><b>我自己浏览抖音时它会乱点吗？</b></summary>

不会。内容脚本默认完全被动，仅在收到后台任务指令后才操作页面。
</details>

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 保存配置与执行日志 |
| `alarms` | 定时触发任务 |
| `tabs` | 开启/关闭执行用的抖音标签页 |
| `notifications` | 需人工处理时发送通知 |
| `webNavigation` | 定位聊天区所在框架 |
| `https://www.douyin.com/*` | 仅在抖音域名下注入脚本 |

## 开发

```
douyin-spark-keeper/
├── background/service-worker.js   调度、标签页管理、重试、通知、角标
├── content/
│   ├── dom-selectors.js           ★ 选择器与识别逻辑（改版时修改此处）
│   ├── dom-utils.js               等待、输入模拟、点击、保活
│   └── runner.js                  主流程：预扫描 → 边滚边发
├── shared/                        配置、消息常量、存储
├── popup/  options/  icons/
└── manifest.json
```

```bash
cd work
npm install jsdom --no-save
node --test "tests/*.test.mjs"    # 172 项
node gen-icons.mjs                # 重新生成图标
```

## 免责声明

本扩展仅用于自动化个人日常操作，不修改、不绕过抖音任何业务逻辑与风控机制。使用者需自行承担因自动化操作产生的账号风险。与抖音及字节跳动无任何关联。

## License

[MIT](LICENSE)