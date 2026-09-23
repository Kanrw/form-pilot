#!/usr/bin/env node
// 北森式自定义下拉：点触发器 → 点选项。
//
// 为什么在驱动层而不在 engine 里（2026-09-23 方正 PCB 实测）：
//   北森 `phoenix-select--editable` 对页内合成事件全免疫（合成 pointer 五件套、
//   native setter、CDP insertText 都试过，见 AGENTS §五 北森实战记录）。
//   唯一实测有效的是**真实坐标点击** —— 那正是 AGENTS §八 降级链的第 2 步，
//   而引擎跑在页内、拿不到扩展的 click 动作。所以 R3 的 setChoice 落地成这个驱动，
//   不是 `__ja.setChoice` 方法。
//
// 用法：
//   node scripts/choose.mjs --session s --options "婚姻状况"
//   node scripts/choose.mjs --session s --set "婚姻状况=未婚"
//   node scripts/choose.mjs --session s --set "学历#1=博士研究生" --set "学习形式#1=全日制"
//   node scripts/choose.mjs --session s --set "..." --dry      # 只报告不点
//
// 字段寻址：`<label>` = 第 1 个同名字段；`<label>#<n>` = 第 n 个（1 起，与 __ja 的 ID 口径一致）。
// 输出：一行 compact JSON {ok, results:[{field,value,ok,verifiedBy,display,options?,err?}]}
// 退出码：全成功 0，否则 1。

import { readFileSync } from 'node:fs';

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:10086/command';

const argv = process.argv.slice(2);
const flagOne = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flagAll = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
  return out;
};

const session = flagOne('--session', null);
const sets = flagAll('--set');
const optionsOf = flagOne('--options', null);
const dry = argv.includes('--dry');
const tries = Number(flagOne('--tries', '3')) || 3;

