#!/usr/bin/env node
// 把引擎注入当前页面。
//
// engine/engine.js + engine/adapters.js 拼成一个字符串，末尾追加适配器选择，
// 一次 evaluate 完成"引擎 + 注册表 + 选定适配器"。
//
// 用法：node scripts/inject.mjs --session <名> [--adapter moka|beisen|generic|auto]
// 输出：{ok, engine:"loaded"|"already loaded", adapter, version}
// 退出码：ok ? 0 : 1
//
// 注意 engine:"already loaded" = 页面里已有旧引擎，改动不会生效。改完源码请刷新页面再注入。

import { readFileSync } from 'node:fs';
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
const adapter = flag('--adapter', 'auto');
// ★ 名单必须与 engine/adapters.js 的注册项**逐一相等**：漏一个，那个站点就只能靠 auto 碰运气，
//   显式指定时还会报 unknown --adapter（feishu 就漏过一次）。
//
// 这里**不再靠注释提醒**（注释挡不住第二次漏），改成由 tests/inject.test.mjs 断言
// 「KNOWN_ADAPTERS 去掉 auto」与 adapters.js 的注册键集合**双向相等** ——
// 多一个、少一个都会红。所以本数组被导出，测试直接 import。
export const KNOWN_ADAPTERS = ['auto', 'moka', 'beisen', 'feishu', 'generic'];
const known = KNOWN_ADAPTERS;

function out(obj, code) {
  console.log(JSON.stringify(obj));
  process.exit(code);
}

// 下面这段只在**直接执行本文件**时跑；被 import 时（tests/inject.test.mjs 只为拿
// KNOWN_ADAPTERS）不得有任何副作用 —— 否则 `out()` 里的 process.exit 会把测试进程带走。
async function main() {
if (!session) out({ ok: false, err: 'missing --session' }, 1);
if (!known.includes(adapter)) out({ ok: false, err: 'unknown --adapter', adapter, known }, 1);

let engine, adapters;
try {
  engine = readFileSync(join(ROOT, 'engine/engine.js'), 'utf8');
  adapters = readFileSync(join(ROOT, 'engine/adapters.js'), 'utf8');
} catch (e) {
  out({ ok: false, err: 'read-source-failed', detail: String(e.message).slice(0, 200) }, 1);
}

// 整体包一层 IIFE：evaluate 与页面共享 JS realm，裸 const 在第二次调用会 SyntaxError。
// engine 的 IIFE 返回值被捕获，用于区分 loaded / already loaded。
const pick = adapter === 'auto' ? '__ja.detect()' : JSON.stringify(adapter);
const code = `(() => {
const __jaBoot = ${engine};
${adapters}
const __jaName = __ja.use(__jaAdapters[${pick}] || __jaAdapters.generic);
return JSON.stringify({
  engine: __jaBoot === 'already loaded' ? 'already loaded' : 'loaded',
  adapter: __jaName,
  version: __ja.version,
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

const value = payload.data && payload.data.value;
let parsed;
try {
  parsed = typeof value === 'string' ? JSON.parse(value) : value;
} catch {
  out({ ok: false, err: 'bad-evaluate-value', detail: String(value).slice(0, 300) }, 1);
}

out({ ok: true, ...parsed }, 0);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) main();
