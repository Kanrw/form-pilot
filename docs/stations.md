# 适配器注册表与站点实测

> 本文件是 `AGENTS.md` 原 §五 / §十四 的**全文摘录，未改一字**（2026-09-24 拆分）。
> AGENTS.md 正文里出现的「见 §X」引用，按 AGENTS.md 顶部的「旧章节 → 新位置」对照表换算到本文件。

---
## 五、适配器注册表

文件：`engine/adapters.js` —— **已落盘**（IIFE 挂 `window.__jaAdapters`，幂等）。四个注册项：

| 适配器 | verified | source | fieldSel |
| --- | --- | --- | --- |
| `moka` | `2026-09-22` | CATL 校招申请页（只读探测） | `[class*=apply-field-]` |
| `beisen` | `2026-09-22` | 粤芯半导体校招申请页（L2+L3 部分，选择类控件未攻克） | `.form-item` |
| `feishu` | `2026-09-22` | 记忆科技校招申请页（只读探测，L3 未跑） | `[class~="atsx-form-item"]` |
| `generic` | `null` | `builtin` | 空（走引擎默认：input 就近容器） |

**feishu 与 moka 的根本差异（2026-09-22 实测）**：类型写在**内部组件**类名上
（`atsx-select-search` / `atsx-date-picker`），字段盒子只有 `atsx-form-item` 一个 token，
且下拉 input 非 readonly —— 启发式的旧两条判据全部落空，typeMap 无从写起（盒子上没有类型 token）。
**引擎为此新增了子树判据**（`heuristicType` 在 cls/readonly 之前查组件类名），
同轮顺带覆盖了 Moka `bool_info` 那类失败。选择器必须用 `~=`（完整词匹配）：
裸 `[class*=atsx-form-item]` 实测命中 156 个节点，真盒子只有 28 个。
字段名事实源是 `<label>`；`[class*=fieldName]` 的 textContent 会混入已填值（"意向城市东莞"）。
「意向城市」「手机号码」是**只读展示**（值来自账号资料，盒内无 input），scan 报 `unknown` 属正确语义。
`起止时间` 是 `atsx-date-picker-period-month` 月区间 —— `fillMonthRange` 的第二个站点。

**moka 的选择器（实测）**：

```
fieldSel         [class*=apply-field-]     ★ 尾横线不可省，见下
labelSel         [class*=title]
menuSel          [class*=sd-Select-menu],[class*=sd-Menu-container]
itemSel          [class*=sd-Menu-content-item]
valueSel         [class*=sd-Input-display-value]
blockSectionSel  [class*=apply-block-]     区块
blockGroupSel    [class*=apply-fields-]    行分组（行索引来源）
rangeSel         [class*=month-range-select]          选择式月区间容器
rangeSelectSel   [class*=sd-Select-container]         区间内 4 个下拉（起始年/月、结束年/月）
addText          '添加'
typeMap          string_info→text / select_info→select / bool_info→select /
                 Select→select / multi_select_info→select / day_info→date /
                 date_info→date / location_info→cascade / confirm_info→choice /
                 file_upload→file / portrait_upload→file / custom_file_upload→file
blockSections    edu 教育背景 / intern 实习经历 / proj 项目经验 / scholar 获奖学金经历 /
                 campus 校内活动经验 / paper 核心期刊论文发表 /
                 patent 个人专利/发明 / contest 竞赛经历 / skill 技能/爱好
```

**四条实测校正（2026-09-22，别再退回）**：

1. **`fieldSel` 的尾横线**。裸 `[class*=apply-field]` 会同时命中 16 个复数行分组容器
   `apply-fields-*`，把 wrapper 当字段（实测真字段 49 个 → 误报 65 个）。
2. **`bool_info` 是下拉，不是文本框**。它是 `sd-Select-container` + `sd-Input-display-value`，
   且 input **不是** readonly → 引擎的启发式（类名含 select？占位符含"请选择"且 readonly？）
   两条都落空 → 会误判成 `text` → 往下拉输入框写值不生效且不报错。所以必须走 `typeMap`。
   `location_info`（籍贯）同理曾是漏网之鱼。
