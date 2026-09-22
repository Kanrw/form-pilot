#!/usr/bin/env node
// 抓当前页面最大 form（退化为 body）的 outerHTML，落到 tests/fixtures/raw/。
//
// 用途：为 jsdom 回归测试提供真实 DOM 来源；也用于站点改版后比对结构差异。
//
// 用法：node scripts/capture-fixture.mjs --session <名> --site <站点名>
// 输出：{ok, path, bytes, fields}
// 退出码：ok ? 0 : 1
//
// ⚠️ raw/ 已在 .gitignore。抓到的东西**默认当作含个人数据**：
//    入库前必须人工脱敏，再另存为 tests/fixtures/<site>.html。
//    先跑 `node scripts/status.mjs` 确认桥可用；session 无 tab 时先 navigate。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:10086/command';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const session = flag('--session', null);
const site = flag('--site', null);

function out(obj, code) {
  console.log(JSON.stringify(obj));
  process.exit(code);
}

if (!session) out({ ok: false, err: 'missing --session' }, 1);
if (!site) out({ ok: false, err: 'missing --site' }, 1);
if (!/^[A-Za-z0-9_-]+$/.test(site)) out({ ok: false, err: 'bad --site (只许字母数字下划线短横)', site }, 1);

// 只抓结构，不抓脚本；顺带把 input 的当前值清空，
// 免得"抓的时候表单恰好有预填值"变成一次无意的数据外带。
//
// 根节点选择：只有在某个 <form> 覆盖了页面 ≥90% 的控件时才用它，
// 否则用 body。实测 Moka 的申请页根本没有 <form>，字段全在 div 里，
// 页面上唯一那个 form 只有 1 个输入框（搜索框）——按"表单优先"会抓到空壳。
const code = `(() => {
  const total = document.querySelectorAll('input,textarea').length;
  const forms = [...document.querySelectorAll('form')]
    .map((f) => ({ f, n: f.querySelectorAll('input,textarea').length }))
    .sort((a, b) => b.n - a.n);
  const best = forms[0];
  const root = best && best.n > 0 && best.n >= total * 0.9 ? best.f : document.body;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,noscript,link[rel=preload]').forEach((e) => e.remove());
  clone.querySelectorAll('input').forEach((e) => {
    e.removeAttribute('value');
    if (e.type === 'password') e.removeAttribute('name');
  });
  clone.querySelectorAll('textarea').forEach((e) => { e.textContent = ''; });
  return JSON.stringify({
    html: clone.outerHTML,
    fields: root.querySelectorAll('input,textarea').length,
    pageFields: total,
    rootTag: root.tagName,
    url: location.origin + location.pathname
  });
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
  out({ ok: false, err: 'bridge-unreachable', bridge: BRIDGE, detail: String(e.message).slice(0, 200), hint: '先跑 node scripts/status.mjs' }, 1);
}

if (!payload || payload.ok !== true) {
  const detail = payload && payload.error ? payload.error.message : JSON.stringify(payload).slice(0, 300);
  out({ ok: false, err: 'evaluate-failed', detail }, 1);
}

let parsed;
try {
  parsed = JSON.parse(payload.data.value);
} catch {
  out({ ok: false, err: 'bad-evaluate-value', detail: String(payload.data.value).slice(0, 200) }, 1);
}

const dir = join(ROOT, 'tests/fixtures/raw');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const file = join(dir, `${site}-${stamp}.html`);
writeFileSync(file, `<!-- captured from ${parsed.url} at ${new Date().toISOString()} -->\n${parsed.html}\n`);

process.stderr.write(`⚠️  ${file}\n    默认视为含个人数据。入库前人工脱敏，另存为 tests/fixtures/${site}.html\n    根节点 <${parsed.rootTag}>，抓到 ${parsed.fields}/${parsed.pageFields} 个控件\n`);
out({ ok: true, path: file.replace(ROOT + '/', ''), bytes: parsed.html.length, fields: parsed.fields, pageFields: parsed.pageFields, rootTag: parsed.rootTag }, 0);
