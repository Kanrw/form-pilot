// form-pilot · 站点适配器注册表
//
// 唯一事实源：form-pilot/engine/adapters.js
//   `skill/references/adapters.js` 是 sync 生成物，勿手改。
// 挂载：window.__jaAdapters —— IIFE 外的 `|| {}` 保证重复注入不抛 SyntaxError。
// 新增站点：探针 → 整理成注册项 → 填 verified 日期与来源 URL → sync → CHANGELOG。
//
// 引擎只认接口不认网站；本文件里的每个字段都对应 AGENTS.md §六 的某个内部方法。

window.__jaAdapters = window.__jaAdapters || {

  // ── Moka（mokahr.com）｜已实测 ──────────────────────────────
  // verified：真实页面只读探测，2026-09-22，CATL 校招申请页
  moka: {
    name: 'moka',
    verified: '2026-09-22',
    source: 'https://app.mokahr.com/campus-recruitment/<orgSlug>/<orgId>',

    // ★ 尾横线不可省。裸 `[class*=apply-field]` 会同时命中 16 个复数行分组容器
    //   `apply-fields-*`，把 wrapper 当字段（实测 49 个真字段 → 误报 65 个）。
    fieldSel: '[class*=apply-field-]',
    labelSel: '[class*=title]',
    // ★ menuSel 同时匹配面板（sd-Select-menu-*）与每个选项外层的 sd-Menu-container-*，
    //   而两者是父子关系 —— 实测「民族」一次弹出 1 个面板 + 58 个单项容器。
    //   收窄由引擎的 visibleMenus() 做「嵌套只留最外层」，**不要在这里删掉 sd-Menu-container**：
    //   别的下拉形态可能只渲染后者，删了会静默少一类菜单。
    menuSel: '[class*=sd-Select-menu],[class*=sd-Menu-container]',
    itemSel: '[class*=sd-Menu-content-item]',
    valueSel: '[class*=sd-Input-display-value]',

    // 选择式月区间（如「就读时间」）：容器 + 内部 4 个下拉，
    // DOM 序 = 起始年 / 起始月 / 结束年 / 结束月。实现见 engine.js fillMonthRange。
    rangeSel: '[class*=month-range-select]',
    rangeSelectSel: '[class*=sd-Select-container]',

    // 区块 = apply-block-*（16 个 section，其中 9 个带加行按钮）；
    // 行分组 = apply-fields-*，行索引取"该分组在区块内的序号"。
    blockSectionSel: '[class*=apply-block-]',
    blockGroupSel: '[class*=apply-fields-]',
    addText: '添加',

    // Moka 把字段类型写在类名前缀上，用它取代启发式：
    // bool_info 实际是下拉（sd-Select-container + sd-Input-display-value）且 input 不是 readonly，
    // 启发式的两条分支都落空 → 误判成 text → 往输入框写值不生效且不报错。
    typeMap: {
      string_info: 'text',
      select_info: 'select',
      bool_info: 'select',
      Select: 'select',
      multi_select_info: 'select',
      day_info: 'date',
      date_info: 'date',
      location_info: 'cascade',
      confirm_info: 'choice',
      file_upload: 'file',
      portrait_upload: 'file',
      custom_file_upload: 'file',
    },

    // 只列真带加行按钮的区块；其余 section（申请信息、上传、个人信息…）
    // 匹配不到 → 走 `main>>label`。
    blockSections: [
      { kind: 'edu', title: '教育背景' },
      { kind: 'intern', title: '实习经历' },
      { kind: 'proj', title: '项目经验' },
      { kind: 'scholar', title: '获奖学金经历' },
      { kind: 'campus', title: '校内活动经验' },
      { kind: 'paper', title: '核心期刊论文发表' },
      { kind: 'patent', title: '个人专利/发明' },
      { kind: 'contest', title: '竞赛经历' },
      { kind: 'skill', title: '技能/爱好' },
    ],
  },

  // ── 飞书招聘（*.jobs.feishu.cn）｜只读探测 2026-09-22 ─────
  // 探测来源：记忆科技（深圳）校招申请页，scripts/probe.mjs + 结构核对，未写入。
  // 组件库 atsx-*。与 Moka 的根本差异：类型写在**内部组件**类名上
  // （atsx-select-search / atsx-date-picker），字段盒子只有 atsx-form-item 一个 token ——
  // 类型判定靠引擎的子树判据（engine.js heuristicType 2026-09-22 新增），typeMap 无从写起。
  feishu: {
    name: 'feishu',
    verified: '2026-09-22',
    source: 'https://varp4lp3dbc.jobs.feishu.cn/708509/resume/<resumeId>/apply',

    // ★ ~= 是按空白分词的完整词匹配。裸 [class*=atsx-form-item] 会同时命中
    //   form-item-label / -control / -children / -required（实测 156 个节点 → 真盒子只有 28 个）。
    fieldSel: '[class~="atsx-form-item"]',
    labelSel: 'label',
    // 字段名有两套：<label>（干净，26 个）与 [class*=fieldName]（textContent 会混入已填值，
    // 如"意向城市东莞"—— 不可作 label 事实源）。
    // 菜单三件套（2026-09-22 L3 受控写校准）：
    // ★ 飞书的下拉菜单是**常驻 DOM**（靠 class 控显隐，不是用后即弃的 body portal）——
    //   所以 openMenuFor 靠"新出现的菜单"判断会失败，需配合对 select 内 input 的
    //   mousedown/focus/mouseup/click 事件序列；菜单项文本跨字段全局唯一，按文本命中安全。
    menuSel: '[class*="atsx-select-dropdown"]',
    itemSel: '[class*="atsx-select-dropdown-menu-item"]',
    valueSel: '[class*="atsx-select-selection"]',

    // 分区容器实测有 title（申请信息 / 附件简历 / …），但区块标题元素与 kind 的
    // 对应关系尚未核对 —— 首版不声明 blockSections，重复 label（起止时间×2）靠 main>>#n 消歧。
    blockSectionSel: '[class~="createFormSection-container"]',
    blockGroupSel: null,
  },

  // ── 北森（*.zhiye.com）｜仅文档来源，未实测 ───────────────
  // 故意不声明 blockSections / typeMap：没有真实探测就没有依据。
  // 已知（来自 v1 指南，未实测）：单选是 div.phoenix-radio；多选菜单选完要点"确定"。
  // 这两项属于 R3，按 AGENTS.md §2.4 推迟到首次实际使用。
  beisen: {
    name: 'beisen',
    verified: null,
    source: 'docs-only',
    fieldSel: '.form-item',
    labelSel: 'label',
    menuSel: '.common-unmodeled-layer',
    itemSel: '.phoenix-selectList__singleLabel,.list-item-container',
    valueSel: '.phoenix-select__placeHolder',
  },

  // ── 通用探针：全部留空，即引擎内置默认值（fieldSel=null 走 input 就近容器，etc.）──
  generic: {
    name: 'generic',
    verified: null,
    source: 'builtin',
  },
};