3. **加行按钮的文本是"添加"两个字，页面上 6 个按钮全叫这个**。规划里写的
   `addRowText: '添加教育经历'` 不存在于 DOM。按文本匹配必然选错，只能区块内定位；
   `addRow` 用"区块内定候选 → 取文本最短者 → 行分组计数 +1 验证"（见 §六 内部方法表）。
4. **`menuSel` 的两个选择器是父子关系，不是并列关系。** `[class*=sd-Menu-container]` 命中的是
   每个选项**外层容器**，而它就长在 `[class*=sd-Select-menu]` 面板内部 —— 点开「民族」一个下拉，
   `visibleMenus()` 返回 **59** 个元素（1 个面板 + 58 个单项容器），不是 1 个。
   表征：`pickOption` 失败报告里的 `menus` 字段会报 59，让人以为同时弹了 59 个菜单。
   **修法在引擎侧**（`visibleMenus()` 做"嵌套只留最外层"），**不要删适配器里的
   `sd-Menu-container`** —— 别的下拉形态可能只渲染后者，删了会静默少一类菜单。

**北森实战记录（2026-09-22，粤芯 cansemitech.zhiye.com，L3 部分完成）**：

- **已攻克**：div.phoenix-radio 单选（R3 setChoice，`--checked` 验证）；普通 `.phoenix-selectList`
  下拉结构确认；`.form-item` + `label` 字段盒（与 v1 指南猜的一致）；「添加项目经历」等
  加行按钮是 `sc-jeraig` 叶子 span，**合成 pointer 五件套点叶子才生效**（WebBridge 真实 click
  会被解析到外层容器，点不动按钮）；fillTexts 批填 9/9 全中。
- **未攻克（本会话约 25 轮调用）**：**editable select（`phoenix-select--editable`）全部免疫**，
  覆盖日期下拉（开始/结束时间）与区域级联（籍贯/城市）。实测无效的通道：
  ① native setter + input 事件；② WebBridge 真实 click + key_type；③ CDP `Input.insertText`
  （focus 保持但值不落）；④ CDP `Input.dispatchMouseEvent` 真实坐标按下/抬起；⑤ 合成
  pointer/mouse 五件套（点 input、点 `.phoenix-select__switchArrow` 都不开菜单）。
  区域级联面板（`common-unmodeled-layer` + `area-text-label`）能开但点击只是导航，
  勾选控件是行内 SVG 图标（`area-icon-RadioUnchecked`），同样点不动。
- **★ 上述结论已被推翻（2026-09-23，方正 PCB `founderpcb.zhiye.com`）**：不是控件免疫，
  是**那 25 轮尝试全打在视口外的坐标上**。实测那个触发器 `getBoundingClientRect().y = -1288`
  （页面根本没滚到它）。唯一有效的通道就是**扩展的真实坐标点击**，顺序为：
  `scrollIntoView({block:'center'})` → 桥 `click` 触发器 → 菜单**正常打开**
  （选项是 `.phoenix-selectList__listItem`，面板可能挂在 portal 上，得按"出现在触发器正下方"
  做 rect 就近过滤）→ 再桥 `click` 选项 → 应用侧 display 更新。**单场 9 个单选 8 中。**
  落地成 `scripts/choose.mjs`（驱动层，见 §六 末）。**页内合成事件仍然无效**，别回去试。
- **仍未攻克：多选**（选项里有「全选」、面板底部有 `.phoenix-button` 的「确定」）。实测
  点选项 + 点确定后应用侧 display 仍是「请选择」（盒内也没有 chip 出现），2 次尝试后按
  §2.8 红线放弃，归 manual。下一步该看 `.phoenix-selectList__listItem` 内部的勾选控件是什么节点。
