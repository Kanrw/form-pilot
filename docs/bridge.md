# 桥接基础设施

> 本文件是 `AGENTS.md` 原 §四 的**全文摘录，未改一字**（2026-09-24 拆分）。
> AGENTS.md 正文里出现的「见 §X」引用，按 AGENTS.md 顶部的「旧章节 → 新位置」对照表换算到本文件。

---
## 四、基础设施现状

- Kimi WebBridge daemon：`http://127.0.0.1:10086/command`
- 状态检查：`node scripts/status.mjs`（或 `~/.kimi-webbridge/bin/kimi-webbridge status`）
- 启动：`~/.kimi-webbridge/bin/kimi-webbridge start`
- macOS/Linux 调用模板：`curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' -d '{"action":...,"args":...,"session":"..."}'`
- Windows：内联 JSON 会乱码，必须用 `--data-binary @file`
- **动作参数形状**（2026-09-22 实测）：`evaluate` 的参数名是 **`code`**，写成 `expression`
  会回 `{"ok":false,"error":{"message":"evaluate: code is required"}}`；`navigate` 用
  `{url,newTab,group_title}`；`screenshot` 用 `{path,fullPage}`，返回 `{format,path,sizeBytes}`
  并把 png 落到磁盘。**这是零安装做"真实渲染核对"的路子** —— 不用装浏览器自动化工具，
  直接开页 + `evaluate` 取 `getBoundingClientRect()` 就能核版式，`screenshot` 能拿到画面。
- 固定 session 名约定：同一任务一个 session，如 `form-v01`、`adapter-research`
- **写 payload 一律用 node 生成文件 + `--data-binary`，不要在 shell 里内联 JSON**（2026-09-22 实测）。
  两个坑：① 内联 JSON 里的 `\n` 会被 shell 吃掉，正则直接变成 `Invalid regular expression: missing /`；
  ② 中文与引号在多层转义下极易写坏。模板：
  ```bash
  node -e 'const fs=require("fs");fs.writeFileSync("/tmp/p.json",
    JSON.stringify({action:"evaluate",args:{code:fs.readFileSync("/tmp/code.js","utf8")},session:"form-v01"}))'
  curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' --data-binary @/tmp/p.json
  ```
  代码写进 `code.js`，Node 负责转义 —— 正则与多行字符串都能原样送过去。
- **动作参数可以空参调用反推**：`{"action":"upload","args":{}}` 会回
  `upload: selector is required`，补上再调会回下一层缺什么。无需文档即可拿到参数表。
  已探到的：`upload` = `{selector, files:[绝对路径]}`；`find_tab` 需要 `{url}`（传 tabId 会报
  `find_tab: url is required`，url 写前缀即可匹配）。
- **session → tab 绑定比想象中更易失**：实测一次会话里当前 tab 连续被关掉两次，
  报错形如 `current tab <id> was closed; session still has tabs [...] — call list_tabs to re-target`。
  恢复办法：`list_tabs` 看哪个 tab 还指向申请页 → `find_tab {url: 前缀}` 重新绑定。
  **不要把 tabs 列表传给 evaluate**，evaluate 只认重新绑定后的当前 tab。
- macOS 上**没有 `timeout` 命令**，用 `curl --max-time <秒>`。

**桥接状态是当场读数，不是本文件的常驻事实。** 2026-09-22 发生过两次状态反转（10:11 daemon 被终止、
11:35 恢复）——**每次使用前必须重新 `status`，不得引用任何历史值**。

**session → tab 绑定是易失的。** 实测：tab 关闭后同一 session 的 `evaluate` 直接报
`session "x" tab was closed — navigate first to recreate`。所以每个 session 的第一步永远是 `navigate`。
`inject.mjs` 不负责导航，它只注入。

**status 在 running 态的完整字段**（2026-09-22 实测）：
`extension_connected, extension_id, extension_version, port, running, skills[], update_available{}, uptime_seconds, version`。
`running:false`（缺 daemon）与 `extension_connected:false`（缺浏览器/扩展）是两种故障、两种修法。

### ★ 目标标签页必须在前台（2026-09-22 实测）

另外，**标签页内容本身也会变**（2026-09-22 实测）：一次会话中途，session 绑定的那个标签页
被切到了别的站点，`apply-field-` 计数归 0、引擎丢失、适配器回落到 `generic`。
所以每个写操作前，除 `document.hidden` 之外再加一句 `location.href` 仍在申请页上；
`inject.mjs` 回的 `adapter` 从 `moka` 变成 `generic` 就是这个信号。

**这是引擎的硬前提，不是建议。** Chrome 对后台标签页节流定时器，而引擎**每个**异步方法都靠
`sleep`（`setTimeout`）驱动 —— 于是 `fillTexts` / `pickOption` / `fillDate` / `fillMonthRange` /
`addRow` 全部变成**无限等待：不报错、不返回、也不超时**。这是最坏的失败形态。

实测证据（同一次会话，同一标签页）：

| 操作 | 后台（`hidden: true`） | 前台（`visible`） |
| --- | --- | --- |
| `await new Promise(r => setTimeout(r, 1500))` | **30 秒未触发** | 正常 |
| 同步 `evaluate`（如 `pickOption` 走 `field-not-found`） | 秒回 | 秒回 |

同步路径不受影响，所以"桥是通的、页面也在"会误导排查方向 —— **先查 `document.hidden`**。

