// 档案的读写与转换 —— 纯逻辑，不碰网络、不碰 DOM。
//
// 三条硬规则（均有命名失败，见 docs/plans/06-profile-ui.md §三）：
//   1. 任何写入路径必须落在 <root>/private/ 内，否则抛错。
//      命名失败：把含个人数据的文件写到仓库里，等于泄露。
//   2. 覆盖已有文件前先备份。
//      命名失败：首次保存覆盖掉手工填过的内容，无从找回。
//   3. stdout 不回显字段值，只回标签与计数。
//      命名失败：值出现在终端回滚缓冲、日志、或贴进对话的那一刻，档案就出了 private/。

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  AUTOFILL,
  SCHEMA_VERSION,
  SECTIONS,
  cleanLabel,
  counts,
  emptyValues,
  fieldOf,
  isEmptyValue,
  isScored,
  manualList,
  normalizeLabel,
  sectionByIndex,
  sectionOf,
  validateValues,
} from './profile.schema.mjs';

export function resolvePaths(root = process.cwd()) {
  const absRoot = resolve(root);
  const privateDir = join(absRoot, 'private');
  return {
    root: absRoot,
    privateDir,
    profilePath: join(privateDir, 'profile.json'),
    backupPath: join(privateDir, 'profile.json.bak'),
    legacyMd: join(privateDir, 'profile.md'),
  };
}

export function assertInsidePrivate(target, paths) {
  const abs = resolve(target);
  const rel = relative(paths.privateDir, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`拒绝写入 private/ 之外：${abs}`);
  }
  return abs;
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

// 按 schema 顺序重排键，重复区段按字段顺序重排条目内的键。
// 命名失败：键序随机 → 每次保存的 diff 整片翻红，人就无法肉眼核对"这次改了什么"。
export function orderValues(values, extra = {}) {
  const ordered = { version: SCHEMA_VERSION, values: {} };
  for (const section of SECTIONS) {
    if (section.repeatable) {
      const arr = Array.isArray(values[section.key]) ? values[section.key] : [];
      ordered.values[section.key] = arr.map((item) => {
        const row = {};
        for (const field of section.fields) row[field.key] = str(item ? item[field.key] : '');
        return row;
      });
    } else {
      for (const field of section.fields) ordered.values[`${section.key}.${field.key}`] = str(values[`${section.key}.${field.key}`]);
    }
  }
  // schema 不认识的键原样保留在末尾（见 readValues 的说明），不静默丢数据。
  for (const [key, value] of Object.entries(extra)) ordered.values[key] = value;
  return ordered;
}

export function serialize(values, extra = {}) {
  return `${JSON.stringify(orderValues(values, extra), null, 2)}\n`;
}

export function readValues(paths) {
  if (!existsSync(paths.profilePath)) {
    return { values: emptyValues(), exists: false, unknownKeys: {}, version: SCHEMA_VERSION };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(paths.profilePath, 'utf8'));
  } catch (e) {
    throw new Error(`${paths.profilePath} 不是合法 JSON：${e.message}`);
  }
  if (parsed.version !== SCHEMA_VERSION) {
    throw new Error(`档案版本 ${parsed.version} 与当前 schema（${SCHEMA_VERSION}）不符，先跑 --import 迁移`);
  }
  const incoming = parsed.values && typeof parsed.values === 'object' ? parsed.values : {};
  const base = emptyValues();

  // schema 不认识的键：保留。命名失败：改了 schema 后打开旧文件、随手一保存，旧字段被静默删除。
  const known = new Set();
  for (const section of SECTIONS) {
    if (section.repeatable) {
      known.add(section.key);
      const arr = Array.isArray(incoming[section.key]) ? incoming[section.key] : [];
      base[section.key] = arr.map((item) => {
        const row = {};
        for (const field of section.fields) row[field.key] = str(item ? item[field.key] : '');
        return row;
      });
    } else {
      for (const field of section.fields) {
        const key = `${section.key}.${field.key}`;
        known.add(key);
        base[key] = str(incoming[key]);
      }
    }
  }
  const unknownKeys = {};
  for (const [key, value] of Object.entries(incoming)) if (!known.has(key)) unknownKeys[key] = value;

  return { values: base, exists: true, unknownKeys, version: parsed.version };
}

