#!/usr/bin/env node
// 岗位筛选（jobmatch 模组）命令行入口。
//
//   node scripts/match.mjs --fetch --url <列表页 URL> --session <名> [--root <dir>]
//       借浏览器桥接取岗位 JSON，落到 <root>/private/jobs/<站点>-<时间>.json
//
//   node scripts/match.mjs --screen [--jobs <文件>] [--root <dir>] [--version <名>] [--top N] [--json]
//       读岗位 + 读档案，出门槛结论与命中证据。默认取 private/jobs/ 里最新一份。
//
//   node scripts/match.mjs --sites
//       列出已实测站点
//
// 通用参数：--root <dir>（默认当前目录）
//
// 说明：这一层只做"确定性的筛"。每项要求是已匹配还是表达缺口，需要对照简历原文判断，
// 那一步留给对话侧（job-match 的五态矩阵），本命令不代劳。

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePaths, resolveValues, importMarkdown, assertInsidePrivate } from '../tools/profile-io.mjs';
import { screenAll, factsFromProfile } from '../jobmatch/filter.mjs';
import { fetchJobs, siteList, BRIDGE } from '../jobmatch/fetch.mjs';
import { VERDICT, GATE } from '../jobmatch/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return flags;
}

// 只设 exitCode，不调 process.exit：管道输出是异步的，exit 会把 JSON 截断
// （实测：--json 经管道读出来是 Unterminated string）。
function out(obj, code = 0) {
  console.log(JSON.stringify(obj, null, 2));
  process.exitCode = code;
}

const HELP = `用法：
  node scripts/match.mjs --fetch --url <列表页> --session <名> [--root <dir>] [--limit N]
  node scripts/match.mjs --screen [--jobs <文件>] [--root <dir>] [--version <名>] [--top N] [--json]
  node scripts/match.mjs --sites

--fetch  借浏览器桥接抓岗位 JSON → private/jobs/
--screen 按档案硬门槛筛岗位，出结论与命中证据
--sites  列出已实测站点`;

// ── 档案 ──────────────────────────────────────────────────
// 只有 profile.json 就走版本解析；只有 profile.md（用户当前的真实状态）就现场导入，不落盘。
function loadProfile(paths, versionName) {
  if (existsSync(paths.profilePath)) {
    const r = resolveValues(paths, versionName);
    return { values: r.values, from: basename(paths.profilePath), version: r.version };
  }
  if (existsSync(paths.legacyMd)) {
    const r = importMarkdown(readFileSync(paths.legacyMd, 'utf8'));
    return { values: r.values, from: basename(paths.legacyMd), version: null, note: '由 md 现场导入，未落盘', notes: r.notes || [] };
  }
  return null;
}

// ── 岗位文件 ──────────────────────────────────────────────
function jobsDir(paths) {
  return join(paths.privateDir, 'jobs');
}

function latestJobs(paths) {
  const dir = jobsDir(paths);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? join(dir, files[0].f) : null;
}

// ── 渲染 ──────────────────────────────────────────────────
function gateText(g) {
  const mark = g.result === GATE.PASS ? '过' : g.result === GATE.FAIL ? '否' : '?';
  return `${g.label}${mark}${g.result === GATE.PASS ? '' : `(${g.note})`}`;
}

