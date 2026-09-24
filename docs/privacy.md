# 项目身份与隐私边界

> 本文件是 `AGENTS.md` 原 §一 的**全文摘录，未改一字**（2026-09-24 拆分）。
> AGENTS.md 正文里出现的「见 §X」引用，按 AGENTS.md 顶部的「旧章节 → 新位置」对照表换算到本文件。

---
## 一、项目身份

- 名称：form-pilot
- 路径：本机 `~/Documents/FindAJob/form-pilot/`（仓库内一律用相对路径，不写死单机绝对路径）
- 目的：浏览器表单自动填写引擎（求职申请），LLM 在循环外，循环内全是确定性 JS
- 生态位：Simplify 式 autofill（快但笨）与 Skyvern/browser-use 式 agent（聪明但贵）之间
- 不做：批量投递、绕过验证、替用户提交、替用户猜测无来源字段

**隐私边界（硬规则，不可放松）**

本项目目标是公开分发，所以个人数据与项目资产必须物理隔离：

- 真实个人信息只放 `private/`（已在 `.gitignore`）。**不要放进 `data/`** ——
  本机 `~/Documents/FindAJob/resume/data/` 是**被提交**的资产目录，同名反义。
- 档案是两个文件：字段定义（含三类分类）在 `tools/profile.schema.mjs`，值在 `private/profile.json`；
  人读镜像与 `--import` 的输入格式是 `docs/profile-template.md`。界面：`node scripts/profile.mjs --ui`。
- 档案还允许有"投放版本"：`private/profiles/<名>.json` 只存差异（`{ overrides }`），基准是 `private/profile.json`。
  **版本能覆盖什么由 `tools/profile.schema.mjs` 的 `OVERRIDABLE_KEYS` 白名单卡死**（当前 9 项：求职意向 8 项 + 自我评价），
  `validateOverrides()` / `writeVersion()` / 界面锁定三处一起挡 —— 放开会让"改手机号"变成"只改了某个版本"，而这是静默的。
- 分类只写 schema，不写进数据文件。`never` 类（证件号码等）在界面上进朱砂虚线围栏，
  且**不进任何映射**：`--render` 与 `GET /api/mapping` 的输出里一项都不许出现，有测试盯着这条。
- 写入路径由代码守着：`scripts/profile.mjs` 与服务端的任何落盘都必须落在 `<root>/private/` 内，越界直接拒绝。
- **推送前必须验证**：`git ls-files | grep -E '^private/'` 输出为空。
  把 profile 内容或附件搬进 `tests/fixtures/`、`docs/`、`CHANGELOG` 同样违规。
- 身份证号、银行卡号、密码、验证码属**永不自动填**：引擎不提供也不接受这类值，
  一律进"待你手动"清单。这条不因"档案里已经写了"而放宽。

  > **待决（2026-09-22）**：首次真实投递后，使用者提出"身份证号码你没帮我填"。
  > 这是**边界本身待他决定**，不是漏填。要放宽的正确做法是
  > **改 `tools/profile.schema.mjs` 里 `basic.idNumber` 的 `autofill` 分类**（`never` → 其它档位），
  > 走既有的三分类机制；**不是给引擎开口子**。在此之前引擎仍按 `never` 处理。
- 引擎**不读** `private/`。它只能通过 `fillTexts(map)` 收到"某字段填某值"，
  而 `字段 → 值` 的映射由用户在对话里确认（三道闸门的第一道）。

### ★ 隐私守卫：三层闸门（用户决策，2026-09-23，**最高优先级**）

**为什么是三层**：踩过三次，每次的成因都不同，只加一层挡不住下一种。

| 事故 | 成因 | 现在谁挡它 |
| --- | --- | --- |
| 手机号进了 AGENTS.md | 人工看不出真值长什么样 | 按 `private/` 逐值比对（不能只靠正则） |
| 真值在提交 A 进仓库、提交 B 才从工作树删掉 | **改工作树删不掉历史** | `--history` 模式 |
| 提交前只跑了 `npm test`，没跑守卫 | 人的记性不是防线 | `.githooks/pre-commit` 强制跑 `--staged` |

**三层闸门 + 一道事后网**：

