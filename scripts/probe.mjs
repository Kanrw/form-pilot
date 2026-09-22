#!/usr/bin/env node
// 站点结构探测器（只读）。
//
// 它替你做一件事：把 DOM 结构一次性 dump 成结构化 JSON。
// 它**不做**的事（三条边界，别放宽）：
//   1. 不推荐、不打分 —— 注册项只能由人审核后产出（防止"猜一个"变成静默错误）
//   2. 不写入、不点击、不触发任何状态变更
//   3. 不写回 engine/adapters.js —— 写回是「翻译＋受控写」两步动作
//
// 为什么薄到这个程度：AGENTS.md §2.2 只允许扩展「当前确实漏掉的东西」。
// 今天真实发生过的、确实靠手做的部分只有「把 DOM 抄成注册项」，
// 所以本文件只生成**证据**，注册项仍由人审核产出。
//
// ★ 核心判据来自 2026-09-22 的 bool_info 事故（见 AGENTS.md §五 校正 2）：
//   引擎停在 `box.className`（engine.js:78），而 Moka 的 select 组件是它的**子树**。
//   本文件因此把类型判据抬高到**子树结构特征**，而不是容器自身的类名。
//
// 用法：node scripts/probe.mjs --session <名> [--as <选择器>] [--text] [--limit N]
// 输出：{ok, url, detect, base, containers, types, ...}
// 退出码：ok ? 0 : 1
//
// ⚠️ 隐私：默认**不输出任何页面文本**。--text 才输出标签文本，此时整份输出
//    视为含个人数据，禁止进 git / tests/fixtures / docs。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:10086/command';

