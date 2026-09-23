# form-pilot · 交接文档

> 本文件只记录已发生的事实与决定，不含新规划。后续 agent 请基于此文档继续执行。
> **§二 工作纪律优先于任何规划文档的"顺带做掉"倾向**；冲突时以 §二 为准。
> 最后更新：2026-09-23

## 一、项目身份

- 名称：form-pilot
- 路径：`~/Documents/FindAJob/form-pilot/`
- 目的：浏览器表单自动填写引擎（求职申请），LLM 在循环外，循环内全是确定性 JS
- 生态位：Simplify 式 autofill（快但笨）与 Skyvern/browser-use 式 agent（聪明但贵）之间
- 不做：批量投递、绕过验证、替用户提交、替用户猜测无来源字段

**隐私边界（硬规则，不可放松）**

本项目目标是公开分发，所以个人数据与项目资产必须物理隔离：

- 真实个人信息只放 `private/`（已在 `.gitignore`）。**不要放进 `data/`** ——
  本机 `~/Documents/FindAJob/resume/data/` 是**被提交**的资产目录，同名反义。
- 档案是两个文件：字段定义（含三类分类）在 `tools/profile.schema.mjs`，值在 `private/profile.json`；
  人读镜像与 `--import` 的输入格式是 `docs/profile-template.md`。界面：`node scripts/profile.mjs --ui`。
- 档案还允许有"投放版本"：`private/profiles/<名>.json` 只存差异（`{ overrides }`），基准是 `private/profile.json`。
  **版本能覆盖什么由 `tools/profile.schema.mjs` 的 `OVERRIDABLE_KEYS` 白名单卡死**（当前 9 项：求职意向 8 项 + 自我评价），
  `validateOverrides()` / `writeVersion()` / 界面锁定三处一起挡 —— 放开会让"改手机号"变成"只改了某个版本"，而这是静默的。
- 分类只写 schema，不写进数据文件。`never` 类（证件号码等）在界面上进朱砂虚线围栏，
  且**不进任何映射**：`--render` 与 `GET /api/mapping` 的输出里一项都不许出现，有测试盯着这条。
- 写入路径由代码守着：`scripts/profile.mjs` 与服务端的任何落盘都必须落在 `<root>/private/` 内，越界直接拒绝。
- **推送前必须验证**：`git ls-files | grep -E '^private/'` 输出为空。
  把 profile 内容或附件搬进 `tests/fixtures/`、`docs/`、`CHANGELOG` 同样违规。
- 身份证号、银行卡号、密码、验证码属**永不自动填**：引擎不提供也不接受这类值，
  一律进"待你手动"清单。这条不因"档案里已经写了"而放宽。

  > **待决（2026-09-22）**：首次真实投递后，使用者提出"身份证号码你没帮我填"。
  > 这是**边界本身待他决定**，不是漏填。要放宽的正确做法是
  > **改 `tools/profile.schema.mjs` 里 `basic.idNumber` 的 `autofill` 分类**（`never` → 其它档位），
  > 走既有的三分类机制；**不是给引擎开口子**。在此之前引擎仍按 `never` 处理。
- 引擎**不读** `private/`。它只能通过 `fillTexts(map)` 收到"某字段填某值"，
  而 `字段 → 值` 的映射由用户在对话里确认（三道闸门的第一道）。

## 二、工作纪律（stop-that-shit · 本项目适用条款）

> 来源：用户级 skill `stop-that-shit`（lennney/stop-that-shit，MIT）。
> 用户决策（2026-09-22）：本纪律写入 AGENTS.md 核心，约束本项目全部后续 agent。
> 下面是它在 form-pilot 的落地条款，不是通用文本的复制。

### 2.1 责任先行

动手前先答三问，答不出就不写代码：

1. 本次交付对应哪条规划的哪句验收？
2. 边界在哪（允许改哪些文件/函数，禁改哪些）？
3. 已有的保证是什么（已实测结论、可运行原型）——改动必须保住它。

### 2.2 直接方案优先，按需扩展

- 先找项目里已有的可运行实现。`job-apply-v2/references/engine.md` 里的原型**已经能跑**，
  加固是"改它"，不是"从零重写"。
- 只有当直接方案**漏掉一个具体已存在的东西**时才扩展：具体的输入、具体的消费方、
  具体的失败、具体的义务。**"以后换站点可能要用"不构成理由——假想灵活性不算当前需求。**
- 已有的支持承诺算当前需求（例：六条安全边界、三道闸门、v1 降级链）；
  纯粹的未来灵活性不算。

### 2.3 每一层防御必须对应一个已命名的失败

- 每加一层 try/catch、重试、探测、降级分支，必须能指着说"它挡的是 X 这个已发生或必然发生的失败"。
- 对不上具体失败的层，不写。已经写了但说不清挡什么的，先查清调用路径再决定删不删——
  查不清不等于该删。
- 挡住真实失败的保护要保留，哪怕它让 diff 变大。

### 2.4 本项目已判定的投机性建设（触发前不实现）

以下条目已由 `docs/plans/04-reality-check-2026-09-22.md` 判定为投机建设。
**在"触发条件"出现之前不实现、不写骨架、不写占位接口。**

| 条目 | 触发条件（出现才做） |
| --- | --- |
| R5 `probeEnv` / shadow DOM / iframe 穿透 | 一次真实表单上发现字段被漏扫 |
| R9 `snapshot` / `setPlan` / `diff` | 一次真实联动导致计划外字段变更，且外层 LLM 从 scan/readAll 差异里看不出来 |
| R3 `setChoice` / 菜单"确定"钩子 | 北森（或首个自定义 radio 站点）实际投入使用 |
| R8 版本守卫 / `_busy` 运行锁 | 出现第二次注入或并发调用的真实事故 |

判据一致：**没有真实站点、没有真实事故，就没有需求。**

> **已解锁并实现**：R4 `fillDate`（2026-09-22）。触发条件由用户直接给出——
> 原始条件是"Moka `day_info` 实测证明可直接输入"，用户的指示更宽："很多网页的表单，
> 特别是时间表单，可以直接填写而不用下拉"；并给了缺省规则：**只有年份没有月份的，先用 `01` 填**。
> 实现见 §六。它不再属于本表。

