# form-pilot

> 浏览器表单自动填写引擎（求职申请场景）。**LLM 在循环外，循环内全是确定性 JS**：
> 一次 `evaluate` 把引擎注入页面，之后 `scan` / `fillTexts` / `pickOption` 都是本地 DOM 操作，
> 不按字段来回问模型。实测 60 字段表单从"120 次往返"降到 1 次注入 + 一次批量写。

生态位：介于 Simplify 式 autofill（快但笨）与 Skyvern / browser-use 式 agent（聪明但贵）之间——
要的是**可解释、可回读、可否认**的自动化：填不进去就明确报失败原因，绝不猜。

---

## 它不做什么（六条边界，不可放松）

1. 不批量投递
2. 不绕过验证码 / 人机校验
3. 不替用户点提交
4. 不替用户猜测**无来源**的字段（档案里没有的值一律报 `manual`，不编）
5. 证件号码（`never` 类字段）AI 不代填 —— 即使材料里就有
6. 个人档案与附件只落在本机 `private/`（git 忽略），不进仓库、不进网络请求

安全边界与流程框架派生自 [ASu-skills](https://github.com/Hisn00w/ASu-skills) 的 `job-apply`（MIT © Hisn00w）。

---

## 架构

```
                 你的终端 / agent                        浏览器（真实页面）
                        │                                       ▲
                        │  HTTP 127.0.0.1:10086                 │ evaluate
                        ▼                                       │
   scripts/*.mjs ──► Kimi WebBridge ─────────────────►  window.__ja（engine.js）
   （胶水，不含业务）                                     ├── detect()     站点识别
                                                        ├── scan()       字段清单 + 类型
   engine/adapters.js ──► window.__jaAdapters ────────► ├── fillTexts()  批量写 + 回读
   （站点差异，纯数据）                                   ├── pickOption() 点开菜单选值
                                                        └── fillDate/fillMonthRange
   tools/           本地档案编辑器（浏览器里开 127.0.0.1:8787）
   jobmatch/        岗位硬门槛筛选（读档案 + 读 JD，出结论与命中证据）
```

- **引擎只认接口不认网站**：`engine/engine.js` 是通用逻辑，站点差异全在 `engine/adapters.js` 的注册项里（选择器 + 类型判据 + 免疫清单）。新增站点 = 跑一遍探针 → 整理成注册项 → 填 `verified` 日期与来源 URL。
- **零构建**：engine 与 adapters 都是 IIFE 单文件，`inject.mjs` 拼成一个字符串一次注入；重复注入幂等。
- **唯一事实源**：`engine/*.js`。计划中的 `skill/`（opencode 技能包）是 sync 生成物，**目前尚未落地**；现在直接用 `scripts/inject.mjs`。

## 已实测站点

| 站点 | 适配器 | 实测日期 | 状态 |
| --- | --- | --- | --- |
| Moka（app.mokahr.com） | `moka` | 2026-09-22 | 只读探测 + 受控写验证 |
| 北森（*.zhiye.com） | `beisen` | 2026-09-22 | L2 只读 + 同步受控写 |
| 飞书招聘（*.jobs.feishu.cn） | `feishu` | 2026-09-22 | L2 只读 + L3 受控写 |
| 其它 | `generic` | — | 兜底，命中率低 |

适配器会随站点改版失效，**`verified` 日期是这个仓库里最重要的信号之一**。

---

## 快速上手

```bash
git clone https://github.com/Kanrw/form-pilot.git
cd form-pilot
npm install          # 只有 jsdom / pdfkit / pdf-parse
npm test             # 93 个用例，Node ≥18
```

### 1. 建本地档案（一次性）

```bash
node scripts/profile.mjs --init                 # 建空的 private/profile.json
node scripts/profile.mjs --import profile.md    # 或从已有《个人资料卡》markdown 迁移
node scripts/profile.mjs --check                # 校验，有 error 退出码 1
node scripts/profile.mjs --ui                   # 起本地界面 http://127.0.0.1:8787
```

字段模型见 `tools/profile.schema.mjs`，模板见 `docs/profile-template.md`。

### 2. 填表（需要 Kimi WebBridge 与浏览器插件）

```bash
node scripts/status.mjs                                    # 预检：running + extension_connected
node scripts/inject.mjs --session form-v01                 # 注入引擎（自动识别站点）
node scripts/inject.mjs --session form-v01 --adapter moka  # 或指定适配器
node scripts/probe.mjs  --session form-v01 --as moka       # 新站点先看结构
```

注入后浏览器里可用的方法与失败码见 `engine/engine.js` 顶部注释与 `AGENTS.md`。

### 3. 岗位筛选 / 简历 PDF（可选）

```bash
node scripts/match.mjs --fetch --url <列表页> --session <名>   # 抓岗位 JSON → private/jobs/
node scripts/match.mjs --screen --top 20                      # 硬门槛闸门 + 命中证据
node scripts/resume-pdf.mjs --version <名>                    # ATS 简历 PDF → private/resume/
```

> **不要往已经填过、解析过的表单重传简历。** 很多站点的解析器会重新解析并**覆盖表单里已有的内容**
> （实测：重传后教育经历被拆成多行、先填好的字段被清掉）。ATS 简历 PDF 是按需工具，不是常规步骤 ——
> 只在目标表单全空、或你明确要求时才上传。

---

## 目录

| 路径 | 作用 |
| --- | --- |
| `engine/` | ★ 代码唯一事实源：`engine.js`（通用引擎）、`adapters.js`（站点注册表） |
| `scripts/` | 命令行胶水：inject / status / probe / capture-fixture / profile / match / resume-pdf / check-private-leak |
| `jobmatch/` | 岗位筛选：站点适配、抓取、硬门槛闸门（不出百分比分数，伪精确是误导） |
| `tools/` | 本地档案编辑器（HTML/CSS/JS）+ 档案导入导出 + 字段 schema |
| `tests/` | `node:test` + jsdom 跑纯逻辑；菜单时序类进 `tests/manual-e2e.md` 人工清单 |
| `docs/` | `plans/` 规划文档、`profile-template.md` 档案模板 |
| `private/` | **不在 git 里**：个人档案、证件照、附件副本、抓下来的岗位与 PDF |

## 隐私边界（硬规则）

- `private/` 被 `.gitignore` 挡住；`tests/fixtures/raw/`（真实页面 HTML）同样不入库，人工脱敏后才移入 `tests/fixtures/`。
- 但档案值会被**抄进**测试、schema 提示语、实测记录——所以有守卫：

```bash
node scripts/check-private-leak.mjs   # 档案值或 /Users/<用户名> 出现在已跟踪文件里 → 退出码 1
```

- 脚本的 stdout 只回计数与路径，**不回档案值**（终端回滚缓冲与对话都是泄密面）。
- PDF / 档案读写有路径守卫，拒绝写到 `private/` 之外。

---

## 开发与贡献

- 命令：`npm test`（93 用例）、`npm run check:privacy`。
- 改 `engine/` 后同步更新 `verified` 日期与 CHANGELOG 条目。
- 纪律见 `AGENTS.md`（给后续维护 AI 的上下文：事实源规则、安全边界、实测记录、双 agent 执行-监督约定）。
- 上游关系：先独立仓库，后轻量回馈（已在 ASu-skills 开 issue 的思路），不直接提 PR——v2 把"下拉默认人工"改成"AI 默认填"，是设计取向分叉而非 bugfix。

## 许可

MIT，见 [LICENSE](LICENSE)。