- **站内简历解析器是最大的填充者**：上传 PDF 后自动带入约 60% 字段（姓名/性别/手机/教育三段/
  项目一/技能名与掌握程度/证书区骨架）。引擎的增量价值在解析器不覆盖的部分：
  专业名称 ×3、实习区、加行后的 3 个项目组、全部技能描述——fillTexts 一次调用全中。
  **旧口径"每个站点的 L3 第一步都是先传简历、等解析、再 rescan"已作废**，见 §七 的默认不填规则。
- **教育段的港大交换（开始 2024-01）结束时间待使用者确认**，档案无此值，未瞎填。

## 十四、Element Plus 型站点：新凯来 `career.sicarrier.com`（2026-09-24 实测）

Vue 3 + **Element Plus** 的校招站，与已有四种适配器（Moka / 北森 / 飞书 / generic）都不同：
字段盒子是 `.el-form-item` + `.el-form-item__label`，**页面上没有 `.form-item`** →
`filltext.mjs` 的 `pickField` 与 `choose.mjs` 在这一站**直接不适用**，本轮四个区（基本信息 /
项目经历 / 教育经历 / 发表论文）全部靠一次性脚本完成。表单在 `#/createCampus`（先到 `#/center`
点「创建简历」才会出现），左侧导航是**分区渲染**，切换只渲染当前区。

### 已实测的交互规律（可直接复用）

| 字段类型 | 写入 | 回读 |
| --- | --- | --- |
| text / textarea | 原生 setter + `input` + `change` | `el.value` |
| date（`el-date-picker`） | 同上 + `keydown Enter` + `blur` | `el.value` |
| select（`el-select`） | 点 `.el-select__wrapper` 开 → 可见下拉里精确匹配文本 → `hit.click()` | ★ `.el-select__wrapper.innerText` |
| 远程搜索 select | 开 → wrapper 内 input 写关键词 → 等 ~1.5s → 精确匹配 | 同上 |
| radio（是/否） | 点 `.el-radio__label` | `.el-radio.is-checked`（**不可取消**，改选只能点另一项） |

- 读下拉选项：取**所有可见** `.el-select-dropdown`（`offsetParent !== null`）再匹配。
  **不要用 `aria-controls` / `aria-expanded` 关联**——实测会串到别的下拉（把排名+学历的选项读成"学校所在地"的）。
- **回读铁律**：el-select 的选中值读 `.el-select__wrapper.innerText`。读组件内部子节点
  （`.el-select__selected-item`）在某些字段拿到空串，会把"已选成功"误判成"失败"。
  判据是"人眼看到的那个文本在哪个节点"，不是结构上更该在那儿的节点。
- 每选完一个 select，下拉会自行关闭；**不要连击多个 select**。
- **「新增」按钮每次生效需 ≥1.5s**，连点会丢（实测连点 3 次只加 1 行）。
- **删除行会弹 `el-message-box` 确认框**，不点「确定」就再点删除 → 弹窗**叠加**、行数不变（实测叠到 5 个）。
- 动态字段：`学历` 选中「博士研究生」后，行内**多出** `本科直博或硕博连读`（是/否），选区换代后才会出现。
- 该站 `论文详情` textarea 有 **500 字上限**（输入框右下角有 `n/500` 计数器）。

### ★ 本轮踩到并已纠正的两处（别再退回）

1. **切分区的点击会被弹窗吞掉**：`el.click()` 返回成功，但若此时有 message-box 挡着，
   分区根本没切——**必须靠"该区特征 label 集合是否变化"验证**，不能信 click 的返回值。
2. **「保存」不是存草稿**：切区时弹的「是否保存当前变更内容？（取消 / 保存）」，点**保存**会直接走
   提交校验，回执是「当前表单必填字段未填写完整，请补充后再提交」（这个回执只有「确定」一个按钮）。
   结论：**在通过校验的「保存并提交」之前，所有填写都只在页面内存里，刷新即丢**。

### 可优化点（本轮暴露，按触发条件排序；未实现的不写代码）

