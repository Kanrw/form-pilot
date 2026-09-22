# 05 · 执行路线与架构（终版）

> 依据：`00`–`04` 四份规划与审查 + `AGENTS.md §二 工作纪律`（stop-that-shit）。
> 用户决策（2026-09-22）：**引擎自动加行**（R2 进 v0.1.0）；**桥接优先**（先验最大风险）。
> 本文取代 00 的路线图与 03 的实施清单；冲突时以本文为准。

## 一、前提与前提崩塌

**本计划假定两件事成立：**

1. Kimi WebBridge daemon 可运行，且用户浏览器扩展能连上（`extension_connected:true`）。
2. `mokahr.com` 的 CATL 校招申请页仍可公开访问，DOM 未改版。

**若前提 1 不成立**：Phase 1 与 Phase 2 的验收全部无法完成。**只有 Phase 3（文档、分发、仓库骨架）
能独立落地。** 因此 Phase 3 的内容全部与桥接解耦，可在桥不可用时前移。
不假装完成，不伪造验收——桥不可用就在报告里写明停在哪一步。

**若前提 2 不成立**（Moka 改版）：走 `02` §二⑥ 的失效学习闭环重新探测；本计划的 ID 方案与
addRow 设计不受站点改版影响（选择器全在适配器里，引擎零改动）。

**当前实测状态**（2026-09-22 11:29）：daemon `running:true`（pid 17130）／
`extension_connected:false` —— **等用户打开浏览器并确认扩展已启用**。

## 二、范围

**做**：Moka 单站点端到端——注入引擎 → 扫描 → 字段映射确认 → 批量填文本 → 逐个下拉 →
按需加经历行 → 全量回读 → 停在提交前。加上可分发形态（skill 包）与回归测试。

**不做**（明确出界）：

| 项 | 原因 |
| --- | --- |
| R3 `setChoice` / 菜单"确定"钩子 | 需北森实测；Moka 的"是否"是下拉，`pickOption` 已覆盖（§2.4） |
| R4 `fillDate` 试探 | Moka 日期当前策略即留手动（§2.4）。**仅类型标注进 v0.1.0**，见 §四 D-7 |
| R5 `probeEnv` / shadow DOM / iframe 穿透 | 无真实漏扫事故（§2.4） |
| R8 版本守卫 / `_busy` 运行锁 | 无二次注入或并发调用事故（§2.4） |
| R9 `snapshot` / `setPlan` / `diff` | 无真实联动事故；回读核对由 `readAll` + 外层对比完成（§2.4） |
| beisen 实测、其他站点适配器 | 需登录，只能在使用中学（`02` §一） |
| 文件上传接口 | 走桥的 `upload` 动作，引擎不实现（引擎拿不到 File 对象） |
| 批量投递 / 绕过验证 / 代提交 / 猜测无来源字段 | 项目身份（AGENTS.md §一） |
| 打包器 / TypeScript / 覆盖率工具 / Playwright / CI / npm 发布 | `03` §3、§4、§8 |
| scan/readAll 分页 `{offset,limit}` | 无返回值截断事故；分页反而让外层必须多轮拼装（§2.4 R7 的分页部分） |

## 三、架构

### 三层

```text
skill/    分发形态：SKILL.md(边界+流程) + references/{engine.js,adapters.js}=生成物 + usage.md + kimi-webbridge.zh-CN.md
engine/   代码唯一事实源：engine.js(→window.__ja) + adapters.js(→window.__jaAdapters)
scripts/  胶水：status / inject / capture-fixture / sync-skill（零三方依赖 .mjs）
tests/    jsdom 纯逻辑 + manual-e2e 人工清单
```

### 运行时数据流

```text
   用户浏览器（已登录，扩展已启用）
        ▲  │ CDP
        │  ▼
   kimi-webbridge daemon  127.0.0.1:10086
        ▲  │ HTTP POST /command  {action,args,session}
        │  ▼
   scripts/inject.mjs ──读──> engine/engine.js + engine/adapters.js
        │                       （拼一个字符串，一次 evaluate）
        ▼
   LLM 按 skill/ 流程驱动：scan → 映射表(用户确认) → fillTexts/pickOption/addRow → readAll
        ▲
     用户资料卡（本地文件，用户指定，不入库）
```

四个组件交换数据，无环：页面 → daemon → inject.mjs → LLM → （用户确认）→ 页面。

### 注入模型

**一次 `evaluate` 注入全部。** `inject.mjs` 读两个文件拼成一个字符串，末尾追加一行
`__ja.use(__jaAdapters[name] || __jaAdapters[__ja.detect()])`。

