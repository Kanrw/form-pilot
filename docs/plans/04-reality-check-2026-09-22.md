# 04 · 实况审查（2026-09-22）

> 方法：以磁盘、git、桥接 CLI 的**实测输出**逐条核对 AGENTS.md 与 01/02/03 四份规划的断言。
> 只记事实与判定，不含新规划。
>
> **章节号重映射（2026-09-22 当天）**：AGENTS.md 新增 §二「工作纪律」后整体下移一位。
> 本文所有 `AGENTS.md §N` 已按新编号更新；旧编号映射为 旧二→新三、旧三→新四、
> 旧四→新五、旧五→新六、旧六→新七、旧十→新十一。审查结论本身未改动。

## 一、总判定

1. **文档齐全，代码为零。** AGENTS.md + 4 份规划约 1000 行；`engine/`、`scripts/` 为空目录，`skill/` 仅两个空子目录，`tests/helpers/jsdom-setup.mjs` 与 `tests/manual-e2e.md` 均 0 字节。
2. **AGENTS.md §四 的基础设施断言已失效。** Kimi WebBridge daemon 于 2026-09-22 10:11 被终止（日志 `sig: terminated`），当前 `running:false`，无扩展连接。
3. **P0 项（R2 区块化 ID）建立在一组从未验证的选择器上**，而规划同时把 9 项加固排进同一条实现链。建议先砍范围（见 §六）。

## 二、事实漂移表（AGENTS.md / 规划 vs 磁盘与进程）

| 断言 | 出处 | 实测 | 判定 |
| --- | --- | --- | --- |
| `running:true + extension_connected:true`（已确认） | AGENTS.md §四 | `{"addr":"127.0.0.1:10086","running":false}`；日志 10:11 `sig: terminated` | ❌ 失效 |
| `git init`；建目录骨架（列为待办） | AGENTS.md §十一.1 / 03 §9.1 | 已完成：`.git` 存在、目录树已建 | ⚠️ 已完成却仍列待办 |
| （未提及）git 作为安全网 | 03 §8 | **零提交**（`main` 无任何 commit） | ❌ 安全网不存在 |
| `.gitignore`（含 `tests/fixtures/raw/`、`.DS_Store`） | AGENTS.md §十一.1 / 03 §1 | 0 字节；根与 `docs/` 各有一个未忽略的 `.DS_Store` | ❌ 待写 |
| "文件：`engine/adapters.js`"＋三适配器出厂表 | AGENTS.md §五 | `engine/` 为空，`adapters.js` 不存在 | ⚠️ 该表是设计稿，非文件状态 |
| 从 `references/engine.md` 抽 `engine.js` | AGENTS.md §十一.2 | 未做（源文件 9806 字节，可抽） | ✅ 一致 |
| `npm test` = `node --test tests/` | 03 §4 | 无 `package.json`，`jsdom` 无处声明 → 命令跑不起来 | ❌ 目标树漏了 `package.json` |
| 原型位置 `references/engine.md` | AGENTS.md §三 | 存在（9806 B）；`adapters.md` 存在（4592 B） | ✅ |
| Moka 实测技法与 URL | AGENTS.md §三 | 与 `adapters.md` 备注一致 | ✅ |
| v1 指南路径 `docs/招聘表单AI代填-使用指南.md` | 03 §6 | 实际在 `~/Documents/FindAJob/docs/`（22430 B），**不在 form-pilot 仓库内** | ⚠️ 跨仓库引用，指向行需写绝对/相对跨库路径 |

## 三、阻塞项（动手前必须解决）

**B1 · 桥接 daemon 停止。** 恢复：`~/.kimi-webbridge/bin/kimi-webbridge start`（extension v2.0.9 / daemon v2.0.15）。未恢复前，AGENTS.md §十一.11 与 00 规划 P0 阶段无法验收。今天 08:50 的日志证明桥曾经可用（session `adapter-research` 调过 `evaluate`），所以这是"停服务"而非"装不上"。

**B2 · 零提交的 git。** 首次提交前必须先写完 `.gitignore`，否则 `.DS_Store`、`.workbuddy/` 会进历史。

**B3 · 无 `package.json`。** 03 §1 的目标目录树漏了它，但 03 §4 规定 `npm test = node --test tests/`。需补 `package.json`（`devDependencies: jsdom`）与 `.gitignore` 的 `node_modules/`。

## 四、未验证依赖（规划中被当成既成事实的能力）

