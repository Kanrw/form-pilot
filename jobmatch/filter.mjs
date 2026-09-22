// form-pilot · jobmatch 确定性筛选核心
//
// 这一层全是纯函数：输入档案 values + 岗位列表，输出门槛结论与命中证据。
// LLM 不在这一层 —— 它负责的是后面那步"每项要求到底是已匹配还是表达缺口"。
//
// 设计约束（来自 asu-skill 的 job-match，本项目照搬）：
//   1. 硬门槛单独判定，不被其他优势加权抵消；
//   2. 未给够信息一律 unknown，unknown 不淘汰也不放行；
//   3. 不产出百分比分数，只产出命中数与缺口。

import {
  GATE,
  VERDICT,
  PROFILE_DEGREE_LEVEL,
  normalizeText,
  splitTerms,
  detectDegree,
  detectYears,
  detectMajorClause,
  detectWorkplace,
  isCampusJob,
} from './schema.mjs';

const arr = (v) => (Array.isArray(v) ? v : []);

// 通用词：档案和 JD 里都会出现，命中它们等于没命中。
// 不过滤会退化成"凡是写了'开发'的岗位都算匹配"，筛选就失效了。
const STOP = new Set([
  '开发', '经验', '能力', '相关', '以上', '优先', '熟悉', '掌握', '良好', '团队', '沟通',
  '负责', '工作', '学习', '专业', '学历', '具有', '具备', '进行', '参与', '协助', '完成',
  '使用', '熟练', '本科', '硕士', '博士', '以及', '其他', '要求', '岗位', '职责', '任职',
  '公司', '部门', '能够', '独立', '较强', '优先', '加分', '不限', '应届', '毕业',
  // skills 段的「类别」列常写成"编程 / 工具"这种分类名。它们是分类不是技能，
  // 进词典会命中任何写了"工具"二字的 JD（实测：38 个岗位里大半靠这两个词命中）。
  '工具', '编程', '技能', '语言', '证书', '其他', '框架', '软件', '硬件',
]);

// 上限放宽到 24：档案里的术语常常就是一段短语（"高通量计算流程开发"）。
// 太长的整句不会在 JD 里出现，自然不命中，不会造出假阳性。
const MAX_TERM = 24;

// ── 档案 → 事实 ────────────────────────────────────────────
// 只取档案里明确写下的东西；留空就是留空，不推断。
export function factsFromProfile(values) {
  const v = values || {};
  const edu = arr(v.education);
  const degreeLevel = edu.reduce((max, e) => {
    const lv = PROFILE_DEGREE_LEVEL[e && e.degree] || 0;
    return lv > max ? lv : max;
  }, 0);
  const intent = v.intent || {};
  return {
    degreeLevel,
    degrees: edu.map((e) => e.degree).filter(Boolean),
    majors: edu.map((e) => e.major).filter(Boolean),
    research: edu.map((e) => e.researchDirection).filter(Boolean),
    cities: splitTerms(intent.targetCities),
    targetRole: String(intent.targetRole || ''),
    directions: String(intent.targetDirections || ''),
    industries: String(intent.targetIndustries || ''),
    graduateStatus: String(intent.graduateStatus || ''),
    hasWorkExperience: arr(v.experience).length > 0,
    // 词典只用 content：category 是分类名（"编程 / 工具"），不是技能。
    skillContents: arr(v.skills).map((s) => s.content).filter(Boolean),
    skillTexts: arr(v.skills).flatMap((s) => [s.category, s.content]).filter(Boolean),
    projectNames: arr(v.projects).map((p) => p.name).filter(Boolean),
  };
}