| # | 问题（有实证） | 建议 | 触发条件 |
| --- | --- | --- | --- |
| 1 | 控件定位与回读**没有跨框架抽象**：`filltext.mjs` 硬编码北森 `.form-item`，遇到 `.el-form-item` 就等于每次重写一次性脚本（本轮 4 个区、约 20 个临时脚本） | 抽 `tools/dom.mjs`：`boxes(root, framework)` + `readDisplay(el)`（select→`wrapper.innerText` / radio→`.is-checked` / 其余→`value`） | **再遇到第二个 Element Plus 站点**——只有一个站点时抽象等于猜 |
| 2 | 回读口径不统一导致**误判"写入失败"**并重复点击（学校所在地那次） | 见上表「回读铁律」；`readDisplay` 落地时把这条写成单测 | 与 #1 同一批 |
| 3 | **落库语义没有在动手前先探一次**：填完 4 个区才发现「保存」= 提交校验、数据只在内存 | 新站点开工第一步探「提交路径」：找入口 → 点一次 → 读回执 → 明确告知用户"是否已落库 / 能不能刷新"。写进 §2.6 的开工清单 | **立即适用**（纯纪律，零代码） |
| 4 | **有后果的点击没有闭环**：删行不点确认会叠加弹窗；新增连点会丢行 | 点击 → 等 → 读回执/计数 → 校验，**四步同脚本完成**；校验未过不发第二次同类点击 | 立即适用 |
| 5 | 切区**没有内容级验证**（见上「踩到两处」第 1 条） | 切区后必读一次特征 label 集合 | 立即适用 |
| 6 | 值**本可以经终端/对话回显**：本轮靠"node 读档案 → 拼进 evaluate → 只打印长度与 ok"规避 | 把这个模式固化成脚本骨架（如 `scripts/evalcode.mjs`），避免每次手写；注意值仍会出现在 HTTP body 与页面里，属必要暴露 | 第三次手写同一段样板时 |
| 7 | **按 label 出现序号寻址行**（`label#n` 口径）本轮在 3 行教育 / 4 行项目 / 7 行论文上全部有效，但只写在 `choose.mjs` 里 | 提升为跨框架公共约定写进文档，与 #1 一并落地 | 与 #1 同一批 |
| 8 | **"某类条目不想投"靠手工删行**（本轮删掉 3 行审稿中论文，要逐行点删除 + 确认框） | 用已有的**投放版本（overrides）**机制承载，例如版本里声明只投「已发表」 | 第二次遇到"某类条目不想投" |
| 9 | 给 `publications` 加字段时**只改 schema 会让测试变红**（`tests/profile.test.mjs` 断言"schema 每个字段都能在 `docs/profile-template.md` 找到"） | 这是测试在正确工作：**加字段必须 schema + 模板两处同改**。已在同一提交内修好 | 立即适用（已固化为事实） |

### 本轮交付（供对照）

- 基本信息 / 项目经历（4 行）/ 教育经历（3 行）/ 发表论文（先 7 行、后按用户要求删到 4 行已发表）均已填并逐项回读。
- 档案侧：`publications` 新增 `publishDate` 字段（schema + 模板同步，提交 `047ca2c`）；用户偏好
  **"简历只写已发表"**（档案仍保留审稿中的条目，"写不写"在填表时决定）。
- 未提交：必填区（求职意向 / 语言情况 / 亲属信息）与教育区 3 处「学习成绩排名」未填，
  该站校验不放行，故数据尚未落库。

## 十五、华为自研组件库站点：`career.huawei.com`（2026-09-24 实测）

华为自研 ATS，组件库是自研的 **`aui-` 前缀**（既不是 Element Plus，也不是北森/Moka 那几套）。
入口 `personal-center?pageType=editResume&recType=CR`（`CR` = 校招简历）。
字段盒 `.aui-form-item` + `.aui-form-item__label`（label 带 `for` 关联控件 id）
→ `filltext.mjs`（硬编码北森 `.form-item`）与 `choose.mjs`（走桥的真实坐标点击）在这一站**都不适用**，
本轮全部靠一次性脚本。

