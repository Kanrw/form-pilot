// form-pilot · jobmatch 抓取层
//
// 借页面自己的网络请求取岗位 JSON：开捕获 → 导航 → 等列表请求出现 → 取响应体。
// 不直连站点 API：飞书门户的请求带 _signature，缺了会被网关丢到 fallback 页
// （实测：直连返回"字节跳动猎头平台"的 HTML，状态码还 200）。
//
// 桥接状态是当场读数，调用前由 CLI 侧 status；这里只负责动作编排。

import { detectSite, sniffJobs, SITES } from './sites.mjs';
import { validateJobs } from './schema.mjs';

export const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:10086/command';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bridge(action, args = {}, session) {
  let r;
  try {
    r = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
    });
  } catch (e) {
    throw new Error(`桥接不可达：${String(e.message).slice(0, 120)}（先跑 node scripts/status.mjs）`);
  }
  const p = await r.json();
  if (!p || p.ok !== true) {
    const msg = p && p.error ? p.error.message : JSON.stringify(p).slice(0, 200);
    throw new Error(`${action} 失败：${msg}`);
  }
  return p.data;
}

// 列表页 URL 的 limit 提到 >= 总数：站点支持时一次拿全，省掉翻页。
export function bumpLimit(url, limit) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('limit')) u.searchParams.set('limit', String(limit));
    else u.searchParams.append('limit', String(limit));
    if (u.searchParams.has('current')) u.searchParams.set('current', '1');
    return u.toString();
  } catch {
    return url;
  }
}

export async function fetchJobs({ url, session, limit = 200, waitMs = 12000 }) {
  if (!session) throw new Error('缺少 --session：每个 session 第一步必须 navigate');
  const site = detectSite(url);
  const target = bumpLimit(url, limit);

  await bridge('network', { cmd: 'start' }, session);
  await bridge('navigate', { url: target }, session);

  const deadline = Date.now() + waitMs;
  let wanted = [];
  let all = [];
  while (Date.now() < deadline) {
    await sleep(1200);
    const list = await bridge('network', { cmd: 'list' }, session);
    all = list.requests || [];
    wanted = all.filter(
      (r) => r.status === 200 && (site ? site.apiPattern.test(r.url) : String(r.mimeType || '').includes('json'))
    );
    if (wanted.length) break;
  }

  const jobs = [];
  const errors = [];
  for (const req of wanted) {
    let detail;
    try {
      detail = await bridge('network', { cmd: 'detail', requestId: req.requestId }, session);
    } catch (e) {
      errors.push(`detail 失败 ${req.requestId}：${e.message}`);
      continue;
    }
    const body = detail && detail.body;
    if (!body) continue;
    const parsed = site ? site.parse(body) : sniffJobs(body);
    if (parsed.length) jobs.push(...parsed);
  }

  await bridge('network', { cmd: 'stop' }, session);

  // id 重复时用 #n 消歧：id 是后续回查岗位的 key，重名会串岗。
  const seen = new Map();
  for (const j of jobs) {
    const key = j.id || j.title;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n > 0) j.id = `${key}#${n + 1}`;
  }

  const check = validateJobs(jobs);
  return {
    site: site ? site.id : 'sniff',
    url: target,
    count: jobs.length,
    jobs,
    errors,
    validation: check,
    captured: all.length,
  };
}

export function siteList() {
  return Object.values(SITES).map((s) => ({ id: s.id, verified: s.verified, source: s.source }));
}