export function writeValues(paths, values, { backup = true, unknownKeys = {} } = {}) {
  const target = assertInsidePrivate(paths.profilePath, paths);
  mkdirSync(dirname(target), { recursive: true });
  let backedUp = false;
  if (backup && existsSync(target)) {
    const bak = assertInsidePrivate(paths.backupPath, paths);
    copyFileSync(target, bak);
    backedUp = true;
  }
  writeFileSync(target, serialize(values, unknownKeys), 'utf8');
  return { path: target, backedUp };
}

export function writeText(paths, relOrAbs, text) {
  const target = assertInsidePrivate(relOrAbs, paths);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
  return target;
}

function expandHome(p) {
  const s = String(p || '').trim().replace(/^`|`$/g, '');
  if (!s) return '';
  return s.startsWith('~/') ? join(homedir(), s.slice(2)) : s;
}

// 附件/来源路径的存在性：只在节点端能做（浏览器拿不到 fs）。
export function checkPaths(values) {
  const checks = [];
  const probe = (key, label, raw) => {
    const value = str(raw).trim();
    const expanded = expandHome(value);
    let exists = false;
    let isDir = false;
    if (expanded) {
      try {
        const st = statSync(expanded);
        exists = true;
        isDir = st.isDirectory();
      } catch {
        exists = false;
      }
    }
    checks.push({ key, label, path: value, expanded, exists: value ? exists : null, isDir });
  };

  for (const section of SECTIONS) {
    for (const field of section.fields) {
      if (field.autofill !== 'path') continue;
      if (section.repeatable) {
        // 附件是可重复清单，路径字段也就在段里 —— 只扫固定区段会让整份附件清单失去存在性校验。
        const arr = Array.isArray(values[section.key]) ? values[section.key] : [];
        arr.forEach((item, index) => {
          probe(`${section.key}[${index}].${field.key}`, `${section.label}[${index + 1}] · ${field.label}`, item ? item[field.key] : '');
        });
      } else {
        probe(`${section.key}.${field.key}`, `${section.label} · ${field.label}`, values[`${section.key}.${field.key}`]);
      }
    }
  }
  return checks;
}

export function checkPathWarnings(checks) {
  // 刻意不带路径本身：消息会进 --check 的 stdout，也可能被贴进对话。
  // 界面上那一行已经把路径显示出来了，这里给标签就够定位。
  return checks
    .filter((c) => c.exists === false)
    .map((c) => ({ level: 'warn', key: c.key, label: c.label, message: '路径未找到' }));
}

// ── markdown 导入 ────────────────────────────────────────────────────────────
//
// 只认模板自己那种结构（`## N. 区段` / `### [i] 段` / `- 标签：值`），不做通用 markdown 解析。
// 这是"我们拥有的格式"，不是"任意文档的脆弱抽取"。

function cleanValue(raw) {
  let v = String(raw || '').replace(/<!--.*?-->/g, '').trim();
  v = v.replace(/^`(.+)`$/s, '$1').trim();
  return v;
}

// 模板里的指导性占位（YYYY-MM-DD、`本科 / 硕士 / 博士`）不是值。
// 选项列表按"拆开后每一项都是选项词"判，而不是和 options.join 逐字相等 ——
// 否则给 select 加第三个选项，老模板那一行就会被当成真值导进来。
function isPlaceholder(v, field) {
  if (!v) return true;
  if (/YYYY/.test(v)) return true;
  if (!field || !field.options || field.options.length < 2) return false;
  const parts = v.split(/[/、|,，\s]+/).filter(Boolean);
  return parts.length >= 2 && parts.every((part) => field.options.includes(part));
}

// 简历里常见的 `2000.02` / `2000/2` / `2000 年 2 月` 指的是同一个日期。
// 命名失败：写法差异被判成格式错，用户被迫把每一处手工改成短横线。
const DATE_HEAD = /^(\d{4})\s*[-./年]\s*(\d{1,2})\s*(?:[-./月]\s*(\d{1,2}))?/;
// 左边的年段写成"明确到日/月为止"，每个分段都要求分隔符后必须跟数字 ——
// 允许尾随分隔符的贪婪写法会把 `2021 -- 2025` 切成 `2021 -` + `-` + `2025`，凭空多出一个短横线。
const RANGE_SPLIT =
  /^(\d{4}(?:\s*[-./年]\s*\d{1,2}\s*[月]?)?(?:\s*[-./月]\s*\d{1,2}\s*[日号]?)?)\s*(?:--|—|–|~|～|至|到|-)\s*(.+)$/;

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

