#!/usr/bin/env node
// 文本/文本域批量写入（走桥的原生 fill，**后台标签页也可用**）。
//
// 为什么它存在：引擎的 `fillTexts` 靠 `await sleep` 驱动，标签页被 Chrome 判为后台时
// 定时器被节流，必然返回 `err:'tab-hidden'`（§四 已实测两次）。而桥的 `fill` 走扩展侧写入，
// 不吃节流 —— 那是 hidden 状态下唯一可用的写通道。
//
// ★ 本文件修的是一个**静默错写**事故（2026-09-23 苏纳 SUNA 会话），别退回任何一条：
//   临时脚本第一版给元素打 `data-fp=ft0/ft1/...` 标记后**没清理**，第二轮运行时标记名复用，
//   页面上于是同时存在新旧两套同名标记 → `document.querySelector('[data-fp=ft0]')` 取的是
//   **文档里第一个**匹配（旧的「姓名」输入框），第二轮要写的「获得证书」就落到了姓名上；
//   更糟的是回读也用同一个选择器，**读写两边错到一起**，报告里显示成"已验证"。
//   三条纪律由此而来：
//     ① 开跑前清掉本脚本自己用过的全部标记；
//     ② 标记带一次性随机前缀，进程内不复用；
//     ③ 回读一律按 **label 定位到盒内元素**，绝不用全局标记选择器。
//
// 另：只写"盒内可见 input/textarea 恰好 1 个"的字段。多于 1 个（如 国际区号+号码 的复合盒）
// 直接拒写 —— 与引擎 `composite-field` 同一条纪律：宁可明确失败，不要静默写错位置。
//
// 用法：
//   node scripts/filltext.mjs --session <名> --set "姓名=王铭龙" --set "外语等级=六级"
//   node scripts/filltext.mjs --session <名> --json <pairs.json>     # [[label, value], ...] 或 [{label,index,value}]
// 输出：{ok, total, written, failed:[...], results:[{label, before, wrote, readback, ok}]}

import { readFileSync } from 'node:fs';

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:10086/command';
const TAG_ATTR = 'data-fp-fill';

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

export const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// label 文案：真实浏览器用 innerText（只取可见文本），jsdom 没实现 innerText
// （读出来是 undefined）→ 退到 textContent。这样定位逻辑在两边可测且行为一致。
export const labelText = (box) => {
  const l = box && box.querySelector('label');
  if (!l) return '';
  return norm(l.innerText || l.textContent || '').split('\n')[0];
};

// 纯函数：按 label 在盒内定位唯一可见的 input/textarea。有单测（tests/filltext.test.mjs）。
// doc 只用 querySelectorAll / offsetWidth|offsetHeight，jsdom 里可桩。
// index 从 1 起（与 `__ja` 的 ID 口径、choose.mjs 的 `label#n` 一致）：同名 label 的第 n 个盒子。
export function pickField(doc, label, index = 1) {
  const items = [...doc.querySelectorAll('.form-item')];
  const boxes = items.filter((i) => labelText(i) === norm(label));
  const it = boxes[index - 1];
  if (!it) return { err: 'box-not-found', n: boxes.length };
  const ins = [...it.querySelectorAll('input, textarea')].filter((e) => e.offsetWidth || e.offsetHeight);
  if (ins.length === 0) return { err: 'no-visible-input', n: 0 };
  if (ins.length > 1) return { err: 'composite-or-none', n: ins.length };
  return { el: ins[0] };
}

