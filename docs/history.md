# 已完成的工作与历史验收

> 本文件是 `AGENTS.md` 原 §三 / §十一 的**全文摘录，未改一字**（2026-09-24 拆分）。
> AGENTS.md 正文里出现的「见 §X」引用，按 AGENTS.md 顶部的「旧章节 → 新位置」对照表换算到本文件。

---
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

**验证时使用的 Moka URL**（某家真实校招申请页，仅探测未提交；此处只留形状，具体 org/jobId 不入库）：
`https://app.mokahr.com/campus-recruitment/<orgSlug>/<orgId>#/job/<jobId>/apply`

### 技能文件（已写入）

`~/.config/opencode/skills/job-apply-v2/`：
- `SKILL.md`（技能主文件，边界+流程）
- `references/engine.md`（引擎代码+用法）
- `references/adapters.md`（适配器注册表草案）
- `agents/openai.yaml`（技能元数据）

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