function normalizeDate(v) {
  const m = DATE_HEAD.exec(String(v || '').trim());
  if (!m) return v;
  return m[3] ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : `${m[1]}-${pad2(m[2])}`;
}

// 导入宽容、手输规范：`2019.09 - 2023.06` 归一成 `2019-09 -- 2023-06`。
function normalizeRange(v) {
  const m = RANGE_SPLIT.exec(String(v || '').trim());
  if (!m) return v;
  const right = /至今|现在|目前|present/i.test(m[2]) ? '至今' : normalizeDate(m[2]);
  return `${normalizeDate(m[1])} -- ${right}`;
}

// ── 日期区间的补日约定 ──────────────────────────────────────────────────────
//
// 表单上的日期大多是"年 → 月 → 日"三级选择，需要精确到日；而简历/档案里写得出
// 起止时间常常只有到月甚至只到年。档案里存到日，填表时就不用每处现场补一个日子。
//
// 约定（补的部分必须被报出来，不能冒充事实）：
//   区间开始 → 该期间的第一天（YYYY → YYYY-01-01，YYYY-MM → YYYY-MM-01）
//   区间结束 → 该期间的最后一天（YYYY → YYYY-12-31，YYYY-MM → 该月最后一天）
// 已经是到日的值原样保留。
const DAY_FIRST = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

function rangeStart(part) {
  const m = DAY_FIRST.exec(part);
  if (!m || m[3]) return { text: part, assumed: [] };
  const month = m[2] || '01';
  return { text: `${m[1]}-${month}-01`, assumed: m[2] ? ['日'] : ['月', '日'] };
}

function rangeEnd(part) {
  const m = DAY_FIRST.exec(part);
  if (!m || m[3]) return { text: part, assumed: [] };
  const month = m[2] ? Number(m[2]) : 12;
  // 该月最后一天：new Date(y, m, 0) 的日期部分就是第 m 月（1 起）的末一天
  const day = new Date(Number(m[1]), month, 0).getDate();
  return { text: `${m[1]}-${pad2(month)}-${pad2(day)}`, assumed: m[2] ? ['日'] : ['月', '日'] };
}

export function expandRangeToDay(value) {
  const s = String(value || '').trim();
  const m = /^(.+?)\s+--\s+(.+?)$/.exec(s);
  if (!m) return { text: s, assumed: [] };
  const start = rangeStart(m[1]);
  const end = /至今/.test(m[2]) ? { text: '至今', assumed: [] } : rangeEnd(m[2]);
  const assumed = [
    ...start.assumed.map((x) => `开始补${x}`),
    ...end.assumed.map((x) => `结束补${x}`),
  ];
  return { text: `${start.text} -- ${end.text}`, assumed };
}

function normalizeByType(field, value) {
  if (field.type === 'date') return normalizeDate(value);
  if (field.type === 'daterange') return normalizeRange(value);
  return value;
}

