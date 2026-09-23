# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本策略：0.x 起步，新适配器 / 新能力 bump minor，修 bug bump patch。
**条目重点记录适配器的实测站点与日期** —— 适配器会随站点改版失效，日期比功能描述更重要。

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
