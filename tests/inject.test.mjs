// inject.mjs 的 `--adapter` 名单与 adapters.js 注册项的**一致性**断言。
//
// 为什么需要这条测试：这份名单原先靠一条注释维护（"名单必须与 adapters.js 对齐"），
// 而注释挡不住第二次漏 —— 事实上它已经漏过一次：feishu 进了 adapters.js 却没进名单，
// 表现是显式 `--adapter feishu` 报 unknown --adapter，只能靠 auto 碰运气。
// 断言改成双向相等：名单里多一个（注册表没有）也会红，不只是少一个。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KNOWN_ADAPTERS } from '../scripts/inject.mjs';

// adapters.js 是浏览器脚本（`window.__jaAdapters = window.__jaAdapters || {...}`），
// 给个 window 桩就能在 Node 里取到注册键。
function adapterKeys() {
  const src = readFileSync(new URL('../engine/adapters.js', import.meta.url), 'utf8');
  const win = {};
  new Function('window', src)(win);
  assert.ok(win.__jaAdapters, 'adapters.js 应当挂载 window.__jaAdapters');
  return Object.keys(win.__jaAdapters);
}

test('KNOWN_ADAPTERS 去掉 auto 后与 adapters.js 注册键双向相等', () => {
  const declared = KNOWN_ADAPTERS.filter((x) => x !== 'auto').slice().sort();
  const registered = adapterKeys().sort();
  const missing = registered.filter((k) => !declared.includes(k));   // 注册了但 CLI 不认
  const extra = declared.filter((k) => !KNOWN_ADAPTERS.includes(k) || !registered.includes(k)); // CLI 认但没注册
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `名单与注册表不一致：注册了但 CLI 不认 = ${JSON.stringify(missing)}；CLI 认但未注册 = ${JSON.stringify(extra)}`,
  );
});

test('KNOWN_ADAPTERS 保留 auto 哨兵在首位（CLI 用它表示"按站点自动识别"）', () => {
  assert.equal(KNOWN_ADAPTERS[0], 'auto');
});

test('import 本模块不产生副作用（守卫脚本必须可被测试 import）', () => {
  // 拿得到导出即为证：若顶层还留着 process.exit 的执行体，这条测试根本跑不到这里。
  assert.ok(Array.isArray(KNOWN_ADAPTERS) && KNOWN_ADAPTERS.length > 1);
});
