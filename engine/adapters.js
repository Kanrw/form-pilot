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
    menuSel: '[class*=sd-Select-menu],[class*=sd-Menu-container]',
    itemSel: '[class*=sd-Menu-content-item]',
    valueSel: '[class*=sd-Input-display-value]',

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