// ── 档案 → 词典 ────────────────────────────────────────────
// 词典来自档案自己写下的词，外加可选的 private/keywords.json。
// 不内置"行业通用技能表" —— 那是在替用户声称他会什么。
export function termsFromProfile(values, extra = []) {
  const f = factsFromProfile(values);
  const raw = [
    ...f.skillContents.flatMap(splitTerms),
    ...f.research.flatMap(splitTerms),
    ...f.majors.flatMap(splitTerms),
    ...f.projectNames,
    ...splitTerms(f.targetRole),
    ...splitTerms(f.directions),
    ...splitTerms(f.industries),
    ...extra,
  ];
  const out = [];
  const seen = new Set();
  for (const term of raw) {
    const t = String(term || '').trim();
    if (t.length < 2 || t.length > MAX_TERM) continue;
    if (STOP.has(t)) continue;
    const k = normalizeText(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ── 命中 ──────────────────────────────────────────────────
// 返回命中项 + 它在 JD 里的原句。没有原句就没有证据，等于没命中。
function jdLines(jd) {
  return String(jd || '')
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function matchTerms(job, terms) {
  const lines = jdLines(job.jd);
  const hayTitle = normalizeText(`${job.title} ${job.category}`);
  const hits = [];
  for (const term of terms) {
    const k = normalizeText(term);
    if (!k) continue;
    const inTitle = hayTitle.includes(k);
    const line = lines.find((l) => normalizeText(l).includes(k));
    if (inTitle || line) {
      hits.push({ term, where: inTitle ? '标题/类别' : 'JD 正文', evidence: inTitle ? job.title : line });
    }
  }
  return hits;
}

// ── 硬门槛 ────────────────────────────────────────────────
function gateCity(job, facts) {
  const city = String(job.city || '').trim();
  if (!city) return { result: GATE.UNKNOWN, note: '岗位未给城市' };
  if (!facts.cities.length) return { result: GATE.UNKNOWN, note: '档案未写意向城市，不替你猜' };
  const k = normalizeText(city);
  const hit = facts.cities.find((c) => normalizeText(c).includes(k) || k.includes(normalizeText(c)));
  return hit
    ? { result: GATE.PASS, note: `${city} ∈ 意向城市` }
    : { result: GATE.FAIL, note: `${city} 不在意向城市（${facts.cities.join('、')}）` };
}

function gateDegree(job, facts) {
  const need = detectDegree(`${job.title} ${job.jd}`);
  if (!need) return { result: GATE.UNKNOWN, note: 'JD 未写学历要求' };
  if (!facts.degreeLevel) return { result: GATE.UNKNOWN, note: '档案未写学历' };
  return facts.degreeLevel >= need.level
    ? { result: GATE.PASS, note: `要求${need.key}，档案学历达标` }
    : { result: GATE.FAIL, note: `要求${need.key}，档案学历未达标` };
}

function gateExperience(job, facts) {
  const years = detectYears(job.jd);
  if (years === null) return { result: GATE.UNKNOWN, note: 'JD 未写年限要求' };
  if (isCampusJob(`${job.title} ${job.jd}`)) return { result: GATE.PASS, note: '校招/实习岗，年限要求不适用' };
  if (!facts.hasWorkExperience && facts.graduateStatus !== '往届') {
    return { result: GATE.FAIL, note: `要求 ${years} 年经验，档案无工作经历` };
  }
  return { result: GATE.PASS, note: `要求 ${years} 年经验` };
}

function gateMajor(job, facts) {
  const clause = detectMajorClause(job.jd);
  if (!clause) return { result: GATE.UNKNOWN, note: 'JD 未写专业要求' };
  const pool = normalizeText([...facts.majors, ...facts.research, ...facts.skillTexts].join(' '));
  for (const cand of clause.terms) {
    const k = normalizeText(cand);
    if (k.length < 2) continue;
    if (pool.includes(k)) return { result: GATE.PASS, note: `专业要求命中「${cand}」` };
  }
  return { result: GATE.FAIL, note: `专业要求「${clause.terms.join('、')}」与档案专业/方向无交集` };
}

const GATES = [
  { key: 'city', label: '地点', run: gateCity },
  { key: 'degree', label: '学历', run: gateDegree },
  { key: 'experience', label: '年限', run: gateExperience },
  { key: 'major', label: '专业/方向', run: gateMajor },
];

// ── 结论 ──────────────────────────────────────────────────
const VERDICT_RANK = { [VERDICT.APPLY]: 0, [VERDICT.SUPPLEMENT]: 1, [VERDICT.CAREFUL]: 2, [VERDICT.SKIP]: 3 };

export function decide(gates, hits) {
  const failed = gates.filter((g) => g.result === GATE.FAIL);
  if (failed.length) return VERDICT.SKIP;
  const unknown = gates.filter((g) => g.result === GATE.UNKNOWN).length;
  if (hits.length >= 2 && unknown === 0) return VERDICT.APPLY;
  if (hits.length >= 1) return VERDICT.SUPPLEMENT;
  return VERDICT.CAREFUL;
}

export function screenJob(job, facts, terms) {
  const gates = GATES.map((g) => ({ key: g.key, label: g.label, ...g.run(job, facts) }));
  const hits = matchTerms(job, terms);
  const verdict = decide(gates, hits);
  return {
    id: job.id,
    title: job.title,
    city: job.city,
    category: job.category,
    source: job.source,
    url: job.url,
    gates,
    hits,
    missed: gates.filter((g) => g.result !== GATE.PASS).map((g) => g.label),
    verdict,
  };
}

export function screenAll(jobs, values, { extraTerms = [] } = {}) {
  const facts = factsFromProfile(values);
  const terms = termsFromProfile(values, extraTerms);
  const rows = jobs.map((j) => screenJob(j, facts, terms));
  rows.sort((a, b) => {
    const d = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (d !== 0) return d;
    return b.hits.length - a.hits.length;
  });
  return { facts, terms, rows };
}
