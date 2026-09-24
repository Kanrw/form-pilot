# form-pilot · 交接文档

> 本文件只记录已发生的事实与决定，不含新规划。后续 agent 请基于此文档继续执行。
> **§二 工作纪律优先于任何规划文档的"顺带做掉"倾向**；冲突时以 §二 为准。
> 2026-09-24 拆分：主文件只留「启动必读」，实证细节与规格**全文**搬进 `docs/`（一个字没删，只搬家）。
> 最后更新：2026-09-24

## 0 · 60 秒启动

**是什么**：浏览器表单自动填写引擎（求职申请场景）。LLM 在循环外，循环内全是确定性 JS；
真实浏览器通过 Kimi WebBridge 桥接驱动，用的是使用者本人的登录态。

**三条硬约束**（违反即回退；要放宽先改规则，不要在命令行上偷过）

1. 真实个人信息只进 `private/`（gitignored），**永不进 git**；推送前
   `git ls-files | grep -E '^private/'` 必须为空。
2. §2.4 的投机性建设，在触发条件出现前**不实现、不写骨架、不留占位接口**。
3. 动手前先答 §2.1 的三问（对应哪条验收 / 边界在哪 / 保住了什么既有保证），答不出就不写代码。

**隐私守卫**：三层闸门（pre-commit 扫**暂存区** / pre-push 扫工作树 / `--history` 事后审计）
+ GitHub Actions 模式判据。**禁止 `--no-verify`**。全文见 `docs/privacy.md`。

**当前能做什么**：引擎注入 + 字段扫描 + 文本/日期填写已可用且实测过；档案（14 区段）与隐私
闸门已落盘；桥接状态**每次使用前重新读**（`node scripts/status.mjs`），不引用任何历史值。

**下一步**：见 §十一。

### 旧章节 → 新位置（2026-09-24 拆分）

| 旧 § | 内容 | 现在在哪 |
| --- | --- | --- |
| §一 | 项目身份 · 隐私边界 · 三层闸门 | 本文要点 + `docs/privacy.md` 全文 |
| §二 | 工作纪律（stop-that-shit 落地条款） | 本文要点 + `docs/discipline.md` 全文 |
| §三 | 已完成的工作 | `docs/history.md` |
| §四 | 基础设施现状（桥接） | `docs/bridge.md` |
| §五 | 适配器注册表 | `docs/stations.md` |
| §六 / §七 / §八 / §十 | 引擎 API / 字段 ID 格式 / 降级链 / 同步方案 | `docs/engine-api.md` |
| §九 | 项目结构 | 本文（未搬） |
| §十一 | 进度与下一步 | 本文要点 + `docs/history.md`（验收明细） |
| §十二 / §十三 | jobmatch 模组 / ATS 简历 PDF 模组 | `docs/modules.md` |
| §十四 | Element Plus 型站点实测（新凯来） | `docs/stations.md` |

> **章节号沿用原编号**，所以"§二 优先于规划文档"这类说法仍然成立。
> **跨文件引用换算**：本文档、`docs/*.md`、`docs/plans/*.md` 以及代码注释里出现的
> 「`AGENTS.md §X`」或「见 §X」，一律按上表找对应的实体文件 —— 编号没变，只是本体搬了家。
> 出处仍在 AGENTS.md 的只有 §0（启动块）、§一 / §二（要点版）、§九（未搬）、§十一（要点版）。

## 一、项目身份

- 名称：form-pilot
- 路径：本机 `~/Documents/FindAJob/form-pilot/`（仓库内一律用相对路径，不写死单机绝对路径）
- 目的：浏览器表单自动填写引擎（求职申请），LLM 在循环外，循环内全是确定性 JS
- 生态位：Simplify 式 autofill（快但笨）与 Skyvern/browser-use 式 agent（聪明但贵）之间
- 不做：批量投递、绕过验证、替用户提交、替用户猜测无来源字段

