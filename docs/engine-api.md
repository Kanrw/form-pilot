# 引擎 API 与字段 ID 格式

> 本文件是 `AGENTS.md` 原 §六 / §七 / §八 / §十 的**全文摘录，未改一字**（2026-09-24 拆分）。
> AGENTS.md 正文里出现的「见 §X」引用，按 AGENTS.md 顶部的「旧章节 → 新位置」对照表换算到本文件。

---
## 六、引擎 API

文件：`engine/engine.js` —— **已落盘**。全部挂 `window.__ja`，单文件 IIFE，幂等。
标 ⏸ 的条目按 §2.4 推迟：**触发条件出现前不实现，也不在 engine.js 里留占位或骨架。**

```
__ja.version                                   → '0.1.0'（三处一致，见 §十 同步方案）
__ja.use(adapter)                              → adapter.name（Object.assign，可重复调用）
__ja.detect()                                  → 'moka' | 'beisen' | 'generic'
__ja.scan()                                    → {total, fields:[{id,block,label,type,required,value}],
                                                  manual:[{id,type,reason:'adapter-manual'}],
                                                  emptyRequired:[id]}__ja.readAll()                                 → [{id,block,label,type,value}]
__ja.addRow(kind)                              → {ok,kind,from,to,added} | {ok:false,err:'section-not-found'
                                                  |'add-button-not-found'|'row-not-added'|...}
__ja.fillTexts(map)                            → {ok:number, failed:[{id,phase,err,attempted,final}],
                                                  retried:[id]}
__ja.pickOption(id, text, {search=true})       → {ok,value} | {ok:false,err:'field-not-found'
                                                  |'manual-required'|'menu-not-open'
                                                  |'option-not-found'|'item-detached'}
__ja.fillDate(id, 'YYYY-MM-DD')                → {ok,wrote,after,unfilledInputs} | {ok:false,err:
                                                  'field-not-found'|'not-a-date-field'|'manual-required'
                                                  |'bad-ymd'|'select-based-date'
                                                  |'no-date-inputs'|'input-count-mismatch'
                                                  |'readonly-unverifiable'|'not-stuck'}
__ja.fillMonthRange(id, from, to)              → {ok,from,to,picks,assumed?,displayAfter?} | {ok:false,err:
                                                  'field-not-found'|'not-a-month-range'|'bad-ym'
                                                  |'range-selects-missing'|'select-detached'|'menu-not-open'
                                                  |'option-not-found'|'item-detached'|'display-not-updated'}
⏸ __ja.probeEnv()      ⏸ __ja.snapshot()      ⏸ __ja.setPlan(ids)
⏸ __ja.setChoice(id,v) ⏸ __ja.diff()
```

- **版本号仍是 `0.1.0`，即使接口已经涨过两次**（`fillDate`、`fillMonthRange`）。
  D-5 的三处版本号里有两处（`skill/SKILL.md` frontmatter、`CHANGELOG.md`）是 Phase 3 的交付物，
  目前还不存在。现在单方面把 `engine.js` 提到 `0.2.0`，只会造出一个"三处不一致、
  却没人能跑 `--check` 断言"的状态 —— 版本对齐跟 Phase 3 一起做。
- `type` 枚举：`text | textarea | file | select | date | cascade | choice | unknown`。
  `fillTexts` 只处理 `text`/`textarea`，其余跳过并在 `failed[].err` 里归类为 `not-text:<type>`。