### 2.5 交付物聚焦

- 报告只写：结果、必要后果、验证证据。
- 不写未被要求的告诫性段落，不把内部过程笔记写进交付物。
- 不确定的结论要收窄或标注来源，不要用免责声明包围；警告只在
  "它改变读者如何使用结果"时给出。

### 2.6 任务模式

- `review` / `answer`：只读。不改文件。
- `change`：只做被要求的改动及其必要后果。
- 必要后果不覆盖明确的文件锁或更窄的边界；要越界先说明。

### 2.7 完成即止

结果存在 ＋ 所需证据支撑 ＋ 无已知范围内阻塞 ＝ 完成。
**不要再加一轮审计循环来"满足纪律"**；复验要复用仍然有效的证据，不重复已通过的检查。

### 2.8 双 agent 执行-监督（用户决策，2026-09-23）

- 现场执行类任务（表单填写、桥接会话等有卡死/循环风险的实操）**必须双 agent**：一个执行，一个监督。
  根因：执行者自己监工自己，轮次必然失控（2026-09-23 北森会话实测：同参数重试 3 次、payload 混用、
  heredoc 变体踩坑，全部无外部否决点）。
- 执行者每步向监督者发 ≤3 行状态（动作 / 结果 / 计数）；监督者只在违规或预算到点时发声，沉默 = 放行。
- 监督者四条红线，触发即强制叫停，执行者不得以"再试一次"抗辩：
  1. 同一类失败第 3 次 → 预警；第 6 次 → 强制跳过归类（manual / 待手动）；
  2. 同一探测读数连续 3 次不变 → 判卡死，换路径或归类；
  3. 同参数重试同一失败动作最多 2 次，第 3 次禁止；
  4. 会话总预算 5 分钟，到点强制收尾出三清单（已填 / 待手动 / 待确认）。
- 监督者不可用时，执行者降级为自带计数器（红线 1/3/4 仍生效）——监督是加强，不是单点依赖。
- 纯文档 / 代码任务不强制双 agent：无卡死风险，加了反而违背 §2 的限时哲学。

**监督者怎么起（2026-09-23 CVTE 会话实测踩坑）**：`run_in_background` ≠ 常驻进程。后台 agent 在自己
这一轮无事可做时就结束这一轮——实测 spawn 后 8 秒退出，全程只发了一条"已就位"。要真常驻只有两条路：
① 监督者自己跑阻塞等待循环（sleep 轮询状态文件）；② 执行者每步用 SendMessage 唤醒。
**② 每步多一个完整 agent 轮次，5 分钟预算会被直接吃掉，禁止。**
所以默认形态改为：**执行者自带计数器跑（红线 1/3/4 全生效），只在触线或单步超时时才 spawn 一次
监督者做一次否决判断。监督是闸门，不是常驻心跳。**

### 2.9 改动即提交（用户决策，2026-09-23）

- **一处改动完成就提交 git**，不攒到"告一段落"。理由是多会话接力：未提交的工作区在下一会话
  只剩 diff、看不出意图，还会和别的会话的未提交改动混成一个大杂烩 commit。
- 一个逻辑主题一个 commit。来源不同 / 主题不同的改动必须拆开，哪怕它们同时躺在暂存区里。
- 提交前跑 `npm test`，绿的才提交。
- 提交 ≠ 推送，默认只落本地。推送是另一个动作，且推送前必须验
  `git ls-files | grep -E '^private/'` 输出为空（见 §一 隐私边界）。

## 三、已完成的工作

### 规划阶段（已完成）

规划文档，`form-pilot/docs/plans/`：

| 文件 | 内容 | 行数 |
| --- | --- | --- |
| `00-master-plan.md` | 总体规划框架，收拢 01/02/03 | ~120 |
| `01-engine-architecture.md` | 引擎架构加固（9 项风险 + 接口 + 实施顺序） | 226 |
| `02-adapters-testing.md` | 站点适配与持续学习策略 | ~95 |
| `03-project-packaging.md` | 项目结构、打包与文档 | 152 |
| `04-reality-check-2026-09-22.md` | 实况审查：AGENTS.md/01/02/03 对磁盘、git、桥接实测的逐条核对 | — |
| `05-execution-architecture.md` | 执行路线与架构（终版，取代 00 的路线图与 03 的实施清单） | 279 |
| `06-profile-ui.md` | 个人档案界面：路线 B（本地 Node 服务）+ 方向 A（向导已撤，见 §六）+ 投放版本（§十三 第六轮）；**已实施** | 545 |

### 核心决定（用户决策，2026-09-22）

1. **站点适配不做提前实测**——北森等需登录的系统，AI 无法注册/登录查看表单。
   改为**在使用中持续学习**：现场探测 → 现场适配 → 用后沉淀。
   记录在 `02-adapters-testing.md` §一、§二。
2. 其他决定见 `03-project-packaging.md` §2-§8（同步方案C、单文件IIFE、
   jsdom测试、MIT署名、issue回馈不PR、v1指南保留存档、git仓库化+轻量semver）。
3. **采用 stop-that-shit 纪律**（见 §二）：不做投机性建设，交付物聚焦，完成即止。

### 引擎原型（已验证，Moka 真实页面实测通过）

位置：`~/.config/opencode/skills/job-apply-v2/references/engine.md`
已验证的底层技法：
- native setter + input/change 事件批量填文本，React 重渲染后值保持（已清测试数据）
- 合成 mousedown/mouseup/click 可打开并选中 Moka 下拉菜单（无需 CDP 坐标）
- Moka 选中值显示在 `[class*=sd-Input-display-value]`（input.value 恒为空）
- Moka 字段容器 `[class*=apply-field]`，label 在 `[class*=title]`

**验证时使用的 Moka URL**（用户真实 CATL 校招申请页，仅探测未提交）：
`https://app.mokahr.com/campus-recruitment/<orgSlug>/<orgId>#/job/<jobId>/apply`

### 技能文件（已写入）