- 全量约 10–12KB，无 evaluate 长度问题。
- 幂等：`engine.js` 是 `(() => { if (window.__ja) return 'already loaded'; ... })()`；
  `adapters.js` 是 `window.__jaAdapters = window.__jaAdapters || {...}`。
- **否决的替代**：分块注入（engine 先、adapters 后）。只在长度受限时才需要，收益为零。

## 四、关键决策

**D-1 · ID 方案。** `blockKind[rowIndex]>>label`；无区块归属的字段用 `main>>label`。
`index` 为同 kind 容器在 DOM 中的序号（0 起）。区块由适配器 `blockSels` 向上 `closest` 判定。
理由：加行只改变该区块内的行数，`edu[0]>>学校名称` 在添加 `edu[2]` 后仍指向原字段。
`scan()` 因此必须**同时输出 `id` 与 `block`/`label`**，否则给用户看的映射表无法分组。

**D-2 · addRow 的可靠性（本项目最脆的一段）。** 按文本找"添加"按钮会命中祖先元素或同文案的
说明文字。三条约束固定下来：

1. 候选限定为可点击元素：`button, a, [role=button], [class*=btn], [class*=Button]`；
2. 多重命中时取 `textContent` **最短**的那个（最内层），不取 DOM 序第一个；
3. **用效果验证，不用点击返回验证**：先记区块容器数，点击后轮询 up to 3s 等计数 +1；
   未增加则 `{ok:false, err:'row-not-added'}`。同一按钮最多点 1 次，不重试。

**D-3 · 菜单归属（R1 最小版）。** 原型里两处必须改：

- 删掉 `|| this.visibleMenus().pop()` 兜底——它会把常驻菜单/残留菜单当目标。找不到就返回
  `{ok:false, err:'menu-not-open', hint:'fallback-cdp'}`，好过选错菜单。
- `before` 用 `Set` 存、用 `!before.has(m)` 判定新出现（严格区分"新弹出"与"常驻"）。

**不做** `closeAllMenus()` 与几何 `nearest()`：残留菜单本就落在 `before` 里被差集排除，
两者都找不到可命名的失败（§2.3）。

**D-4 · 写读同调用的事务性。** 保留原型"写 → 等 → 复读 → 吞值就重填"，但修正原型的结构性缺陷：
原实现重填后**立即同步读值**，必然等于刚写入的值，`ok` 恒真、`retried` 恒报成功。
现固定为：`写 → 同步读 → sleep 600 → 复读 → 不一致则重写 → sleep 400 → 再读 → 定 ok/retried`。
**删掉 `unchanged` 桶**——引擎无法区分"值被联动改写"与"值没写进去"，不可实现。
不整体回滚：表单填写无原子性，逆向触发联动比正向更危险，且用户有核对闸门。

**D-5 · 版本号单一来源。** 一个号，三处写入：`engine/engine.js` 的 `__ja.version`、
`skill/SKILL.md` frontmatter `version:`、`CHANGELOG.md` 最新条目。`sync-skill.mjs --check`
断言三者相等，不等则退出码 1。首版 `0.1.0`。
**否决的替代**：引擎版本与项目版本分两条轨——多一个概念、零收益，且是 04 审查 U4 的成因。

**D-6 · 桥接健康检查独立成脚本。** `status.mjs` 的命名失败：`running:false`（缺 daemon）与
`extension_connected:false`（缺浏览器/扩展）是**两种不同故障、两种不同修法**，
而 `inject.mjs` 的 curl 报错无法区分。故保留独立脚本。
实测状态字段（2026-09-22 取自 running 态）：
`extension_connected, extension_id, extension_version, port, running, skills[], update_available{}, uptime_seconds, version`。

**D-7 · R4 拆两半。** 只有**类型标注**进 v0.1.0（约 2 行）：`scan()` 对 container class 含
`day_info`/`date-picker` 的字段标 `type:'date'`，含 `cascade`/`area` 的标 `type:'cascade'`。
命名失败：日期控件被当成下拉 → 外层调 `pickOption` 打开日历面板 → 检测失败，白跑一轮。
`fillDate` 试探本身按 §2.4 推迟。日期/级联字段自动落进"待用户手动"清单，**零额外代码**。

**D-8 · 注入与模块系统解耦。** 测试用 `dom.window.eval(fs.readFileSync('engine/engine.js'))`
加载引擎，不 `import`。因此 `package.json` **不设 `type` 字段**，引擎的 `.js` 永不被 Node 加载。

## 五、接口契约（v0.1.0）