- **3-5 分钟哲学的机制化（2026-09-22 晚，北森复盘三项修复，82 例测试）**：
  1. **manualTypes**（适配器声明，如北森 `['select','date','cascade']`）——scan() 直接把
     这些类型归入 `manual` 清单；pickOption/fillDate 在**入口**即报 `manual-required`
     快速失败，不进入开菜单/等待循环。杜绝"换个通道再试 25 轮"复发。
     `emptyRequired` 只收 manual 之外的空必填，两个清单合起来就是使用者的人工待办。
     **★ 口径（2026-09-23 更正）**：`manual` 的含义是「**引擎填不了**」，**不等于「只能人工」**。
     北森那类自定义下拉可以交给 `scripts/choose.mjs`（真实坐标点击，两站实测 11 中 9）。
     正确流程是：scan → 非 manual 的走引擎 → manual 的先试 choose.mjs → 驱动也填不了才进人工待办。
     照旧读成"这一列都得我自己点"，会把本来能自动化的字段白推给使用者。
  2. **复合字段拒绝写入**（修复"报 ok 实际填错"的静默缺陷）：盒内有多个可见 input 且
     适配器未声明 `numberInputSel`（角色选择器）时，fillTexts 报 `composite-field` 拒写，
     一个字节都不落。声明了角色选择器则写入与回读走同一个 `pickInput()`——
     自检不再"两边错到一起"。Moka 手机号未实测类名，**不声明**——它会明确失败而不是静默填错。
  3. **解析值沿用 + 核对**（见 §七修订）：scan 的 `emptyRequired`/`manual` 分组就是
     提交前的核对清单，取代"解析输出一律不用"的旧策略。
- **日期字段多为"年/月/日"若干文本框，不是下拉 —— 先试直填，别默认走 `pickOption`。**
  缺月份的按用户规则用 `01`（`2022` → `2022-01`），补了什么在 `assumed` 里报出。
  区间字段只填起始、结束留空即"至今"，未填个数在 `unfilledInputs` 里报出。
- **但三种形态里有一种是选择式的，`fillDate` 盖不住：「月区间」用 `fillMonthRange`。**
  实测 Moka 的 `date_info` 有**两个变体，同名组件不同下拉数**：
  「就读时间」= 4 个下拉（起始年/月 + 结束年/月，**一个文本框都没有**）；
  「毕业时间（月）」「英语证书获得时间」= **2 个下拉（年 + 月，单月不是区间）**。
  容器类名都是 `month-range-select`。
  `fillDate` 在这类字段上会先往下拉内部的 input 里写字、再报 `display-not-updated` ——
  结论没错（没谎报成功），但控件已被污染。所以 `fillDate` 现在**动手之前**就识别并返回
  `select-based-date`，并指名该用 `fillMonthRange`。
  `fillMonthRange(id, from, to)`：**`to` 传空串 = 单月（只用 2 个下拉）/ 至今**，
  传起止 = 区间（用 4 个下拉）；下拉数不足报 `range-selects-missing` 而不是硬填。
  月份越界（如 `2023-13`）在这一层就 `bad-ym` 拦掉 —— 放过去会走到下拉里报
  `option-not-found`，把排查引向站点改版，而真凶通常是档案里的日期写错了。
- **「学校名称 / 专业名称」是联想输入（type-ahead），不是普通文本框（2026-09-22 实测）。**
  这两个字段下面挂着候选面板。实测看到的内容：
  学校 = `<示例大学>` / `<示例大学>继续教育学院` / `<示例大学>网络教育学院` / `<示例学院>`；
  专业 = `<示例专业>` / `物理学` / `没有找到专业？添加专业全称`。
  （此处只记录控件形态，真实候选值属个人数据，不入库。）
  `fillTexts` 只把文本写进 input，**不从候选里确认**，后果有两层：
  ① 值不被应用正式接受（看着填好了，应用不一定认）；
  ② **候选面板一直挂在页面上** —— 实测使用者因此在操作表单时被反复干扰，
  最后手动清空了 `学校名称` ×2 与 `专业名称` ×1（原话："下拉选项一直浮现"）。
  **正确做法**：写完文本后从候选面板里**点选对应项**让应用确认，然后收起面板。
  `pickOption` 的"点触发器 → 选菜单项"正好是这个动作，但**尚未在联想输入上验证过**。
  注意候选值未必等于档案值（档案写 `<示例专业>（<示例班>）`，候选只有 `<示例专业>`），
  这种不一致不要自作主张改数据，要走确认。