`~/.config/opencode/skills/job-apply-v2/`：
- `SKILL.md`（技能主文件，边界+流程）
- `references/engine.md`（引擎代码+用法）
- `references/adapters.md`（适配器注册表草案）
- `agents/openai.yaml`（技能元数据）

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

## 五、适配器注册表

文件：`engine/adapters.js` —— **已落盘**（IIFE 挂 `window.__jaAdapters`，幂等）。四个注册项：

| 适配器 | verified | source | fieldSel |
| --- | --- | --- | --- |
| `moka` | `2026-09-22` | CATL 校招申请页（只读探测） | `[class*=apply-field-]` |
| `beisen` | `2026-09-22` | 粤芯半导体校招申请页（L2+L3 部分，选择类控件未攻克） | `.form-item` |
| `feishu` | `2026-09-22` | 记忆科技校招申请页（只读探测，L3 未跑） | `[class~="atsx-form-item"]` |
| `generic` | `null` | `builtin` | 空（走引擎默认：input 就近容器） |

**feishu 与 moka 的根本差异（2026-09-22 实测）**：类型写在**内部组件**类名上
（`atsx-select-search` / `atsx-date-picker`），字段盒子只有 `atsx-form-item` 一个 token，
且下拉 input 非 readonly —— 启发式的旧两条判据全部落空，typeMap 无从写起（盒子上没有类型 token）。
**引擎为此新增了子树判据**（`heuristicType` 在 cls/readonly 之前查组件类名），
同轮顺带覆盖了 Moka `bool_info` 那类失败。选择器必须用 `~=`（完整词匹配）：
裸 `[class*=atsx-form-item]` 实测命中 156 个节点，真盒子只有 28 个。
字段名事实源是 `<label>`；`[class*=fieldName]` 的 textContent 会混入已填值（"意向城市东莞"）。
「意向城市」「手机号码」是**只读展示**（值来自账号资料，盒内无 input），scan 报 `unknown` 属正确语义。
`起止时间` 是 `atsx-date-picker-period-month` 月区间 —— `fillMonthRange` 的第二个站点。

**moka 的选择器（实测）**：

```
fieldSel         [class*=apply-field-]     ★ 尾横线不可省，见下
labelSel         [class*=title]
menuSel          [class*=sd-Select-menu],[class*=sd-Menu-container]
itemSel          [class*=sd-Menu-content-item]
valueSel         [class*=sd-Input-display-value]
blockSectionSel  [class*=apply-block-]     区块
blockGroupSel    [class*=apply-fields-]    行分组（行索引来源）
rangeSel         [class*=month-range-select]          选择式月区间容器
rangeSelectSel   [class*=sd-Select-container]         区间内 4 个下拉（起始年/月、结束年/月）
addText          '添加'
typeMap          string_info→text / select_info→select / bool_info→select /
                 Select→select / multi_select_info→select / day_info→date /
                 date_info→date / location_info→cascade / confirm_info→choice /
                 file_upload→file / portrait_upload→file / custom_file_upload→file
blockSections    edu 教育背景 / intern 实习经历 / proj 项目经验 / scholar 获奖学金经历 /
                 campus 校内活动经验 / paper 核心期刊论文发表 /
                 patent 个人专利/发明 / contest 竞赛经历 / skill 技能/爱好
```

**四条实测校正（2026-09-22，别再退回）**：

1. **`fieldSel` 的尾横线**。裸 `[class*=apply-field]` 会同时命中 16 个复数行分组容器
   `apply-fields-*`，把 wrapper 当字段（实测真字段 49 个 → 误报 65 个）。
2. **`bool_info` 是下拉，不是文本框**。它是 `sd-Select-container` + `sd-Input-display-value`，
   且 input **不是** readonly → 引擎的启发式（类名含 select？占位符含"请选择"且 readonly？）
   两条都落空 → 会误判成 `text` → 往下拉输入框写值不生效且不报错。所以必须走 `typeMap`。
   `location_info`（籍贯）同理曾是漏网之鱼。
3. **加行按钮的文本是"添加"两个字，页面上 6 个按钮全叫这个**。规划里写的
   `addRowText: '添加教育经历'` 不存在于 DOM。按文本匹配必然选错，只能区块内定位；
   `addRow` 用"区块内定候选 → 取文本最短者 → 行分组计数 +1 验证"（见 §六 内部方法表）。
4. **`menuSel` 的两个选择器是父子关系，不是并列关系。** `[class*=sd-Menu-container]` 命中的是
   每个选项**外层容器**，而它就长在 `[class*=sd-Select-menu]` 面板内部 —— 点开「民族」一个下拉，
   `visibleMenus()` 返回 **59** 个元素（1 个面板 + 58 个单项容器），不是 1 个。
   表征：`pickOption` 失败报告里的 `menus` 字段会报 59，让人以为同时弹了 59 个菜单。
   **修法在引擎侧**（`visibleMenus()` 做"嵌套只留最外层"），**不要删适配器里的
   `sd-Menu-container`** —— 别的下拉形态可能只渲染后者，删了会静默少一类菜单。

**北森实战记录（2026-09-22，粤芯 cansemitech.zhiye.com，L3 部分完成）**：

- **已攻克**：div.phoenix-radio 单选（R3 setChoice，`--checked` 验证）；普通 `.phoenix-selectList`
  下拉结构确认；`.form-item` + `label` 字段盒（与 v1 指南猜的一致）；「添加项目经历」等
  加行按钮是 `sc-jeraig` 叶子 span，**合成 pointer 五件套点叶子才生效**（WebBridge 真实 click
  会被解析到外层容器，点不动按钮）；fillTexts 批填 9/9 全中。
