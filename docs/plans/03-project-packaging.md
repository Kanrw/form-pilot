# 03 · 项目结构、打包与文档规划

> 前序：01（引擎设计）、02（适配器注册表）已定稿，代码现以 markdown 代码块形式嵌在
> `~/.config/opencode/skills/job-apply-v2/references/{engine,adapters}.md` 中。
> 本文解决：独立项目 form-pilot 的目录结构、唯一事实源同步、注入格式、测试、脚本、文档、上游关系与版本策略。

## 1. 目标目录树

```text
form-pilot/
├── README.md                     # 项目门面：是什么、架构图、快速上手、分发方法
├── AGENTS.md                     # 给后续维护 AI 的上下文（事实源规则、sync 命令、安全边界）
├── LICENSE                       # MIT（与上游 ASu-skills 一致，见 §7）
├── CHANGELOG.md                  # Keep-a-Changelog 格式
├── .gitignore                    # 个人信息、tests/fixtures/raw/、.DS_Store
├── engine/                       # ★ 代码唯一事实源
│   ├── engine.js                 #   通用引擎，单文件 IIFE，挂 window.__ja，幂等
│   └── adapters.js               #   适配器注册表，IIFE 挂 window.__jaAdapters
├── skill/                        # ★ job-apply-v2 技能包（自包含、可整体复制分发）
│   ├── SKILL.md                  #   边界 + 流程（主文件，内容事实源）
│   ├── agents/openai.yaml
│   └── references/
│       ├── engine.js             #   【生成物】sync 从 engine/ 复制，禁手改
│       ├── adapters.js           #   【生成物】同上
│       ├── usage.md              #   手工维护：用法约定/使用注意/站点探针/速查表（纯文档）
│       └── kimi-webbridge.zh-CN.md  # 从 v1 skill 复制
├── scripts/
│   ├── sync-skill.mjs            # engine/ → skill/references/ → 部署到 ~/.config
│   ├── inject.mjs                # 读 engine+adapters 合成一次 evaluate 发给 WebBridge
│   ├── status.mjs                # 桥接健康检查（running + extension_connected）
│   └── capture-fixture.mjs       # 抓当前页面表单 outerHTML 存 tests/fixtures/
├── tests/
│   ├── engine.test.mjs           # node:test + jsdom，跑纯逻辑
│   ├── helpers/jsdom-setup.mjs   # offsetHeight/scrollIntoView 桩
│   ├── fixtures/                 # 脱敏后的真实页面 HTML（moka.html、beisen.html…）
│   └── manual-e2e.md             # 真实浏览器回归清单（菜单时序类人工跑）
└── docs/
    ├── plans/                    # 规划文档（本文件）
    └── guide-v2.md               # 用户使用指南 v2（见 §6）
```

## 2. 决策一：唯一事实源与 skill 同步机制

**矛盾**：引擎/适配器要在项目里维护，但 skill 分发时 references/ 必须物理自包含。

| 方案 | 改一处生效 | skill 自包含 | 结论 |
| --- | --- | --- | --- |
| A. 符号链接 skill/references → engine/ | ✓ | ✗ 复制即断、Windows 权限坑 | 否决 |
| B. SKILL.md 写项目绝对路径直接引用 | ✓ | ✗ 绑定单机路径，不可分发 | 否决 |
| C. 构建脚本单向同步（项目→skill） | ✓（一条命令） | ✓ 生成物随仓库提交 | **采用** |
| D. 以 skill 目录为源，项目反向引用 | ✓ | ✓ 但仓库不完整、依赖反转 | 否决 |

**采用 C，细则：**

1. `engine/*.js` 是代码唯一事实源；`skill/references/*.js` 是**生成物**，
   文件头由 sync 注入 `// GENERATED from form-pilot/engine/ — DO NOT EDIT, run scripts/sync-skill.mjs`。