export function importMarkdown(text) {
  const values = emptyValues();
  // 预置项只属于 --init：导入要从零开始建段，否则 answers 会既有预置的 3 条、
  // 又有从模板导进来的 3 条，变成 6 条。
  for (const sectionDef of SECTIONS) if (sectionDef.repeatable) values[sectionDef.key] = [];
  const notes = [];
  const matched = new Set();
  let section = null;
  let itemIndex = -1;
  let unknownSection = false;
  const droppedFromUnknown = [];
  const assumedDates = [];

  // 上一次写入的位置。缩进的续行会并到它上面 —— 项目描述、自我评价这类字段天然是多行的，
  // 命名失败：解析只取第一行，后面的内容被悄悄截断。
  let last = null;
  const appendLine = (text) => {
    if (!last) return false;
    if (last.kind === 'qa') {
      const item = values[last.section][last.index];
      item.answer = item.answer ? `${item.answer}\n${text}` : text;
    } else if (last.index === null) {
      const key = `${last.section}.${last.fieldKey}`;
      values[key] = values[key] ? `${values[key]}\n${text}` : text;
    } else {
      const item = values[last.section][last.index];
      item[last.fieldKey] = item[last.fieldKey] ? `${item[last.fieldKey]}\n${text}` : text;
    }
    return true;
  };

  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/<!--.*?-->/g, '').trim();
    if (!line) continue;
    if (/^\s{2,}|^\t/.test(raw) && appendLine(line)) continue;

    if (/^#{1,6}\s/.test(line)) {
      const h2 = line.match(/^##\s*(\d+)\s*[.、]?\s*(.*)$/);
      const h3 = line.match(/^###\s*\[(\d+)\]/);
      if (h2) {
        const n = Number(h2[1]);
        section = sectionByIndex(n);
        itemIndex = -1;
        unknownSection = !section;
        if (!section) notes.push(`区段编号 ${n}（${cleanLabel(h2[2])}）在 schema 里没有对应项，整段未导入`);
        else if (cleanLabel(h2[2]) && normalizeLabel(h2[2]) !== normalizeLabel(section.label)) {
          notes.push(`区段 ${n} 标题是「${cleanLabel(h2[2])}」，schema 里是「${section.label}」—— 请确认是否错位`);
        }
      } else if (h3 && section && section.repeatable) {
        itemIndex = Number(h3[1]);
        while (values[section.key].length <= itemIndex) values[section.key].push({});
      } else {
        // 没编号的标题结束当前区段，避免把后面的行算进上一段
        section = null;
        itemIndex = -1;
        unknownSection = false;
      }
      last = null;
      continue;
    }

    // 分隔符前的标签最多 30 字符：再长就是正文里的普通句子（比如含 URL 的说明行），不是字段行。
    const m = line.match(/^(?:[-*+]\s*)?([^：:]{1,30})[：:]\s*(.*)$/);
    if (!m) continue;
    const rawLabel = cleanLabel(m[1]);
    if (!rawLabel || rawLabel.length > 24) continue;

    if (!section) {
      // 未识别区段里的字段名要记下来：只说"整段未导入"，用户不知道丢了什么。
      if (unknownSection) droppedFromUnknown.push(rawLabel);
      continue;
    }
    const value = cleanValue(m[2]);

    // `- 题目：答案` 形状的区段（常见长文本答案）按问答对导入，不是 label→字段。
    if (section.importStyle === 'qa') {
      values[section.key].push({ scope: '', question: rawLabel, answer: value });
      matched.add(`${section.key}:qa`);
      last = { kind: 'qa', section: section.key, index: values[section.key].length - 1 };
      continue;
    }

    const field = fieldOf(section.key, rawLabel);
    if (!field) {
      notes.push(`「${rawLabel}」在 ${section.label} 里找不到对应字段，已忽略`);
      continue;
    }
    matched.add(`${section.key}.${field.key}`);
    let finalValue = isPlaceholder(value, field) ? '' : normalizeByType(field, value);
    if (field.type === 'daterange' && finalValue) {
      const expanded = expandRangeToDay(finalValue);
      if (expanded.assumed.length) assumedDates.push(`${section.label} · ${field.label}：${expanded.text}（${expanded.assumed.join('、')}）`);
      finalValue = expanded.text;
    }
    if (section.repeatable) {
      if (itemIndex < 0) {
        itemIndex = 0;
        while (values[section.key].length <= itemIndex) values[section.key].push({});
      }
      values[section.key][itemIndex][field.key] = finalValue;
      last = { kind: 'field', section: section.key, index: itemIndex, fieldKey: field.key };
    } else {
      values[`${section.key}.${field.key}`] = finalValue;
      last = { kind: 'field', section: section.key, index: null, fieldKey: field.key };
    }
  }

  if (droppedFromUnknown.length) {
    notes.push(`未识别区段里这些字段名未导入：${droppedFromUnknown.join('、')}`);
  }

  // 丢掉全空段。命名失败：模板里 `### [0]` 那种空示例段会被导成一条"真实经历"，
  // 用户得手动删掉才对 —— 而它看起来跟真填的段没区别。
  for (const sectionDef of SECTIONS) {
    if (!sectionDef.repeatable) continue;
    values[sectionDef.key] = values[sectionDef.key].filter((item) =>
      sectionDef.fields.some((field) => !isEmptyValue(item[field.key]))
    );
  }

  // 迁移完整性：schema 里每个字段都该在模板里出现过，没出现说明模板与 schema 已经错开。
  const missing = [];
  for (const sectionDef of SECTIONS) {
    if (sectionDef.importStyle === 'qa') continue;
    for (const field of sectionDef.fields) {
      if (!matched.has(`${sectionDef.key}.${field.key}`)) missing.push(`${sectionDef.label} · ${field.label}`);
    }
  }
  return { values, notes, missing, assumedDates, matched: [...matched] };
}

// ── 映射表 ───────────────────────────────────────────────────────────────────