- **未攻克（本会话约 25 轮调用）**：**editable select（`phoenix-select--editable`）全部免疫**，
  覆盖日期下拉（开始/结束时间）与区域级联（籍贯/城市）。实测无效的通道：
  ① native setter + input 事件；② WebBridge 真实 click + key_type；③ CDP `Input.insertText`
  （focus 保持但值不落）；④ CDP `Input.dispatchMouseEvent` 真实坐标按下/抬起；⑤ 合成
  pointer/mouse 五件套（点 input、点 `.phoenix-select__switchArrow` 都不开菜单）。
  区域级联面板（`common-unmodeled-layer` + `area-text-label`）能开但点击只是导航，
  勾选控件是行内 SVG 图标（`area-icon-RadioUnchecked`），同样点不动。
  **结论**：北森选择类字段现阶段一律 manual，不要在会话里反复重试同类通道；
  下一步值得试的只有 `getEventListeners()` 查真实绑定位置 / 组件 state 直调，见 §2.4 R3 余项。
- **站内简历解析器是最大的填充者**：上传 PDF 后自动带入约 60% 字段（姓名/性别/手机/教育三段/
  项目一/技能名与掌握程度/证书区骨架）。引擎的增量价值在解析器不覆盖的部分：
  专业名称 ×3、实习区、加行后的 3 个项目组、全部技能描述——fillTexts 一次调用全中。
  **每个站点的 L3 第一步都是先传简历、等解析、再 rescan**（本页 53→68 个字段）。
- **教育段的港大交换（开始 2024-01）结束时间待使用者确认**，档案无此值，未瞎填。

## 六、引擎 API

文件：`engine/engine.js` —— **已落盘**。全部挂 `window.__ja`，单文件 IIFE，幂等。
标 ⏸ 的条目按 §2.4 推迟：**触发条件出现前不实现，也不在 engine.js 里留占位或骨架。**

```
__ja.version                                   → '0.1.0'（三处一致，见 §十 同步方案）
__ja.use(adapter)                              → adapter.name（Object.assign，可重复调用）
__ja.detect()                                  → 'moka' | 'beisen' | 'generic'
__ja.scan()                                    → {total, fields:[{id,block,label,type,required,value}],
                                                  manual:[{id,type,reason:'adapter-manual'}],
                                                  emptyRequired:[id]}
__ja.readAll()                                 → [{id,block,label,type,value}]
__ja.addRow(kind)                              → {ok,kind,from,to,added} | {ok:false,err:'section-not-found'
                                                  |'add-button-not-found'|'row-not-added'|...}
__ja.fillTexts(map)                            → {ok:number, failed:[{id,phase,err,attempted,final}],
                                                  retried:[id]}
__ja.pickOption(id, text, {search=true})       → {ok,value} | {ok:false,err:'field-not-found'
                                                  |'manual-required'|'menu-not-open'
                                                  |'option-not-found'|'item-detached'}
__ja.fillDate(id, 'YYYY-MM-DD')                → {ok,wrote,after,unfilledInputs} | {ok:false,err:
                                                  'field-not-found'|'not-a-date-field'|'manual-required'
                                                  |'bad-ymd'|'select-based-date'
                                                  |'no-date-inputs'|'input-count-mismatch'
                                                  |'readonly-unverifiable'|'not-stuck'}
__ja.fillMonthRange(id, from, to)              → {ok,from,to,picks,assumed?,displayAfter?} | {ok:false,err:
                                                  'field-not-found'|'not-a-month-range'|'bad-ym'
                                                  |'range-selects-missing'|'select-detached'|'menu-not-open'
                                                  |'option-not-found'|'item-detached'|'display-not-updated'}
⏸ __ja.probeEnv()      ⏸ __ja.snapshot()      ⏸ __ja.setPlan(ids)
⏸ __ja.setChoice(id,v) ⏸ __ja.diff()
```

- **版本号仍是 `0.1.0`，即使接口已经涨过两次**（`fillDate`、`fillMonthRange`）。
  D-5 的三处版本号里有两处（`skill/SKILL.md` frontmatter、`CHANGELOG.md`）是 Phase 3 的交付物，
  目前还不存在。现在单方面把 `engine.js` 提到 `0.2.0`，只会造出一个"三处不一致、
  却没人能跑 `--check` 断言"的状态 —— 版本对齐跟 Phase 3 一起做。
- `type` 枚举：`text | textarea | file | select | date | cascade | choice | unknown`。
  `fillTexts` 只处理 `text`/`textarea`，其余跳过并在 `failed[].err` 里归类为 `not-text:<type>`。
- **3-5 分钟哲学的机制化（2026-09-22 晚，北森复盘三项修复，82 例测试）**：
  1. **manualTypes**（适配器声明，如北森 `['select','date','cascade']`）——scan() 直接把
     这些类型归入 `manual` 清单；pickOption/fillDate 在**入口**即报 `manual-required`
     快速失败，不进入开菜单/等待循环。杜绝"换个通道再试 25 轮"复发。
     `emptyRequired` 只收 manual 之外的空必填，两个清单合起来就是使用者的人工待办。
  2. **复合字段拒绝写入**（修复"报 ok 实际填错"的静默缺陷）：盒内有多个可见 input 且
     适配器未声明 `numberInputSel`（角色选择器）时，fillTexts 报 `composite-field` 拒写，
     一个字节都不落。声明了角色选择器则写入与回读走同一个 `pickInput()`——
     自检不再"两边错到一起"。Moka 手机号未实测类名，**不声明**——它会明确失败而不是静默填错。
  3. **解析值沿用 + 核对**（见 §七修订）：scan 的 `emptyRequired`/`manual` 分组就是
     提交前的核对清单，取代"解析输出一律不用"的旧策略。
- **日期字段多为"年/月/日"若干文本框，不是下拉 —— 先试直填，别默认走 `pickOption`。**
  缺月份的按用户规则用 `01`（`2022` → `2022-01`），补了什么在 `assumed` 里报出。
  区间字段只填起始、结束留空即"至今"，未填个数在 `unfilledInputs` 里报出。
