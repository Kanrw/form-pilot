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
//
// 字段寻址：`<label>` = 第 1 个同名字段；`<label>#<n>` = 第 n 个（1 起，与 __ja 的 ID 口径一致）。
// 输出：一行 compact JSON {ok, results:[{field,value,ok,verifiedBy,display,options?,err?}]}
// 退出码：全成功 0，否则 1。
//
// ★ 选哪个由 Node 侧的 matchOption 决定（2026-09-23 修）。
//   原先页内字符串里另有一份匹配器，导致 6 例单测覆盖的 matchOption **根本不参与生产**，
//   而且两份语义不同（单测那份精确命中 ≥2 报 ambiguous 不猜，页内那份取第一个 exact）。
//   现在页内只负责**取候选并打标记**（candidatesBody），选谁一律回到 Node 侧用 matchOption 判 ——
//   被测的就是在跑的那份。另外：**标记与点击必须原子**，标记跨一次桥往返就可能被 React
//   重渲染换掉节点（实测 `click: element not found`）。

// 注：本文件原先还 import 了 readFileSync 但从未使用（死导入，2026-09-23 随 A 项一并清掉）。

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
// 菜单是异步渲染的，重试靠**多次桥往返**（每次往返本身就是真实等待），不用定时器 ——
// 后台标签页里定时器会被 Chrome 节流，那正是引擎 `tab-hidden` 的成因（AGENTS §四）。
const TRIES = 3;

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

// 候选 [{tag,text}] + 目标值 → 该点哪个 tag。
// 这是**生产路径真正调用的那个判断**（matchOption 的语义在这里落地，不是复制一份）。
//
// 重复文本一律报 ambiguous，不"取第一个"：2026-09-23 实测踩到过 ——
// 上一格菜单没关掉时，`--options 到岗时间` 返回的候选里混进了「学历」的选项。
// 那种情况下"取第一个"会把值点进**另一个字段的面板**，属于静默错填。
// 宁可报 ambiguous 让人来看（配合下面 closeOpenPanels 的开菜单前清场）。
export function chooseCandidate(cands, value) {
  const texts = cands.map((c) => c.text);
  const m = matchOption(texts, value);
  if (m.how === 'ambiguous') return { err: 'option-ambiguous', candidates: m.candidates, options: texts };
  if (m.how === 'none') return { err: 'option-not-found', options: texts };
  const hit = cands.find((c) => norm(c.text) === norm(m.raw));
  // matchOption 的成功分支必然来自某个候选，走到这里说明取数窗口与判定窗口不一致
  if (!hit) return { err: 'option-not-found', options: texts };
  return { tag: hit.tag, text: m.raw, how: m.how };
}

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
  panel: '[class*=phoenix-selectList]',
};
const OPT_ATTR = 'data-ch-opt';

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

// 取候选：只做取数 + 打标记，**不选**。选谁由 Node 侧的 chooseCandidate 决定。
// 按 rect 就近过滤 —— 面板可能挂在 portal 上、不在触发器子树里，
// 唯一可靠的锚是"出现在触发器正下方"（已知局限：邻近的另一个面板也可能落进窗口，
// 所以真正选谁还要过 matchOption 的歧义判定）。
const candidatesBody = (run) => `
  const trig = document.querySelector('[data-ch=trig]');
  if (!trig) return JSON.stringify({ err: 'trigger-lost' });
  const t = trig.getBoundingClientRect();
  document.querySelectorAll('[${OPT_ATTR}]').forEach(e => e.removeAttribute('${OPT_ATTR}'));
  const all = [...document.querySelectorAll('${SEL.option}')].filter(e => e.offsetHeight);
  const near = all.filter(e => {
    const r = e.getBoundingClientRect();
    return Math.abs(r.x - t.x) < 320 && r.y > t.y - 30 && r.y < t.y + 500;
  });
  const out = near.map((e, i) => {
    const tag = ${JSON.stringify(run)} + i;
    e.setAttribute('${OPT_ATTR}', tag);
    return { tag, text: norm(e.innerText) };
  });
  return JSON.stringify({ ok: true, cands: out });
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
  document.querySelectorAll('[data-ch], [${OPT_ATTR}]').forEach(e => { e.removeAttribute('data-ch'); e.removeAttribute('${OPT_ATTR}'); });
  return JSON.stringify({ ok: true });
`);

