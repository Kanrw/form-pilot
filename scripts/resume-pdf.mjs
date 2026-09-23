#!/usr/bin/env node
// ATS 简历 PDF 生成器 —— 从档案生成「完整、未压缩、机器可读」的 PDF 简历。
//
//   node scripts/resume-pdf.mjs                  # 基准档案 → private/resume/resume-ats.pdf
//   node scripts/resume-pdf.mjs --version <名>   # 按投放版本口径 → private/resume/resume-ats-<名>.pdf
//   node scripts/resume-pdf.mjs --versions       # 列出可用版本（只回名字，不回值）
//   参数：--root <dir>  --font <ttf/ttc 路径>
//
// 为什么有它：多数招聘网站支持「上传简历 → 自动解析 → 回填表单」，比逐字段往网页里
// 灌可靠得多。面向 HR 的排版简历常为省空间压缩字段，解析不出完整内容 —— 这个版本刻意反着来：
//   1. 单栏纯文本流：无表格、无图片、无分栏、无页眉页脚，解析器按行读。
//   2. 每个字段都带标准「标签：值」，日期、区间保持档案原值不缩写。
//   3. 区段标题用 schema 的区段标签（教育经历 / 科研 / 项目经历 / …），它们是解析器认识的高频关键词。
//   4. 整段排除（各有命名理由，见 EXCLUDE 注释）：never 类字段、紧急联系人（第三方个人信息）、
//      常见长文本答案（表单答案不是简历内容）、附件清单（本机路径无意义）。
//   5. 输出强制落在 <root>/private/ 内；stdout 只回路径与计数，不回显字段值。

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import PDFDocument from 'pdfkit';
import {
  assertInsidePrivate,
  isEmptyValue,
  listVersions,
  resolvePaths,
  resolveValues,
} from '../tools/profile-io.mjs';
import { SECTIONS } from '../tools/profile.schema.mjs';

// ── 字体 ─────────────────────────────────────────────────────────────────────
// PDF 要可被 ATS 抽出中文，必须内嵌带 ToUnicode 的 CJK 字体（系统标准字体都是拉丁字形）。
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Hiragino Sans GB.ttc',              // macOS 冬青黑体（首个面是常规体）
  '/System/Library/Fonts/PingFang.ttc',                      // macOS 苹方
  '/System/Library/Fonts/STHeiti Light.ttc',                 // 旧版 macOS
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',    // macOS 兜底
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',  // Linux
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  'C:\\Windows\\Fonts\\msyh.ttc',                            // Windows 微软雅黑
  'C:\\Windows\\Fonts\\simhei.ttf',
];

// 逐个试开：TTC 能否被 fontkit 打开随系统版本有差异，开不了就换下一个。
// 命名失败：TTC 打不开时直接生成会崩或字形缺失，宁可提前换字体。
export function pickFont(override = '') {
  const list = override ? [override] : FONT_CANDIDATES;
  for (const path of list) {
    if (!existsSync(path)) continue;
    try {
      const doc = new PDFDocument({ compress: false });
      doc.font(path);
      const width = doc.widthOfString('中');
      doc.end();
      if (width > 0) return path;
    } catch {
      // 换下一个候选
    }
  }
  throw new Error('找不到可用的中文字体（ttf/ttc）。用 --font <路径> 指定一个包含中文字形的字体文件');
}

// ── 内容组装（纯函数，便于单测） ────────────────────────────────────────────
//
// 区块是线性排版的原子；render 只认区块，build 只产区块。
//   name    大标题          { text }
//   meta    页眉联系行      { parts: [{ label, value }] }   渲染成「电话：x ｜ 邮箱：y」
//   section 区段标题        { title }
//   entry   条目头行        { parts: ['公司', '职位', '2020-01 -- 至今'] }
//   kv      「标签：值」行   { label, value }
//   kvs     一行多组键值    { parts: [[label, value], ...] }
//   lines   多行正文        { lines: [...] }                已编号的行原样，裸行加 "- "
//   para    整段文字        { text }

const FIELD_LABEL = {};
for (const section of SECTIONS) for (const field of section.fields) FIELD_LABEL[`${section.key}.${field.key}`] = field.label;