// '项目名称#2=xxx' → 第 2 行；不带 # 即第 1 行。多行区块（教育/工作/项目）必须靠它定位。
export function parseSet(arg) {
  const i = String(arg).indexOf('=');
  if (i <= 0) return null;
  const head = norm(String(arg).slice(0, i));
  const value = String(arg).slice(i + 1);
  const m = head.match(/^(.*?)#(\d+)$/);
  const label = m ? norm(m[1]) : head;
  const index = m ? Number(m[2]) : 1;
  if (!label || !value || !(index >= 1)) return null;
  return { label, index, value, key: index > 1 ? `${label}#${index}` : label };
}

// 标记名带一次性前缀：同一进程内不复用，跨进程也不重名（见文件头的三条纪律）
export const tagName = (run, i) => `${run}${i}`;

const unwrap = (v) => { let g = 0; while (typeof v === 'string' && g++ < 4) { try { v = JSON.parse(v); } catch { break; } } return v; };

async function main() {
  const session = flagOne('--session', null);
  let pairs = flagAll('--set').map(parseSet);
  const jsonPath = flagOne('--json', null);
  if (jsonPath) {
    // 兼容两种 json 形态：["label#n", "value"] 或 { label, index, value }
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    for (const r of raw) {
      if (Array.isArray(r)) pairs.push(parseSet(`${r[0]}=${r[1]}`));
      else if (r && r.label) pairs.push({ label: norm(r.label), index: r.index || 1, value: String(r.value), key: (r.index || 1) > 1 ? `${r.label}#${r.index}` : r.label });
    }
  }
  pairs = pairs.filter(Boolean);

  if (!session) { console.log(JSON.stringify({ ok: false, err: 'missing --session' })); process.exit(1); }
  if (!pairs.length) { console.log(JSON.stringify({ ok: false, err: 'nothing to do: --set "<label>[#n]=<value>" or --json <file>' })); process.exit(1); }

  const bridge = async (action, args) => {
    const r = await fetch(BRIDGE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(`${action}: ${(j.error && j.error.message) || JSON.stringify(j)}`);
    return j.data;
  };
  const evalIn = async (body) => unwrap((await bridge('evaluate', { code: `(() => { const norm = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); ${body} })()` })).value);

  const run = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

  // ① 清残留标记（本次静默错写事故的直接原因）
  const cleaned = (await evalIn(`
    let n = 0;
    document.querySelectorAll('[${TAG_ATTR}]').forEach(e => { e.removeAttribute('${TAG_ATTR}'); n++; });
    return JSON.stringify({ n });
  `)).n;

  // ② 定位 + 打唯一标记
  const tagged = await evalIn(`
    const pairs = ${JSON.stringify(pairs)};
    const run = ${JSON.stringify(run)};
    const items = [...document.querySelectorAll(".form-item")];
    const lab = x => { const l = x.querySelector('label'); const s = l ? norm(l.innerText || l.textContent || '') : ''; const i = s.indexOf(String.fromCharCode(10)); return i < 0 ? s : s.slice(0, i); };
    const out = [];
    pairs.forEach((p, i) => {
      const boxes = items.filter(x => lab(x) === norm(p.label));
      const it = boxes[(p.index || 1) - 1];
      if (!it) { out.push({ key: p.key, err: 'box-not-found', found: boxes.length }); return; }
      const ins = [...it.querySelectorAll('input, textarea')].filter(e => e.offsetWidth || e.offsetHeight);
      if (ins.length !== 1) { out.push({ key: p.key, err: 'composite-or-none', n: ins.length }); return; }
      const tag = run + i;
      ins[0].setAttribute('${TAG_ATTR}', tag);
      out.push({ key: p.key, tag, before: (ins[0].value || '').slice(0, 60) });
    });
    return JSON.stringify(out);
  `);

  // ③ 写入
  const results = [];
  for (const t of tagged) {
    const p = pairs.find((x) => x.key === t.key);
    if (t.err) { results.push({ ...t, ok: false }); continue; }
    try {
      await bridge('click', { selector: `[${TAG_ATTR}=${t.tag}]` });
      const r = await bridge('fill', { selector: `[${TAG_ATTR}=${t.tag}]`, value: p.value });
      results.push({ key: t.key, before: t.before, wrote: p.value.slice(0, 60), ok: !!r.success });
    } catch (e) {
      results.push({ key: t.key, ok: false, err: String(e.message).slice(0, 140) });
    }
  }

  // ④ 回读：按 label 重新定位（**不用标记选择器** —— 那正是读写两边错到一起的原因）
  const back = await evalIn(`
    const pairs = ${JSON.stringify(pairs)};
    const items = [...document.querySelectorAll('.form-item')];
    const lab = x => { const l = x.querySelector('label'); const s = l ? norm(l.innerText || l.textContent || '') : ''; const i = s.indexOf(String.fromCharCode(10)); return i < 0 ? s : s.slice(0, i); };
    return JSON.stringify(pairs.map((p) => {
      const boxes = items.filter(x => lab(x) === norm(p.label));
      const it = boxes[(p.index || 1) - 1];
      if (!it) return { key: p.key, err: 'box-not-found' };
      const ins = [...it.querySelectorAll('input, textarea')].filter(e => e.offsetWidth || e.offsetHeight);
      return { key: p.key, val: ins.length === 1 ? norm(ins[0].value).slice(0, 60) : '(n=' + ins.length + ')' };
    }));
  `);
  const backMap = new Map(back.map((b) => [b.key, b.val]));

  // ⑤ 清掉本次标记
  await evalIn(`document.querySelectorAll('[${TAG_ATTR}]').forEach(e => e.removeAttribute('${TAG_ATTR}')); return JSON.stringify({ ok: true });`);

  for (const r of results) {
    if (r.err) continue;
    const want = pairs.find((p) => p.key === r.key).value;
    r.readback = backMap.get(r.key);
    r.ok = r.readback === norm(want) || (r.readback || '').startsWith(norm(want).slice(0, 40));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, run, cleaned, total: results.length, written: results.length - failed.length, failed: failed.length, results }));
  process.exit(failed.length === 0 ? 0 : 1);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) main();
