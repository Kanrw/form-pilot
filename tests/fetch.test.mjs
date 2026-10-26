// jobmatch 抓取层的收尾纪律（node:test）。
//
// 只起一个假桥服务器，断言「动作序列」而不是抓取结果 —— 这里要证明的是
// 失败路径上 `network stop` 仍然发出，否则录制会留在后台，下一次 list 混进上一页的请求。
//
// 两条环境约束：
//   1. BRIDGE_URL 必须在 import fetch.mjs **之前**设 —— 模块顶层就把它读成常量了；
//   2. 所以整份文件共用一个假桥（换端口没用：模块只会加载一次），用 handler 切换行为。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { SITES } from '../jobmatch/sites.mjs';

let handler = () => ({ ok: true, data: {} });
let actions = [];

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      payload = {};
    }
    actions.push(payload.args && payload.args.cmd ? `network:${payload.args.cmd}` : String(payload.action));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(handler(payload)));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.BRIDGE_URL = `http://127.0.0.1:${server.address().port}/command`;
const mod = await import('../jobmatch/fetch.mjs');

test.after(() => server.close());

function use(fn) {
  handler = fn;
  actions = [];
}

test('fetchJobs：navigate 失败时仍发 network stop（抓包不能留在后台）', async () => {
  use((p) => (p.action === 'navigate' ? { ok: false, error: { message: 'nav failed' } } : { ok: true, data: {} }));
  await assert.rejects(mod.fetchJobs({ url: 'https://example.test/list', session: 's', waitMs: 1 }), /navigate/);
  assert.ok(actions.includes('network:start'), '开始录制');
  assert.ok(actions.includes('network:stop'), `失败路径没有收尾，动作序列：${actions.join(' → ')}`);
});

test('fetchJobs：站点 parse 抛错时也发 stop，错误照常上抛', async () => {
  SITES.bad = {
    id: 'bad',
    apiPattern: /\/api\/jobs/,
    hostPattern: /example\.test$/,
    parse() {
      throw new Error('站点改版了');
    },
  };
  use((p) => {
    if (p.action === 'navigate') return { ok: true, data: {} };
    if (p.args && p.args.cmd === 'list') {
      return { ok: true, data: { requests: [{ requestId: 'r1', status: 200, url: 'https://example.test/api/jobs' }] } };
    }
    if (p.args && p.args.cmd === 'detail') return { ok: true, data: { body: { anything: 1 } } };
    return { ok: true, data: {} };
  });
  try {
    await assert.rejects(mod.fetchJobs({ url: 'https://example.test/list', session: 's', waitMs: 1 }), /站点改版了/);
    assert.ok(actions.includes('network:stop'), `parse 抛错后没收尾：${actions.join(' → ')}`);
  } finally {
    delete SITES.bad;
  }
});

test('bumpLimit：把 limit 提到目标数、current 归 1，非法 URL 原样返回', () => {
  const u = new URL(mod.bumpLimit('https://example.test/list?limit=20&current=3', 200));
  assert.equal(u.searchParams.get('limit'), '200');
  assert.equal(u.searchParams.get('current'), '1');
  assert.equal(new URL(mod.bumpLimit('https://example.test/list', 200)).searchParams.get('limit'), '200');
  assert.equal(mod.bumpLimit('not a url', 200), 'not a url');
});