> **「新站点」≠「新增适配器」。** `engine/adapters.js` 的四个注册项**本轮一个没动** ——
> 先把事实摸清、记在本文件；是否抽象成第五个适配器，等**第二个同类站点**出现再说
> （触发条件同 §十四 可优化点 #1：只有一个站点时的抽象等于猜）。

### 站点形状

- **一次渲染全部 68 个 `.aui-form-item`**（不像新凯来是分区渲染）→ 全表可一次扫完，不必切区。
- 左侧目录 5 项：基本信息 / 教育经历 / 工作经历 / 其他信息（下含 语言情况·发表论文·发明专利·
  参加学术会议·竞赛奖项·奖学金·附件·华为相关经验·其他）/ 简历保存。
  ★ **但条目化模块（项目经历、发表论文…）是独立的 `.module-container`，不在目录里** ——
  只扫侧栏目录会**漏掉整个模块**（本轮差点漏掉「项目经历」）。
  **新站开工先枚举 `.module-container` 全集，再去看目录。**
- 站内有「简历解析」拖拽/选文件自动填充入口（本轮未用；注意 §七 的"默认不上传"规则仍在）。
- 有二级目录（其他信息）与"条目化模块"两套结构并存，别用一套选择器套全场。

### 已实测的交互规律（可直接复用）

| 字段类型 | 写入 | 回读 |
| --- | --- | --- |
| text / textarea | 原生 setter + `input` + `change` | `el.value` |
| 日期（`.picker`） | 同上 + `keydown Enter` + `keyup Enter` + `blur` | `el.value`（失焦后再读一次） |
| 下拉（`.aui-select`） | 点**它内部的 `input`**（pointerdown+mousedown+mouseup+click）→ 可见面板里精确匹配文本 → `hit.click()` | `.aui-select input`.value |
| radio | 点它的 `<label>` | `input[type=radio]:checked` 的 label 文本 |

### ★ 九条实测校正（别再退回）

1. **打开 `.aui-select` 必须点它内部的 `input`**。打在 `.aui-select` wrapper 上的合成点击**不生效**
   （面板恒 `0x0`，同参数重试无效）；点内部 input 后实测面板 `160x182` 出现。
2. **判断"菜单开了没"不能用 `offsetParent`**：面板挂在 `BODY > div.animate-onscroll` 的 popper 上，
   打开后 `offsetParent` 仍可能为 null。改用「沿祖先走 `computedStyle` 排除 `display:none`/`visibility:hidden`」
   + `getBoundingClientRect().height > 0`。
3. **下拉面板是 30 个按字段顺序预渲染在 body 上的独立 popper**（每个 select 一个）：
   定位必须「在所有**可见**面板里精确匹配文本」，**不能按 `dds[dds.length-1]` 取最后一个**
   （本轮据此取错，报 `no-exact-match` 且候选列表为空）。
4. **radio 的 input 自身 `height: 0`**：用几何判据筛控件会把 radio **全漏掉**，把"已选"误报成"必填未填"
   （本轮踩到，一度以为原值被写丢）。
5. **条目化模块的标题文本是 `发表论文-1删除`（序号 + 删除二字）**：匹配模块名要
   **先剥 `删除|添加`、再剥尾号 `-N`**。顺序反了一条都匹配不到（本轮先剥序号 → 数成 0 条）。
6. **「添加X」按钮是 `BUTTON.aui-button`，内部还有一个 span**：用"无子元素"当叶子判据会把它整个漏掉
   （实测报 `add-btn-missing`）。每点一次新增要等 **≥2s**。
7. **`innerText` 不含 `<input>` 的 value**：拿"读容器文本"当独立回读路径会**全报缺失**（本轮虚惊一场）。
8. **必填判据别信 class**：条目化模块的 label **不带** `is-required`。确定性做法是读伪元素 ——
   `getComputedStyle(label, '::before')` 的 `content === '"*"'` **且** 颜色为 `rgb(245, 34, 45)`（华为红）
   才判必填，`content: none` 即可选。
   **据此才发现：`主要职责与业绩`、`民族`、`自我评价` 其实都是可选**（不是必填）——
   靠 class 判会既漏必填又误判可选。