const v = (values, key) => String(values[key] ?? '').trim();
const has = (values, key) => !isEmptyValue(values[key]);
const seg = (values, key) => (Array.isArray(values[key]) ? values[key] : []);

// 页眉两行联系信息：把 ATS 最常抓的字段放在第一屏、且都带标签。
const META_LINES = [
  [['basic.gender', '性别'], ['basic.birthDate', '出生日期'], ['basic.politicalStatus', '政治面貌'], ['basic.currentCity', '现居住城市']],
  [['basic.phone', '电话'], ['basic.email', '邮箱'], ['basic.github', 'GitHub'], ['basic.orcid', 'ORCID']],
];

// 页眉已带标签的字段 + 四类整段排除的字段，正文一律不再出现。
const BASIC_SKIP = new Set([
  'name', 'englishName', 'gender', 'birthDate', 'politicalStatus', 'currentCity', 'phone', 'email', 'github', 'orcid',
  'idNumber', // never 类：引擎不提供也不接受，简历同样不输出
  'emergencyContactName', 'emergencyContactPhone', // 第三方个人信息，不进任何上传文件
]);

function metaBlocks(values) {
  const blocks = [];
  for (const line of META_LINES) {
    const parts = line
      .map(([key, label]) => ({ label, value: v(values, key) }))
      .filter((part) => part.value);
    if (parts.length) blocks.push({ kind: 'meta', parts });
  }
  return blocks;
}

function fixedSection(values, sectionKey, { skip = [] } = {}) {
  const blocks = [];
  for (const field of SECTIONS.find((s) => s.key === sectionKey).fields) {
    if (skip.includes(field.key)) continue;
    const value = v(values, `${sectionKey}.${field.key}`);
    if (value) blocks.push({ kind: 'kv', label: field.label, value });
  }
  return blocks;
}