// ── 纯函数（有单测，见 tests/choose.test.mjs）──────────────────────────────
export const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// '学历#2' → { label:'学历', index:2 }；'学历' → { label:'学历', index:1 }
export const parseTarget = (spec) => {
  const m = norm(spec).match(/^(.*?)#(\d+)$/);
  if (!m) return { label: norm(spec), index: 1 };
  return { label: norm(m[1]), index: Number(m[2]) };
};

// '婚姻状况=未婚' → { spec, value }。值里允许出现 '='，按第一个 '=' 切。
export const parseSet = (arg) => {
  const i = String(arg).indexOf('=');
  if (i < 0) return null;
  const { label, index } = parseTarget(String(arg).slice(0, i));
  const value = norm(String(arg).slice(i + 1));
  if (!label || !value) return null;
  return { label, index, value, key: index > 1 ? `${label}#${index}` : label };
};

// 选项匹配：精确 → 去括号/去空格后的精确 → 唯一包含。
// 不做"猜一个"：多个候选命中同一档就报 ambiguous，宁可人工点。
export const matchOption = (texts, value) => {
  const list = texts.map((t) => ({ raw: t, t: norm(t) }));
  const v = norm(value);
  const exact = list.filter((x) => x.t === v);
  if (exact.length === 1) return { raw: exact[0].raw, how: 'exact' };
  if (exact.length > 1) return { how: 'ambiguous', candidates: exact.map((x) => x.raw) };
  const loose = list.filter((x) => x.t.replace(/[（）()\s]/g, '') === v.replace(/[（）()\s]/g, ''));
  if (loose.length === 1) return { raw: loose[0].raw, how: 'loose' };
  if (loose.length > 1) return { how: 'ambiguous', candidates: loose.map((x) => x.raw) };
  const inc = list.filter((x) => x.t.includes(v) || v.includes(x.t));
  if (inc.length === 1) return { raw: inc[0].raw, how: 'contains' };
  if (inc.length > 1) return { how: 'ambiguous', candidates: inc.map((x) => x.raw) };
  return { how: 'none' };
};

// ── 桥 ────────────────────────────────────────────────────────────────────
const unwrap = (v) => {
  let g = 0;
  while (typeof v === 'string' && g++ < 4) { try { v = JSON.parse(v); } catch { break; } }
  return v;
};

async function bridge(action, args) {
  const r = await fetch(BRIDGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args, session }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${action}: ${(j.error && j.error.message) || JSON.stringify(j)}`);
  return j.data;
}

const evalIn = async (body) => {
  const code = `(() => { const norm = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); ${body} })()`;
  return unwrap((await bridge('evaluate', { code })).value);
};

const SEL = {
  item: '.form-item',
  trig: '[class*=phoenix-select]',
  option: '[class*=phoenix-selectList__listItem]',
};

// 定位第 index 个 label 匹配的字段，滚进视口，标记触发器。返回 rect。
const locateBody = (name, index) => `
  const hits = [...document.querySelectorAll('${SEL.item}')].filter(it => {
    const l = norm((it.querySelector('label') || {}).innerText || '').split('\\n')[0];
    return l === norm(${JSON.stringify(name)});
  });
  if (hits.length < ${index}) return JSON.stringify({ err: 'field-not-found', found: hits.length });
  const it = hits[${index - 1}];
  const trig = it.querySelector('${SEL.trig}') || it;
  trig.scrollIntoView({ block: 'center' });
  trig.setAttribute('data-ch', 'trig');
  const r = trig.getBoundingClientRect();
  return JSON.stringify({ ok: true, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: String(trig.className).slice(0, 60) });
`;

// 开着的菜单里找选项。按 rect 就近过滤 —— 面板可能挂在 portal 上，
// 不在触发器子树里，唯一可靠的锚是"出现在触发器正下方"。
const optionBody = (value) => `
  const trig = document.querySelector('[data-ch=trig]');
  if (!trig) return JSON.stringify({ err: 'trigger-lost' });
  const t = trig.getBoundingClientRect();
  const all = [...document.querySelectorAll('${SEL.option}')].filter(e => e.offsetHeight);
  const texts = [...new Set(all.map(e => norm(e.innerText)))];
  const near = all.filter(e => {
    const r = e.getBoundingClientRect();
    return Math.abs(r.x - t.x) < 320 && r.y > t.y - 30 && r.y < t.y + 500;
  });
  if (!near.length) return JSON.stringify({ err: 'menu-not-open', visibleOptions: texts.slice(0, 12) });
  const textsNear = [...new Set(near.map(e => norm(e.innerText)))];
  const want = norm(${JSON.stringify(value)});
  let chosen = near.find(e => norm(e.innerText) === want);
  if (!chosen) chosen = near.find(e => norm(e.innerText).replace(/[（）()]/g, '') === want.replace(/[（）()]/g, ''));
  if (!chosen) {
    const inc = near.filter(e => norm(e.innerText).includes(want) || want.includes(norm(e.innerText)));
    if (inc.length === 1) chosen = inc[0];
    else return JSON.stringify({ err: inc.length ? 'option-ambiguous' : 'option-not-found', options: textsNear.slice(0, 20) });
  }
  chosen.setAttribute('data-ch', 'opt');
  return JSON.stringify({ ok: true, matched: norm(chosen.innerText), how: norm(chosen.innerText) === want ? 'exact' : 'loose', options: textsNear.slice(0, 20) });
`;

const readbackBody = (name, index) => `
  const hits = [...document.querySelectorAll('${SEL.item}')].filter(it => {
    const l = norm((it.querySelector('label') || {}).innerText || '').split('\\n')[0];
    return l === norm(${JSON.stringify(name)});
  });
  const it = hits[${index - 1}];
  if (!it) return JSON.stringify({ err: 'field-not-found' });
  const trig = it.querySelector('${SEL.trig}') || it;
  return JSON.stringify({ display: norm(trig.innerText).slice(0, 60) });
`;

const cleanup = () => evalIn(`
  document.querySelectorAll('[data-ch]').forEach(e => e.removeAttribute('data-ch'));
  return JSON.stringify({ ok: true });
`);

// 列出某字段的选项（只开菜单，不选）。给"档案里没有值"的字段做人工决策用。
export async function listOptions(label, index = 1) {
  await cleanup();
  const loc = await evalIn(locateBody(label, index));
  if (loc.err) return { ok: false, err: loc.err };
  await bridge('click', { selector: '[data-ch=trig]' });
  let opts = null;
  for (let i = 0; i < tries; i++) {
    const r = await evalIn(optionBody('<none>'));
    if (r.options && !opts) opts = r.options;
    if (r.err !== 'menu-not-open') break;
  }
  // 关掉菜单：再点一次触发器（"切换"语义，见 AGENTS §四）
  await bridge('click', { selector: '[data-ch=trig]' });
  await cleanup();
  return { ok: true, options: opts || [] };
}

async function chooseOne({ label, index, value }) {
  await cleanup();
  const loc = await evalIn(locateBody(label, index));
  if (loc.err) return { field: label + (index > 1 ? '#' + index : ''), value, ok: false, err: 'field-not-found' };
  await bridge('click', { selector: '[data-ch=trig]' });

  let pick = null;
  for (let i = 0; i < tries; i++) {
    pick = await evalIn(optionBody(value));
    if (!pick.err) break;
  }
  if (!pick || pick.err) {
    await bridge('click', { selector: '[data-ch=trig]' }); // 收残留菜单
    await cleanup();
    return { field: label + (index > 1 ? '#' + index : ''), value, ok: false, err: (pick && pick.err) || 'menu-not-open', options: (pick && pick.options) || [] };
  }

  await bridge('click', { selector: '[data-ch=opt]' });
  const back = await evalIn(readbackBody(label, index));
  await cleanup();
  const display = back.display || '';
  const ok = display === value || display.includes(value) || value.includes(display);
  return {
    field: label + (index > 1 ? '#' + index : ''), value,
    ok, verifiedBy: 'display', display,
    ...(ok ? { how: pick.how } : { err: 'display-not-updated', options: pick.options, matched: pick.matched }),
  };
}

async function main() {
  if (!session) { console.log(JSON.stringify({ ok: false, err: 'missing --session' })); process.exit(1); }
  if (!sets.length && !optionsOf) { console.log(JSON.stringify({ ok: false, err: 'nothing to do: pass --set "<字段>=<值>" or --options "<字段>"' })); process.exit(1); }

  try {
    if (optionsOf) {
      const { label, index } = parseTarget(optionsOf);
      const r = await listOptions(label, index);
      console.log(JSON.stringify({ ok: r.ok, field: optionsOf, options: r.options || [], ...(r.err ? { err: r.err } : {}) }));
      process.exit(r.ok ? 0 : 1);
    }

    const results = [];
    for (const arg of sets) {
      const t = parseSet(arg);
      if (!t) { results.push({ field: arg, ok: false, err: 'bad-set-format' }); continue; }
      if (dry) { results.push({ field: t.key, value: t.value, ok: true, dry: true }); continue; }
      results.push(await chooseOne(t));
    }
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }));
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: 'bridge-or-eval-failed', detail: String(e.message).slice(0, 300) }));
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) main();