| # | 断言 | 出处 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| U1 | Moka `blockSels: '[class*=educations] [class*=form-item-wrap]'`、`addRowText: '添加教育经历'` | 01 R2 | 无。`adapters.md` 只记录 `[class*=apply-field]` 与 `*-info-*` 类型后缀 | **R2 是 P0，猜错等于 P0 失效。**上线前必须在真实 CATL 页探测确认 |
| U2 | "WebBridge evaluate 支持 frame 定向时直接注入" | 01 R5 | v1 `kimi-webbridge.zh-CN.md` 动作表仅 navigate / find_tab / list_tabs / snapshot / click / fill / upload / screenshot / evaluate / cdp，**无 frame 定向**；第 88 行明写"跨域 iframe…暂停并让用户接管，不用 `evaluate` 绕过" | 删掉"evaluate 定向 frame"分支。同域 iframe 若真要支持，先实测；否则按 v1 边界写"列入待手动" |
| U3 | `status.mjs` 断言输出含 `extension_connected` | 03 §5 | 当前（停止态）输出只有 `{addr, running}`；v1 文档第 38 行标称 running 态应含该字段 | 恢复 daemon 后确认字段在 running 态是否出现；`status.mjs` 做防御式解析 |
| U4 | **版本号三处互斥**：`__ja.version='0.2.0'`（AGENTS.md §六 / 01 §三）· CHANGELOG 首条 `0.1.0`（03 §9.9）· 03 §8 要求"engine.js 与 SKILL.md 头注释一致"但 SKILL.md frontmatter **只有 name/description，无 version** | 01 / 03 / AGENTS | 逐文件读确认 | 二选一并写死：①引擎版本＝项目版本（给 SKILL.md 加 `version` 字段，sync 校验）；或②显式声明两条版本轨且 sync 不校验 |
| U5 | 03 §4 测试覆盖"`scan()` 的 `label#n` 编号" | 03 §4 | 01 R2 已把 ID 改为 `blockKind[i]>>label`，`label#n` 被取代 | 03 §4 是 R2 前的残留表述；改为 `edu[0]>>学校名称` |
| U6 | `if (window.__ja) return` 后的版本守卫 | 01 R8 | 无实测 | 低风险，随 R8 一起验即可 |

## 五、设计缺陷（规划本身站不住的地方）

**D1 · R1 的诊断写错了，结论对。** `before.includes(m)` 用的是元素同一性，DOM 节点引用稳定，`.includes` 本身没坏。真正的坏点是 `|| this.visibleMenus().pop()` 这个兜底——它会把常驻菜单/残留菜单当成目标。规划的 Set 化只是形式改进，真正要修的是**删掉 `.pop()`**。诊断不改对，后人会保留 Set 却把 `.pop()` 加回来。（"同时冒出两个新 portal"时用几何最近仍有价值，保留 `nearest`。）

**D2 · R3 的验证方式与适配器备注自相矛盾。** 01 R3 写 `await sleep(300)` 后检查 `target.className.includes('--checked')`；而 `adapters.md` 的北森备注明写"重渲染会清临时 class → 不要用固定 class 标记元素"。sleep 后读 class ＝ 读取可能已被清掉的临时态 → 假阴性。改为：sleep 后重新 `findField` ＋重新定位 radio，用"该字段当前选中项的文本"验证（文本比临时 class 长寿）。

**D3 · R4 的 `fillDate` 判定会假阴性。** `ok: inp.value.includes(ymd)` 假设控件回填原格式；`2026-09-22` 被格式化成 `2026/09/22` 或 `2026年9月22日` 时判失败 → 好控件被误列手动清单。另：只派发 `blur` 而不先 `focus`，多数控件忽略。改为 `focus → input → change → blur`，判定用"归一化后年/月/日三要素都出现在 value 里"。

**D4 · R6 的 `unchanged` 桶无法实现。** 引擎无法区分"值被联动改写"与"值根本没写进去"——两者都表现为"读回 ≠ 写入值"。当前设计靠 `phase` 猜。要么在报告里显式标注这是启发式，要么删掉该桶只留 `failed + retried`。

**D5 · R7 的 200 字符截断被 R6 的报告破坏。** R7 规定"单字段 value ≤200 字符"，R6 的报告却要带 `attempted:'138...'` 与 `final:''`——textarea 长文进报告就突破上限。规则需写明"截断适用于所有返回字段，含报告中的 attempted/final"。

**D6 · R9 的 `scanFields()` 不在任何接口表里。** R9 伪码调 `this.scanFields()`；R2 伪码调 `this.fields()` / `this.blockOf()`；对外只有 `scan({offset,limit})`。三处命名不一致，实现时会现编。需要一张"内部方法命名表"。

**D7 · R9 的 `_plan` 写法自相矛盾。** 01 §三 的 API 是 `setPlan(ids[])`，同文 R9 正文却写 `__ja._plan = new Set(keys)` 直接赋值。"用方法"与"直接改字段"并存于同一文档。

**D8 · v2 流程丢了 v1 的"提交前截图"。** v1 `kimi-webbridge.zh-CN.md` 动作表列了 `screenshot`（"保存提交前的核对截图"）；v2 SKILL.md 的 9 步标准流程里没有截图，最后一步只有"停在提交按钮前"。而 SKILL.md 自称"核心边界（与 v1 完全相同）"——这是事实上的删减。要么补回第 9 步，要么在 SKILL.md 明说不截图的原因。