// ── 注入体 ─────────────────────────────────────────────
// 单独导出，好让 jsdom 能直接跑它做回归（不需要真实浏览器）。
export const PROBE_CODE = `(() => {
  var qsa = function (s) { try { return document.querySelectorAll(s); } catch (e) { return []; } };
  var toks = function (el) { return ((el.className || '') + '').split(/\\s+/).filter(Boolean); };
  var esc = function (s) { return '[class*="' + s + '"]'; };

  // ── 1. 页面基数 ──────────────────────────────────
  var inputs = qsa('input,textarea');
  var selNoFile = 'input:not([type=file]):not([type=checkbox]):not([type=radio]),textarea';
  var base = {
    inputs: qsa('input').length,
    textareas: qsa('textarea').length,
    files: qsa('input[type=file]').length,
    total: inputs.length,
    visible: [].filter.call(inputs, function (e) { return e.offsetHeight > 0 || true; }).length
  };

  // ── 2. 候选容器前缀 ──────────────────────────────
  // 前缀是全量枚举的，所以 "apply-field" 与 "apply-field-" 会作为两个候选
  // 各自算出自己的计数 —— 差异由数据浮现，不由我们猜。
  var pool = {};
  for (var i = 0; i < inputs.length; i++) {
    var p = inputs[i];
    for (var d = 0; p && d < 12; p = p.parentElement, d++) {
      var ts = toks(p);
      for (var t = 0; t < ts.length; t++) pool[ts[t]] = true;
    }
  }
  var cands = {};
  Object.keys(pool).forEach(function (tok) {
    if (tok.length < 4) return;
    for (var n = 4; n <= tok.length; n++) cands[tok.slice(0, n)] = true;
  });

  // 给控件编号，好在候选之间做"覆盖了多少个不同控件"的去重统计。
  var idx = new Map(), nIdx = 0;
  for (var q = 0; q < inputs.length; q++) if (!idx.has(inputs[q])) idx.set(inputs[q], nIdx++);

  var candsArr = Object.keys(cands);
  var rough = [];
  for (var c = 0; c < candsArr.length; c++) {
    var prefix = candsArr[c];
    var nodes = qsa(esc(prefix));
    if (!nodes.length || nodes.length > 400) continue;   // 太泛的前缀直接丢
    var seen = new Set(), withCtl = 0;
    for (var k = 0; k < nodes.length; k++) {
      var cs = nodes[k].querySelectorAll(selNoFile);
      if (!cs.length) continue;
      withCtl++;
      for (var m = 0; m < cs.length; m++) seen.add(idx.get(cs[m]));
    }
    var covered = seen.size;
    if (covered < 2) continue;                            // 覆盖不到 2 个控件，不可能是字段容器
    rough.push({ prefix: prefix, total: nodes.length, withCtl: withCtl, covered: covered });
  }
  // ★ 排序按"去重覆盖数"，不是"含控件的节点数" —— 后者会把 wrapper 重复计数，
  //   导致含 8 个套娃的 "apply-" 压在零套娃的 "apply-field-" 前面。这个 bug 是
  //   jsdom + tests/fixtures/moka.html 跑出来的，别改回去。
  rough.sort(function (a, b) {
    return b.covered - a.covered || a.total - b.total || b.prefix.length - a.prefix.length;
  });

  // 同义前缀去重：一个 token 会派生出几十个等价前缀（"apply-field-eeeeeeee"
  // 派生 apply-f / apply-fi / ... / apply-field-eeeeeee），它们 (total,covered)
  // 完全相同，会把名额挤光、让真正的候选掉出 Top40。每组只留一个代表：
  // 优先以分隔符结尾的（那才是稳定的语义边界），其次最短的。
  var groups = {}, gkey;
  for (var g = 0; g < rough.length; g++) {
    var cand = rough[g];
    gkey = cand.total + '/' + cand.covered;
    var cur = groups[gkey];
    if (!cur) { groups[gkey] = cand; continue; }
    var endA = /[-_]$/.test(cand.prefix), endB = /[-_]$/.test(cur.prefix);
    if (endA !== endB ? endA : cand.prefix.length < cur.prefix.length) groups[gkey] = cand;
  }
  var rough2 = Object.keys(groups).map(function (k) { return groups[k]; });
  rough2.sort(function (a, b) { return a.total - b.total || a.prefix.length - b.prefix.length; });

  // 嵌套污染只对头部候选算 —— O(k^2)，全量算会拖垮页面。
  var top = rough2.slice(0, 40);
  var containers = top.map(function (r) {
    var nodes = [].slice.call(qsa(esc(r.prefix)));
    var nested = 0;
    for (var a = 0; a < nodes.length; a++) {
      for (var b = 0; b < nodes.length; b++) {
        if (a !== b && nodes[a].contains(nodes[b])) { nested++; break; }
      }
    }
    return {
      sel: esc(r.prefix),
      prefix: r.prefix,
      total: r.total,
      withCtl: r.withCtl,
      covered: r.covered,      // 去重后的控件数：真正该等于预期字段数的量
      nested: nested,          // >0 说明它在命中 wrapper；套娃 = 误算字段数
      implied: r.total - nested
    };
  });
  // 精算完 nested 再排一次：零套娃优先，这才是好的字段容器边界。
  containers.sort(function (a, b) {
    return b.implied - a.implied || a.nested - b.nested || a.total - b.total;
  });

  // ── 3. 类型证据（typeMap 的原料）─────────────────
  // ★ 判据在**子树结构**上，不在容器自身的 class 名上。
  //   这是 bool_info 事故留下的唯一正确答案：Moka 的 bool_info 是
  //   sd-Select-container + sd-Input-display-value，容器类名里没有 select。
  var as = window.__PROBE_AS || (containers[0] ? containers[0].sel : selNoFile);
  var boxes = [].slice.call(qsa(as));
  var evidence = {};
  var texts = [];
  boxes.forEach(function (box) {
    toks(box).forEach(function (tok) {
      // ★ key 取"前两段"而不是完整类名。每个字段的后缀 hash 都不同，
      //   用全名分组会导致每条 n=1 全部被过滤掉；而 typeMap 的语义本来就是
      //   前缀匹配（typeOf 用 startsWith），所以 key 形如 bool_info / string_info。
      var mm = tok.match(/^[^_-]+[_-][^_-]+/);
      var e = evidence[mm ? mm[0] : tok] || (evidence[mm ? mm[0] : tok] = {
        token: mm ? mm[0] : tok, n: 0, select: 0, displayValue: 0, readonly: 0,
        textarea: 0, file: 0, radio: 0, dateish: 0, cascadeish: 0
      });
      e.n++;
      if (box.querySelector('[class*=Select],[class*=dropdown],[class*=Menu]')) e.select++;
      if (box.querySelector('[class*=display-value],[class*=displayValue]')) e.displayValue++;
      if (box.querySelector('textarea')) e.textarea++;
      if (box.querySelector('input[type=file]')) e.file++;
      if (box.querySelector('[class*=radio],[class*=checkbox]')) e.radio++;
      if (/day_info|datepicker|date-picker|[_-]date([_-]|$)/i.test(tok)) e.dateish++;
      if (/cascade|location|[_-]area([_-]|$)/i.test(tok)) e.cascadeish++;
      var ro = box.querySelector('input[readonly],[readonly]');
      if (ro) e.readonly++;
    });
    if (window.__PROBE_TEXT) {
      var lb = box.querySelector('label,[class*=title],[class*=Title]');
      texts.push({ label: lb ? lb.textContent.trim().slice(0, 40) : '', tokens: toks(box).join(' ') });
    }
  });

  var types = Object.keys(evidence).map(function (k) { return evidence[k]; })
    .filter(function (e) { return e.n >= 2; })
    .sort(function (a, b) { return b.n - a.n; });

  return JSON.stringify({
    url: location.origin + location.pathname,
    detect: window.__ja ? window.__ja.detect() : 'engine-not-injected',
    base: base,
    assumed: as,
    containers: containers,
    types: types,
    texts: texts
  });
})()`;