- **级联（如「籍贯」）按 `01 §R4` 既定策略一律 manual**：三级面板 + 异步加载 + 重名地区
  （全国几十个"朝阳区"），自动化收益低风险高。实测它表现为一个 readonly 输入框
  （placeholder `请输入籍贯`），合成点击没能唤出面板 —— 更该留给使用者手动。
- **★ 一个字段盒子里可能有多个 input，「取第一个」是错的（2026-09-22 实测，使用者发现）。**
  Moka 的「手机号码」是 **国际区号（`+86`）+ 号码输入框** 的复合形态。`fillTexts` 写的是
  `box.querySelector(A.textInputSel)` —— **盒子里第一个 input，也就是区号那一个**；
  实测把整个 `<11位号码>` 灌进了 `+86` 的位置。
  更糟的是 `valueOf` 读的也是第一个 input，**写入与回读都指向同一个错的地方**，
  于是 `fillTexts` 报 `ok: true`，**自检完全失效** —— 这是"两边错到一起"的失败，比明确报错危险。
  修法方向：适配器给这类字段声明**角色选择器**（如 `numberInputSel`），按角色定位而不是按序号。
  **未修之前不要往这类复合字段写完整值。**
- **★ 日期字段的形态是站点级差异，必须靠适配器声明，引擎不要猜（2026-09-22 实测三种）**：

  | 站点 · 字段 | 形态 |
  | --- | --- |
  | Moka「就读时间」「毕业时间（月）」「英语证书获得时间」 | **选择式月区间**：`month-range-select`，2 个下拉（单月）或 4 个（区间） |
  | Moka「项目经验 起止时间」 | **年 / 月 / 日 各一个独立框**（区间 = 两组共 6 框） |
  | 北森 | **一个框内完成年月日选择**（单个 picker） |

  本次踩的坑：`scan()` 把「起止时间」报成 `type: 'text'`，我照着当文本框填了
  `2021-09 -- 2024-06` —— 全错。
  **判据：填日期前先看 DOM 里到底有几个框、是不是下拉，不要只看 `type` 字段。**
  `type` 是启发式/类名映射推出来的，它说 `text` 不代表真的只有一个文本框。
- **日期字段最容易撒谎的一点：值可能根本不在 `<input>` 上。**
  实测 Moka `就读时间`：`input.value` 写进去了、重渲染后还在，但应用把真实值渲染在
  `sd-Input-display-value` 里且**那几个是空的** —— 看起来填好了，提交时是空的。
  所以规则是：**字段内存在 display 元素时，一律以 display 为准**（`verifiedBy:'display'`），
  它为空的场景返回 `display-not-updated`；没有 display 元素才回退到 input 比对（`verifiedBy:'input'`）。
  不要用 `readonly:false` 反推"能直填" —— 这个结论我犯过一次，见 04 审查的教训。
- **只读日期控件（如 Moka `出生日期`）一律 `readonly-unverifiable` 转人工**，见 `fillDate` 注释。
- `phase` 枚举：`locate | fill | verify`。
- **文件上传不经引擎**：JS 拿不到 File 对象，走桥的 `upload` 动作，引擎不提供上传接口。
- `scan`/`readAll` **没有分页参数**（§2.4 已删）。返回值超限再说。

### 选择类字段的驱动：`scripts/choose.mjs`（2026-09-23）

R3 `setChoice` 的触发条件（北森实际投入使用）已在方正 PCB 的真实投递中满足，但它**没有**落地成
`__ja.setChoice`，而是落在驱动层 —— 有效通道是扩展的真实坐标点击，页内拿不到。这是
§八 降级链的第 2 步（CDP 坐标点击）被走通，不是第 1 步（合成事件）复活。

```
node scripts/choose.mjs --session <名> --options "<字段>"          # 只开菜单导选项，不选
node scripts/choose.mjs --session <名> --set "<字段>=<值>" ...      # 逐个开→点→回读
node scripts/choose.mjs --session <名> --set "学历#2=硕士研究生"    # #n = 第 n 个同名字段（1 起）
```