function cell(v) {
  return str(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ') || '（空）';
}

export function renderMapping(values, { pathChecks = [], target = '' } = {}) {
  const out = [];
  out.push('# 个人档案 · 映射表');
  out.push('');
  out.push(`> 由 \`node scripts/profile.mjs --render\` 生成${target ? `，源文件 ${target}` : ''}。`);
  out.push('> 「永不自动填」的字段不在这里，也不会出现在任何一步给引擎的映射里。');
  out.push('');

  const rowsOf = (predicate, sections) => {
    const rows = [];
    for (const sectionDef of sections) {
      if (sectionDef.repeatable) {
        const arr = Array.isArray(values[sectionDef.key]) ? values[sectionDef.key] : [];
        arr.forEach((item, index) => {
          for (const field of sectionDef.fields) {
            if (!predicate(field)) continue;
            rows.push([`${sectionDef.label}[${index + 1}] · ${field.label}`, cell(item[field.key])]);
          }
        });
      } else {
        for (const field of sectionDef.fields) {
          if (!predicate(field)) continue;
          rows.push([`${sectionDef.label} · ${field.label}`, cell(values[`${sectionDef.key}.${field.key}`])]);
        }
      }
    }
    return rows;
  };

  const table = (rows) => {
    if (!rows.length) return ['（暂无）', ''];
    return ['| 字段 | 值 |', '| --- | --- |', ...rows.map(([a, b]) => `| ${a} | ${b} |`), ''];
  };

  out.push('## 可自动填（auto）');
  out.push('');
  out.push(...table(rowsOf((field) => field.autofill === 'auto', SECTIONS)));
  out.push('## 需逐项确认（confirm）');
  out.push('');
  out.push(...table(rowsOf((field) => field.autofill === 'confirm', SECTIONS)));

  const pathRows = pathChecks
    .filter((c) => c.path)
    .map((c) => [`${c.label}`, `\`${c.path}\``, c.exists ? '已找到' : '未找到']);
  out.push('## 附件路径（供桥上传，不经引擎）');
  out.push('');
  out.push(...(pathRows.length ? ['| 字段 | 路径 | 文件 |', '| --- | --- | --- |', ...pathRows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`), ''] : ['（暂无）', '']));

  const noteRows = rowsOf((field) => field.autofill === 'note', SECTIONS).filter(([, v]) => v !== '（空）');
  out.push('## 附注（不进填表映射）');
  out.push('');
  out.push(...table(noteRows));

  out.push('## 待你手动');
  out.push('');
  const manual = manualList(values);
  if (manual.length) for (const item of manual) out.push(`- ${item.label} —— ${item.reason}`);
  else out.push('（无）');
  out.push('');

  return out.join('\n');
}

export function buildMapping(values, paths) {
  return renderMapping(values, { pathChecks: checkPaths(values), target: paths ? paths.profilePath : '' });
}

export function summarize(values) {
  const { slots, filled, byAutofill, segments } = counts(values);

  // perSection 供界面左轨与区段头显示。分母只含 SCORED 的分类（理由见 schema.isScored）。
  const perSection = {};
  for (const section of SECTIONS) {
    let sectionSlots = 0;
    let sectionFilled = 0;
    let neverSlots = 0;
    if (section.repeatable) {
      const arr = Array.isArray(values[section.key]) ? values[section.key] : [];
      for (const item of arr) {
        for (const field of section.fields) {
          if (field.autofill === 'never') { neverSlots += 1; continue; }
          if (!isScored(field)) continue;
          sectionSlots += 1;
          if (!isEmptyValue(item ? item[field.key] : '')) sectionFilled += 1;
        }
      }
    } else {
      for (const field of section.fields) {
        if (field.autofill === 'never') { neverSlots += 1; continue; }
        if (!isScored(field)) continue;
        sectionSlots += 1;
        if (!isEmptyValue(values[`${section.key}.${field.key}`])) sectionFilled += 1;
      }
    }
    perSection[section.key] = {
      filled: sectionFilled,
      slots: sectionSlots,
      segments: segments[section.key] || 0,
      neverSlots,
    };
  }

  return {
    completeness: `${filled}/${slots}`,
    filled,
    slots,
    byAutofill: Object.fromEntries(
      Object.entries(byAutofill).map(([k, v]) => [k, { label: AUTOFILL[k].label, slots: v.slots, filled: v.filled }])
    ),
    segments,
    perSection,
    manual: manualList(values),
  };
}

export { counts, isEmptyValue, sectionOf, validateValues };