| 层 | 命令 | 扫什么 | 何时跑 |
| --- | --- | --- | --- |
| 1 提交前 | `check-private-leak.mjs --staged` | **暂存区内容**（`git show :<path>`），不是磁盘 | `.githooks/pre-commit` 自动，**过不去就提交不了** |
| 2 推送前 / 日常 | `check-private-leak.mjs`（默认 tree） | 已跟踪文件 + `private/` 是否被跟踪 | `.githooks/pre-push` 自动 · `npm run check` |
| 3 事后审计 | `--history` | `git log -p --all` 全部历史，命中会**点名到哪个 SHA** | `npm run check:privacy:history`（人工，推送不跑它） |
| 网 | `--patterns` | 本机绝对路径 / 手机号 / 身份证号三类模式，**不需要档案** | GitHub Actions（`.github/workflows/privacy.yml`） |

- **第 1 层必须扫 index 而不是工作树**：被 `git add` 之后又在磁盘上改干净的文件，
  提交进去的仍是脏内容。这是"扫工作树"挡不住的一类绕过，别改回去。
- **失败关闭，但只对"本该有档案却没有"生效。** 区分信号是 `private/` **目录**在不在：
  目录在、档案读不出来（改名 / 误删 / 坏 JSON）→ **exit 1 拒绝比对**（这才是最危险的形态：
  以为有保护、其实根本没读到）；目录根本不在（新克隆 / 贡献者机器）→ 降级为模式判据并打告警，
  否则那边**一个提交都做不了**。旧版把这两种情况混成一句"跳过并 exit 0"（fail-open），
  一个重命名就能把守卫废掉。
- **扫描范围与判据是两个维度**：`--staged` / `--history` 是范围，`--patterns` 表示"不要求 private/"。
  可叠加 —— `.githooks/pre-commit` 在没有档案的 checkout 里跑的就是 `--staged --patterns`。
  早先把 `--patterns` 写成第三种"范围"是错的：那样新克隆里 pre-commit 只剩"堵死"和"放行"两个选项。
- **守卫自己被扫**：排除清单现在只有 `package-lock.json`。旧版把守卫自身排除，结果
  "守卫里写进真值"成了盲区 —— 落地当天就踩到一次（白名单里手滑写了真实手机号，三种模式全没报）。
- **禁止 `--no-verify`**。钩子是防线不是障碍；要绕过先改这条规则，不要在命令行上偷过。
  诚实提醒：钩子可以被 `--no-verify` 绕过，所以 GitHub Actions 那道网必须留着。
- 白名单（`ALLOW` / `ALLOW_PATTERN`）**每条必须写理由**，且 `ALLOW_PATTERN` 有 10 条上界
  （`tests/privacy.test.mjs` 盯着）。白名单是最容易被顺手放宽的地方，一涨就说明有人在消音。
- **已清（2026-09-23 删库重建）**：`npm run check:privacy:history` **现在是干净的**。
  曾经的 3 个已公开档案值走了这条完整路径：改工作树无效 → 重写历史 + force push 也清不掉
  （GitHub 仍按旧 SHA 提供对象）→ **只有删库重建能清**。这次执行的是：
  用户网页删库 → 本地 `filter-branch` 把三个值替换为泛称 → 删掉陈旧的 `origin/main`
  （它是改写后唯一还能走到旧提交的引用）→ reflog expire + `gc --prune=now` → 复核远端 404。
  **代价：全部 SHA 变了**，所以本文件里任何旧 SHA 引用都不再存在（已按此清理）。
  以后再出现"历史脏了"，照这条路径走，不要指望 rewrite + force push。
- **重建时顺手做的两件（2026-09-23）**：① 提交身份从个人邮箱改为
  `105688024+Kanrw@users.noreply.github.com`（**只设在 repo-local config**，因为全局改会波及
  使用者的其它仓库；新克隆不会继承，所以新克隆里提交会用全局邮箱 —— 别忘了）；
  ② 历史里的 `.DS_Store` 一并清掉。**唯一的本地残留**是 WorkBuddy 自己的会话检查点引用
  （`refs/agents/<session>/checkpoints/turn/*`）仍持有那两个 blob —— 那是工具状态、不在推送范围，
  故未动（要清就 `git update-ref -d` 那两个引用后 gc，代价是丢该会话的检查点）。

钩子安装：`npm install` 会自动跑 `prepare`（`git config core.hooksPath .githooks`）。
手工装：`npm run prepare`；确认：`git config --get core.hooksPath` 应回 `.githooks`。