- 每个字段的**标记与点击必须原子**：`data-ch` 标记跨一次桥往返就可能被 React 重渲染换掉节点
  （实测 `click: element not found: [data-ch=opt]`）。别把"标记"和"点击"分到两次 agent 调用里。
- 回读走应用侧 display（`verifiedBy: 'display'`），不看 `input.value` —— 与引擎同一口径。
- 选项匹配：精确 → 去括号/空格 → 唯一包含；**≥2 个候选报 `ambiguous` 而不是挑一个**，
  一个都不命中就报 `none` 并把选项列表回给调用方去人看。纯函数有单测（`tests/choose.test.mjs`，11 例）。
- 菜单异步渲染的重试靠**多次桥往返**（每次往返本身就是真实等待），不用定时器 ——
  后台标签页里定时器被节流，那正是引擎 `tab-hidden` 的成因（见 §四）。

**内部方法命名（固定，不许现编）**：
`sleep / norm / trunc / j / setNativeValue / synthClick / fields / labelOf / heuristicType / typeOf /`
`firstTitle / rowIndexOf / sectionOf / sectionByKind / groupCount / readSelect / valueOf /`
`isRequired / entries / findField / visibleMenus / menuItems / matchItem / closeMenus / openMenuFor / chooseIn`

内部规约（不可违反）：
- 元素引用不得跨 sleep 复用（stale 免疫）
- 菜单操作必须串行 —— 由调用方保证；引擎 0.1.0 **不加 `_busy` 锁**（见 §2.4 R8）
- 返回值一律 compact `JSON.stringify`，无空格；**所有**字符串字段截断 200 字符
  （含失败报告里的 `attempted` / `final`）
- `firstTitle` 固定用宽选择器，不用 `A.labelSel`：区块标题的父元素类名各站点不同，
  而标题在 DOM 序上先于区块内字段

## 七、适配器字段 ID 格式

```
<kind>[<rowIndex>]>><label>    # 区块命中（kind 来自适配器 blockSections）
main>><label>                  # 非区块字段
main>><label>#<n>              # 同上，但 label 在同一次 scan 内重复（n≥2）
<label> / <label>#<n>          # 适配器未声明 blockSections 时的降级形态
```

Moka 实测样例（2026-09-22）：

```
edu[0]>>学校名称       edu[0]>>就读时间     edu[0]>>受教育类型    edu[0]>>学历
edu[0]>>院系           edu[0]>>专业名称     edu[0]>>研究方向      edu[0]>>GPA
intern[0]>>是否有实习经历                    skill[0]>>英语等级
main>>推荐码           main>>是否内推        main>>上传简历
```

**4 级结构（实测）**：`apply-blocks-*`(1) → `apply-block-*`(16 个区块) → `apply-fields-*`(行分组)
→ `apply-field-*`(49 个字段)。`kind` 由区块标题前缀匹配 `blockSections` 得出；
`rowIndex` 是该字段所在行分组在区块内的序号（0 起）。

**ID 必须单射。** 它是 `fillTexts(map)` 的 key，重名即静默填错字段。
Plan 01 R2 原本只对 `main` 前缀消歧，实测发现非重复区块之间也可能撞名，故 `main` 分支同样加 `#n`。
**已验收**：Moka 页 scan → `total 49 / unique 49 / duplicate 0`。

**已知的结构变更源（都会让 ID 漂移，必须重新 scan）**：

| 变更源 | 实测影响 |
| --- | --- |
| 站内"添加一行" | 未验收（`addRow` 还没在真实页跑过） |
| **上传简历触发站内解析** | **已实测（2026-09-22 Moka）**：教育经历 1 → 3 行、项目经验 1 → 3 行，字段总数 49 → 67（稳定后；此前记的 56/68 是解析中途的读数）；解析器还会**覆盖已填字段**，清掉了我先填的 `学校名称`／`研究方向`／`是否有项目经验` |