```js
__ja.version                                   // '0.1.0'
__ja.use(adapter)                              // → adapter.name
__ja.detect()                                  // 'moka' | 'beisen' | 'generic'
__ja.scan()                                    // → JSON {total, fields:[{id,block,label,type,required,value}]}
__ja.addRow(kind)                              // → JSON {ok,kind,from,to} | {ok:false,err:'row-not-added'}
__ja.fillTexts(map)                            // → JSON {ok:number, failed:[...], retried:[...]}
__ja.pickOption(id, text, {search=true})       // → JSON {ok,value} | {ok:false,err,available:[...]}
__ja.readAll()                                 // → JSON [{id,label,type,value}]
```

- `type` 枚举：`text | textarea | file | select | date | cascade | choice | unknown`。
  `fillTexts` 只处理 `text`/`textarea`，其余跳过并在报告里归类。
- `failed` 元素：`{id, phase:'locate'|'fill'|'verify', err, attempted, final}`。
- 返回值一律 `JSON.stringify` 无空格；**所有**字符串字段截断 200 字符（含 `attempted`/`final`）。
- 内部方法命名（固定，不许现编）：
  `fields() / labelOf(box) / typeOf(box) / blockOf(box) / findField(id) / visibleMenus() /`
  `menuItems(menu) / readSelect(box) / setNativeValue(el,v) / synthClick(el) / norm(s) / sleep(ms)`。

## 六、Phase 划分

每个 Phase 独立可合并；任一 Phase 落地后系统都处于可用状态。

### Phase 1 · 骨架 + 引擎可注入

**交付物**

| 文件 | 内容 |
| --- | --- |
| `.gitignore` | `.DS_Store`、`node_modules/`、`tests/fixtures/raw/` |
| `package.json` | `name/private/version:0.1.0`、`scripts.test="node --test tests/"`、`devDependencies:{jsdom:"^30.1.1"}`、**不设 `type`** |
| `engine/engine.js` | 从 `references/engine.md` 原样抽取 + 版本头 + D-1/D-3/D-4/D-7 的改动 |
| `engine/adapters.js` | 从 `references/adapters.md` 抽取，改 `window.__jaAdapters = window.__jaAdapters \|\| {...}`，补 `verified`/`source` 元数据 |
| `scripts/status.mjs` | 解析 CLI JSON → 精简输出，区别报两种故障 |
| `scripts/inject.mjs` | 读两文件拼串 + `__ja.use(...)`，POST 一次 evaluate；`--session`、`--adapter` |
| `AGENTS.md` 修订 | §六 去掉 `offset/limit`；§七 补 D-1 的分支规则；§四 改写为实测状态 |
| git | 首次提交（当前仓库零提交） |

**验收**

```bash
node scripts/status.mjs        # → {"ok":true,"running":true,"extension_connected":true,...}
node scripts/inject.mjs --session form-v01
# → {"ok":true,"adapter":"moka","engine":"loaded"}
```

在真实 Moka CATL 页紧跟一次 `__ja.scan()`，返回字段清单；重复的 `edu[0]>>学校名称` /
`edu[1]>>学校名称` 前缀正确出现；日期字段标 `type:'date'` 而非 `select`。

**独立可用性**：即使后续全不做，这一步已经能"读出任意表单的字段结构"，有实际价值。

### Phase 2 · 填写闭环（Moka 端到端）

**交付物**

| 文件 | 内容 |
| --- | --- |
| `engine/engine.js` | 补 `fillTexts` 报告格式、`pickOption` 菜单归属修复、`addRow`（D-2）、`readAll` |
| `scripts/capture-fixture.mjs` | evaluate 抓最大 form（退化 body）的 outerHTML → `tests/fixtures/raw/<site>-<date>.html`，stderr 提醒脱敏 |
| `tests/helpers/jsdom-setup.mjs` | `offsetHeight` defineProperty 返回非 0；`scrollIntoView` 空函数桩 |
| `tests/engine.test.mjs` | 4 例，见 §七 |
| `tests/fixtures/moka.html` | 由 capture-fixture 产出，**人工脱敏后**入库 |
| `tests/manual-e2e.md` | 真实浏览器回归清单（时序类无法进 jsdom 的部分） |

**验收**：真实 Moka CATL 页走完 `scan → 映射确认 → fillTexts → 逐个 pickOption → addRow → readAll`，
**停在提交按钮前，未提交**；`npm test` 全绿。

**独立可用性**：项目目标达成——能替用户填完一份申请表。

### Phase 3 · 分发与文档

**交付物**：`scripts/sync-skill.mjs`（含 `--check` 三版本号断言）；`skill/` 自包含
（`SKILL.md` 改指向 `references/engine.js`+`adapters.js`+`usage.md`；`references/usage.md` 承接原
md 里的散文；`kimi-webbridge.zh-CN.md` 从 v1 复制）；`README.md`；`LICENSE`（MIT + ASu-skills 上游署名）；
`CHANGELOG.md`（首条 0.1.0）；`docs/guide-v2.md`；v1 指南加存档指向行。