**隐私边界（硬规则，不可放松）** —— 全文与推导见 `docs/privacy.md`，要点：

- 真实个人信息只放 `private/`。**不要放进 `data/`** —— 本机 `~/Documents/FindAJob/resume/data/`
  是**被提交**的资产目录，同名反义。
- 档案三个文件：字段定义在 `tools/profile.schema.mjs`（含三类分类），值在 `private/profile.json`，
  人读镜像与 `--import` 输入格式在 `docs/profile-template.md`。界面：`node scripts/profile.mjs --ui`。
- 分类只写 schema，不写数据文件。`never` 类（证件号码等）**不进任何映射**，
  `--render` 与 `GET /api/mapping` 里一项都不许出现，有测试盯着。
- 身份证号、银行卡号、密码、验证码属**永不自动填**：不因"档案里已经写了"而放宽。
- 引擎**不读** `private/`。它只通过 `fillTexts(map)` 收到"某字段填某值"，映射由使用者确认（第一道闸门）。
- 推送前必须验证：`git ls-files | grep -E '^private/'` 输出为空。

### 隐私守卫：三层闸门（用户决策 2026-09-23，**最高优先级**）

| 层 | 命令 | 扫什么 | 何时跑 |
| --- | --- | --- | --- |
| 1 提交前 | `check-private-leak.mjs --staged` | **暂存区内容**（`git show :<path>`），不是磁盘 | `.githooks/pre-commit` 自动，过不去就提交不了 |
| 2 推送前 / 日常 | `check-private-leak.mjs`（默认 tree） | 已跟踪文件 + `private/` 是否被跟踪 | `.githooks/pre-push` · `npm run check` |
| 3 事后审计 | `--history` | `git log -p --all` 全历史，命中点名到 SHA | `npm run check:privacy:history`（人工） |
| 网 | `--patterns` | 本机绝对路径 / 手机号 / 身份证号三类模式 | GitHub Actions |

- **第 1 层必须扫 index 而不是工作树**：被 `git add` 之后又在磁盘上改干净的文件，提交进去的
  仍是脏内容。这是"扫工作树"挡不住的一类绕过，别改回去。
- **失败关闭，但只对"本该有档案却没有"生效**：`private/` **目录**在而档案读不出来 → 拒绝比对；
  目录不在（新克隆 / 贡献者机器）→ 降级为模式判据，否则那边一个提交都做不了。
- **禁止 `--no-verify`**。钩子能被绕过，所以 GitHub Actions 那道网必须留着。
- 历史脏过的唯一解法是**删库重建**（重写历史 + force push 清不掉旧对象，GitHub 仍按旧 SHA 提供）。
  完整路径、代价与"重建时顺手做的两件事"见 `docs/privacy.md`。

钩子安装：`npm install` 自动跑 `prepare`；手工 `npm run prepare`；确认 `git config --get core.hooksPath` 应回 `.githooks`。

## 二、工作纪律（stop-that-shit · 本项目适用条款）

> 来源：用户级 skill `stop-that-shit`（lennney/stop-that-shit，MIT）。用户决策（2026-09-22）：
> 写入本项目核心，约束全部后续 agent。**下面是条款速查；逐条论证、案例、以及"已删的守卫别再
> 捡回来"清单见 `docs/discipline.md`。**