9. **照片/附件不是 input**：`个人照片` 是 `<img src="blob:...">` + `input[type=file]`，
   按 input 计数会把"已上传"误报成"空" → **先截图再下结论**。

★ **"重新查询元素再读"不构成独立回读** —— 它读的仍是你自己刚写进 DOM 的值（读写两边会错到一起）。
第二证据要取**框架自己渲染的东西**：本站是**字数计数器**（`.aui-input__count-inner`）。
实测写入后计数器同步变成 `n/上限`，才敢断定 **Vue 的 model 收到了值**；
否则只是改了 DOM 表层，保存时会被框架的旧 state 覆盖 —— 那正是本项目最贵的静默错写。

### 字段与上限

- 发表论文：`论文名称`(500) / `发表时间`(日期) / `论文详情`(1000) —— **三者皆必填**。
- 项目经历：`项目名称`(500) / `开始时间` / `结束时间` / `项目角色`(200) / `主要职责与业绩`(5000) ——
  必填是**名称/起/止/角色**，职责可选（按第 8 条的伪元素判据实测）。
- 论文详情文本构造（沿用新凯来那套）：`期刊，卷期页，作者位次，状态。` + 换行 +
  `研究内容：<对应项目描述的前两句>`；论文↔项目靠档案 `outcome` 里是否含论文标题串来匹配。
  **坑**：档案 `description` 首句自带 `1. ` 这类列表编号，会**原样带进简历文本** ——
  要么接受，要么在生成时清掉，但别让它悄悄留在正式简历里。

### 本轮交付（供对照）

- 原来空着的 6 项（民族 / 自我评价 / 博士段 研究方向+导师姓名 / 本科段 学制 / 语言 熟练程度）
  + 必填 radio「是否有亲属正在或曾在华为任职」+ **发表论文 4 条**（按用户口径**只写已发表**，
  审稿中的不写）+ **项目经历 4 条** = **31 个字段**，逐项回读一致，并以字数计数器二次佐证。
- **未点「保存」**：本站保存语义（是否走提交校验、是否落库）**尚未探明** → 数据仍只在页面内存里，
  刷新即丢。§十四 #3 那条"开工第一步先探落库语义"的纪律**本轮又被跳过了**，见下表 #4。
- 保存前全库仅剩 **2 处必填未填**：① 项目经历第 2 条的 `结束时间`（档案写的是"至今"，按不编造原则留空，
  但该格必填，不填校验不放行）；② `个人照片`（页面显示有图，但 src 是 `blob:` 本地预览、盒内无 input
  → **是否已落库存疑，需使用者确认**）。

### 可优化点（本轮暴露，按触发条件排序；未实现的不写代码）

| # | 问题（有实证） | 建议 | 触发条件 |
| --- | --- | --- | --- |
| 1 | **「独立回读」被误解成"重新查询同一个 input"**，两者读的都是自己写的 DOM 值，挡不住静默错写 | 第二证据取**框架渲染物**（计数器）；`readDisplay` 落地时把这条写成单测 | 与 §十四 #1/#2 同一批（`tools/dom.mjs`） |
| 2 | **必填判据信 class 会全落空**（条目化模块不加 `is-required`），既漏必填又误判可选 | 固化 `::before` 的 `content` + 颜色探测 | **立即适用**（纪律 + 一个函数） |
| 3 | **条目化模块不在侧栏目录里**，只扫目录会漏模块 | 开工先枚举 `.module-container` 全集 | **立即适用** |
| 4 | **落库语义又没先探**（§十四 #3 已写过"开工第一步探提交路径"，本轮仍跳过） | 说明那条纪律**确实会被跳过**：需要在开工清单里**前置为第 0 步**，而不是并列一条 | **立即适用** |
| 5 | 每遇新组件库就重写一遍**同一批样板**（开菜单、判必填、按 label 取盒） | 与 §十四 #1 合并成 `tools/dom.mjs` | 第二次遇到 `aui-` 类站点时 |
