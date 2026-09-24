# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本策略：0.x 起步，新适配器 / 新能力 bump minor，修 bug bump patch。
**条目重点记录适配器的实测站点与日期** —— 适配器会随站点改版失效，日期比功能描述更重要。

## [Unreleased]

### 新增

- 档案：`publications` 增加**发表日期**字段（`publishDate`，`YYYY-MM-DD`）。
  schema 与 `docs/profile-template.md` 的字段位必须同时改 —— `tests/profile.test.mjs` 有
  「schema 里每个字段都能在模板里找到」的断言盯着这条。
- 站点：**Element Plus 型站点**（新凯来 `career.sicarrier.com`，实测 2026-09-24）的完整交互规律
  与坑，见 `docs/stations.md`。
- 站点：**华为自研 `aui-` 组件库站点**（校招简历 `career.huawei.com`，实测 2026-09-24）的站点形状、
  九条实测校正、字段上限与两处待确认项，见 `docs/stations.md` §十五。
  - 引擎适配器**未改动**（仍是 moka / beisen / feishu / generic 四个）——「新站点」不等于「新增适配器」
  - 方法上新增一条：**"重新查询同一个元素"不构成独立回读**，第二证据要取**框架渲染物**
    （本站是 `.aui-input__count-inner` 字数计数器），否则挡不住"只改了 DOM 表层、保存时被旧 state 覆盖"
    这类静默错写

### 文档

- **AGENTS.md 拆分（2026-09-24）**：原 993 行的单文件按性质拆为「启动必读主文件 + 7 个全文附文件」，
  主文件压到 ~220 行。动机是**启动成本**：原文件里约一半篇幅是查阅型规格（引擎 API、字段 ID、
  适配器表）与历史实测档案，每次启动都要读一遍。
  - 新增：`docs/privacy.md`（项目身份 · 隐私边界 · 三层闸门）、`docs/discipline.md`（工作纪律全文）、
    `docs/bridge.md`（桥接基础设施 · 前台硬前提 · 静默错写纪律）、`docs/stations.md`（适配器注册表 +
    各站实测）、`docs/engine-api.md`（引擎 API · 字段 ID · 降级链 · 同步方案）、
    `docs/modules.md`（jobmatch · ATS 简历 PDF）、`docs/history.md`（已完成工作 · 各 Phase 验收明细）
  - **原文一字未删，只是搬家**；**章节号沿用原编号**，主文件顶部给出「旧章节 → 新位置」对照表，
    文中「见 §X」按该表换算
  - 校验：拆完用脚本逐行比对，原文的实义行（去空白后 ≥15 字符）在新结构里命中率 100%

## [0.1.0] — 2026-09-23

首个可公开分发的版本：引擎 + 三个站点适配器 + 档案体系 + 岗位筛选 + ATS 简历 PDF，
`npm test` 93 个用例全绿。

### 新增

- **engine/**：浏览器端通用填写引擎（IIFE 单文件，挂 `window.__ja`，重复注入幂等）
  - `detect / scan / fillTexts / pickOption / fillDate / fillMonthRange`
  - 失败一律显式：复合字段拒写、免疫类型（`manualTypes`）快速失败、`scan` 输出人工待办
  - 3–5 分钟哲学机制化：宁明确失败，不静默错；不做无限试错
- **站点适配器**（`engine/adapters.js`）
  - `moka`：Moka，实测 2026-09-22（真实校招申请页，只读探测 + 受控写）
  - `beisen`：北森 `*.zhiye.com`，实测 2026-09-22（L2 只读 + 同步受控写；单选是 div-radio，无 input）
  - `feishu`：飞书招聘 `*.jobs.feishu.cn`，实测 2026-09-22（L2 + L3 受控写；菜单常驻 DOM）
  - `generic`：兜底
- **档案体系**（`tools/`）：字段 schema、markdown 导入导出、本地编辑界面（127.0.0.1:8787）、
  投放版本（基准 + 每版本只存差异）
- **岗位筛选**（`jobmatch/`）：硬门槛闸门 + 命中证据 + 四档结论，不出百分比分数
- **ATS 简历 PDF**（`scripts/resume-pdf.mjs`）：按档案生成可解析 PDF，`never` 类字段不进稿
- **脚本**：`status` / `inject` / `probe` / `capture-fixture` / `profile` / `match` / `resume-pdf`
- **隐私守卫**：`scripts/check-private-leak.mjs` —— 档案值与单机绝对路径不得进已跟踪文件
  - 四种模式：默认扫已跟踪文件 / `--staged` 扫暂存区 / `--history` 扫全部历史 /
    `--patterns` 纯模式判据（不需要档案，CI 用）
  - `.githooks/pre-commit`（扫暂存区）与 `pre-push`（扫工作树）由 `npm run prepare` 自动装配
  - `.github/workflows/privacy.yml` 在服务端跑模式判据
  - **失败关闭**：拿不到 `private/profile.json` 时拒绝对比并退出 1，不再静默放行

### 变更

- `private/`（真实档案、证件照、附件、抓取结果）与 `tests/fixtures/raw/` 明确排除在版本控制外
- **默认不上传简历（2026-09-23）**：站内解析器重新解析时会**覆盖表单已有内容**，
  所以流程改为「先 scan → 只在表单全空或使用者明确要求时才上传」；
  `scripts/resume-pdf.mjs`（ATS 简历 PDF）默认不启用，降为按需工具

### 已知未完成

- 计划中的 `skill/`（opencode 技能包）与 `scripts/sync-skill.mjs` 尚未落地；
  目前通过 `scripts/inject.mjs` 直接使用 `engine/`
- `docs/guide-v2.md`（用户指南）尚未落地；`docs/plans/03` 与 AGENTS.md §九 里仍把它当交付物引用
- 飞书站的月区间日期与「期望工作地点」在 L3 实测中跳过；`pickOption` 在该站会复发 `menu-not-open`
- 菜单出现时序、portal、`isTrusted` 降级不在 jsdom 覆盖范围内，见 `tests/manual-e2e.md`

### 署名

安全边界与流程框架派生自 [ASu-skills](https://github.com/Hisn00w/ASu-skills) 的 `job-apply`（MIT © Hisn00w）。