// 「标签：首行」+ 余行正文。描述 / 成果这类多行字段既要保住标签关键词，又不能压行。
function labeledLines(label, raw) {
  const lines = String(raw || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  return [{ kind: 'kv', label, value: lines[0] }, ...(lines.length > 1 ? [{ kind: 'lines', lines: lines.slice(1) }] : [])];
}

function repeatableItem(values, sectionKey, item, { entry = [], kvKeys = [], linesKeys = [] }) {
  const blocks = [];
  const parts = entry
    .map((key) => {
      const value = v(item, key);
      if (key === 'degree') {
        const program = v(item, 'programType');
        return program ? `${value}（${program}）` : value;
      }
      return value;
    })
    .filter(Boolean);
  if (parts.length) blocks.push({ kind: 'entry', parts });
  for (const key of kvKeys) {
    const value = v(item, key);
    if (value) blocks.push({ kind: 'kv', label: FIELD_LABEL[`${sectionKey}.${key}`], value });
  }
  for (const key of linesKeys) blocks.push(...labeledLines(FIELD_LABEL[`${sectionKey}.${key}`], item[key]));
  return blocks;
}

export function buildBlocks(values) {
  const name = v(values, 'basic.name');
  const englishName = v(values, 'basic.englishName');
  if (!name && !englishName) {
    throw new Error('basic.name 与 basic.englishName 都为空 —— 没有姓名的简历没有意义，先补档案再生成');
  }

  const blocks = [{ kind: 'name', text: englishName ? `${name}（${englishName}）` : name }];
  blocks.push(...metaBlocks(values));

  const pushSection = (title, sectionBlocks) => {
    if (sectionBlocks.length) blocks.push({ kind: 'section', title }, ...sectionBlocks);
  };

  pushSection('求职意向', fixedSection(values, 'intent'));

  const eduBlocks = [];
  for (const item of seg(values, 'education')) {
    eduBlocks.push(
      ...repeatableItem(values, 'education', item, {
        entry: ['school', 'degree', 'period'],
        kvKeys: ['department', 'major', 'researchDirection', 'supervisor', 'degreeAwarded', 'studyType', 'gpa', 'studentId', 'unifiedAdmission', 'overseasStudy'],
      })
    );
  }
  pushSection('教育经历', eduBlocks);

  const projectBlocks = [];
  for (const item of seg(values, 'projects')) {
    projectBlocks.push(
      ...repeatableItem(values, 'projects', item, {
        entry: ['name', 'period'],
        kvKeys: ['affiliation', 'role'],
        linesKeys: ['description', 'outcome'],
      })
    );
  }
  pushSection('科研 / 项目经历', projectBlocks);

  const expBlocks = [];
  for (const item of seg(values, 'experience')) {
    expBlocks.push(
      ...repeatableItem(values, 'experience', item, {
        entry: ['company', 'title', 'period'],
        linesKeys: ['duties'],
      })
    );
  }
  pushSection('实习 / 工作经历', expBlocks);

  const posBlocks = [];
  for (const item of seg(values, 'positions')) {
    posBlocks.push(
      ...repeatableItem(values, 'positions', item, {
        entry: ['title', 'period'],
        linesKeys: ['description'],
      })
    );
  }
  pushSection('在校职务', posBlocks);

  const pubBlocks = [];
  for (const item of seg(values, 'publications')) {
    const parts = ['venue', 'authorPosition', 'citation', 'status']
      .map((key) => [FIELD_LABEL[`publications.${key}`], v(item, key)])
      .filter(([, value]) => value);
    if (v(item, 'title')) pubBlocks.push({ kind: 'kv', label: FIELD_LABEL['publications.title'], value: v(item, 'title') });
    if (parts.length) pubBlocks.push({ kind: 'kvs', parts });
  }
  pushSection('论文与成果', pubBlocks);

  const skillBlocks = seg(values, 'skills').map((item) => ({
    kind: 'kv',
    label: v(item, 'category') || '技能',
    value: v(item, 'content'),
  })).filter((block) => block.value);
  pushSection('技术能力', skillBlocks);

  pushSection('证书与语言', fixedSection(values, 'certificates'));

  const awardBlocks = [];
  for (const item of seg(values, 'awards')) {
    const parts = ['award', 'level', 'period']
      .map((key) => [FIELD_LABEL[`awards.${key}`], v(item, key)])
      .filter(([, value]) => value);
    if (parts.length) awardBlocks.push({ kind: 'kvs', parts });
  }
  pushSection('获奖', awardBlocks);

  const actBlocks = [];
  for (const item of seg(values, 'activities')) {
    const parts = ['role', 'organization'].map((key) => [FIELD_LABEL[`activities.${key}`], v(item, key)]).filter(([, value]) => value);
    if (parts.length) actBlocks.push({ kind: 'kvs', parts });
    actBlocks.push(...labeledLines(FIELD_LABEL['activities.content'], item.content));
  }
  pushSection('社团与组织活动', actBlocks);

  pushSection('自我评价', String(values['selfEvaluation.text'] || '')
    .split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ kind: 'para', text })));

  // 基本信息（其余人口学字段）放最后：ATS 按标签抓取不挑位置，人读的部分在前。
  const basicBlocks = [];
  for (const field of SECTIONS.find((s) => s.key === 'basic').fields) {
    if (BASIC_SKIP.has(field.key)) continue;
    const value = v(values, `basic.${field.key}`);
    if (value) basicBlocks.push({ kind: 'kv', label: field.label, value });
  }
  pushSection('基本信息', basicBlocks);

  // 「常见长文本答案」「附件清单」两区段刻意不进简历：前者是表单答案不是简历内容，
  // 后者是本机路径。排除是显式决定，不是遗漏。
  return blocks;
}

// ── 渲染 ─────────────────────────────────────────────────────────────────────

const SEPARATOR = ' ｜ ';
const BULLET_RE = /^\s*(\d+[.、)]|[-•·]|[（(][一二三四五六七八九十]+[)）])/;

