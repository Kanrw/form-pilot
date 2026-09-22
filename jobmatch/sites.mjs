// form-pilot · jobmatch 站点注册表
//
// 通道是 network，不是 DOM：招聘站列表页的卡片里通常只有职责、没有任职要求
// （实测：记忆科技飞书站的 .positionItem 里 requirement 完全缺失），
// 而硬门槛（学历 / 专业 / 年限）恰恰写在 requirement 里。
// 走页面自己发出的 JSON，等于拿站点自己的数据，不需要逆向它的签名。
//
// 没有匹配站点时走 sniffJobs()：从捕获到的 JSON 里找一个"像岗位列表"的数组。
// 找不到就报错，不静默返回空 —— 静默的空列表会被当成"没有岗位"。

import { makeJob } from './schema.mjs';

const TEXT_KEYS = ['description', 'requirement', 'jd', 'jobDesc', 'job_desc', 'content', 'detail'];
const TITLE_KEYS = ['title', 'jobTitle', 'job_title', 'name', 'positionName', 'postName'];
const CITY_KEYS = ['city', 'cityName', 'city_name', 'location', 'workPlace', 'workplace'];

function firstText(o, keys) {
  for (const k of keys) {
    const v = o && o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// 有些站点把城市放在数组里（飞书：city_list[0].name），有的放扁平字段。
function pickCity(o) {
  const list = o && (o.city_list || o.cityList || o.locations);
  if (Array.isArray(list) && list.length) {
    const c = list[0];
    const name = typeof c === 'string' ? c : firstText(c, ['name', 'city', 'cityName']);
    if (name) return name;
  }
  if (o && o.city_info) {
    const name = firstText(o.city_info, ['name', 'city']);
    if (name) return name;
  }
  return firstText(o, CITY_KEYS);
}

export const SITES = {
  // 飞书招聘门户（jobs.feishu.cn / *.jobs.feishu.cn）
  // verified：2026-09-22，记忆科技（深圳）有限公司校招门户，实测 75 个岗位一次取全。
  feishu: {
    id: 'feishu',
    verified: '2026-09-22',
    source: 'https://varp4lp3dbc.jobs.feishu.cn/708509/',
    // 页面自己发的请求；带 _signature，直连会被网关丢到 fallback 页。
    apiPattern: /\/api\/v\d+\/search\/job\/posts/,
    hostPattern: /jobs\.feishu\.cn$/,
    // 列表接口一次能取全：把 URL 的 limit 提到 >= 总数即可（实测 limit=100 → 75 条）。
    pageSizeParam: 'limit',
    parse(body) {
      const list = body && body.data && body.data.job_post_list;
      if (!Array.isArray(list)) return [];
      return list.map((j) =>
        makeJob({
          id: String(j.id || ''),
          title: firstText(j, TITLE_KEYS),
          city: pickCity(j),
          category: (j.job_category && j.job_category.name) || '',
          type: [j.recruit_type && j.recruit_type.parent && j.recruit_type.parent.name, j.recruit_type && j.recruit_type.name]
            .filter(Boolean)
            .join(' '),
          // 列表接口不给详情页 URL，也不猜它的拼法（实测 /position/<id>/ 是 404 页）。
          url: '',
          jd: [j.description, j.requirement].filter(Boolean).join('\n'),
          source: 'feishu',
        })
      );
    },
  },
};

export function detectSite(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const s of Object.values(SITES)) {
    if (s.hostPattern && s.hostPattern.test(host)) return s;
  }
  return null;
}

// ── 通用嗅探（无匹配站点时的兜底） ──────────────────────────
// 判据刻意收紧：数组 ≥3 项，每项同时有"标题型"字段和"正文型"字段。
// 宁可找不到，也不要把配置数组当成岗位列表。
export function sniffJobs(body) {
  if (!body || typeof body !== 'object') return [];
  const seen = new Set();
  const queue = [body];
  let depth = 0;
  while (queue.length && depth < 6) {
    const node = queue.shift();
    depth += 1;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      if (node.length >= 3 && node.every((x) => x && typeof x === 'object')) {
        const titleKey = TITLE_KEYS.find((k) => node.some((x) => typeof x[k] === 'string' && x[k].trim()));
        const textKey = TEXT_KEYS.find((k) => node.some((x) => typeof x[k] === 'string' && x[k].trim()));
        if (titleKey && textKey) {
          return node.map((x, i) =>
            makeJob({
              id: String(x.id || x.jobId || x.job_id || i),
              title: firstText(x, TITLE_KEYS),
              city: pickCity(x),
              category: '',
              type: '',
              url: '',
              jd: TEXT_KEYS.map((k) => (typeof x[k] === 'string' ? x[k] : '')).filter(Boolean).join('\n'),
              source: 'sniff',
            })
          );
        }
      }
      continue;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object' && !seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return [];
}
