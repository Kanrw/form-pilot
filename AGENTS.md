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
| R4 `fillDate` 试探 | Moka `day_info` 实测证明可直接输入（当前策略是留手动） |
| R8 版本守卫 / `_busy` 运行锁 | 出现第二次注入或并发调用的真实事故 |

判据一致：**没有真实站点、没有真实事故，就没有需求。**

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

五份规划文档，`form-pilot/docs/plans/`：

| 文件 | 内容 | 行数 |
| --- | --- | --- |
| `00-master-plan.md` | 总体规划框架，收拢 01/02/03 | ~120 |
| `01-engine-architecture.md` | 引擎架构加固（9 项风险 + 接口 + 实施顺序） | 226 |
| `02-adapters-testing.md` | 站点适配与持续学习策略 | ~95 |
| `03-project-packaging.md` | 项目结构、打包与文档 | 152 |
| `04-reality-check-2026-09-22.md` | 实况审查：AGENTS.md/01/02/03 对磁盘、git、桥接实测的逐条核对 | — |

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
- ⚠️ **桥接状态是当场读数，不是本文件的常驻事实**。已记录历史值 `running:true + extension_connected:true`，
  但 2026-09-22 10:11 的日志显示 daemon 被终止（`sig: terminated`）→ **恢复使用前必须重新 `status` 确认，
  不得引用本行历史值**。
- 状态检查：`~/.kimi-webbridge/bin/kimi-webbridge status`
- 恢复：`~/.kimi-webbridge/bin/kimi-webbridge start`
- macOS/Linux 调用模板：`curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' -d '{"action":...,"args":...,"session":"..."}'`
- Windows：内联 JSON 会乱码，必须用 `--data-binary @file`
- 固定 session 名约定：同一任务一个 session，如 `form-v2-analysis`、`adapter-research`

## 五、适配器注册表（当前出厂状态）

文件：`engine/adapters.js`（待从 `skill/references/adapters.md` 提取改造为 IIFE）
当前三注册项（下表是**设计稿，文件尚未落盘**）：

| 适配器 | fieldSel | labelSel | menuSel | itemSel | valueSel | verified | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `moka` | `[class*=apply-field]` | `[class*=title]` | `[class*=sd-Select-menu],[class*=sd-Menu-container]` | `[class*=sd-Menu-content-item]` | `[class*=sd-Input-display-value]` | `2026-09-22` | `https://app.mokahr.com/...` |
| `beisen` | `.form-item` | `label` | `.common-unmodeled-layer` | `.phoenix-selectList__singleLabel,.list-item-container` | `.phoenix-select__placeHolder` | `null` | `docs-only` |
| `generic` | `null` | `null` | `null` | `li,[role=option],...` | `null` | 探针模式 | — |

北森特异（来自 v1 指南文档，未实测）：
- 单选是 `div.phoenix-radio`（不是原生 radio），点自定义单选
- 多选样式 `.list-item-container`，选完要点面板内"确定"按钮（`.phoenix-button`）才生效
- 菜单 portal 在 body 底部 `.common-unmodeled-layer`（取高度>100 的可见者）

## 六、引擎 API 最终形态

文件：`engine/engine.js`（待从 `skill/references/engine.md` 提取）
全部挂 `window.__ja`，单文件 IIFE，幂等（`if (window.__ja) return`）。

标 ⏸ 的条目按 §2.4 推迟，触发条件出现前不实现，也不在 engine.js 里留占位。

```
__ja.version                                        // 版本号取值待定，见 04 审查 U4
__ja.use(adapter)                                   // 注册并切换适配器
__ja.detect()         → 'moka'|'beisen'|'generic'
__ja.scan({offset,limit}) → {total, fields:[{id,type,required,value}]}
__ja.addRow(kind)     → {ok, index}                 // 添加经历行
__ja.fillTexts(map)   → {ok,failed[],retried[],unchanged[]}
__ja.pickOption(id,text,{mode:'single'|'multi',search})  // 下拉
__ja.readAll({offset,limit})                        // 分页回读
⏸ __ja.probeEnv()     → {shadowHosts, iframes[]}    // R5
⏸ __ja.snapshot()     → {count}                     // R9 填前快照
⏸ __ja.setPlan(ids[])                               // R9 计划变更集合
⏸ __ja.setChoice(id,value)                          // R3 单选/多选/布尔统一入口
⏸ __ja.fillDate(id,'YYYY-MM-DD') → {ok}|{manual:true}     // R4 日期试探
⏸ __ja.diff()         → {changed[],outside[],missing[]}   // R9 核对报告
```

内部规约（不可违反）：
- 元素引用不得跨 sleep 复用（stale 免疫）
- 菜单操作串行，`_busy` 锁
- 返回值一律 compact JSON.stringify，无空格，单字段 value ≤200 字符
  （截断适用于**所有**返回字段，含失败报告里的 `attempted` / `final`）

