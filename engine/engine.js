// form-pilot · 浏览器表单自动填写引擎
//
// 唯一事实源：form-pilot/engine/engine.js
//   `skill/references/engine.js` 是 sync 生成物，勿手改。
// 注入方式：scripts/inject.mjs —— 本文件 + adapters.js 拼成一个字符串，一次 evaluate。
// 版本号：与 skill/SKILL.md frontmatter 的 version、CHANGELOG 最新条目保持一致（D-5）。
//
// 本文件不含 R3/R4/R5/R8/R9 的任何实现或占位，见 AGENTS.md §2.4。

(() => {
if (window.__ja) return 'already loaded';

const VERSION = '0.1.0';

// ── 工具 ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[\s*：:]/g, '');
const trunc = (v) => { const s = v == null ? '' : String(v); return s.length > 200 ? s.slice(0, 200) : s; };
const j = (o) => JSON.stringify(o);

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
    const inp = box.querySelector(A.textInputSel);
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
      block = 'main';
      id = 'main>>' + label;
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
    const label = m[3];
    for (const e of entries()) {
      if (norm(e.label) !== norm(label)) continue;
      if (kind === null) {
        if (e.block === 'main') return e.box;
        continue;
      }
      const s = sectionOf(e.box);
      if (s && s.kind === kind && s.rowIndex === row) return e.box;
    }
    return null;
  }
  const lm = /^(.*)#(\d+)$/.exec(id);
  const label = lm ? lm[1] : id;
  const nth = lm ? +lm[2] : 1;
  const hits = fields().filter((b) => norm(labelOf(b)) === norm(label));
  return hits[nth - 1] || null;
}

// ── 菜单 ────────────────────────────────────────────────
function visibleMenus() {
  const all = A.menuSel
    ? [...document.querySelectorAll(A.menuSel)]
    : [...document.body.children].flatMap((d) => [d, ...d.querySelectorAll('[class*=menu],[class*=Menu],[class*=dropdown],[class*=Dropdown],[class*=popper],[class*=option],[role=listbox]')]);
  return [...new Set(all)].filter((m) => m.offsetHeight > 30);
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
    return j({ total: list.length, fields: list });
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
    const results = [];
    for (const id of Object.keys(map)) {
      const value = map[id];
      const row = { id, ok: false, phase: 'locate', err: '', attempted: trunc(value), final: '', _v: value };
      const box = findField(id);
      if (!box) { row.err = 'field-not-found'; results.push(row); continue; }
      const type = typeOf(box);
      if (type !== 'text' && type !== 'textarea') { row.err = 'not-text:' + type; results.push(row); continue; }
      const inp = box.querySelector(A.textInputSel);
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
      const inp = box && box.querySelector(A.textInputSel);
      const now = inp ? inp.value : '';
      if (now !== r._v) swallowed.push(r);
      else r.final = trunc(now);
    }
    for (const r of swallowed) {
      const box = findField(r.id);
      const inp = box && box.querySelector(A.textInputSel);
      if (!inp) continue;
      setNativeValue(inp, r._v);
      retried.push(r.id);
    }
    if (swallowed.length) {
      await sleep(400);
      for (const r of swallowed) {
        const box = findField(r.id);
        const inp = box && box.querySelector(A.textInputSel);
        const now = inp ? inp.value : '';
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
    const search = !opts || opts.search !== false;
    const box = findField(id);
    if (!box) return j({ ok: false, err: 'field-not-found', id });

    const before = new Set(visibleMenus());
    const trigger = box.querySelector(A.textInputSel) || box;
    synthClick(trigger);

    let menu = null;
    let freshCount = 0;
    for (let i = 0; i < 8; i++) {
      await sleep(250);
      const fresh = visibleMenus().filter((m) => !before.has(m) && m.isConnected);
      freshCount = fresh.length;
      if (fresh.length) { menu = fresh[0]; break; }
    }
    // 删掉了原型里的 `|| visibleMenus().pop()` 兜底：它会把常驻菜单当目标。
    // 找不到就失败，好过选错菜单。
    if (!menu) return j({ ok: false, err: 'menu-not-open', id, hint: 'fallback-cdp' });

    const searchBox = menu.querySelector('input:not([readonly])');
    if (search && searchBox && optionText) {
      setNativeValue(searchBox, optionText);
      await sleep(400);
    }
    const items = menuItems(menu);
    const target = matchItem(items, optionText);
    if (!target) {
      document.body.click();
      return j({
        ok: false, err: 'option-not-found', id, optionText,
        menus: freshCount,
        available: items.slice(0, 10).map((x) => x.textContent.trim().slice(0, 15)),
      });
    }
    if (!target.isConnected) return j({ ok: false, err: 'item-detached', id, optionText });

    synthClick(target);
    await sleep(500);
    const value = readSelect(box);
    return j({ ok: norm(value) === norm(optionText) || value.indexOf(optionText) >= 0, id, value: trunc(value) });
  },

  // 在指定区块内加一行。按钮文本各站点高度雷同，所以不按文本选站点，
  // 而是"区块内定候选 → 取文本最短者 → 用区块计数 +1 验证效果"。
  async addRow(kind) {
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
