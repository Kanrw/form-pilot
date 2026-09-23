#!/usr/bin/env node
// 隐私边界守卫：已跟踪文件里不许出现 private/ 下的真实档案值。
// 用法：node scripts/check-private-leak.mjs   （有泄漏 exit 1）
//
// 为什么要有它：private/ 被 .gitignore 挡住，但档案值会被**抄进**测试、schema 提示、
// AGENTS.md 的实测记录里 —— 那些文件是要进 git、要公开分发的。人工看不出来，机器能。
//
// 判据只有两条，都故意做得笨而全：
//   1. private/ 下任何 ≥4 字符的字符串值，不许出现在已跟踪文件里；
//   2. 已跟踪文件里不许出现 /Users/<用户名> 这类单机绝对路径（会泄露使用者身份）。
// 宁可误报（人工加白名单），不可漏报 —— 漏报等于把手机号推到公网。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

// 结构上的键名/提示语本就是模板，不该被当成泄漏；命中这些前缀的值跳过。
const SKIP_KEYS = /^(meta|schema|\$schema|version|updatedAt|createdAt)\b/;
// 常见通用词，不算个人数据，避免噪音把真泄漏淹掉。
const COMMON = new Set(['至今', '中国', '汉族', '男', '女', '本科', '硕士研究生', '博士研究生']);

// 白名单：schema/模板里的**选项与提示语**，是给人照着填的格式样例，不是某人的数据。
// 每条都要写清理由 —— 白名单是最容易被人顺手放宽的地方，放宽一次就等于守卫失效。
const ALLOW = new Map([
  ['共青团员', '政治面貌下拉的标准选项之一（与 群众/中共党员 并列），模板内容'],
  ['176 cm', '身高字段 hint 的格式样例，示范"要带单位"'],
  ['英语 / 熟练', '语言能力 hint 的格式样例，示范"语种 + 掌握程度"'],
  ['学术型博士', '培养类型 hint 的通用取值，非特定个人'],
  ['第一性原理', '通用技术名词，JD 与技能分类里都会出现'],
  ['github.com/Kanrw', '本人仓库地址，本就是要公开的（出现在 README 与 package.json）'],
]);
// 已知盲区（不打算自动化处理，靠 review 时人眼看）：档案值的**前缀子串**不算命中。
// 真踩过一次——档案里是一串顿号分隔的爱好，测试里只抄了前两个，
// 全文比对抓不到。改成逐词比对又会误伤"物理学"这类通用词，得不偿失。
// 纯年份（如获奖年份 2019）不具识别力，跳过。
const SKIP_VALUE = /^\d{4}$/;

function collectPrivateValues() {
  const vals = new Map();
  const files = [];
  const p = join(ROOT, 'private/profile.json');
  if (existsSync(p)) files.push(p);
  const dir = join(ROOT, 'private/profiles');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.push(join(dir, f));
  }
  if (files.length === 0) return null; // 新克隆没有 private/：不是错误，跳过

  const walk = (o, path) => {
    if (o == null) return;
    if (typeof o === 'string') {
      if (o.length >= 4 && !COMMON.has(o) && !ALLOW.has(o) && !SKIP_VALUE.test(o) && !SKIP_KEYS.test(path)) {
        if (!vals.has(o)) vals.set(o, new Set());
        vals.get(o).add(path);
      }
      return;
    }
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof o === 'object') for (const k in o) walk(o[k], path ? `${path}.${k}` : k);
  };
  for (const f of files) walk(JSON.parse(readFileSync(f, 'utf8')), '');
  return vals;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT })
    .toString().trim().split('\n')
    .filter((f) => f && f !== 'package-lock.json' && f !== 'scripts/check-private-leak.mjs');
}

const vals = collectPrivateValues();
if (!vals) {
  console.log('check-private-leak: 本机无 private/，跳过（新克隆属正常）。');
  process.exit(0);
}

const files = trackedFiles().map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
const leaks = [];

for (const [val, keys] of vals) {
  for (const [f, text] of files) {
    if (text.includes(val)) leaks.push({ kind: '档案值', val, keys: [...keys][0], file: f });
  }
}
for (const [f, text] of files) {
  const m = text.match(/\/Users\/[a-zA-Z0-9._-]+/g);
  if (m) for (const hit of new Set(m)) leaks.push({ kind: '绝对路径', val: hit, keys: '', file: f });
}

if (leaks.length === 0) {
  console.log(`check-private-leak: 干净（${vals.size} 个档案值 × ${files.length} 个已跟踪文件）。`);
  process.exit(0);
}
console.error(`check-private-leak: 发现 ${leaks.length} 处泄漏，禁止提交：`);
for (const l of leaks) console.error(`  [${l.kind}] ${JSON.stringify(l.val)}  ← ${l.file}${l.keys ? '  (' + l.keys + ')' : ''}`);
process.exit(1);
