# form-pilot · 交接文档

> 本文件只记录已发生的事实与决定，不含新规划。后续 agent 请基于此文档继续执行。
> **§二 工作纪律优先于任何规划文档的"顺带做掉"倾向**；冲突时以 §二 为准。
> 最后更新：2026-09-22

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

**桥接状态是当场读数，不是本文件的常驻事实。** 2026-09-22 发生过两次状态反转（10:11 daemon 被终止、
11:35 恢复）——**每次使用前必须重新 `status`，不得引用任何历史值**。

**session → tab 绑定是易失的。** 实测：tab 关闭后同一 session 的 `evaluate` 直接报
`session "x" tab was closed — navigate first to recreate`。所以每个 session 的第一步永远是 `navigate`。
`inject.mjs` 不负责导航，它只注入。

**status 在 running 态的完整字段**（2026-09-22 实测）：
`extension_connected, extension_id, extension_version, port, running, skills[], update_available{}, uptime_seconds, version`。
`running:false`（缺 daemon）与 `extension_connected:false`（缺浏览器/扩展）是两种故障、两种修法。

## 五、适配器注册表

文件：`engine/adapters.js` —— **已落盘**（IIFE 挂 `window.__jaAdapters`，幂等）。三个注册项：

| 适配器 | verified | source | fieldSel |
| --- | --- | --- | --- |
| `moka` | `2026-09-22` | CATL 校招申请页（只读探测） | `[class*=apply-field-]` |
| `beisen` | `null` | `docs-only` | `.form-item` |
| `generic` | `null` | `builtin` | 空（走引擎默认：input 就近容器） |

**moka 的选择器（实测）**：

```
fieldSel         [class*=apply-field-]     ★ 尾横线不可省，见下
labelSel         [class*=title]
menuSel          [class*=sd-Select-menu],[class*=sd-Menu-container]
itemSel          [class*=sd-Menu-content-item]
valueSel         [class*=sd-Input-display-value]
blockSectionSel  [class*=apply-block-]     区块
blockGroupSel    [class*=apply-fields-]    行分组（行索引来源）
addText          '添加'
typeMap          string_info→text / select_info→select / bool_info→select /
                 Select→select / multi_select_info→select / day_info→date /
                 date_info→date / location_info→cascade / confirm_info→choice /
                 file_upload→file / portrait_upload→file / custom_file_upload→file
blockSections    edu 教育背景 / intern 实习经历 / proj 项目经验 / scholar 获奖学金经历 /
                 campus 校内活动经验 / paper 核心期刊论文发表 /
                 patent 个人专利/发明 / contest 竞赛经历 / skill 技能/爱好
```

**三条实测校正（2026-09-22，别再退回）**：

1. **`fieldSel` 的尾横线**。裸 `[class*=apply-field]` 会同时命中 16 个复数行分组容器
   `apply-fields-*`，把 wrapper 当字段（实测真字段 49 个 → 误报 65 个）。
2. **`bool_info` 是下拉，不是文本框**。它是 `sd-Select-container` + `sd-Input-display-value`，
   且 input **不是** readonly → 引擎的启发式（类名含 select？占位符含"请选择"且 readonly？）
   两条都落空 → 会误判成 `text` → 往下拉输入框写值不生效且不报错。所以必须走 `typeMap`。
   `location_info`（籍贯）同理曾是漏网之鱼。
3. **加行按钮的文本是"添加"两个字，页面上 6 个按钮全叫这个**。规划里写的
   `addRowText: '添加教育经历'` 不存在于 DOM。按文本匹配必然选错，只能区块内定位；
   `addRow` 用"区块内定候选 → 取文本最短者 → 行分组计数 +1 验证"（见 §六 内部方法表）。

**北森**（来自 v1 指南，未实测）：单选是 `div.phoenix-radio`；多选样式 `.list-item-container`，
选完要点面板内"确定"（`.phoenix-button`）才生效；菜单 portal 在 body 底部的
`.common-unmodeled-layer`（取高度>100 的可见者）。
**刻意不声明 `blockSections` / `typeMap`——没有真实探测就没有依据。**
这两项属 R3，按 §2.4 推迟到首次实际使用。

## 六、引擎 API

文件：`engine/engine.js` —— **已落盘**。全部挂 `window.__ja`，单文件 IIFE，幂等。
标 ⏸ 的条目按 §2.4 推迟：**触发条件出现前不实现，也不在 engine.js 里留占位或骨架。**

```
__ja.version                                   → '0.1.0'（三处一致，见 §十 同步方案）
__ja.use(adapter)                              → adapter.name（Object.assign，可重复调用）
__ja.detect()                                  → 'moka' | 'beisen' | 'generic'
__ja.scan()                                    → {total, fields:[{id,block,label,type,required,value}]}
__ja.readAll()                                 → [{id,block,label,type,value}]
__ja.addRow(kind)                              → {ok,kind,from,to,added} | {ok:false,err:'section-not-found'
                                                  |'add-button-not-found'|'row-not-added'|...}
__ja.fillTexts(map)                            → {ok:number, failed:[{id,phase,err,attempted,final}],
                                                  retried:[id]}
__ja.pickOption(id, text, {search=true})       → {ok,value} | {ok:false,err:'field-not-found'
                                                  |'menu-not-open'|'option-not-found'|'item-detached'}
__ja.fillDate(id, 'YYYY-MM-DD')                → {ok,wrote,after,unfilledInputs} | {ok:false,err:
                                                  'field-not-found'|'not-a-date-field'|'bad-ymd'
                                                  |'no-date-inputs'|'input-count-mismatch'
                                                  |'readonly-unverifiable'|'not-stuck'}
⏸ __ja.probeEnv()      ⏸ __ja.snapshot()      ⏸ __ja.setPlan(ids)
⏸ __ja.setChoice(id,v) ⏸ __ja.diff()
```