export async function renderPdf(blocks, { fontPath, outPath, paths, title = '简历' }) {
  const target = paths ? assertInsidePrivate(outPath, paths) : outPath;
  mkdirSync(dirname(target), { recursive: true });
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 46, bottom: 46, left: 46, right: 46 },
    info: { Title: title, Creator: 'form-pilot resume-pdf' },
  });
  const stream = doc.pipe(createWriteStream(target));
  doc.font(fontPath);
  const LEFT = 46;
  const WIDTH = doc.page.width - LEFT * 2;

  const write = (text, { size = 10.5, color = '#000000', x = null, width = null } = {}) => {
    doc.fontSize(size).fillColor(color);
    const options = { width: width ?? WIDTH, lineGap: 2.2 };
    if (x != null) doc.text(text, x, doc.y, options);
    else doc.text(text, options);
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'name': {
        write(block.text, { size: 17 });
        doc.moveDown(0.3);
        break;
      }
      case 'meta': {
        write(block.parts.map((p) => `${p.label}：${p.value}`).join(SEPARATOR), { size: 9.5, color: '#333333' });
        doc.moveDown(0.2);
        break;
      }
      case 'section': {
        doc.moveDown(0.5);
        write(block.title, { size: 13 });
        const y = doc.y + 2;
        doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(0.75).strokeColor('#999999').stroke();
        doc.moveDown(0.4);
        break;
      }
      case 'entry': {
        doc.moveDown(0.3);
        write(block.parts.join(SEPARATOR), { size: 11 });
        doc.moveDown(0.15);
        break;
      }
      case 'kv': {
        write(`${block.label}：${block.value}`);
        doc.moveDown(0.12);
        break;
      }
      case 'kvs': {
        write(block.parts.map(([label, value]) => `${label}：${value}`).join(SEPARATOR));
        doc.moveDown(0.12);
        break;
      }
      case 'lines': {
        for (const line of block.lines) write(BULLET_RE.test(line) ? line : `- ${line}`);
        doc.moveDown(0.12);
        break;
      }
      case 'para': {
        write(block.text);
        doc.moveDown(0.15);
        break;
      }
      default:
        throw new Error(`未知区块类型：${block.kind}`);
    }
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return target;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return flags;
}

const USAGE = `用法：
  node scripts/resume-pdf.mjs                  基准档案 → private/resume/resume-ats.pdf
  node scripts/resume-pdf.mjs --version <名>   按投放版本口径 → private/resume/resume-ats-<名>.pdf
  node scripts/resume-pdf.mjs --versions       列出可用版本
参数：--root <dir>  --font <ttf/ttc 路径>`;

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    return await run(argv);
  } catch (e) {
    const guard = /拒绝写入/.test(e.message);
    out({ ok: false, error: guard ? 'path-guard' : 'failed', message: e.message });
    return 1;
  }
}

async function run(argv) {
  const flags = parseArgs(argv);
  const paths = resolvePaths(flags.root && flags.root !== true ? flags.root : process.cwd());

  if (flags.help || flags.h) {
    out({ ok: true, usage: USAGE });
    return 0;
  }

  if (flags.versions) {
    const list = listVersions(paths);
    out({ ok: true, action: 'versions', versions: list.map((item) => ({ name: item.name, overrides: item.count })) });
    return 0;
  }

  const versionName = flags.version && flags.version !== true ? String(flags.version) : '';
  if (flags.version === true) throw new Error('--version 需要一个版本名，--versions 可查看已有版本');
  const resolved = resolveValues(paths, versionName || null);
  if (versionName && !resolved.versionExists) throw new Error(`版本 ${versionName} 不存在，--versions 可查看已有版本`);

  const blocks = buildBlocks(resolved.values);
  const fontPath = pickFont(flags.font && flags.font !== true ? String(flags.font) : '');
  const fileName = versionName ? `resume-ats-${versionName}.pdf` : 'resume-ats.pdf';
  const target = await renderPdf(blocks, {
    fontPath,
    outPath: join(paths.privateDir, 'resume', fileName),
    paths,
  });

  // 只回计数与路径 —— stdout 可能进终端回滚缓冲或对话，值不能跟着出去。
  out({
    ok: true,
    action: 'resume-pdf',
    version: versionName || null,
    file: target.replace(paths.root, '.'),
    font: fontPath,
    sections: blocks.filter((b) => b.kind === 'section').length,
    fields: blocks.filter((b) => b.kind === 'kv' || b.kind === 'kvs').length,
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