**验收**：`node scripts/sync-skill.mjs` 后 `~/.config/opencode/skills/job-apply-v2/` 完整，
opencode 里 `/job-apply-v2` 可唤起；`--check` 无 drift。

**独立可用性**：别人 `clone` + 一条命令即可用。

## 七、提测与验证

**jsdom 4 例**（纯逻辑，DOM 形状不必faithful）：

1. `detect()` —— 含 `[class*=apply-field]`+`[class*=sd-Input]` → `'moka'`；空 DOM → `'generic'`。
2. `scan()` ID —— 有区块容器 → `edu[1]>>学校名称`；无区块容器 → `学校名称#2`（降级路径）。
3. `fillTexts()` —— native setter 写值可回读；报告 shape 为 `{ok,failed,retried}`。
4. `findField()` —— 按 `edu[0]>>学校名称` 与 `学校名称#2` 均能定位。

**失败路径必须覆盖**：`findField` 落空 → `failed.phase='locate'`；非文本字段 →
被跳过并在报告归类；`pickOption` 三种失败 err 各一例。

**人工 e2e**（`tests/manual-e2e.md`，每个适配器一节，发布前跑）：
开页 → inject → scan（识别率 ≥90%、必填标记无漏）→ 批量填 → **连续 5 个下拉无错菜单** →
addRow → readAll → 截图 → 停在提交前。

**命令**：`npm test`（= `node --test tests/`）。不引覆盖率工具。

## 八、回滚

- 引擎是内存态，刷新页面即消失，零持久化 → 填错不影响任何站点数据。
- 首次提交后，任何改动可 `git checkout` 回退；`--check` 在提交前拦住生成物漂移。
- 部署到 `~/.config/opencode/skills/job-apply-v2/` 是整树覆盖，回滚 = 重新 sync 上一版。
- 无数据迁移，无外部状态变更（不提交表单、不写用户文件）。

## 九、共享成本与文件增量

**+18 个文件**（4 scripts、2 engine、4 tests、6 顶层 md/license、1 package.json、1 本文档）。
**+1 条命令**（`npm test`）。**+0 个服务**（桥是既有的）。**+0 个环境变量**
（`BRIDGE_URL` 可选覆盖，默认 `http://127.0.0.1:10086/command`）。
**+0 个凭证/账号**：桥不需要 API key；Moka 用用户自己的浏览器会话。
超过 8 文件门槛，此处显式声明。

**Simplest path 对照**：蛮力版是"一个 .js 文件，每次手粘进 evaluate，不建仓库、不写测试"。
本方案多出的三样各自对应一个命名失败：scripts → 每次手粘 10KB 易错且无法校验；
jsdom 测试 → 改引擎后不知道有没有回归；git → 误改不可恢复。

## 十、唯一的待填空（阻塞原因与预决分支）

> **已于 2026-09-22 解决**：桥接恢复后跑了只读探针，结果走"找到区块容器"分支。
> 真实结构、真实选择器与三条实测校正记录在 `AGENTS.md §五`、`§七`；
> 本节保留当时的决策过程与预决分支，作为"为什么这样选"的依据。

**缺什么**：Moka 的区块容器真实选择器 + 加行按钮真实文本（`blockSels` / `addRowText` 的值）。
**为什么缺**：`extension_connected:false`，扩展未连，无法探测真实 DOM。04 审查 U1。
**谁负责**：用户打开浏览器并确认扩展启用 → agent 跑只读探针（navigate + dump class，不写任何字段）。

**分支已预决，执行时不需要重新决策方向：**

| 探测结果 | 走法 |
| --- | --- |
| 找到教育/工作经历各自的 wrapper 容器 | `blockSels` 填真实选择器，ID = `blockKind[i]>>label`，addRow 按 D-2 实现 |
| 字段平铺、无区块容器 | **R2 降级**：ID 用 `label#k`；addRow 仍按 D-2 实现（按钮文本 + 计数验证）；限制写成硬约束——**加行必须在 scan 之前完成**，写入 `SKILL.md` 与 `AGENTS.md §七` |

两条路的引擎代码差异只在 `blockOf()` 一个函数（返回 `{kind,index}` 或 `null`），
其余接口与流程完全一致。

## 十一、已知边界（记录，不预先设计）

- **返回值规模**：字段数到 ~10x（600 字段）时 `scan()` 返回值可能触顶。不做分页（§二）。
  求职表单不会到这个量级；真出现再按 §2.4 解锁。
- **桥可用性是单点**：见 §一。
- **`kimi-webbridge` 有可用升级**（current v2.0.15 → latest v2.0.19）。与本计划无关，
  不影响使用；不处理。
