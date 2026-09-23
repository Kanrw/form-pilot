// form-pilot · 浏览器表单自动填写引擎
//
// 唯一事实源：form-pilot/engine/engine.js
//   `skill/references/engine.js` 是 sync 生成物，勿手改。
// 注入方式：scripts/inject.mjs —— 本文件 + adapters.js 拼成一个字符串，一次 evaluate。
// 版本号：与 skill/SKILL.md frontmatter 的 version、CHANGELOG 最新条目保持一致（D-5）。
//
// 已实现的推迟项：R3（单选 setChoice，北森触发）、R4（fillDate / fillMonthRange）。
// 仍不实现：R5/R8/R9 与 R3 的多选"确定"钩子（无已命名失败），见 AGENTS.md §2.4。

(() => {
if (window.__ja) return 'already loaded';

const VERSION = '0.1.0';

// ── 工具 ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[\s*：:]/g, '');
const trunc = (v) => { const s = v == null ? '' : String(v); return s.length > 200 ? s.slice(0, 200) : s; };
const j = (o) => JSON.stringify(o);

// ── 前台守卫 ────────────────────────────────────────────
// 命名失败（2026-09-22 实测）：标签页在后台时 Chrome 节流定时器，`await sleep(...)` **永不返回**，
// 于是每个异步方法都变成"无限等待"—— 不报错、不返回、也不超时。这是最坏的失败形态。
//
// 实测证据：hidden 标签页里 `await new Promise(r => setTimeout(r, 1500))` 30 秒都没触发，
// 而同一个标签页上的**同步** evaluate 秒回 —— 所以问题出在定时器，不在页面或桥。
//
// 为什么不能用"给 sleep 加超时"来兜底：那个超时定时器同样不会触发，兜不住。
// 只能在入口查可见性，把最常见的"没在前台就开始填"变成明确错误。
//
// 局限（写清楚，免得被当成万能）：挡不住"填到一半被切到后台"，那种情况仍会挂住。
const HIDDEN_HINT = '目标标签页不在前台：Chrome 会节流定时器，所有 await sleep 永不返回。把该标签页切到最前面后重试';
const tabHidden = () => typeof document !== 'undefined' && document.hidden === true;

// React/Vue 兼容的 native setter 写值
function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
  desc.set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 元素级合成鼠标事件。isTrusted 站点由调用方按降级链处理，本文件不做 CDP。
function synthClick(el) {
  el.scrollIntoView({ block: 'center' });
  for (const t of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  }
}

// ── 当前适配器（use() 覆盖；默认值是通用探针）────────────
const A = {
  name: 'generic',
  fieldSel: null,
  labelSel: null,
  menuSel: null,
  itemSel: null,
  valueSel: null,
  typeMap: null,         // 类名前缀 → type 的确定性映射（有则优先，取代启发式）
  blockSectionSel: null, // 区块容器（重复经历所在的 section）
  blockGroupSel: null,   // 区块内的行分组容器（行索引来源）
  blockSections: null,   // [{kind, title}]，title 用于匹配 section 标题前缀
  addText: '添加',
  textInputSel: 'input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea',
  fileSel: 'input[type=file]',
  rangeSel: null,          // 选择式月区间的容器标记（Moka: [class*=month-range-select]）
  rangeSelectSel: null,    // 区间内 4 个下拉的容器，DOM 序 = 起始年 / 起始月 / 结束年 / 结束月
  radioGroupSel: null,     // R3 单选组容器（北森: .phoenix-radio-group）
  radioItemSel: null,      // 组内选项（北森: .phoenix-radio-group__radioItem）
  radioCheckedSel: null,   // 选中态标记（北森: core 上的 .phoenix-radio--checked）
  // 3-5 分钟哲学的机制化（2026-09-22 北森实战复盘）：
  // manualTypes —— 这些 type 的字段直接归手动，pickOption/fillDate 入口即报
  // manual-required 快速失败，杜绝"换个通道再试 25 轮"复发。null = 不限制。
  manualTypes: null,
  // 复合字段（如 +86 + 号码框）里真正承接值的那一个 input 的角色选择器。
  // 未声明而盒内有多个可见 input 时，fillTexts 拒绝写入（composite-field）——
  // 宁可明确失败，不要"写入回读都指向第一个、自检失效"的静默错（AGENTS.md §八）。
  numberInputSel: null,
};

// ── 字段与类型 ──────────────────────────────────────────
function fields() {
  const boxes = A.fieldSel
    ? [...document.querySelectorAll(A.fieldSel)]
    : [...document.querySelectorAll('input,textarea')].map((el) => el.closest('form,div[class],li,td') || el.parentElement);
  return [...new Set(boxes)].filter((b) => b && b.offsetHeight > 0);
}

function labelOf(box) {
  if (A.labelSel) {
    const l = box.querySelector(A.labelSel);
    if (l && l.textContent.trim()) return l.textContent.trim();
  }
  const l = box.querySelector('label,[class*=label],[class*=Label],[class*=title],[class*=Title]');
  return l ? l.textContent.trim() : '';
}

// 通用启发式。注意 `[_-]date([_-]|$)` 不写成裸 /date/，否则会误命中 "update"。
function heuristicType(box) {
  if (box.querySelector(A.fileSel)) return 'file';
  const inp = box.querySelector(A.textInputSel);
  if (!inp) return box.querySelector('[class*=radio],[class*=checkbox]') ? 'choice' : 'unknown';
  if (inp.tagName === 'TEXTAREA') return 'textarea';
  const cls = (box.className || '').toString();
  if (/day_info|datepicker|date-picker|[_-]date([_-]|$)/i.test(cls)) return 'date';
  if (/cascade|location_info|[_-]area([_-]|$)/i.test(cls)) return 'cascade';
  if (/select|dropdown/i.test(cls)) return 'select';
  // 子树判据（2026-09-22 飞书实测）：类型可能写在内部组件的类名上，不在字段盒子上。
  // 命名失败：飞书的下拉 input 是 atsx-select-search__field，字段盒子 class 只有
  // atsx-form-item 一个 token，且该 input 不是 readonly —— 上面两条旧判据全部落空，
  // 8 个下拉字段会被判成 text，写值静默无效。这与 Moka bool_info 同类但根因不同：
  // Moka 把类型写在盒子类名上（typeMap 能救），飞书写在组件上（只有子树判据能救）。
  if (box.querySelector('[class*=date-picker],[class*=datepicker],[class*=DatePick]')) return 'date';
  if (box.querySelector('[class*=select-search],[class*=Select],[class*=select-],[class*=-select],[class*=dropdown]')) return 'select';
  if (inp.readOnly) return 'select';   // 只读 = 需交互选择，不能直接写值
  return 'text';
}

function typeOf(box) {
  if (A.typeMap) {
    const keys = Object.keys(A.typeMap).sort((a, b) => b.length - a.length);
    for (const c of box.classList) {
      for (const k of keys) if (c.indexOf(k) === 0) return A.typeMap[k];
    }
  }
  return heuristicType(box);
}

// ── 区块（重复经历段）──────────────────────────────────
// 区块标题。固定用宽选择器而不是 A.labelSel：区块标题的父元素类名各站点不同，
// 而标题在 DOM 序上先于区块内字段，所以取"第一个非空标题文本"是安全的。
// 实测依据：Moka 16 个 apply-block-* 的首个标题文本即区块名（2026-09-22 只读探针）。
function firstTitle(root) {
  const sel = '[class*=title],[class*=Title],h1,h2,h3,h4';
  for (const e of root.querySelectorAll(sel)) {
    const t = (e.textContent || '').trim();
    if (t) return t;
  }
  return '';
}

function rowIndexOf(secEl, box) {
  if (!A.blockGroupSel) return 0;
  const groups = [...secEl.querySelectorAll(A.blockGroupSel)];
  const g = box.closest(A.blockGroupSel);
  const i = g ? groups.indexOf(g) : -1;
  return i < 0 ? 0 : i;
}

function sectionOf(box) {
  if (!A.blockSectionSel || !A.blockSections) return null;
  const el = box.closest(A.blockSectionSel);
  if (!el) return null;
  const t = norm(firstTitle(el));
  for (const s of A.blockSections) {
    if (t.indexOf(norm(s.title)) === 0) return { kind: s.kind, el, rowIndex: rowIndexOf(el, box) };
  }
  return null;
}

function sectionByKind(kind) {
  if (!A.blockSectionSel || !A.blockSections) return null;
  const def = A.blockSections.filter((s) => s.kind === kind)[0];
  if (!def) return null;
  for (const el of document.querySelectorAll(A.blockSectionSel)) {
    if (norm(firstTitle(el)).indexOf(norm(def.title)) === 0) return el;
  }
  return null;
}

function groupCount(secEl) {
  return A.blockGroupSel ? secEl.querySelectorAll(A.blockGroupSel).length : 0;
}

// ── 取值 ────────────────────────────────────────────────
// 写入目标的统一定位：单 input 盒直接用；多 input 盒（复合字段）只有适配器声明了
// 角色选择器（numberInputSel）才允许定位，否则 composite —— fillTexts 会拒绝写入。
// 修复"手机号灌进 +86 框"的关键：写入与回读必须走同一个函数，不能再各自 querySelector。
function pickInput(box) {
  const inputs = [...box.querySelectorAll(A.textInputSel)].filter((e) => e.offsetHeight > 0);
  if (inputs.length <= 1) return { inp: inputs[0] || null, composite: false };
  if (A.numberInputSel) {
    const role = box.querySelector(A.numberInputSel);
    if (role && inputs.includes(role)) return { inp: role, composite: false };
  }
  return { inp: inputs[0] || null, composite: true };
}

function readSelect(box) {
  if (A.valueSel) {
    const v = box.querySelector(A.valueSel);
    if (v) return v.textContent.trim();
  }
  const inp = box.querySelector(A.textInputSel);
  if (inp && inp.value) return inp.value;
  const cand = [...box.querySelectorAll('span,div')]
    .filter((s) => s.children.length === 0 && s.offsetHeight > 0)
    .map((s) => s.textContent.trim())
    .filter((t) => t && !/请选择|select/i.test(t) && norm(t) !== norm(labelOf(box)));
  return cand[0] || '';
}

function valueOf(box, type) {
  if (type === 'text' || type === 'textarea') {
    // ★ 回读必须走 pickInput，不能各自 querySelector（见 pickInput 上的注释）。
    //   失败实例：Moka「手机号码」盒 = addon(+86) + 号码框两个 input，
    //   `box.querySelector(textInputSel)` 命中的是 addon 那个空的 ——
    //   值已经写进号码框了，scan 却报空，还把必填项列进 emptyRequired。
    const inp = pickInput(box).inp;
    return inp ? inp.value : '';
  }
  if (type === 'file') {
    const f = box.querySelector(A.fileSel);
    return f && f.files && f.files.length ? f.files[0].name : '';
  }
  return readSelect(box);
}

function isRequired(box) {
  if (box.querySelector('[class*=required],[class*=asterisk]')) return true;
  return /\*/.test((box.textContent || '').slice(0, 40));
}

// 字段清单（含 ID 与取值）。ID 方案见 AGENTS.md §七。
function entries() {
  const seen = {};
  return fields().map((box) => {
    const label = labelOf(box).slice(0, 30);
    const type = typeOf(box);
    const sec = sectionOf(box);
    let id;
    let block;
    if (sec) {
      block = sec.kind + '[' + sec.rowIndex + ']';
      id = block + '>>' + label;
    } else if (A.blockSections) {
      // main 分支同样要消歧：两个非重复区块里出现同名字段时，
      // 裸 `main>>label` 不是单射，fillTexts 的 map key 会互相覆盖。
      seen[label] = (seen[label] || 0) + 1;
      block = 'main';
      id = seen[label] > 1 ? 'main>>' + label + '#' + seen[label] : 'main>>' + label;
    } else {
      seen[label] = (seen[label] || 0) + 1;
      block = 'main';
      id = seen[label] > 1 ? label + '#' + seen[label] : label;
    }
    return { id, block, label, type, box };
  });
}

function findField(id) {
  const m = /^(?:([A-Za-z_]+)\[(\d+)\]|main)>>(.*)$/.exec(id);
  if (m) {
    const kind = m[1] || null;
    const row = m[2] === undefined ? null : +m[2];
    const raw = m[3];
    const lm = /^(.*)#(\d+)$/.exec(raw);
    const base = lm ? lm[1] : raw;
    const nth = lm ? +lm[2] : 1;
    let hit = 0;
    for (const e of entries()) {
      if (norm(e.label) !== norm(base)) continue;
      if (kind === null) {
        if (e.block !== 'main') continue;
      } else {
        const s = sectionOf(e.box);
        if (!s || s.kind !== kind || s.rowIndex !== row) continue;
      }
      hit++;
      if (hit === nth) return e.box;
    }
    return null;
  }
  // 旧式 label / label#n（适配器未声明 blockSections 时的 ID 形态）
  const lm2 = /^(.*)#(\d+)$/.exec(id);
  const label = lm2 ? lm2[1] : id;
  const nth2 = lm2 ? +lm2[2] : 1;
  const hits = fields().filter((b) => norm(labelOf(b)) === norm(label));
  return hits[nth2 - 1] || null;
}

// ── 菜单 ────────────────────────────────────────────────
function visibleMenus() {
  const all = A.menuSel
    ? [...document.querySelectorAll(A.menuSel)]
    : [...document.body.children].flatMap((d) => [d, ...d.querySelectorAll('[class*=menu],[class*=Menu],[class*=dropdown],[class*=Dropdown],[class*=popper],[class*=option],[role=listbox]')]);
  const vis = [...new Set(all)].filter((m) => m.offsetHeight > 30);
  // ★ 候选之间互相嵌套时只保留最外层。
  // 命名失败（2026-09-22 Moka 实测）：适配器的 menuSel 同时匹配面板 sd-Select-menu-* 与
  // 每个选项外层的 sd-Menu-container-*，而后者是前者的后代 —— 点开「民族」一个下拉，
  // visibleMenus() 返回 59 个元素（1 个面板 + 58 个单项容器），而不是 1 个。
  // 后果不是选错菜单（面板在文档序更前，fresh[0] 仍是它），而是**失败报告在撒谎**：
  // pickOption 失败时回的 `menus` 字段会报 59，让现场排查的人以为同时弹出了 59 个菜单。
  // 返回"菜单及其每一个选项容器"是范畴错误 —— 这个函数的名字就是"菜单"。
  return vis.filter((m) => !vis.some((o) => o !== m && o.contains(m)));
}

function menuItems(menu) {
  const items = A.itemSel
    ? [...menu.querySelectorAll(A.itemSel)]
    : [...menu.querySelectorAll('li,[role=option],[class*=item],[class*=Item],[class*=option],[class*=Option]')];
  return [...new Set(items)].filter((x) => x.offsetHeight > 0 && x.textContent.trim());
}

function matchItem(items, text) {
  const exact = items.filter((x) => norm(x.textContent) === norm(text));
  if (exact.length) return exact[0];
  const pre = items.filter((x) => norm(x.textContent).indexOf(norm(text)) === 0);
  return pre.length === 1 ? pre[0] : null;
}

// 清场：把已经展开的菜单关掉。
//
// 命名失败（2026-09-22 Moka 实测）：点击一个**已经打开的**触发器不会重新打开菜单，而是把它关掉。
// 于是上一次失败留下的残留菜单会让下一次 openMenuFor 永远看到"没有新菜单"，
// 报 menu-not-open —— 而页面其实是好的。表现是"同一个字段第一次失败之后再也填不上，
// 报错还指向菜单没弹出来"，排查方向完全被带偏。
//
// 这一条推翻了 05 §四 D-3 的判断。D-3 当时说"残留菜单本就落在 before 里被差集排除，
// 找不到可命名的失败"—— 差集确实能排除它作为**候选**，但挡不住"点一下反而关掉"这个副作用。
// 清场只在这里做，且只在真的有菜单残留时才等待（干净页面上零开销）。
async function closeMenus() {
  let n = visibleMenus().length;
  for (let i = 0; i < 4 && n > 0; i++) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
    await sleep(150);
    n = visibleMenus().length;
  }
  return n;
}

// 点开一个触发器，返回新出现的那个菜单。
// 抽出来是因为月区间要连点 4 个下拉（pickOption 只点 1 个），共用同一段等待与归属逻辑。
async function openMenuFor(trigger) {
  await closeMenus();
  const before = new Set(visibleMenus());
  synthClick(trigger);
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const fresh = visibleMenus().filter((m) => !before.has(m) && m.isConnected);
    if (fresh.length) return { menu: fresh[0], freshCount: fresh.length };
  }
  // 删掉原型里的 `|| visibleMenus().pop()` 兜底：它会把常驻菜单当目标。
  // 找不到就失败，好过选错菜单。
  return { menu: null, freshCount: 0 };
}