2. 生成物**提交进 git**（类 dist/ 惯例）：别人 clone 后直接复制 skill/ 即用，无需先跑构建。
3. `node scripts/sync-skill.mjs` 两步：①engine/*.js → skill/references/；②skill/ 整树 → `~/.config/opencode/skills/job-apply-v2/`。`--check` 模式只做 diff、漂移时退出码 1，供 git pre-commit / CI 用。
4. 原 engine.md/adapters.md 中的**散文**（用法约定、使用注意、站点探针、速查表）不进 JS 注释，
   迁至手工维护的 `skill/references/usage.md`——代码与文档各自单一事实源，不做"md↔js 互转"的脆弱抽取。
5. SKILL.md/agents/ 的事实源直接放在仓库 `skill/` 下；`~/.config` 下的 skill 目录降级为纯部署目标。

## 3. 决策二：引擎模块化与注入格式

**结论：单文件 IIFE，零构建步骤。**

- 浏览器无模块系统，桥的 `evaluate` 只收一个字符串——"多文件 + 打包器"（rollup/esbuild）对 ~250 行代码是纯开销，违背 KISS。
- `engine.js` 保持现状 IIFE（`if (window.__ja) return`，重复注入幂等）。
- `adapters.js` 需改造：当前 `const ADAPTERS = {...}` 在第二次 evaluate 时会因重复声明抛 SyntaxError。
  改为 IIFE：`window.__jaAdapters = window.__jaAdapters || { moka:..., beisen:..., generic:... }`，同样幂等。
- 注入 = `inject.mjs` 读两个文件拼成一个字符串 + 末尾追加一行 `__ja.use(__jaAdapters[name || __ja.detect()])`，
  一次 evaluate 完成"引擎+注册表+选定适配器"。总量 <10KB，无 evaluate 长度问题。
- 未来引擎真变大，也只用 `cat part1.js part2.js > engine.js` 级别的拼接，不引入打包器。

## 4. 决策三：测试设施（最小可行）

**分层：jsdom 跑纯逻辑 + 真实浏览器人工清单，不引 Playwright。**

- fixtures 来源：`scripts/capture-fixture.mjs` 从真实页面抓表单 `outerHTML` → `tests/fixtures/raw/`，
  **人工脱敏后**移入 `tests/fixtures/` 提交（安全边界：个人资料不入库；raw/ 进 .gitignore）。
- 运行器：Node ≥18 内置 `node:test` + 唯一依赖 `jsdom`。
  jsdom 两个已知坑用 `helpers/jsdom-setup.mjs` 打桩：
  `offsetHeight` 恒 0（defineProperty 返回非 0）→ 否则引擎可见性过滤全灭；
  `scrollIntoView` 未实现 → 空函数桩。
- 覆盖范围：`detect()` 签名判定、`scan()` 的 label#n 编号、`fillTexts()` native setter 写值与回读、
  `findField` 定位。这些在 jsdom 里行为真实（setter/事件派发 jsdom 均支持）。
- **不覆盖**：菜单出现时序、portal、isTrusted 降级——jsdom 无真实渲染时序，
  这些进 `tests/manual-e2e.md` 核对清单（每个适配器一节：开页→inject→scan→填→回读的预期结果），
  发布前在真实 Moka/北森页面人工过一遍。
- 命令：`npm test`（即 `node --test tests/`）。不为测试引 TypeScript/覆盖率工具。

## 5. 决策四：scripts/ 辅助脚本（职责与接口，不实现）

统一约定：Node ≥18 原生 `node scripts/xxx.mjs`，零三方依赖（手解 `process.argv`），
stdout 输出 JSON，成功 0 / 失败 1；bridge 地址默认 `http://127.0.0.1:10086/command`，可用 `BRIDGE_URL` 覆盖。

| 脚本 | 职责 | 接口 |
| --- | --- | --- |
| `status.mjs` | 预检：调 `~/.kimi-webbridge/bin/kimi-webbridge status`，断言 running+extension_connected 双 true | 无参数；输出 `{ok, running, extension_connected}` |
| `inject.mjs` | 读 engine.js+adapters.js，拼适配器选择行，POST 一次 `evaluate` | `--session <名> [--adapter moka\|beisen\|generic\|auto(默认)]`；输出 `{ok, adapter, engine:"loaded"\|"already loaded"}` |
| `capture-fixture.mjs` | evaluate 抓当前页最大 form（退化 body）的 outerHTML 写文件 | `--session <名> --site <站点名>`；写 `tests/fixtures/raw/<站点名>-<日期>.html`，并在 stderr 提醒脱敏 |
| `sync-skill.mjs` | 单向同步（见 §2），含 GENERATED 头注入 | `[--check]`（只 diff 不写）`[--target <skill目录>]`（默认 ~/.config/opencode/skills/job-apply-v2） |

inject 不内嵌 engine 源码、status 不复制 bridge CLI 功能——脚本只做胶水。

## 6. 决策五：文档体系

- **README.md**：定位一句话、架构图（引擎/适配器/skill 三层）、三分钟上手（clone→sync-skill→opencode 里 `/job-apply-v2`）、安全边界摘要、署名（见 §7）。
- **AGENTS.md**：①唯一事实源规则（改 engine/ 后必跑 sync-skill，references/*.js 禁手改）；
  ②六个安全边界原文（继承 v1，维护者不得放松）；③测试与发布命令；④适配器新增流程（探针→≤20 行注册项）。
- **docs/**：`plans/` 存规划；`guide-v2.md` 为正式用户指南。
- **v1 指南处置**：**另存新文件，v1 保留**。在 `docs/招聘表单AI代填-使用指南.md` 顶部加一行
  "v1 北森专版存档；v2 通用版见 form-pilot/docs/guide-v2.md"。
  理由：v1 指南绑定 v1 skill 的"下拉默认人工"策略，与 v2"AI 默认填下拉"直接冲突，
  原文件名覆盖会误导仍用 v1 的人；且 v1 的北森 DOM 解剖仍是 beisen 适配器的参考材料。
  guide-v2.md 骨架：四组件安装→skill 安装（clone+sync 或复制 skill/）→资料卡模板（沿用附录 A）→
  新默认分工（AI 填下拉，级联/日期仍人工）→交付报告格式→故障排查表（用 SKILL.md 的 v2 版）。

## 7. 决策六：与 ASu-skills 上游的关系

- v2 的六条安全边界与流程框架**逐字继承** ASu-skills `/job-apply`（MIT，作者 Hisn00w）。
  MIT 的唯一义务是保留版权声明与许可文本。
- **LICENSE 选 MIT**：与上游一致，最大化兼容，未来回馈/合并无障碍。
- **署名**：README 与 SKILL.md 头部各加一行
  "安全边界与流程框架派生自 [ASu-skills](https://github.com/Hisn00w/ASu-skills) 的 job-apply（MIT © Hisn00w）"；
  LICENSE 文件后附上游 MIT 原文。
- **回馈方式：先独立仓库，后轻量回馈**。不直接提 PR——v2 改变了 v1 明示的默认策略（下拉人工→AI 填），
  属于设计取向分叉而非 bugfix，PR 大概率不合上游口味。改为：仓库公开后在上游开一个 issue，
  简述"引擎+适配器注册表"思路与实测数据（60 字段 120 次往返→1 次），附链接，合不合并交给作者。

## 8. 决策七：版本与发布

- **git 仓库化：要**。即使本地为主，git 是防误改的安全网，也是将来公开分发的前提；`git init` 成本为零。
- **版本策略：轻量 semver**。版本号只写两处：`engine.js` 头注释 `__ja.version` 与 SKILL.md 头注释，
  sync 时校验一致。0.x 起步：新适配器/新能力 bump minor，修 bug bump patch；公开分发后再考虑 1.0。
- **CHANGELOG.md**：Keep-a-Changelog，每次 sync 部署前更新；条目重点记适配器实测站点与日期（适配器会随站点改版失效，日期是重要信号）。
- **发布形态**：不打 npm 包；分发 = `git clone` + `node scripts/sync-skill.mjs`。
  git tag 对应版本号即可，无 CI 发布流水线。

## 9. 实施清单

1. `git init`；建 §1 目录骨架；写 .gitignore（含 `tests/fixtures/raw/`）。
2. 把 references/engine.md 代码块抽成 `engine/engine.js`（原样，仅加版本头注释）。
3. 把 references/adapters.md 代码块抽成 `engine/adapters.js`，改为 IIFE 幂等挂载（§3 第 3 条）。
4. 散文部分迁至 `skill/references/usage.md`；SKILL.md 中两个 reference 链接改为 .js + usage.md。
5. 复制 v1 的 `kimi-webbridge.zh-CN.md` 与现有 SKILL.md、agents/ 入 `skill/`。
6. 写 `scripts/sync-skill.mjs` 并首跑，验证 `~/.config` 下 skill 完整可用。
7. 写 `status.mjs` → `inject.mjs` → `capture-fixture.mjs`（按依赖序）。
8. 写 jsdom-setup 桩 + engine.test.mjs 首批用例（detect/scan/fillTexts）。
9. 写 README、AGENTS.md、LICENSE（MIT+上游署名）、CHANGELOG 首条 0.1.0。
10. 写 docs/guide-v2.md；给 v1 指南加存档指向行。
11. （可选）在上游 ASu-skills 开回馈 issue。