// ── CLI ────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

function out(obj, code) {
  console.log(JSON.stringify(obj));
  process.exit(code);
}

async function main() {
  const session = flag('--session', null);
  const as = flag('--as', null);
  const wantText = argv.includes('--text');
  const limit = Math.max(1, Math.min(60, Number(flag('--limit', 25)) || 25));

  if (!session) out({ ok: false, err: 'missing --session' }, 1);

  const code = `(function(){
    window.__PROBE_TEXT = ${wantText ? 'true' : 'false'};
    ${as ? `window.__PROBE_AS = ${JSON.stringify(as)};` : ''}
    return (${PROBE_CODE});
  })()`;

  let payload;
  try {
    const r = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'evaluate', args: { code }, session }),
    });
    payload = await r.json();
  } catch (e) {
    out({ ok: false, err: 'bridge-unreachable', detail: String(e.message).slice(0, 200), hint: '先跑 node scripts/status.mjs' }, 1);
  }
  if (!payload || payload.ok !== true) {
    out({ ok: false, err: 'evaluate-failed', detail: payload && payload.error ? payload.error.message : JSON.stringify(payload).slice(0, 300) }, 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(payload.data.value);
  } catch {
    out({ ok: false, err: 'bad-evaluate-value', detail: String(payload.data.value).slice(0, 300) }, 1);
  }

  const res = {
    ok: true,
    ...parsed,
    containers: (parsed.containers || []).slice(0, limit),
    types: (parsed.types || []).slice(0, limit),
  };
  if (!wantText) { res.texts = []; res.textNote = 'omit --text 未输出任何页面文本'; }

  if (wantText) {
    process.stderr.write('⚠️  本次输出含页面标签文本，视为个人数据：禁止进 git / tests/fixtures / docs\n');
  }
  res.hint = '本文件只给证据，不给推荐。注册项请人工据 containers/types 整理，并补 verified 日期。';
  out(res, 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