- `type` 枚举：`text | textarea | file | select | date | cascade | choice | unknown`。
  `fillTexts` 只处理 `text`/`textarea`，其余跳过并在 `failed[].err` 里归类为 `not-text:<type>`。
- **日期字段多为"年/月/日"若干文本框，不是下拉 —— 先试直填，别默认走 `pickOption`。**
  缺月份的按用户规则用 `01`（`2022` → `2022-01`），补了什么在 `assumed` 里报出。
  区间字段只填起始、结束留空即"至今"，未填个数在 `unfilledInputs` 里报出。
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
`isRequired / entries / findField / visibleMenus / menuItems / matchItem`

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
| **上传简历触发站内解析** | **已实测（2026-09-22 Moka）**：教育经历 1 → 3 行、项目经验 1 → 3 行，字段总数 49 → 56 → 68；解析器还会**覆盖已填字段**，清掉了我先填的 `学校名称`／`研究方向`／`是否有项目经验` |

> **硬规则：上传简历是整个流程的第一步。** 等解析跑完、结构稳定后再 scan、再填。
> 反过来做，等于把自己刚填的内容交给解析器覆盖。解析是异步的，实测 12 秒后仍在变动。

**未验收**：`addRow` 之后的 ID 稳定性（加一行 → 出现 `edu[1]>>` 且 `edu[0]>>` 不变）。

## 八、故障降级链

合成事件 → CDP 坐标点击（`Input.dispatchMouseEvent`）→ 列入"待用户手动清单"
（不在一个控件上反复重试）。

## 九、项目结构

**已落盘**（Phase 1）：`.gitignore`、`package.json`、`engine/engine.js`、`engine/adapters.js`、
`scripts/status.mjs`、`scripts/inject.mjs`、`tests/` 两个 0 字节占位。
**尚未**（Phase 2/3）：`skill/`（当前只有空的 `agents/`、`references/` 目录）、`tests/engine.test.mjs`、
`tests/fixtures/`、`scripts/sync-skill.mjs`、`scripts/capture-fixture.mjs`、README / LICENSE / CHANGELOG、
`docs/guide-v2.md`。

```
form-pilot/
├── README.md / LICENSE(MIT+上游署名) / CHANGELOG.md    ← Phase 3
├── AGENTS.md / .gitignore / package.json               ← 已落盘
├── engine/               # 代码唯一事实源                        ← 已落盘
│   ├── engine.js         # 单文件IIFE，挂 window.__ja
│   └── adapters.js       # IIFE幂等挂载 window.__jaAdapters（含 verified 日期）
├── skill/                # 技能包（自包含可分发）                ← Phase 3
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── references/
│       ├── engine.js     # 【生成物】sync 复制，禁手改
│       ├── adapters.js   # 【生成物】同上
│       ├── usage.md      # 手工维护散文
│       └── kimi-webbridge.zh-CN.md  # 从 v1 复制
├── scripts/
│   ├── status.mjs        # 桥接健康检查（区分两种故障）           ← 已落盘
│   ├── inject.mjs        # 读engine+adapters拼字符串，POST一次evaluate  ← 已落盘
│   ├── sync-skill.mjs    # engine/ → skill/references/ → ~/.config（单向，含GENERATED头）  ← Phase 3
│   └── capture-fixture.mjs  # 抓当前页表单outerHTML               ← Phase 2
├── tests/                                                        ← Phase 2
│   ├── engine.test.mjs   # node:test + jsdom
│   ├── helpers/jsdom-setup.mjs  # offsetHeight/scrollIntoView桩
│   ├── fixtures/         # 脱敏HTML（raw/进.gitignore）
│   └── manual-e2e.md     # 真实浏览器回归清单
└── docs/plans/           # 00-05：规划、审查、执行路线
```

## 十、同步方案（唯一事实源）

采用构建脚本单向同步（方案C）：`scripts/sync-skill.mjs` 把 `engine/*.js` 复制为
`skill/references/*.js`（注入 GENERATED 头，禁手改），生成物提交进 git，
再整树部署到 `~/.config/opencode/skills/job-apply-v2/`。`--check` 只 diff 不写。

## 十一、进度与下一步

**路线图的唯一事实源是 `docs/plans/05-execution-architecture.md` §六**（三个 Phase，各自独立可合并）。
本节只记进度，**不重复那份列表**——两份执行清单必然漂移。

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
| `npm test` | 6/6 通过（detect / scan 字段数与单射 / 区块前缀与类型 / fillTexts 分类 / 行级定位 / main 重名） |
| `node scripts/capture-fixture.mjs --session … --site moka` | `{"ok":true,"fields":59,"pageFields":59,"rootTag":"BODY"}` |
| 真实页受控写（批量填 + 下拉 + 加行 + 回读） | **未做** |

**受控写必须用户在场监督**，且停在提交前。它是 Phase 2 的真正完成判据，
`tests/manual-e2e.md` 的 moka 一节就是它的清单。

`package.json` 的 `scripts.test` 从 `node --test tests/` 改成 `node --test`：
Node 22 把路径参数当模块加载，报 `Cannot find module '…/tests'`。03 §4 里写的调用形式是错的。

### Phase 3 · 分发与文档 —— 未开始

与桥接完全解耦。桥不可用时它就是唯一能推进的部分。

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
