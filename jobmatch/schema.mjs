// form-pilot · jobmatch 数据结构与枚举
//
// 只放"确定性"的东西：枚举、文本归一化、JD 里门槛线索的抽取。
// 不含任何评分公式 —— job-match 明令禁止伪精确的百分比匹配分，
// 本模组同样不产出总分，只产出门槛结论 + 命中证据 + 缺口。
//
// 与 profile.schema.mjs 的关系：那里管"档案字段怎么定义"，这里管"岗位与结论怎么定义"。
// 两者通过 values（profile.json 的形状）衔接，jobmatch 不读 private/，只接受传进来的值。

export const JOB_SCHEMA_VERSION = 1;

// 硬门槛结论。unknown ≠ 通过：它是" JD 或档案没给够信息"，不参与淘汰。
export const GATE = { PASS: 'pass', FAIL: 'fail', UNKNOWN: 'unknown' };
export const GATE_ORDER = [GATE.FAIL, GATE.UNKNOWN, GATE.PASS];

// 匹配状态（job-match 的五态，一个不多）。代码只校验它，不做判定 —— 判定在对话侧。
export const STATUS = ['已匹配', '表达缺口', '证据不足', '真实缺口', '待确认'];

// 投递建议四档。
export const VERDICT = {
  APPLY: '建议投递',
  SUPPLEMENT: '补充材料后投递',
  CAREFUL: '谨慎投递',
  SKIP: '暂不建议投递',
};

// ── 文本归一化 ────────────────────────────────────────────
// 全角→半角、小写、压掉空白与常见分隔。用于"包含匹配"，不做分词。
const FULLWIDTH = /[！-～]/g;

export function normalizeText(s) {
  let t = String(s === null || s === undefined ? '' : s);
  t = t.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  t = t.toLowerCase();
  t = t.replace(/[\s\u3000]+/g, '');
  t = t.replace(/[（）()【】\[\]""''《》<>]/g, '');
  t = t.replace(/[、,，。.;；:：/·\-—_+|]/g, '');
  return t;
}

// 把一段长文本切成候选词。两件事，都是忠实于原文，不做中文分词（分词会造出档案里没有的词）：
//   1. 括号内外分别成词 —— "<示例研究方向>（半导体缺陷与掺杂…）" 里，括号是作者自己加的补充，
//      整串当一个词时 JD 里永远匹配不到（实测：不拆的话词典只剩 2 个词）。
//   2. 再按顿号/逗号/斜杠切。
const SPLIT_RE = /[、,，;；/|·\n\r]+|\s{2,}/;
const MIN_TERM = 2;

export function splitTerms(s) {
  const t = String(s || '');
  // 括号内的内容提到外面，括号本身丢弃。
  const unbracketed = t.replace(/[（(]([^）)]*)[）)]/g, '、$1、');
  return unbracketed
    .split(SPLIT_RE)
    .map((x) => x.replace(/[（(）)【】\[\]]/g, '').trim())
    .filter((x) => x.length >= MIN_TERM);
}

// ── JD 门槛线索抽取 ────────────────────────────────────────
// 每条正则都对应一类真实写在 JD 里的表述；抽不到就返回 null（→ unknown），不猜。

// 学历：取 JD 里出现过的最高一个。博士 > 硕士/研究生 > 本科 > 大专/专科。
export const DEGREE_LEVEL = { 大专: 1, 专科: 1, 本科: 2, 研究生: 3, 硕士: 3, 博士: 4 };
const DEGREE_RE = /(博士|硕士研究生|硕士|研究生|本科|大学本科|大专|专科)/g;
// 档案侧的学历取值（schema options）：本科 / 硕士研究生 / 博士研究生
export const PROFILE_DEGREE_LEVEL = { 大专: 1, 专科: 1, 本科: 2, 硕士研究生: 3, 博士研究生: 4 };