## 七、适配器字段 ID 格式

```
main>>label                    # 普通字段（单一条，无重复）
edu[0]>>学校名称               # 区块化：kind[rowIndex]>>label
edu[1]>>学校名称               # 添加一行后，新行 index=1
work[0]>>公司名
```

区块签名（适配器声明 blockSels）：Moka 待定字段（`blockSels`/`addRowText` 是 plan 01 R2 的设计，
尚未在 engine.js 中实现）。
⚠️ **plan 01 R2 给出的 `'[class*=educations] [class*=form-item-wrap]'` 与按钮文本从未在真实 DOM 上验证过**
（见 04 审查 U1）。实现 R2 前必须先跑只读探针确认；探不出来则退回 `main>>label` 单层 ID，
并把 `addRow` 一并推迟。

## 八、故障降级链

合成事件 → CDP 坐标点击（`Input.dispatchMouseEvent`）→ 列入"待用户手动清单"
（不在一个控件上反复重试）。

## 九、项目结构蓝图（待 build）

```
form-pilot/
├── README.md / AGENTS.md / LICENSE(MIT+上游署名) / CHANGELOG.md / .gitignore
├── package.json          # scripts.test = "node --test tests/"；devDependencies: jsdom
├── engine/               # 代码唯一事实源
│   ├── engine.js         # 单文件IIFE，挂 window.__ja
│   └── adapters.js       # IIFE幂等挂载 window.__jaAdapters（含 verified 日期）
├── skill/                # 技能包（自包含可分发）
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── references/
│       ├── engine.js     # 【生成物】sync 复制
│       ├── adapters.js   # 【生成物】同上
│       ├── usage.md      # 手工维护散文
│       └── kimi-webbridge.zh-CN.md  # 从 v1 复制
├── scripts/
│   ├── sync-skill.mjs    # engine/ → skill/references/ → ~/.config（单向，含GENERATED头）
│   ├── inject.mjs        # 读engine+adapters拼字符串，POST一次evaluate
│   ├── status.mjs        # 桥接健康检查
│   └── capture-fixture.mjs  # 抓当前页表单outerHTML
├── tests/
│   ├── engine.test.mjs   # node:test + jsdom
│   ├── helpers/jsdom-setup.mjs  # offsetHeight/scrollIntoView桩
│   ├── fixtures/         # 脱敏HTML（raw/进.gitignore）
│   └── manual-e2e.md     # 真实浏览器回归清单
└── docs/plans/           # 00-04 规划与审查文档
```

## 十、同步方案（唯一事实源）

采用构建脚本单向同步（方案C）：`scripts/sync-skill.mjs` 把 `engine/*.js` 复制为
`skill/references/*.js`（注入 GENERATED 头，禁手改），生成物提交进 git，
再整树部署到 `~/.config/opencode/skills/job-apply-v2/`。`--check` 只 diff 不写。

## 十一、下一步执行事项（按依赖序）

1. `.gitignore` 写实（`.DS_Store`、`node_modules/`、`tests/fixtures/raw/`）；
   `git add -A && git commit` 首提交（当前仓库**零提交**，安全网尚未成立）
2. 补 `package.json`（`scripts.test`、`devDependencies: jsdom`）
3. 启动桥接并重新确认状态；记录 `status` 在 running 态的完整字段名
4. 开 Moka CATL 申请页跑**只读探针**：确认（或推翻）§七 的 blockSels 与加行按钮文本
5. 写 `capture-fixture.mjs`，抓 Moka 表单 `outerHTML` → 脱敏 → `tests/fixtures/`
6. 从 `skill/references/engine.md` 抽 `engine/engine.js`（原样，仅加版本头注释）
7. 从 `skill/references/adapters.md` 抽 `engine/adapters.js`，改 IIFE 幂等挂载
8. 散文迁至 `skill/references/usage.md`
9. 复制 `kimi-webbridge.zh-CN.md`、`SKILL.md`、`agents/` 入 `skill/`
10. 写四个 scripts 并首跑 `sync-skill.mjs` 验证部署到 `~/.config`
11. 引擎加固：**只做 v0.1.0 最小集 R1 / R2 / R6 / R7**（依据 `04-reality-check-2026-09-22.md` §六），
    在 Moka 端到端验证。其余见 §2.4 的触发条件
12. `npm test` + jsdom 桩
13. 写 README/AGENTS/LICENSE/CHANGELOG
14. 写 `docs/guide-v2.md`；给 v1 指南加存档指向行（v1 指南在 `~/Documents/FindAJob/docs/`，
    在 form-pilot 仓库之外，跨目录引用需写相对路径）

实施序（v0.1.0 最小集）：R1菜单归属 → R2区块ID → R6报告格式 → R7分块。
其后按触发条件解锁，01 规划原始序中 R9/R3/R4/R8/R5 均已推迟。