- **但三种形态里有一种是选择式的，`fillDate` 盖不住：「月区间」用 `fillMonthRange`。**
  实测 Moka 的 `date_info` 有**两个变体，同名组件不同下拉数**：
  「就读时间」= 4 个下拉（起始年/月 + 结束年/月，**一个文本框都没有**）；
  「毕业时间（月）」「英语证书获得时间」= **2 个下拉（年 + 月，单月不是区间）**。
  容器类名都是 `month-range-select`。
  `fillDate` 在这类字段上会先往下拉内部的 input 里写字、再报 `display-not-updated` ——
  结论没错（没谎报成功），但控件已被污染。所以 `fillDate` 现在**动手之前**就识别并返回
  `select-based-date`，并指名该用 `fillMonthRange`。
  `fillMonthRange(id, from, to)`：**`to` 传空串 = 单月（只用 2 个下拉）/ 至今**，
  传起止 = 区间（用 4 个下拉）；下拉数不足报 `range-selects-missing` 而不是硬填。
  月份越界（如 `2023-13`）在这一层就 `bad-ym` 拦掉 —— 放过去会走到下拉里报
  `option-not-found`，把排查引向站点改版，而真凶通常是档案里的日期写错了。
- **「学校名称 / 专业名称」是联想输入（type-ahead），不是普通文本框（2026-09-22 实测）。**
  这两个字段下面挂着候选面板。实测看到的内容：
  学校 = `<示例大学>` / `<示例大学>继续教育学院` / `<示例大学>网络教育学院` / `广州城市理工学院`；
  专业 = `<示例专业>` / `物理学` / `没有找到专业？添加专业全称`。
  `fillTexts` 只把文本写进 input，**不从候选里确认**，后果有两层：
  ① 值不被应用正式接受（看着填好了，应用不一定认）；
  ② **候选面板一直挂在页面上** —— 实测使用者因此在操作表单时被反复干扰，
  最后手动清空了 `学校名称` ×2 与 `专业名称` ×1（原话："下拉选项一直浮现"）。
  **正确做法**：写完文本后从候选面板里**点选对应项**让应用确认，然后收起面板。
  `pickOption` 的"点触发器 → 选菜单项"正好是这个动作，但**尚未在联想输入上验证过**。
  注意候选值未必等于档案值（档案写 `<示例专业>（<示例班>）`，候选只有 `<示例专业>`），
  这种不一致不要自作主张改数据，要走确认。
- **级联（如「籍贯」）按 `01 §R4` 既定策略一律 manual**：三级面板 + 异步加载 + 重名地区
  （全国几十个"朝阳区"），自动化收益低风险高。实测它表现为一个 readonly 输入框
  （placeholder `请输入籍贯`），合成点击没能唤出面板 —— 更该留给使用者手动。
- **★ 一个字段盒子里可能有多个 input，「取第一个」是错的（2026-09-22 实测，使用者发现）。**
  Moka 的「手机号码」是 **国际区号（`+86`）+ 号码输入框** 的复合形态。`fillTexts` 写的是
  `box.querySelector(A.textInputSel)` —— **盒子里第一个 input，也就是区号那一个**；
  实测把整个 `<11位号码>` 灌进了 `+86` 的位置。
  更糟的是 `valueOf` 读的也是第一个 input，**写入与回读都指向同一个错的地方**，
  于是 `fillTexts` 报 `ok: true`，**自检完全失效** —— 这是"两边错到一起"的失败，比明确报错危险。
  修法方向：适配器给这类字段声明**角色选择器**（如 `numberInputSel`），按角色定位而不是按序号。
  **未修之前不要往这类复合字段写完整值。**
- **★ 日期字段的形态是站点级差异，必须靠适配器声明，引擎不要猜（2026-09-22 实测三种）**：

  | 站点 · 字段 | 形态 |
  | --- | --- |
  | Moka「就读时间」「毕业时间（月）」「英语证书获得时间」 | **选择式月区间**：`month-range-select`，2 个下拉（单月）或 4 个（区间） |
  | Moka「项目经验 起止时间」 | **年 / 月 / 日 各一个独立框**（区间 = 两组共 6 框） |
  | 北森 | **一个框内完成年月日选择**（单个 picker） |

  本次踩的坑：`scan()` 把「起止时间」报成 `type: 'text'`，我照着当文本框填了
  `2021-09 -- 2024-06` —— 全错。
  **判据：填日期前先看 DOM 里到底有几个框、是不是下拉，不要只看 `type` 字段。**
  `type` 是启发式/类名映射推出来的，它说 `text` 不代表真的只有一个文本框。
- **日期字段最容易撒谎的一点：值可能根本不在 `<input>` 上。**
  实测 Moka `就读时间`：`input.value` 写进去了、重渲染后还在，但应用把真实值渲染在
  `sd-Input-display-value` 里且**那几个是空的** —— 看起来填好了，提交时是空的。
  所以规则是：**字段内存在 display 元素时，一律以 display 为准**（`verifiedBy:'display'`），
  它为空的场景返回 `display-not-updated`；没有 display 元素才回退到 input 比对（`verifiedBy:'input'`）。
  不要用 `readonly:false` 反推"能直填" —— 这个结论我犯过一次，见 04 审查的教训。
- **只读日期控件（如 Moka `出生日期`）一律 `readonly-unverifiable` 转人工**，见 `fillDate` 注释。
- `phase` 枚举：`locate | fill | verify`。
- **文件上传不经引擎**：JS 拿不到 File 对象，走桥的 `upload` 动作，引擎不提供上传接口。
- `scan`/`readAll` **没有分页参数**（§2.4 已删）。返回值超限再说。

**内部方法命名（固定，不许现编）**：
`sleep / norm / trunc / j / setNativeValue / synthClick / fields / labelOf / heuristicType / typeOf /`
`firstTitle / rowIndexOf / sectionOf / sectionByKind / groupCount / readSelect / valueOf /`
`isRequired / entries / findField / visibleMenus / menuItems / matchItem / closeMenus / openMenuFor / chooseIn`

内部规约（不可违反）：
- 元素引用不得跨 sleep 复用（stale 免疫）
- 菜单操作必须串行 —— 由调用方保证；引擎 0.1.0 **不加 `_busy` 锁**（见 §2.4 R8）
- 返回值一律 compact `JSON.stringify`，无空格；**所有**字符串字段截断 200 字符
  （含失败报告里的 `attempted` / `final`）
- `firstTitle` 固定用宽选择器，不用 `A.labelSel`：区块标题的父元素类名各站点不同，
  而标题在 DOM 序上先于区块内字段