function renderReport(res, meta) {
  const L = [];
  L.push(`# 岗位筛选 · ${meta.time}`);
  L.push('');
  L.push(`> 岗位来源：${meta.source}（${meta.count} 个）　档案：${meta.profile}${meta.version ? ` · 版本 ${meta.version}` : ''}`);
  L.push(`> 硬门槛逐项判定，不加权抵消；unknown = 信息不够，既不淘汰也不放行。`);
  L.push('');

  const groups = [VERDICT.APPLY, VERDICT.SUPPLEMENT, VERDICT.CAREFUL, VERDICT.SKIP];
  for (const v of groups) {
    const rows = res.rows.filter((r) => r.verdict === v);
    if (!rows.length) continue;
    L.push(`## ${v} · ${rows.length}`);
    L.push('');
    for (const r of rows) {
      L.push(`- **${r.title}**　${[r.city, r.category, r.type].filter(Boolean).join(' · ')}`);
      L.push(`  门槛：${r.gates.map(gateText).join(' | ')}`);
      if (r.hits.length) {
        L.push(`  命中：${r.hits.map((h) => `${h.term}（${h.where}）`).join('、')}`);
      } else {
        L.push('  命中：无 —— 档案里写下的词没有出现在 JD 里');
      }
    }
    L.push('');
  }
  return L.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────
const flags = parseArgs(process.argv.slice(2));
const root = flags.root ? resolve(flags.root) : ROOT;
const paths = resolvePaths(root);

if (flags.help || (!flags.fetch && !flags.screen && !flags.sites)) {
  console.log(HELP);
  process.exitCode = 0;
} else if (flags.sites) {
  out({ sites: siteList() }, 0);
} else if (flags.fetch) {
  if (!flags.url || flags.url === true) out({ ok: false, err: 'missing --url' }, 1);
  else if (!flags.session || flags.session === true) out({ ok: false, err: 'missing --session', hint: '同一任务用一个 session，第一步永远是 navigate' }, 1);
  else await runFetch();
} else if (flags.screen) {
  await runScreen();
}

async function runFetch() {
  const limit = Number(flags.limit) || 200;
  let res;
  try {
    res = await fetchJobs({ url: flags.url, session: flags.session, limit });
  } catch (e) {
    out({ ok: false, err: 'fetch-failed', detail: String(e.message).slice(0, 300), bridge: BRIDGE }, 1);
    return;
  }
  if (!res.count) {
    out({ ok: false, err: 'no-jobs', site: res.site, captured: res.captured, errors: res.errors, hint: '没抓到岗位：站点可能不在注册表且 sniff 找不到列表，或页面没发列表请求' }, 1);
    return;
  }
  const dir = jobsDir(paths);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = join(dir, `${res.site}-${stamp}.json`);
  assertInsidePrivate(file, paths);
  writeFileSync(file, JSON.stringify({ site: res.site, url: res.url, fetchedAt: new Date().toISOString(), count: res.count, jobs: res.jobs }, null, 2));
  out({
    ok: true,
    site: res.site,
    count: res.count,
    file,
    validation: res.validation,
    errors: res.errors,
  }, res.validation.ok ? 0 : 1);
}

async function runScreen() {
  const file = flags.jobs && flags.jobs !== true ? resolve(flags.jobs) : latestJobs(paths);
  if (!file || !existsSync(file)) {
    out({ ok: false, err: 'no-jobs-file', dir: jobsDir(paths), hint: '先跑 --fetch，或用 --jobs <文件> 指定' }, 1);
    return;
  }
  const bundle = JSON.parse(readFileSync(file, 'utf8'));
  const jobs = Array.isArray(bundle) ? bundle : bundle.jobs || [];

  const prof = loadProfile(paths, typeof flags.version === 'string' ? flags.version : null);
  if (!prof) {
    out({ ok: false, err: 'no-profile', dir: paths.privateDir, hint: '先跑 node scripts/profile.mjs --init 或 --import' }, 1);
    return;
  }

  const res = screenAll(jobs, prof.values);
  const top = Number(flags.top) || 0;
  if (top > 0) res.rows = res.rows.slice(0, top);

  if (flags.json) {
    out({ ok: true, file, count: res.rows.length, terms: res.terms, rows: res.rows }, 0);
    return;
  }

  const meta = {
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    source: `${bundle.site || basename(file)}（${jobs.length}）`,
    count: jobs.length,
    profile: prof.from + (prof.note ? `，${prof.note}` : ''),
    version: prof.version || '',
  };
  console.log(renderReport(res, meta));
  console.log(`\n词典（${res.terms.length}）来自档案：${res.terms.slice(0, 30).join('、')}${res.terms.length > 30 ? ' …' : ''}`);

  // 档案缺什么，直接决定门槛能判到什么程度。不说出来，用户只会看到一堆 unknown。
  const facts = factsFromProfile(prof.values);
  const why = [];
  if (!facts.cities.length) why.push('意向城市未填 → 地点门槛全 unknown');
  if (!facts.degreeLevel) why.push('学历未填 → 学历门槛全 unknown');
  if (!facts.skillContents.length) why.push('技术能力段为空 → 词典里没有 VASP / Python 这类硬技能词');
  if (!facts.majors.length) why.push('专业名称未填 → 专业门槛只能靠研究方向比对');
  if (why.length) console.log(`档案缺口：${why.join('；')}`);
  const notes = (prof.notes || []).filter((n) => /区段/.test(n));
  if (notes.length) console.log(`档案导入告警：\n  ${notes.slice(0, 6).join('\n  ')}`);
}