引擎已在每个异步方法入口加了前台守卫：命中返回 `err:'tab-hidden'`（`fillTexts` 保持
`{ok,failed,retried}` 形状，`ok: 0` 且每个字段各报一条）。**局限**：挡不住"填到一半被切到后台"。
不要试图用"给 `sleep` 加超时"来兜底 —— 那个超时定时器同样不会触发。

### 后台标签页的两条修正（2026-09-23 实测，方正 PCB 会话）

- **`Page.bringToFront`（cdp）不是"置前开关"，只在 Chrome 窗口没被完全遮挡时有效。**
  实测序列：navigate 后 `hidden:true` → `cdp {method:"Page.bringToFront"}` → `hidden:false`
  （够跑完一次同步 `evaluate`）→ 之后 WorkBuddy 窗口夺焦、Chrome 被完全遮挡 → `hidden` 回 `true`，
  **再调 bringToFront 一次仍 `true`**。所以不要把"先 bringToFront 再跑异步方法"当成可依赖的流程；
  Chrome 的遮挡判定（occlusion）在窗口未被看见时把页面按后台处理，定时器照样节流。
- **桥的原生 `fill` 动作 `{selector, value}` 是 `hidden:true` 下唯一实测可用的写通道。**
  它走扩展侧写入，**不吃后台定时器节流**。实测在 `hidden:true` 下写 4 个字段（含中文值），
  2 秒后回读全部保持、无残留联想面板。用法：先用**同步** `evaluate` 给目标 input 打
  `data-fp=*` 标记（同步路径不受 hidden 影响），再 `fill {selector:"input[data-fp=..]", value}`。
  **局限（决定它只能当降级通道）**：它只写值，不做引擎的复合字段拒写、也不做回读自检 ——
  用之前必须自己核"目标盒内可见 input 数 = 1"（北森手机号那类复合字段会写错位置），
  用之后必须另发一次 evaluate 回读。**引擎的 `fillTexts` 在 hidden 下必然报 `tab-hidden`，
  同参数重试上限 2 次（§2.8 红线 3）；第 2 次仍失败就换通道或转人工，不要试第三次。**

### ★ 批量写入的静默错写（2026-09-23 苏纳 SUNA 会话，脚本已修）

**失败形态**（本项目最贵的一类：报告写着"已验证"，实际写错了字段）：
临时批量写入脚本给元素打 `data-fp=ft0/ft1/...` 标记后**没清理**，第二轮运行复用同一批标记名，
页面上于是同时存在新旧两套同名标记 → `document.querySelector('[data-fp=ft0]')` 取的是
**文档里第一个**匹配（第一轮写的「姓名」输入框）→ 第二轮要写的「获得证书」落到了姓名上，
**姓名/学号/邮箱三个字段被证书文本/爱好/项目描述覆盖**。更糟的是回读也用同一个选择器，
**读写两边错到一起**，所以第一轮报告是"14/14 已写入、回读一致"。
发现方式：用引擎 `scan()` 与"按 label 取盒内真值"两条独立路径对读，出现 3 处不一致。

**三条纪律（`scripts/filltext.mjs` 已内建，别退回）**：

1. 开跑前**清掉本脚本自己用过的全部标记**（跨轮次残留是事故的直接原因）；
2. 标记带**一次性随机前缀**（`run + i`），进程内不复用、跨进程不重名；
3. **回读一律按 label 定位盒内元素**，绝不用全局标记选择器 —— 这是唯一能发现"写错字段"的读法。

另两条实现坑：`label.innerText` 在 jsdom 里是 `undefined`（只有真浏览器才有），读 label 要
`innerText || textContent`，否则定位逻辑根本没法单测；注入代码里别写 `'\n'`
（Node 模板字符串会提前把它转成真换行，浏览器端直接 SyntaxError），用 `String.fromCharCode(10)`。

`scripts/filltext.mjs` = 后台标签页下的**文本/文本域写入通道**（桥的原生 `fill`，不吃定时器节流，
见上一节），用法 `--set "<字段>=<值>"`。它只写"盒内可见控件恰好 1 个"的字段，多于 1 个直接拒写
（与引擎 `composite-field` 同一条纪律）。

### 下拉触发器是"切换"语义（2026-09-22 实测）

同一下拉**连点两次**，可见面板数 `0 → 1 → 0`：点击一个**已经打开**的触发器是把它**关掉**。
结合另一条实测 —— `chooseIn` 失败后页面**会残留 1 个可见面板**（`body.click()` 关不掉它）——
就有：一次失败留下残留菜单 → 下一次点同一触发器把它关掉 → `openMenuFor` 永远看不到新菜单 →
报 `menu-not-open`，而页面其实是好的。**这才是 `closeMenus()` 存在的理由**，别删。

**站点探针**（2026-09-22 新增）：`node scripts/probe.mjs --session <名> [--as <sel>] [--text] [--limit N]`
在真实页面上**只读** dump 结构，输出 `containers[]`（候选容器 + `nested` 套娃数）与
`types[]`（类型 token 的子树特征），供人整理成注册项。**不推荐、不打分、不写回 adapters.js** ——
理由是"猜一个"的代价是静默填错，那是本项目历史上最贵的一类失败。
默认不输出任何页面文本（`--text` 才输出并打 stderr 警告）。
回归在 `tests/probe.test.mjs`（3 例）；裁定过程与"为什么这么薄"见 `docs/plans/07-probe-tooling.md`。
**它不是 R5 `probeEnv`**：开发期工具，不进注入到用户浏览器的 bundle，不参与填写。