export function detectDegree(text) {
  const hits = String(text || '').match(DEGREE_RE);
  if (!hits) return null;
  let best = null;
  for (const h of hits) {
    const key = h.replace('大学本科', '本科').replace('硕士研究生', '硕士');
    const lv = DEGREE_LEVEL[key] || 0;
    if (!best || lv > best.level) best = { key, level: lv };
  }
  return best ? { key: best.key, level: best.level } : null;
}

// 工作年限："3年以上相关经验" / "具备 2 年工作经验"。
const YEARS_RE = /(\d+)\s*年(?:以上)?(?:[^。；;\n]{0,12}?(?:工作|相关|行业|从业|研发|项目))?经验/;

export function detectYears(text) {
  const m = String(text || '').match(YEARS_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// 校招信号：JD 明确写应届 / 在校 / 实习 / 校招时，"N 年经验"不适用。
const CAMPUS_RE = /应届|在校生|实习生|校招|校园招聘|毕业年生/;

export function isCampusJob(text) {
  return CAMPUS_RE.test(String(text || ''));
}

// 专业要求。真实 JD 两种写法，都得认：
//   a) 前置标签："专业要求：微电子、集成电路等相关专业优先"
//   b) 后置收尾："微电子、集成电路等相关专业优先"
// 反例（实测踩过）：只写"专业"二字会命中"应用专业方法或工具"这种句子，
// 于是 HRBP 岗被判成"专业要求＝协助上司为业务团队提供解决方案"。
// 所以前置式必须带显式标签或冒号。
const MAJOR_LABEL_RE =
  /(?:专业要求|所学专业|专业背景|专业方向|学科要求|专业)[：:]\s*([^。；;\n]{2,60})|(?:专业要求|所学专业|专业背景|专业方向)[：:是为]?\s*([^。；;\n]{2,60})/;
const MAJOR_SUFFIX_RE = /([^。；;\n]{2,60}?)相关专业/;
// 混进来的学历/届别表述不是专业，比对时要剔掉。
const MAJOR_NOISE = /学历|届|优先|以上|毕业|本科|硕士|博士|获得|具有|具备|以上/;

export function detectMajorClause(text) {
  const t = String(text || '');
  for (const re of [MAJOR_LABEL_RE, MAJOR_SUFFIX_RE]) {
    const m = t.match(re);
    if (!m) continue;
    const raw = String(m[1] || m[2] || '').trim();
    const terms = splitTerms(raw).filter((x) => !MAJOR_NOISE.test(x));
    if (terms.length) return { text: raw, terms };
  }
  return null;
}

// 工作地点：结构化字段优先（站点给的 city），正文兜底。
const WORKPLACE_RE = /(?:工作地点|工作地|base|Base|办公地点)[^。；;\n]{0,4}[：:是为]?\s*([一-龥A-Za-z]{2,12})/;

export function detectWorkplace(text) {
  const m = String(text || '').match(WORKPLACE_RE);
  return m ? m[1].trim() : null;
}

// ── 岗位与结论 ────────────────────────────────────────────

// 站点抽取脚本产出这个形状；--screen 消费它。
export function makeJob(o = {}) {
  return {
    id: String(o.id || ''),
    title: String(o.title || ''),
    city: String(o.city || ''),
    category: String(o.category || ''),
    type: String(o.type || ''),
    url: String(o.url || ''),
    jd: String(o.jd || ''),
    source: String(o.source || ''),
    fetchedAt: o.fetchedAt || new Date().toISOString(),
  };
}

// 抓取产物的校验。id 必须单射 —— 它是后续交接回引擎定位岗位的 key，重名即静默串岗。
export function validateJobs(list) {
  const errors = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['不是数组'] };
  const ids = new Set();
  list.forEach((j, i) => {
    if (!j || typeof j !== 'object') { errors.push(`[${i}] 不是对象`); return; }
    if (!j.title) errors.push(`[${i}] 缺 title`);
    if (!j.jd) errors.push(`[${i}] 缺 jd：${j.title || '(无标题)'}`);
    if (j.id) {
      if (ids.has(j.id)) errors.push(`[${i}] id 重复：${j.id}`);
      ids.add(j.id);
    }
  });
  return { ok: errors.length === 0, errors };
}