> **硬规则（2026-09-23 修订，用户决策）：默认不上传简历。**
> 旧规则"上传简历是整个流程的第一步"已作废 —— 多数站点的解析器会**重新解析并覆盖表单里已有内容**，
> 在已经有正确值的表单上再传一次等于自毁。实证：方正 PCB 重传后本科被拆成两行（行3 的专业名
> 变成了简历里的"培养类型"、行4 丢了学校名称）；Moka 实测同源，解析清掉了我先填的
> `学校名称`／`研究方向`／`是否有项目经验`。
>
> 现在的口径，按顺序：
> 1. **先 scan，看这页已经有什么**。有值的字段不会因为传简历变得更多。
> 2. **只在两种情况下上传**：① 表单**全空**且没有更省的填法；② 使用者明确要求。
> 3. 传完必须等解析稳定（实测 **4 秒内**）→ rescan → **逐字段核对解析覆盖或改写了什么**，
>    尤其是日期与带"培养类型"的教育行（见 §十三 已知副作用）。
>
> **ATS 简历 PDF 模组（§十三）默认不启用** —— 它是按需调用的工具，不是流程的第一步。

> **旧版原文（留档，别再照做）**：「上传简历是整个流程的第一步，等解析跑完、结构稳定后再
> scan、再填。反过来做，等于把自己刚填的内容交给解析器覆盖。」——这条只对"表单全空"成立。

### ★ 站内解析输出：逐字段核对后可沿用（用户决策修订，2026-09-22 晚）

> 旧版（Moka 实测后）：「解析的输出一律不用」。北森实战（同日，粤芯）推翻了一刀切：
> 解析自动填对约 60% 字段（姓名/性别/手机/教育三段/项目一/技能名与掌握程度），
> 引擎实际只补解析不覆盖的 22 个文本字段（批填全中）。两个站点数据相反，
> 说明**解析质量是站点变量，不是常量** —— 策略从"不用"改为"沿用 + 核对"。

**规则（3-5 分钟哲学：把轮次花在增量上，不花在重填上）**：

1. **"不重传"与"沿用解析值"是两件事**：站点自带的解析结果（或使用者早先传过的那次）直接
   rescan 沿用；默认**不再上传**，见本节开头的硬规则。只有在表单全空时才考虑上传。
2. **解析值默认沿用**，不再全量重填。
3. 提交前核对靠 scan 的两个分组（2026-09-22 机制化）：
   `emptyRequired`（空必填，必须处理）+ `manual`（适配器免疫类型，直接归手动）。
   核对动作 = readAll 输出与档案逐字段比对，使用者过目后再提交。
4. **教育行的口径污染警告保留**（Moka 实测）：解析按简历的切法生成行
   （本科 / 硕博连读 / 境外交流），档案的切法是（本科 / 硕士 / 博士）。
   行切法不一致时**以档案为准重排**，不要围绕解析的切法分析。
5. 日期类解析痕迹仍不可信（Moka 实测：写入的 `01` 被应用解成"暂无选项"，
   input.value 有值、应用侧为空）——日期字段核对时以应用侧显示为准，不看 input.value。

Moka 旧数据留档（89 字段那次）：解析填对 6 个（≈7%）、填错 4 个、
教育三段该填的全空。那次"沿用不划算"的判断在当时成立；机制化之后，
沿用与核对的成本由 scan 分组兜底，不再依赖会话现场判断。

**未验收**：`addRow` 之后的 ID 稳定性（加一行 → 出现 `edu[1]>>` 且 `edu[0]>>` 不变）。

## 八、故障降级链

合成事件 → CDP 坐标点击（`Input.dispatchMouseEvent`）→ 列入"待用户手动清单"
（不在一个控件上反复重试）。

## 十、同步方案（唯一事实源）

采用构建脚本单向同步（方案C）：`scripts/sync-skill.mjs` 把 `engine/*.js` 复制为
`skill/references/*.js`（注入 GENERATED 头，禁手改），生成物提交进 git，
再整树部署到 `~/.config/opencode/skills/job-apply-v2/`。`--check` 只 diff 不写。