## 七、适配器字段 ID 格式

```
<kind>[<rowIndex>]>><label>    # 区块命中（kind 来自适配器 blockSections）
main>><label>                  # 非区块字段
main>><label>#<n>              # 同上，但 label 在同一次 scan 内重复（n≥2）
<label> / <label>#<n>          # 适配器未声明 blockSections 时的降级形态
```

Moka 实测样例（2026-09-22）：

```
edu[0]>>学校名称       edu[0]>>就读时间     edu[0]>>受教育类型    edu[0]>>学历
edu[0]>>院系           edu[0]>>专业名称     edu[0]>>研究方向      edu[0]>>GPA
intern[0]>>是否有实习经历                    skill[0]>>英语等级
main>>推荐码           main>>是否内推        main>>上传简历
```

**4 级结构（实测）**：`apply-blocks-*`(1) → `apply-block-*`(16 个区块) → `apply-fields-*`(行分组)
→ `apply-field-*`(49 个字段)。`kind` 由区块标题前缀匹配 `blockSections` 得出；
`rowIndex` 是该字段所在行分组在区块内的序号（0 起）。

**ID 必须单射。** 它是 `fillTexts(map)` 的 key，重名即静默填错字段。
Plan 01 R2 原本只对 `main` 前缀消歧，实测发现非重复区块之间也可能撞名，故 `main` 分支同样加 `#n`。
**已验收**：Moka 页 scan → `total 49 / unique 49 / duplicate 0`。

**已知的结构变更源（都会让 ID 漂移，必须重新 scan）**：

| 变更源 | 实测影响 |
| --- | --- |
| 站内"添加一行" | 未验收（`addRow` 还没在真实页跑过） |
| **上传简历触发站内解析** | **已实测（2026-09-22 Moka）**：教育经历 1 → 3 行、项目经验 1 → 3 行，字段总数 49 → 67（稳定后；此前记的 56/68 是解析中途的读数）；解析器还会**覆盖已填字段**，清掉了我先填的 `学校名称`／`研究方向`／`是否有项目经验` |

> **硬规则：上传简历是整个流程的第一步。** 等解析跑完、结构稳定后再 scan、再填。
> 反过来做，等于把自己刚填的内容交给解析器覆盖。解析是异步的，实测 **4 秒内**就已稳定
> （旧记的"12 秒后仍在变动"是保守观察）。

### ★ 站内解析输出：逐字段核对后可沿用（用户决策修订，2026-09-22 晚）

> 旧版（Moka 实测后）：「解析的输出一律不用」。北森实战（同日，粤芯）推翻了一刀切：
> 解析自动填对约 60% 字段（姓名/性别/手机/教育三段/项目一/技能名与掌握程度），
> 引擎实际只补解析不覆盖的 22 个文本字段（批填全中）。两个站点数据相反，
> 说明**解析质量是站点变量，不是常量** —— 策略从"不用"改为"沿用 + 核对"。

**规则（3-5 分钟哲学：把轮次花在增量上，不花在重填上）**：

1. 上传简历仍是第一步，等解析稳定后 rescan（字段 53 → 68）。
2. **解析值默认沿用**，不再全量重填。
3. 提交前核对靠 scan 的两个分组（2026-09-22 机制化）：
   `emptyRequired`（空必填，必须处理）+ `manual`（适配器免疫类型，直接归手动）。
   核对动作 = readAll 输出与档案逐字段比对，使用者过目后再提交。
4. **教育行的口径污染警告保留**（Moka 实测）：解析按简历的切法生成行
   （本科/硕博连读/境外交流），档案的切法是（本科/硕士/博士）。
   行切法不一致时**以档案为准重排**，不要围绕解析的切法分析。
5. 日期类解析痕迹仍不可信（Moka 实测：写入的 `01` 被应用解成"暂无选项"，
   input.value 有值、应用侧为空）——日期字段核对时以应用侧显示为准，不看 input.value。

Moka 旧数据留档（89 字段那次）：解析填对 6 个（≈7%）、填错 4 个、
教育三段该填的全空。那次"沿用不划算"的判断在当时成立；机制化之后，
沿用与核对的成本由 scan 分组兜底，不再依赖会话现场判断。

**未验收**：`addRow` 之后的 ID 稳定性（加一行 → 出现 `edu[1]>>` 且 `edu[0]>>` 不变）。

## 八、故障降级链

合成事件 → CDP 坐标点击（`Input.dispatchMouseEvent`）→ 列入"待用户手动清单"
（不在一个控件上反复重试）。

## 九、项目结构

**已落盘**：`engine/`（2）、`scripts/`（6：status / inject / capture-fixture / profile / match / resume-pdf）、
`tools/`（5：档案 schema、I/O、界面三件套）、`tests/`（6：engine.test 11 例、profile.test 34 例、
jobmatch.test、probe.test、resume-pdf.test 6 例、jsdom 桩、fixture、人工清单）、`docs/`（plans 00–06 + profile-template）。
**尚未**（Phase 3）：`skill/` 整个目录、`scripts/sync-skill.mjs`、README / LICENSE / CHANGELOG、
`docs/guide-v2.md`。

