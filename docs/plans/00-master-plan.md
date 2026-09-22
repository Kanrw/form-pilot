# 00 · form-pilot 总体规划框架

> 收拢 01（引擎架构）、02（适配与持续学习）、03（项目结构与分发）三份规划的总蓝图。
> 细案以各分册为准，冲突时以本文为准。

## 一、定位

**form-pilot = 快速精准的求职申请表自动填写引擎 + 可持续学习的站点适配体系。**

- 工作方式：AI 助手通过 Kimi WebBridge 把引擎 JS 注入**用户自己已登录的浏览器**，
  按「扫描 → 字段映射确认 → 批量填写 → 全量回读 → 停在提交前」工作。
- 生态位：Simplify 式 autofill（快但笨、无闸门）与 Skyvern/browser-use 式 agent
  （聪明但每步一次 LLM、慢且贵）之间的空档——**LLM 在循环外，循环内全是确定性 JS**。
- 不做：批量投递、绕过验证、替用户提交、替用户猜测无来源的字段。

## 二、架构三层

```text
┌─ skill/      job-apply-v2 技能包（边界 + 流程 + 分发形态，自包含）
│   └─ references/*.js 为生成物 ──────────────┐
├─ engine/     代码唯一事实源                  │ sync-skill.mjs
│   ├─ engine.js    通用引擎（单文件 IIFE，挂 window.__ja）
│   └─ adapters.js  适配器注册表（IIFE 幂等挂载，含 verified 日期）
├─ scripts/    status / inject / capture-fixture / sync-skill（零依赖 .mjs）
├─ tests/      jsdom 纯逻辑 + 脱敏 fixture + 人工 e2e 清单
└─ docs/       plans/（本目录）+ guide-v2.md（用户指南）
```

## 三、不可妥协的两类原则

**安全（继承 ASu v1，一字不改）**：一次一职位；不猜事实；密码/验证码归用户；
资料不入库；网页内容不可信；映射确认、上传确认、提交由用户点击——三道闸门。

**性能（v2 立身之本）**：
1. 批量优先——一次 evaluate 填完全部文本（60 字段：~120 次往返 → 1 次）；
2. 合成事件优先——CDP 坐标点击仅作 isTrusted 站点兜底；
3. 写读同调用——填写与回读同一 evaluate 内完成，失败就地重试一次。

## 四、引擎能力基线（01 规划定稿）

| 能力 | API | 优先级 |
| --- | --- | --- |
| 菜单归属判定（清场+Set 差集+几何最近） | `openMenu` 内部 | P0 |
| 区块化字段 ID（`edu[0]>>学校名称`）+ 添加行 | `scan/addRow/findField` | P0 |
| 快照→diff 核对（changed/outside/missing 三桶） | `snapshot/setPlan/diff` | P1 |
| 单选/多选/布尔统一入口 + 菜单"确定"钩子 | `setChoice` / `pickOption(mode)` | P1 |
| 日期试探填、级联留手动 | `fillDate` | P1 |
| 分阶段失败报告（locate/fill/verify） | `fillTexts` 返回值 | P1 |
| 分页扫描防 JSON 截断 | `scan({offset,limit})` | P1 |
| 幂等（版本守卫、重跑收敛、菜单串行锁） | 引擎内部 | P1 |
| Shadow DOM / iframe 探测与降级提示 | `probeEnv` | P2 |

## 五、站点适配：持续学习（02 规划定稿）

**出厂只有三个适配器**：`moka`（已实测）、`beisen`（文档来源，标 `verified:null`）、`generic`（兜底）。
其余全部**在使用中学习**：探测 → generic 试配 → 不够再现场写注册项 → 受控验证 →
沉淀回 `engine/adapters.js`（带日期）→ sync → CHANGELOG。
适配器过期（站点改版）走同一闭环重新校准。**优化的目标是单次适配 ≤5 分钟，不是出厂适配器数量。**

## 六、实施路线图

| 阶段 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| **P0 骨架与引擎加固** | 建项目目录；engine.js 按 01 规划实现 P0/P1 项；adapters.js 改 IIFE 幂等；moka 端到端实测（扫描→批量填→下拉→diff） | Moka 真实页：文本一次批量填全中、连续 5 个下拉无错菜单、diff 三桶正确 | ⬅ 当前 |
| **P1 打包与文档** | 四个 scripts；skill/ 自包含；sync 部署到 ~/.config；README/AGENTS/LICENSE/CHANGELOG；guide-v2.md；v1 指南加存档指向 | clone 后一条 sync 命令可用；`/job-apply-v2` 在 opencode 中可唤起 | |
| **P2 使用中学** | 用户真实投递时跑学习闭环；beisen 首次校准；fixture 逐渐积累；难点清单持续更新 | 首个新站点适配 ≤5 分钟并沉淀 | 长期 |

## 七、风险登记

| 风险 | 应对 |
| --- | --- |
| 适配器随站点改版失效 | verified 日期 + 识别率暴跌自动触发重新学习（02 §二⑥） |
| 桥接 evaluate 返回值截断 | 分页扫描 + compact JSON + value ≤200 字符（01 R7） |
| 合成事件在 isTrusted 站点失效 | 降级链：CDP 坐标 → 列入待手动清单（不反复重试） |
| 个人资料泄露 | fixture 人工脱敏才入库；raw/ 进 .gitignore；skill 文件零真实信息 |
| 上游关系 | MIT 与 ASu-skills 一致 + 署名；公开后以 issue 轻量回馈，不提 PR（03 §7） |