| 条款 | 一句话 |
| --- | --- |
| 2.1 责任先行 | 先答三问（哪条验收 / 边界在哪 / 保住什么既有保证），答不出不写代码 |
| 2.2 直接方案优先，按需扩展 | 已有能跑的就改它；只有漏掉**具体已存在**的东西才扩展，"以后换站点可能要用"不算理由 |
| 2.3 每层防御对应一个已命名的失败 | 指不出挡哪个失败的层不写；挡住真实失败的要留，哪怕 diff 变大 |
| 2.4 投机性建设清单 | 触发前不实现：R5 `probeEnv`/shadow DOM/iframe · R9 `snapshot`/`setPlan`/`diff` · R3 `setChoice` · R8 版本守卫/`_busy` 锁。（R4 `fillDate` 已解锁并实现，不再在表内） |
| 2.5 交付物聚焦 | 只写结果、必要后果、验证证据；不写未被要求的告诫性段落 |
| 2.6 任务模式 | `review`/`answer` 只读不改文件；`change` 只做被要求的改动及其必要后果 |
| 2.7 完成即止 | 结果 + 证据 + 无阻塞 = 完成；不要为"满足纪律"再加一轮审计循环 |
| 2.8 双 agent 执行-监督 | 现场执行类任务（表单填写、桥接会话等有卡死风险）必读，见下 |
| 2.9 改动即提交 | 一个逻辑主题一个 commit；提交前跑 `npm run check`，不攒到"告一段落" |
| 2.10 防御收窄 | 已按 §2.3 复核处置过的守卫，清单见 `docs/discipline.md`，别把删掉的捡回来 |

**§2.8 的四条红线**（监督者触发即强制叫停，执行者不得以"再试一次"抗辩）：

1. 同一类失败第 3 次 → 预警；第 6 次 → 强制跳过归类（manual / 待手动）；
2. 同一探测读数连续 3 次不变 → 判卡死，换路径或归类；
3. 同参数重试同一失败动作最多 2 次，第 3 次禁止；
4. 会话总预算 5 分钟，到点强制收尾出三清单（已填 / 待手动 / 待确认）。

监督者的默认形态是**闸门，不是常驻心跳**：执行者自带计数器跑（红线 1/3/4 全生效），只在触线或
单步超时时 spawn 一次监督者做否决判断 —— `run_in_background` ≠ 常驻进程（实测 spawn 后 8 秒自己
结束）。纯文档 / 代码任务不强制双 agent，加了反而违背限时哲学。

**§2.9 的落点**：提交前跑 **`npm run check`**（= `npm test` + 隐私守卫）。**只跑 `npm test` 不够**
—— 真值一旦进了 commit，改工作树也删不掉历史（2026-09-23 实证：两个档案值写进 AGENTS，隔一个
提交才从工作树改掉，历史里那份仍在并随推送公开，最终只能删库重建）。守卫的检查点必须是**提交前**。
提交 ≠ 推送，默认只落本地。

## 九、项目结构

**已落盘**：`engine/`（2）、`scripts/`（10：status / inject / probe / capture-fixture / filltext /
choose / profile / match / resume-pdf / check-private-leak）、
`tools/`（5：档案 schema、I/O、界面三件套）、`tests/`（13：engine.test / profile.test /
jobmatch.test / probe.test / resume-pdf.test / golden.test / choose.test / privacy.test /
filltext.test / inject.test + jsdom 桩 + fixture + 人工清单）、`docs/`（plans 00–07 + profile-template）。
**已落盘（2026-09-23 补）**：README / LICENSE(MIT+上游署名) / CHANGELOG。
**已落盘（2026-09-23 再补，隐私闸门）**：`.githooks/`（pre-commit 扫暂存区、pre-push 扫工作树）、
`.github/workflows/privacy.yml`（服务端模式判据）。见 §一 三层闸门。
**尚未**：`skill/` 整个目录、`scripts/sync-skill.mjs`、`docs/guide-v2.md`。
（三者都在 docs/plans/03 §6/§9 里被当成交付物，仓库里没有——读计划文档时会撞墙，见 CHANGELOG「已知未完成」。）