```
form-pilot/
├── README.md / LICENSE(MIT+上游署名) / CHANGELOG.md    ← Phase 3，未落盘
├── AGENTS.md / .gitignore / package.json               ← 已落盘
├── engine/               # 代码唯一事实源
│   ├── engine.js         # 单文件IIFE，挂 window.__ja
│   └── adapters.js       # IIFE幂等挂载 window.__jaAdapters（含 verified 日期）
├── tools/                # 个人档案：字段定义 + I/O + 界面（见 §十一 支线）
│   ├── profile.schema.mjs   # 14 区段 / 86 字段位的唯一来源（含三分类与 OVERRIDABLE_KEYS）
│   ├── profile-io.mjs       # 读写 / 校验 / md 导入 / 映射表渲染 / 路径守卫
│   └── profile-editor.html / .css / .js
├── skill/                # 技能包（自包含可分发）                ← Phase 3，未落盘
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── references/
│       ├── engine.js     # 【生成物】sync 复制，禁手改
│       ├── adapters.js   # 【生成物】同上
│       ├── usage.md      # 手工维护散文
│       └── kimi-webbridge.zh-CN.md  # 从 v1 复制
├── scripts/
│   ├── status.mjs        # 桥接健康检查（区分两种故障）
│   ├── inject.mjs        # 读engine+adapters拼字符串，POST一次evaluate
│   ├── capture-fixture.mjs  # 抓当前页表单outerHTML
│   ├── profile.mjs       # 档案 CLI（--init/--import/--check/--render/--versions）+ --ui 本地服务
│   ├── match.mjs         # jobmatch CLI（--fetch/--screen/--sites）
│   ├── resume-pdf.mjs    # ATS 简历 PDF 生成（见 §十三）
│   └── sync-skill.mjs    # engine/ → skill/references/ → ~/.config（单向，含GENERATED头）  ← Phase 3，未落盘
├── tests/
│   ├── engine.test.mjs   # node:test + jsdom，11 例
│   ├── profile.test.mjs  # node:test + jsdom，34 例
│   ├── helpers/jsdom-setup.mjs  # offsetHeight/scrollIntoView桩
│   ├── fixtures/         # 脱敏HTML（raw/进.gitignore）
│   └── manual-e2e.md     # 真实浏览器回归清单
└── docs/
    ├── profile-template.md
    └── plans/            # 00–06：规划、审查、执行路线、档案界面
```

## 十、同步方案（唯一事实源）

采用构建脚本单向同步（方案C）：`scripts/sync-skill.mjs` 把 `engine/*.js` 复制为
`skill/references/*.js`（注入 GENERATED 头，禁手改），生成物提交进 git，
再整树部署到 `~/.config/opencode/skills/job-apply-v2/`。`--check` 只 diff 不写。

## 十一、进度与下一步

**路线图的唯一事实源是 `docs/plans/05-execution-architecture.md` §六**（主线三个 Phase，各自独立可合并）。
个人档案界面是**并行支线**，不依赖桥接，唯一事实源是 `docs/plans/06-profile-ui.md` §八。
本节只记进度，**不重复那两份列表**——三份执行清单必然漂移。

### Phase 1 · 骨架 + 引擎可注入 —— 已完成（2026-09-22）

| 验收 | 结果 |
| --- | --- |
| `node scripts/status.mjs` | `{"ok":true,"running":true,"extension_connected":true}`，exit 0 |
| `node scripts/inject.mjs --session form-v01` | `{"ok":true,"engine":"loaded","adapter":"moka","version":"0.1.0"}`，exit 0 |
| 真实 Moka 页 `__ja.scan()` | `total 49 / unique 49 / duplicate 0`；ID 形如 `edu[0]>>学校名称`；类型经 `typeMap` 映射 |

**已知未验收项**：`addRow` 的"加行后 ID 不漂移"需要一次受控写，属 Phase 2。
`findField` 的定位往返也没在真实页验过（公开 API 没有只读的定位入口，写了就是改表单）——
它进 Phase 2 的 jsdom 用例。

### Phase 2 · 填写闭环 —— 代码已完成，**受控写验收未做**

已落盘：`scripts/capture-fixture.mjs`、`tests/helpers/jsdom-setup.mjs`、`tests/engine.test.mjs`、
`tests/fixtures/moka.html`、`tests/manual-e2e.md`。

| 验收 | 结果 |
| --- | --- |
| `npm test`（engine 部分） | 11/11 通过（detect / scan 字段数与单射 / 区块前缀与类型 / fillTexts 分类 / 行级定位 / main 重名 / fillDate 5 例） |
| `node scripts/capture-fixture.mjs --session … --site moka` | `{"ok":true,"fields":59,"pageFields":59,"rootTag":"BODY"}` |
| 真实页受控写（批量填 + 下拉 + 加行 + 回读） | **未做** |

**受控写必须用户在场监督**，且停在提交前。它是 Phase 2 的真正完成判据，
`tests/manual-e2e.md` 的 moka 一节就是它的清单。

`package.json` 的 `scripts.test` 从 `node --test tests/` 改成 `node --test`：
Node 22 把路径参数当模块加载，报 `Cannot find module '…/tests'`。03 §4 里写的调用形式是错的。

### Phase 3 · 分发与文档 —— 未开始

与桥接完全解耦。桥不可用时它就是唯一能推进的部分。

### 个人档案界面（并行支线）—— Phase 1 + Phase 2 已落地（2026-09-22）

唯一事实源：`docs/plans/06-profile-ui.md`（§八 Phase 划分、§十三 六轮实施记录）。
**与主线完全解耦**：不触碰 `engine/`，不新增 `__ja.*` 接口，`fillTexts(map)` 的契约不变。

表格式的字段清单**不在本文复制**——唯一来源是 `tools/profile.schema.mjs`（14 区段 / 86 字段位）。

| 验收 | 结果 |
| --- | --- |
| `npm test`（profile 部分） | 34/34 通过 |
| `--import` / `--check`（真实档案） | `matchedFields 78`、`notes []`、`errors 0`、`warnings 0`、`completeness 174/184`（第七轮拆 `emergencyContact`、第八轮加 `hobbies` 之后） |
| `--render` 泄漏检查 | `证件号码` 只出现在「待你手动」清单，不进任何值表 |
| 路径守卫 | `<root>/private/` 之外的写入被拒，退出码 1 |
| `--ui` 真实浏览器核对 | 三栏 210/769/240 且无横向溢出；围栏存在含 1 行；完整度 `25/57` 与服务端一致 |

**未做**：窄屏断点（768 / 1024）未实测；`tests/manual-e2e.md` 档案那节的 9 条人工核对
只过了 2 条（#1 三栏比例、#2 朱砂围栏），其余 7 条待补。这 7 条属人工核对，不阻塞主线。

**`private/` 不在本工作区**（gitignored，每个 checkout 各一份 —— `06 §一` 的 F5 就是这条漂移风险）。
真实档案在哪个 checkout 就用 `--root <该处>` 指过去；在别处跑 `--ui` 看到空档状态是正常现象，
不是数据丢了。