// 在已打开的菜单里选中一项。返回 {ok, text} 或 {ok:false, err, available}。
async function chooseIn(menu, optionText, useSearch) {
  const searchBox = useSearch ? menu.querySelector('input:not([readonly])') : null;
  if (searchBox && optionText) { setNativeValue(searchBox, optionText); await sleep(400); }
  const items = menuItems(menu);
  const target = matchItem(items, optionText);
  if (!target) {
    document.body.click();
    return { ok: false, err: 'option-not-found', available: items.slice(0, 10).map((x) => x.textContent.trim().slice(0, 15)) };
  }
  if (!target.isConnected) return { ok: false, err: 'item-detached' };
  synthClick(target);
  await sleep(500);
  return { ok: true, text: target.textContent.trim() };
}

// ── 公开 API ────────────────────────────────────────────
window.__ja = {
  version: VERSION,

  use(adapter) {
    if (adapter) Object.assign(A, adapter);
    return A.name;
  },

  detect() {
    if (document.querySelector('[class*=apply-field-]') && document.querySelector('[class*=sd-Input]')) return 'moka';
    if (document.querySelector('.form-item') && document.querySelector('[class*=phoenix]')) return 'beisen';
    if (document.querySelector('[class~="atsx-form-item"]')) return 'feishu';
    return 'generic';
  },

  scan() {
    const list = entries().map((e) => ({
      id: e.id,
      block: e.block,
      label: e.label,
      type: e.type,
      required: isRequired(e.box),
      value: trunc(valueOf(e.box, e.type)),
    }));
    // 3-5 分钟哲学的分组输出（2026-09-22 北森复盘）：外层 LLM 一次 scan 就拿到
    // 「自动填什么 / 空必填必须处理 / 哪些类型直接归手动」，不再逐字段试错。
    const manualSet = A.manualTypes || [];
    const manual = list.filter((f) => manualSet.includes(f.type))
      .map((f) => ({ id: f.id, type: f.type, reason: 'adapter-manual' }));
    const emptyRequired = list.filter((f) => f.required && !f.value && !manualSet.includes(f.type))
      .map((f) => f.id);
    return j({ total: list.length, fields: list, manual, emptyRequired });
  },

  readAll() {
    return j(entries().map((e) => ({
      id: e.id,
      block: e.block,
      label: e.label,
      type: e.type,
      value: trunc(valueOf(e.box, e.type)),
    })));
  },

  // 批量填文本。只处理 text/textarea，其余在报告里归类。
  // 第二遍必须 sleep 之后再读：写入后同步读值恒等于刚写的值，抓不到"被 React 吞掉"。
  async fillTexts(map) {
    if (tabHidden()) {
      const ids = Object.keys(map);
      // 保持 {ok,failed,retried} 的形状不变：调用方不用为这一种失败单独写分支。
      return j({
        ok: 0, err: 'tab-hidden', hint: HIDDEN_HINT,
        failed: ids.map((id) => ({ id, phase: 'locate', err: 'tab-hidden', attempted: trunc(map[id]), final: '' })),
        retried: [],
      });
    }
    const results = [];
    for (const id of Object.keys(map)) {
      const value = map[id];
      const row = { id, ok: false, phase: 'locate', err: '', attempted: trunc(value), final: '', _v: value };
      const box = findField(id);
      if (!box) { row.err = 'field-not-found'; results.push(row); continue; }
      const type = typeOf(box);
      if (type !== 'text' && type !== 'textarea') { row.err = 'not-text:' + type; results.push(row); continue; }
      const { inp, composite } = pickInput(box);
      // 复合字段（+86 + 号码框这类）：不声明角色选择器就写，等于"报 ok 实际填错"。
      // 直接失败并归类，让调用方改适配器或归入手动 —— 3-5 分钟哲学：不赌。
      if (composite) { row.err = 'composite-field'; results.push(row); continue; }
      if (!inp) { row.err = 'no-input'; results.push(row); continue; }
      setNativeValue(inp, value);
      row.ok = inp.value === value;
      row.phase = 'fill';
      if (!row.ok) row.err = 'value-not-stuck';
      results.push(row);
    }

    await sleep(600);

    const swallowed = [];
    const retried = [];
    for (const r of results) {
      if (!r.ok) continue;
      const box = findField(r.id);
      const pick = box && pickInput(box);
      const now = pick && pick.inp ? pick.inp.value : '';
      if (now !== r._v) swallowed.push(r);
      else r.final = trunc(now);
    }
    for (const r of swallowed) {
      const box = findField(r.id);
      const pick = box && pickInput(box);
      if (!pick || !pick.inp) continue;
      setNativeValue(pick.inp, r._v);
      retried.push(r.id);
    }
    if (swallowed.length) {
      await sleep(400);
      for (const r of swallowed) {
        const box = findField(r.id);
        const pick = box && pickInput(box);
        const now = pick && pick.inp ? pick.inp.value : '';
        r.final = trunc(now);
        r.ok = now === r._v;
        if (!r.ok) { r.phase = 'verify'; r.err = 'value-not-stuck-after-retry'; }
      }
    }

    const failed = results.filter((r) => !r.ok)
      .map((r) => ({ id: r.id, phase: r.phase, err: r.err, attempted: r.attempted, final: r.final }));
    return j({ ok: results.length - failed.length, failed, retried });
  },

  async pickOption(id, optionText, opts) {
    if (tabHidden()) return j({ ok: false, err: 'tab-hidden', id, hint: HIDDEN_HINT });
    const search = !opts || opts.search !== false;
    const box = findField(id);
    if (!box) return j({ ok: false, err: 'field-not-found', id });
    // manual 机制（2026-09-22 北森复盘）：适配器判定的免疫类型在入口即拒绝，
    // 不进入开菜单/等待循环 —— 杜绝"换个通道再试 25 轮"复发。
    const mt = typeOf(box);
    if (A.manualTypes && A.manualTypes.includes(mt)) {
      return j({ ok: false, err: 'manual-required', id, type: mt, hint: '该类型已由适配器归入手动清单（免疫实测记录见 AGENTS.md）' });
    }

    const { menu, freshCount } = await openMenuFor(box.querySelector(A.textInputSel) || box);
    if (!menu) return j({ ok: false, err: 'menu-not-open', id, hint: 'fallback-cdp' });

    const r = await chooseIn(menu, optionText, search);
    if (!r.ok) return j({ ok: false, err: r.err, id, optionText, menus: freshCount, available: r.available });

    const value = readSelect(box);
    return j({ ok: norm(value) === norm(optionText) || value.indexOf(optionText) >= 0, id, value: trunc(value) });
  },

  // 单选点选（R3，2026-09-22 由北森实际使用触发，AGENTS.md §2.4）。
  //
  // 命名失败：北森「性别」是 div.phoenix-radio，**没有 input** —— fillTexts 拒绝 choice 类，
  // pickOption 找的是下拉菜单，两个现有方法都盖不住，只能人工点。
  // 与下拉的本质区别：选项常驻字段盒内（不需要开菜单），选中态是组件类名而非菜单项。
  //
  // 实测（粤芯表单）两条硬事实：
  //   1. 选中标记 = core 元素上的 --checked 修饰类（圆点 opacity 恒 0，由类名驱动样式）。
  //   2. 合成事件必须带 pointerdown/pointerup —— 只发 mousedown/mouseup/click 三件套
  //      点不动 phoenix radio（第一遍探测实测无反应）。
  // 多选菜单"确定"钩子不做：本页没有多选字段，没有已命名的失败（§2.3）。
  async setChoice(id, optionText) {
    if (tabHidden()) return j({ ok: false, err: 'tab-hidden', id, hint: HIDDEN_HINT });
    const box = findField(id);
    if (!box) return j({ ok: false, err: 'field-not-found', id });
    if (!A.radioGroupSel || !A.radioItemSel || !A.radioCheckedSel) {
      return j({ ok: false, err: 'no-choice-support', id, hint: '适配器未声明 radioGroupSel/radioItemSel/radioCheckedSel' });
    }

    const itemsOf = (b) => {
      const group = b && b.querySelector(A.radioGroupSel);
      if (!group) return null;
      return [...group.querySelectorAll(A.radioItemSel)]
        .filter((x) => x.offsetHeight > 0 && x.textContent.trim());
    };
    const items = itemsOf(box);
    if (!items) return j({ ok: false, err: 'not-a-choice-field', id, type: typeOf(box) });
    const target = matchItem(items, optionText);
    if (!target) {
      return j({ ok: false, err: 'option-not-found', id, optionText,
        available: items.slice(0, 10).map((x) => x.textContent.trim().slice(0, 15)) });
    }

    target.scrollIntoView({ block: 'center' });
    const Mk = (t) => (window.PointerEvent && t.indexOf('pointer') === 0 ? PointerEvent : MouseEvent);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new (Mk(t))(t, { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(400);

    // 验证：选中态必须是可观察的 DOM 证据，不许"点完就算"（与 fillDate 同一条纪律）。
    // 元素引用不跨 sleep 复用：重渲染可能换掉整组，验证前重新定位。
    const checked = (itemsOf(findField(id) || box) || [])
      .filter((x) => x.querySelector(A.radioCheckedSel))
      .map((x) => x.textContent.trim());
    const ok = checked.length === 1
      && (norm(checked[0]) === norm(optionText) || checked[0].indexOf(optionText) >= 0);
    return j({ ok, id, checked, err: ok ? '' : 'not-checked' });
  },

  // 日期直填（R4，2026-09-22 由用户触发：多数站点的日期是若干文本框而非下拉，可以直填）。
  //
  // 输入框分配规则（实测 Moka 两种形态）：
  //   · 1 个 input            → 整串写入（"2000-02-01"）
  //   · 2 个 input（年/月）    → 依次写 年、月
  //   · 3 个 input（年/月/日） → 依次写 年、月、日
  //   · 4 个 input（年月年月） → 只填起始，结束留空即"至今"；余下的在 unfilledInputs 里报出
  //
  // ★ 只读 input 单独处理：程序化写入能把值粘在 DOM 上，但**无法证明应用状态接受了它**
  //   （React 只在 state 变化时重渲染，state 是空的时候假值会一直挂着）。
  //   实测 Moka「出生日期 (年龄)」：值 4 秒后仍在、重渲染后仍在，但应用既没算出年龄、
  //   也没有任何接受迹象。所以只读字段一律返回 ok:false + readonly-unverifiable，
  //   **绝不报成功** —— 一个看起来填好、实际提交为空的字段，比明确失败危险得多。
  async fillDate(id, ymd) {
    if (tabHidden()) return j({ ok: false, err: 'tab-hidden', id, hint: HIDDEN_HINT });
    const box = findField(id);
    if (!box) return j({ ok: false, err: 'field-not-found', id });
    const type = typeOf(box);
    if (type !== 'date') return j({ ok: false, err: 'not-a-date-field', id, type });
    // manual 机制：与 pickOption 同一入口守卫（北森日期下拉免疫，见 AGENTS.md §五）。
    if (A.manualTypes && A.manualTypes.includes('date')) {
      return j({ ok: false, err: 'manual-required', id, type, hint: '日期类已由适配器归入手动清单' });
    }

    // 选择式日期控件（month-range-select）必须先挡掉，而且要在**动手写之前**挡。
    // 命名失败（2026-09-22 Moka 实测）：「毕业时间（月）」「英语证书获得时间」= 2 个下拉的
    // 单月变体，「就读时间」= 4 个下拉的区间变体，两者都不含可写的文本框。
    // 不挡的话 fillDate 会往那两个下拉内部的 input 上写字，然后报 display-not-updated ——
    // 结论没错（没有谎报成功），但**控件已经被污染**，而且报错说的是"改走日历选择"，
    // 没告诉调用方真正该用的是 fillMonthRange。
    if (A.rangeSel && box.querySelector(A.rangeSel)) {
      return j({
        ok: false, err: 'select-based-date', id,
        hint: '这个日期字段是选择式控件（month-range-select），不含文本框。用 fillMonthRange 填：'
            + '单月字段（2 个下拉）传 to=空串，区间字段（4 个下拉）传起止。',
      });
    }

    // 接受 'YYYY' / 'YYYY-MM' / 'YYYY-MM-DD'。
    // 只有年份时按用户规则补 01，但**补了什么必须报出来**（assumed），
    // 否则"我只有年份"这个数据缺口会被默认值掩盖。
    const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(String(ymd).trim());
    if (!m) return j({ ok: false, err: 'bad-ymd', id, ymd });
    const pad = (s) => String(+s).padStart(2, '0');
    const assumed = [];
    let mm = '01';
    if (m[2]) mm = pad(m[2]);
    else assumed.push('month');
    const dd = m[3] ? pad(m[3]) : null;
    if (!dd) assumed.push('day');
    const wide = dd ? m[1] + '-' + mm + '-' + dd : m[1] + '-' + mm;
    const parts = [m[1], mm].concat(dd ? [dd] : []);

    const ins = [...box.querySelectorAll('input')]
      .filter((i) => i.type !== 'file' && i.type !== 'checkbox' && i.type !== 'radio' && i.offsetHeight > 0);
    if (!ins.length) return j({ ok: false, err: 'no-date-inputs', id });

    const plan = ins.length === 1 ? [wide] : parts;
    if (plan.length > ins.length) {
      return j({ ok: false, err: 'input-count-mismatch', id, inputs: ins.length, parts: plan.length });
    }
    const targets = ins.slice(0, plan.length);
    for (let i = 0; i < targets.length; i++) setNativeValue(targets[i], plan[i]);
    await sleep(600);

    const after = targets.map((i) => i.value);
    const readonly = ins.filter((i) => i.readOnly).length;
    const out = { id, wrote: plan, after, unfilledInputs: ins.length - plan.length };
    if (assumed.length) out.assumed = assumed;
    if (readonly) {
      out.ok = false;
      out.err = 'readonly-unverifiable';
      out.readonlyInputs = readonly;
      out.hint = '只读控件的程序化写入无法证明被应用接受，请在页面上人工确认或改用日历选择';
      return j(out);
    }

    // ★ 验证读哪，是这里最容易撒谎的地方。
    // 实测 Moka：input.value 写进去了、重渲染后还在，而应用真实的值渲染在
    // sd-Input-display-value 里。只用 input 回读 → 报"填上了"，实际应用状态是空的。
    // 所以：字段内存在 display 元素时，一律以它为准。
    //
    // 【2026-09-22 更正】「就读时间」曾被当作这条结论的样本，但那是个误判 ——
    // 它是**选择式月区间**（month-range-select + 4 个下拉），压根没有文本框，
    // 值本来就只存在于 display 里。那类字段走 fillMonthRange，**不要用 fillDate**：
    // fillDate 会往那 4 个下拉内部的 input 写值，在报 display-not-updated 的同时
    // 已经把控件状态污染了（值写进去了但应用不认，可能冲掉原有选择）。
    const dispEls = A.valueSel ? [...box.querySelectorAll(A.valueSel)] : [];
    if (dispEls.length) {
      const seen = dispEls.map((e) => e.textContent.trim()).filter(Boolean).join(' ');
      out.verifiedBy = 'display';
      out.displayAfter = trunc(seen);
      const hit = seen.length > 0
        && plan.every((p) => seen.indexOf(p) >= 0 || seen.indexOf(String(+p)) >= 0);
      out.ok = hit;
      if (!hit) {
        out.err = 'display-not-updated';
        out.hint = 'input 写进去了但应用渲染的显示值没变 —— 这个组件的值不在 input 上，改走日历选择';
      }
      return j(out);
    }
    out.verifiedBy = 'input';
    out.ok = after.every((v, i) => v === plan[i]);
    if (!out.ok) out.err = 'not-stuck';
    return j(out);
  },

  // 选择式月区间（R4 的第三种形态，2026-09-22 由首次真实投递触发）。
  //
  // 命名失败：Moka 的「就读时间」是 month-range-select —— 起始年/月 + 结束年/月 共 4 个下拉，
  // **一个文本框都没有**，而它是必填。填不上就得人工点 4 次下拉；三段教育就是 12 次。
  // 现有两个方法都盖不住：fillDate 只认 input（在那 4 个下拉内部的 input 上写值等于污染控件），
  // pickOption 一个字段只点一个菜单。所以单列一个方法，而不是给 fillDate 加分支 ——
  // 它的契约是"一个日期"，塞进区间会让 `ok` 的含义变模糊。
  //
  // from / to 接受 'YYYY' 或 'YYYY-MM'；to 传空串/null 表示"至今"，只填起始两个下拉。
  // 缺月份按用户规则补 01，补了什么在 assumed 里报出来（与 fillDate 同一口径：补的值不能冒充事实）。
  async fillMonthRange(id, from, to) {
    if (tabHidden()) return j({ ok: false, err: 'tab-hidden', id, hint: HIDDEN_HINT });
    const box = findField(id);
    if (!box) return j({ ok: false, err: 'field-not-found', id });
    if (!A.rangeSel || !box.querySelector(A.rangeSel)) return j({ ok: false, err: 'not-a-month-range', id });

    const ym = (s) => {
      const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(String(s == null ? '' : s).trim());
      if (!m) return null;
      const assumed = [];
      let mm = '01';
      if (m[2]) {
        const n = +m[2];
        // ★ 月份越界要在这里拦住。放过去的话，值会一路走到下拉里匹配不到，
        //   报的是 option-not-found（带 available 选项表），排查者会去怀疑站点改版，
        //   而真正的原因通常是档案里的日期写错了（如区间解析把 2023-13 写进数据）。
        if (n < 1 || n > 12) return null;
        mm = String(n).padStart(2, '0');
      } else assumed.push('month');
      return { y: m[1], m: mm, assumed };
    };

    const a = ym(from);
    if (!a) return j({ ok: false, err: 'bad-ym', id, from });
    const openEnd = to === undefined || to === null || to === '';
    const b = openEnd ? null : ym(to);
    if (!openEnd && !b) return j({ ok: false, err: 'bad-ym', id, to });

    const order = openEnd ? [[a.y, a.m]] : [[a.y, a.m], [b.y, b.m]];
    const need = order.length * 2;
    const sels = [...box.querySelectorAll(A.rangeSelectSel || A.textInputSel)].filter((e) => e.offsetHeight > 0);
    if (sels.length < need) {
      return j({ ok: false, err: 'range-selects-missing', id, selects: sels.length, need });
    }

    const picks = [];
    for (let i = 0; i < order.length; i++) {
      for (let k = 0; k < 2; k++) {
        const want = order[i][k];
        // 月份的显示形态不一定补零：实测 Moka 渲染 "9"，而 ISO 写法是 "09"。
        // 两种写法都试，最终以页面给的文本为准（picks 里回的是实际选中项的文本）。
        const texts = k === 0 ? [want] : (String(+want) === want ? [want] : [want, String(+want)]);
        let hit = null;
        let last = null;
        for (const text of texts) {
          // 元素引用不跨 sleep 复用（§六 内部规约）：每步重新定位字段与下拉。
          // 顺带每次重验下拉数量 —— 重渲染把控件换掉是这类组件最常见的失效方式。
          const cur = findField(id) || box;
          const list = [...cur.querySelectorAll(A.rangeSelectSel || A.textInputSel)].filter((e) => e.offsetHeight > 0);
          if (list.length < need) return j({ ok: false, err: 'range-selects-missing', id, selects: list.length, need });
          const sel = list[i * 2 + k];
          if (!sel || !sel.isConnected) return j({ ok: false, err: 'select-detached', id, step: want, picked: picks });
          const { menu } = await openMenuFor(sel);
          if (!menu) return j({ ok: false, err: 'menu-not-open', id, step: want, picked: picks });
          last = await chooseIn(menu, text, true);
          if (last.ok) { hit = last; break; }
        }
        if (!hit) {
          return j({ ok: false, err: last.err, id, step: want, picked: picks, available: last.available });
        }
        picks.push(hit.text);
      }
    }
    await sleep(300);

    const out = { id, from: a.y + '-' + a.m, to: b ? b.y + '-' + b.m : null, picks };
    const assumed = a.assumed.map((x) => 'from.' + x).concat(b ? b.assumed.map((x) => 'to.' + x) : []);
    if (assumed.length) out.assumed = assumed;

    // 验证：与 fillDate 同一条规则 —— 字段内存在 display 元素时一律以它为准。
    const finalBox = findField(id) || box;
    const disp = A.valueSel ? [...finalBox.querySelectorAll(A.valueSel)].map((e) => e.textContent.trim()) : [];
    const want = openEnd ? [a.y, a.m] : [a.y, a.m, b.y, b.m];
    if (disp.length) {
      out.verifiedBy = 'display';
      out.displayAfter = trunc(disp.filter(Boolean).join(' '));
      out.ok = want.every((w, i) => {
        const got = norm(disp[i] || '');
        return got !== '' && (got === norm(w) || got === norm(String(+w)));
      });
      if (!out.ok) {
        out.err = 'display-not-updated';
        out.hint = '下拉点过了但应用渲染的值没变，请在页面上确认这一格';
      }
      return j(out);
    }
    out.verifiedBy = 'picks';
    out.ok = picks.length === need;
    if (!out.ok) out.err = 'not-stuck';
    return j(out);
  },

  // 在指定区块内加一行。按钮文本各站点高度雷同，所以不按文本选站点，
  // 而是"区块内定候选 → 取文本最短者 → 用区块计数 +1 验证效果"。
  async addRow(kind) {
    if (tabHidden()) return j({ ok: false, err: 'tab-hidden', kind, hint: HIDDEN_HINT });
    if (!A.blockSections) return j({ ok: false, err: 'no-block-sections', kind });
    const sec = sectionByKind(kind);
    if (!sec) return j({ ok: false, err: 'section-not-found', kind });

    const cands = [...sec.querySelectorAll('button,a,[role=button],[class*=btn],[class*=Button]')]
      .filter((b) => b.offsetHeight > 0 && norm(b.textContent).indexOf(norm(A.addText)) >= 0);
    if (!cands.length) return j({ ok: false, err: 'add-button-not-found', kind });

    const rank = (e) => (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button') ? 0 : 1;
    cands.sort((x, y) => {
      const dx = x.textContent.trim().length - y.textContent.trim().length;
      return dx !== 0 ? dx : rank(x) - rank(y);
    });
    const btn = cands[0];
    if (!btn.isConnected) return j({ ok: false, err: 'button-detached', kind });

    const from = groupCount(sec);
    synthClick(btn);
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      const now = groupCount(sec);
      if (now > from) return j({ ok: true, kind, from, to: now, added: now - from });
    }
    return j({ ok: false, err: 'row-not-added', kind, from });
  },
};

return 'engine-loaded';
})()