// 开菜单前先确认页面上没有**残留的已开面板**。
// 命名失败（2026-09-23 实测）：上一格的菜单没关掉时，`--options 到岗时间` 取回的候选里
// 混进了「学历」的选项 —— 那不是"多看几个选项"，而是会点到别人的面板上（静默错填另一字段）。
// 关闭动作靠 Escape + body.click，**每次尝试用一次桥往返当等待**（页内定时器会被后台节流，
// 见文件头），最多 3 次；关不掉就明确报 stale-menu-open 而不是硬着头皮开。
async function closeOpenPanels() {
  const countOpen = () => evalIn(`
    const n = [...document.querySelectorAll('${SEL.panel}')].filter(e => e.offsetHeight).length;
    return JSON.stringify({ n });
  `);
  let n = (await countOpen()).n;
  for (let i = 0; i < 3 && n > 0; i++) {
    await evalIn(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.click();
      return JSON.stringify({ ok: true });
    `);
    n = (await countOpen()).n;
  }
  return n;
}

// 开菜单并取回候选（带重试：菜单异步渲染）。返回 [{tag,text}] 或 {err}
async function openAndCollect(run) {
  let last = { err: 'menu-not-open' };
  for (let i = 0; i < TRIES; i++) {
    const r = await evalIn(candidatesBody(run));
    if (r.err) { last = r; continue; }
    if (r.cands && r.cands.length) return r.cands;
    last = { err: 'menu-empty' };
  }
  return last;
}

// 列出某字段的选项（只开菜单，不选）。给"档案里没有值"的字段做人工决策用。
export async function listOptions(label, index = 1) {
  await cleanup();
  const stale = await closeOpenPanels();
  if (stale) return { ok: false, err: 'stale-menu-open', openPanels: stale };
  const loc = await evalIn(locateBody(label, index));
  if (loc.err) return { ok: false, err: loc.err };
  await bridge('click', { selector: '[data-ch=trig]' });
  const cands = await openAndCollect('opt');
  // 关掉菜单：再点一次触发器（"切换"语义，见 AGENTS §四）
  await bridge('click', { selector: '[data-ch=trig]' });
  await cleanup();
  if (!Array.isArray(cands)) return { ok: false, err: cands.err };
  return { ok: true, options: [...new Set(cands.map((c) => c.text))] };
}

async function chooseOne({ label, index, value }) {
  const key = label + (index > 1 ? '#' + index : '');
  await cleanup();
  const stale = await closeOpenPanels();
  if (stale) return { field: key, value, ok: false, err: 'stale-menu-open', openPanels: stale };
  const loc = await evalIn(locateBody(label, index));
  if (loc.err) return { field: key, value, ok: false, err: 'field-not-found' };
  await bridge('click', { selector: '[data-ch=trig]' });

  const run = 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const cands = await openAndCollect(run);
  if (!Array.isArray(cands)) {
    await bridge('click', { selector: '[data-ch=trig]' }); // 收残留菜单
    await cleanup();
    return { field: key, value, ok: false, err: cands.err };
  }

  const pick = chooseCandidate(cands, value);
  if (pick.err) {
    await bridge('click', { selector: '[data-ch=trig]' }); // 收残留菜单
    await cleanup();
    return { field: key, value, ok: false, err: pick.err, options: (pick.options || []).slice(0, 20) };
  }

  await bridge('click', { selector: `[${OPT_ATTR}="${pick.tag}"]` });
  const back = await evalIn(readbackBody(label, index));
  await cleanup();
  const display = back.display || '';
  const ok = display === value || display.includes(value) || value.includes(display);
  return {
    field: key, value,
    ok, verifiedBy: 'display', display,
    ...(ok ? { how: pick.how, ...(pick.nodes > 1 ? { nodes: pick.nodes } : {}) } : { err: 'display-not-updated', options: (pick.options || []).slice(0, 20) }),
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