### git

分支 `main`。提交粒度按"一个可独立回退的单元"，不按时间：
仓库基线 → engine/ → scripts/ + 文档 → 隐私边界 → Phase 2 测试与 fixture。

**推送前必查**：`git ls-files | grep -E '^private/'` 必须为空。

## 十二、jobmatch 模组（岗位筛选）

独立于引擎的功能模组，2026-09-22 落地并在真实站点跑通。它回答"值不值得投"，
引擎回答"怎么填" —— 两者不共享代码，只通过"筛选结论 → 投放版本 → fillTexts(map)"衔接。

**文件**

| 文件 | 职责 |
| --- | --- |
| `jobmatch/schema.mjs` | 枚举（GATE / STATUS / VERDICT）、文本归一化、JD 门槛线索抽取 |
| `jobmatch/filter.mjs` | 确定性核心：档案→事实、档案→词典、四道闸门、命中、四档结论、排序 |
| `jobmatch/sites.mjs` | 站点注册表（当前 `feishu`，已实测）+ 无匹配时的通用嗅探 |
| `jobmatch/fetch.mjs` | 桥接编排：network start → navigate → list → detail → 解析 |
| `scripts/match.mjs` | CLI：`--fetch` / `--screen` / `--sites` |

**通道是 network，不是 DOM。** 实测原因：记忆科技飞书站的 `.positionItem` 卡片里只有岗位职责，
`requirement`（学历 / 专业 / 年限）完全缺失；而门槛恰恰写在 requirement 里。
直连站点 API 也不行 —— 请求带 `_signature`，缺了会被网关丢到"字节跳动猎头平台"的 fallback 页（状态码还 200）。
所以借页面自己发出的 JSON。`?limit=100` 一次取全 75 条，不需要翻页。

**四道闸门**：地点 / 学历 / 年限 / 专业方向，逐项 `pass / fail / unknown`。
`unknown` 既不淘汰也不放行；任一 `fail` 直接落到"暂不建议投递"，不被命中数加权抵消。
不产出百分比分数（照 asu-skill `job-match` 的规则，伪精确分数是误导）。

**四档结论**：`建议投递`（无 unknown 且命中 ≥2）/ `补充材料后投递`（命中 ≥1）/ `谨慎投递`（无命中）/ `暂不建议投递`（有 fail）。
"已匹配 / 表达缺口 / 证据不足"这类判定需要对着简历原文看，留给对话侧，代码不代劳。

**踩过并已修的三个坑**（各有单测盯着，见 `tests/jobmatch.test.mjs` 的 ★）

1. `splitTerms` 不拆括号时，"<示例研究方向>（半导体缺陷…）"整串进词典 → 词典只剩 2 个词 → 全场 0 命中。
2. 专业门槛正则只写"专业"二字会命中"应用专业方法或工具"这类句子 → HRBP 岗被判专业不符。
   现在前置式必须带显式标签或冒号，后置式认"…等相关专业"。
3. `skills.category`（"编程 / 工具"）进词典 → 75 个岗位里 38 个靠"工具""编程"假命中。现在只用 `content`。

**已知边界（不是 bug）**

- `private/profile.md` 的节编号与 schema 顺序错位（md 第 5 节是技能，schema 第 5 节是实习经历），
  `--import` 会整段错位；当前 `--screen` 是现场导入不落盘，所以技能段与求职意向段为空 →
  词典偏小、意向城市 unknown。CLI 会把这类告警打出来，修档请走 `--ui` 或修正 md 编号。
- 列表接口不含岗位详情页 URL，`/position/<id>/` 实测是 404 页 → `url` 留空，不猜拼法；
  交接靠岗位 `id` + 在页面上打开。
- 词典只来自档案自己写下的词。档案没写的技能不会凭空命中，这是刻意的。

## 十三、ATS 简历 PDF 模组（2026-09-22 落地）

独立于引擎的档案侧模组。背景：多数招聘网站支持「上传简历 → 自动解析 → 回填表单」，
比逐字段灌网页可靠；面向 HR 的排版简历压缩字段导致解析失败，所以生成一份
**完整、未压缩、机器可读**的版本供上传。

| 文件 | 职责 |
| --- | --- |
| `scripts/resume-pdf.mjs` | CLI：`node scripts/resume-pdf.mjs [--version <名>] [--font <ttf/ttc>] [--versions]` |
| `tests/resume-pdf.test.mjs` | node:test 6 例：组装齐全 / 四类排除 / 空姓名报错 / 空区段不出标题 / PDF 抽回比对 / 路径守卫 |

产出 `private/resume/resume-ats.pdf`（投放版本口径为 `resume-ats-<名>.pdf`，复用
`resolveValues` 的基准 ⊕ 覆盖）。依赖：`pdfkit`（运行时生成）+ `pdf-parse`（devDep，测试抽回比对）。

**版式决定**：单栏纯文本流，无表格 / 图片 / 分栏 / 页眉页脚；区段标题用 schema 区段标签；
每个字段都带「标签：值」；日期保持档案原值不缩写；页眉两行放 ATS 高频字段
（性别 / 出生日期 / 政治面貌 / 现居住城市；电话 / 邮箱 / GitHub / ORCID）。
中文必须内嵌带 ToUnicode 的 CJK 字体才能被抽出 —— 候选字体逐个试开
（本机实测 Hiragino / PingFang 的 TTC 未过探测，落到 Arial Unicode.ttf），全败时报错要求 `--font`。

**整段排除（显式决定，不是遗漏）**：never 类（证件号码）、紧急联系人（第三方个人信息）、
常见长文本答案（表单答案不是简历内容）、附件清单（本机路径）。
教育条目头行把 `degree + programType` 合并显示；描述 / 成果保留逐行编号原样。

**验收（2026-09-22）**：`npm test` 88/88；真实档案 152 个非空值（排除上述四类后）逐一比对，
抽回文本 152/152 命中；空区段（实习 / 工作经历）不出标题。输出强制 `<root>/private/` 内，
stdout 只回路径与计数、不回显字段值。