```
form-pilot/
├── README.md / LICENSE(MIT+上游署名) / CHANGELOG.md    ← 已落盘（2026-09-23）
├── AGENTS.md / .gitignore / package.json               ← 已落盘
├── .githooks/            # 隐私闸门第 1、2 层（core.hooksPath 指向这里，npm install 自动装）
│   ├── pre-commit        #   --staged：扫暂存区内容，过不去就提交不了
│   └── pre-push          #   默认 tree：工作树 + private/ 跟踪检查
├── .github/workflows/    # 隐私闸门的事后网：privacy.yml 跑 --patterns（无档案也能查）
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
│   ├── resume-pdf.mjs    # ATS 简历 PDF 生成（见 §十三；默认不启用，见 §七）
│   ├── choose.mjs        # 自定义下拉的驱动：开菜单 → 点选项 → 回读（见 §六 末）
│   ├── filltext.mjs      # 文本/文本域写入（后台标签页可用）+ 标记纪律（见 §四 静默错写一节）
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

> **2026-09-24 补**：`docs/` 下新增 7 个从本文件拆出的全文文件（`privacy` / `discipline` / `history` /
> `bridge` / `stations` / `engine-api` / `modules`），上文"docs/（plans 00–07 + profile-template）"
> 与实际不符，以本节 + 文末「文档地图」为准。

## 十一、进度与下一步

**路线图的唯一事实源是 `docs/plans/05-execution-architecture.md` §六**（主线三个 Phase，各自独立
可合并）；个人档案界面是**并行支线**，唯一事实源是 `docs/plans/06-profile-ui.md` §八。
本节只记状态摘要，**不重复那两份列表**（三份执行清单必然漂移）；逐条验收明细见 `docs/history.md`。

| Phase | 状态 |
| --- | --- |
| 1 · 骨架 + 引擎可注入 | **已完成（2026-09-22）**：真实 Moka 页 `scan()` 报 `total 49 / unique 49 / duplicate 0` |
| 2 · 填写闭环 | 代码与测试已完成；**真实页受控写验收未做** —— 它必须使用者在场监督，且停在提交前 |
| 3 · 分发与文档 | **未开始**。与桥接完全解耦，桥不可用时它就是唯一能推进的部分 |
| 支线 · 个人档案界面 | Phase 1 + Phase 2 已落地（`profile.mjs --ui`）；窄屏断点与 7 条人工待核对项未做（不阻塞主线） |

`package.json` 的 `scripts.test` 必须是 `node --test`（**不带路径参数**）—— Node 22 会把路径参数
当模块加载并报 `Cannot find module '…/tests'`。03 §4 里写的调用形式是错的。

**已知未落盘**：`skill/` 整个目录、`scripts/sync-skill.mjs`、`docs/guide-v2.md`
（三者都在 `docs/plans/03` §6/§9 里被当成交付物，仓库里没有 —— 见 CHANGELOG「已知未完成」）。

### git

分支 `main`。提交粒度按"一个可独立回退的单元"，不按时间。
**推送前必查**：`git ls-files | grep -E '^private/'` 必须为空。
本机推 GitHub **必须走代理**（直连不通）：`HTTPS_PROXY=http://127.0.0.1:7897 git push`。

### 文档地图（按"什么时候读"排）

| 文件 | 何时读 |
| --- | --- |
| `AGENTS.md`（本文件） | 每次启动 |
| `docs/privacy.md` | 动提交 / 推送 / 档案写入规则时（项目身份与三层闸门全文） |
| `docs/discipline.md` | 判断"这个改动到底要不要做"时（十条纪律的论证与案例） |
| `docs/bridge.md` | 用桥接驱动浏览器时（前台硬前提、后台写通道、静默错写纪律、探测工具） |
| `docs/stations.md` | 遇到新站点 / 改适配器时（各站实测事实，含 Element Plus 新站点） |
| `docs/engine-api.md` | 调 `__ja.*` 接口或改引擎时（API、字段 ID 格式、降级链、同步方案） |
| `docs/modules.md` | 用 jobmatch 筛岗位、或生成 ATS 简历 PDF 时 |
| `docs/history.md` | 想知道"当初为什么是这个决定"时（含各 Phase 验收明细） |
| `docs/plans/` | 找规划原文（05 是路线图事实源、06 是档案界面事实源） |
| `CHANGELOG.md` | 看版本与已知未完成 |