**D9 · 桥接不可用时的行为未定义。** v1 文档给了降级链（宿主浏览器能力 → 隔离 Playwright），03 §4 又定"不引 Playwright"。form-pilot 的规划里没有任何"桥挂了怎么办"。当前它正好挂着。

**D10 ·（原型代码）`fillTexts` 的重试在结构上无法发现自己要抓的失败。** `await sleep(600)` 之后的重试循环里，重填后**立即同步读值**，必然等于刚写入的值 → `r.ok` 恒真、`retried` 恒报成功。真正要抓的是"重填后 React 又吞掉"，需要再 sleep 一次再读。当前实现会向用户报告一个它没验证过的成功。

**D11 ·（原型代码）`typeOf` 的 `/date/i` 会误命中 `update`。** `'xxx-update-box'` 含 "date" → 被误判为下拉/日期类。改 `/day_info|datepicker|date-picker|[_-]date([_-]|$)/i`。

## 六、范围建议（最重要的一条）

**不要把 R1–R9 全实现完才验收。** 项目自己定了两条原则：

- 02 §二："优化的目标是单次现场适配成本 ≤5 分钟，不是出厂适配器数量。"
- 03 §3："零构建、KISS、~250 行不引打包器。"

但 AGENTS.md §十一.11 要求"01 规划的 P0/P1 加固实现"——那是 8 项连锁实现，其中 4 项（R3 多选确定、R4 日期、R5 iframe、R9 diff）需要**第二个真实站点**才能验证。这与项目自己的 KISS 决策冲突。

**建议切 v0.1.0 最小可验收集**（判据：一次真实 Moka 页跑通）：

1. **R1 菜单归属** —— 但先按 D1 把诊断改写正确。
2. **R2 区块化 ID** —— **前提是先探测真实 DOM**（B1 ＋ U1）；探测不出来就退回 `main>>label` 单层 ID 并在 AGENTS.md §七 记录原因。
3. **R6 报告格式**（含 D10 修复）—— 没有它，现场适配时无法判断失败环节。
4. **R7 分页 ＋ 截断**（含 D5）。

**推迟**：R3（无北森实测，写了也是猜）、R4（Moka 当前策略就是"日期留手动"，试探功能先不做）、R5（依赖 U2 不成立）、R9（`outside` 桶有价值，但可等一次真实联动事故再补；`changed/missing` 外层用 scan+readAll 就能算）、R8（第一版 `if (window.__ja)` 守卫已够，版本比较等真有"第二次注入"需求）。

理由：R3/R4/R5 属于"给还不存在的站点写适配"，违反 02 自己定的"用中学"；R9 属于"给还没发生过的事故写检测"。先把 Moka 一条路走通，v0.2.0 再加。

## 七、建议的下一步（可执行、按依赖序）

1. **`.gitignore` 写实**（`.DS_Store`、`node_modules/`、`tests/fixtures/raw/`）；`git add -A && git commit`（首提交：AGENTS.md ＋ docs/plans ＋ 空骨架）。先做这步——之后所有改动才有安全网。
2. **`package.json`**：`scripts.test = "node --test tests/"`，`devDependencies.jsdom`（`.mjs` 天然 ESM，无需 `"type":"module"`）。
3. **`kimi-webbridge start`**，`status` 确认双 true，并记录 `status` 在 running 态的完整字段名（解 U3）。
4. **打开 Moka CATL 申请页，跑只读探针**：dump 教育/工作区块容器的实际 class、`offsetHeight`、加行按钮真实文本。产出：填 U1，或推翻 R2 的 `blockSels` 设计。
5. **写 `capture-fixture.mjs`** 抓 Moka 表单 `outerHTML` → 脱敏 → `tests/fixtures/moka.html`。这是 L1 测试的唯一输入。
6. **抽 `engine/engine.js`**（原样，仅加版本头注释），再按 §六 最小集实现 R1/R2/R6/R7。
7. **回改 AGENTS.md**：§四 改为"桥接状态需现场确认，勿引用历史值"；§五 的表格加"状态：未落盘"；给"已完成 / 已决策 / 假设"三类加显式标记——当前文档把三种信度混在同一视觉权重里，这是后续 agent 踩坑的直接来源。（**已于 2026-09-22 完成**，并新增 §二 工作纪律。）

## 八、回滚与失败处理

- **第 4 步探针找不到区块容器** → R2 降级为 `main>>label`，写入 AGENTS.md §七，R2 降为 P2（无区块化 ID 时 `addRow` 不可靠，`addRow` 随之推迟）。
- **桥接长期无法恢复** → 按 v1 文档降级链，本轮只做离线部分（第 1、2 步 ＋ jsdom 可覆盖的逻辑 ＋ 人工构造小 HTML 作 fixture），Moka e2e 挂起。
- **U4 版本号** 必须在首个 commit 前定，否则 CHANGELOG 首条就会与 `__ja.version` 打架。
