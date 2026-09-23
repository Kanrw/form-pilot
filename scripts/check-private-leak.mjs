#!/usr/bin/env node
// 隐私边界守卫：档案真值不许进 git（工作树 / 暂存区 / 历史 三个面都扫）。
//
// 用法：
//   node scripts/check-private-leak.mjs                  # 扫已跟踪文件（工作树）← 默认，npm run check:privacy
//   node scripts/check-private-leak.mjs --staged         # 扫暂存区内容 ← pre-commit 钩子用
//   node scripts/check-private-leak.mjs --history        # 扫全部 git 历史 ← 事后审计，npm run check:privacy:history
//   node scripts/check-private-leak.mjs --patterns       # 只跑模式判据，不要求 private/ ← CI / 新克隆
// **扫描范围与判据是两维**（--staged/--history 是范围，--patterns 是判据），可以叠加：
//   --staged --patterns  = 扫暂存区、只跑模式判据（新克隆的 pre-commit 走这条）
//   --patterns 单独用    = 扫工作树、只跑模式判据（CI 走这条）
// 早先把 --patterns 写成第三种"范围"是错的：这样新克隆里 pre-commit 永远拿不到判据，
// 只能要么失败关闭把人全堵死、要么放行 —— 两个都不对。
//
// 失败关闭（**只对"本该有档案却没有"生效**，见 main()）：private/ 目录在但档案读不出来 →
// 拒绝放行；private/ 目录根本不存在（新克隆 / 贡献者）→ 降级为模式判据并明确告警。
//
// 为什么要有它：private/ 被 .gitignore 挡住，但档案值会被**抄进**测试、schema 提示、
// AGENTS.md 的实测记录里 —— 那些文件要进 git、要公开分发。人工看不出来，机器能。
//
// ★ 三次真实事故决定了本文件现在的形状（别退回任何一条）：
//   1. 手机号进了 AGENTS.md → 所以要按档案值逐条比对，不能只靠正则；
//   2. 真值在提交 A 进仓库、在提交 B 才从工作树删掉 → **改工作树删不掉历史** → 所以有 --history；
//   3. 提交前只跑了 npm test 没跑守卫 → 所以有 .githooks/pre-commit 强制跑 --staged。
//   第 2 条还顺带证明了"扫工作树"是不够的：被 `git add` 之后又在磁盘上改干净的文件，
//   提交进去的仍是脏内容 —— 所以 pre-commit 必须扫 index（`git show :<path>`），不是磁盘。
//
// 判据故意做得笨而全：
//   A. private/ 下任何 ≥4 字符的字符串值，不许出现在被扫对象里；
//   B. 本机绝对路径 / 手机号 / 身份证号 这三类**模式**（不需要档案就能查，CI 靠它们）；
//   C. 任何 private/ 下的路径不得被 git 跟踪（这是最直接的违规形态）。
// 宁可误报（人工加白名单并写明理由），不可漏报 —— 漏报等于把手机号推到公网。
//
// 失败关闭：**只对"本该有档案却没有"生效**。
// 区分信号是 private/ **目录**而不是文件：目录在而档案读不出来（改名/误删）→ 拒绝放行；
// 目录根本不在（新克隆、贡献者机器）→ 降级成模式判据并告警，否则谁都没法提交。
// 旧版把这两种情况混成一句"跳过并 exit 0" —— 那是 fail-open，一个重命名就能废掉守卫。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

const argv = new Set(process.argv.slice(2));
// 范围
const SCOPE = argv.has('--history') ? 'history' : argv.has('--staged') ? 'staged' : 'tree';
// 判据：--patterns 表示"不要求 private/"，与范围正交
const NO_PROFILE = argv.has('--patterns');

// ★ 守卫自己也必须被扫（2026-09-23）。旧版把本文件排除在扫描之外，理由说不清；
// 结果是"守卫里写进真值"成了盲区 —— 实测当场踩到一次：白名单里手滑写了一行真实手机号，
// 因为文件被排除，三种模式一个都没报出来。
//
// 现在**排除清单是空的**：曾排除 `package-lock.json`（无理由，纯遗留），2026-09-23 取消后
// 实测 tree 与 patterns 两种模式都干净（127 个档案值 + 3 类模式 × 52 个已跟踪文件），
// 于是决定不再排除 —— 盲区少一个是一个。要重新加排除项，必须先给出**实测命中**，
// 并把命中的字符串形态与"为什么它不是个人数据"写在这里。
// git 把含 NUL 的文件当二进制；逐行文本判据对它没意义，但**不能静默跳过**，只对二进制生效。
const BINARY = /\u0000/;

// 排除清单：保持为空。曾排除 `package-lock.json`（无理由、纯遗留）—— 2026-09-23 真的取消后
// 实测 tree / staged / patterns 三种范围都干净，于是永久去掉：盲区少一个是一个。
// 要重新加排除项，必须先给出**实测命中**，并把命中的字符串形态与"为什么它不是个人数据"写在上面。
// （踩过的坑：macOS 是 BSD grep，`grep "a\|b"` 不支持交替 —— 当时据此判断"排除已取消"是错的，
//   实际 Set 还在生效，白跑了一轮实验。这类判断用 Grep 工具或 grep -E。）

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

// 模式判据的允许清单：测试里的**假**号码。每条必须写清"为什么它不是真数据"，
// 且**上界是 10 条**（tests/privacy.test.mjs 盯着）—— 白名单一涨就说明有人在拿它消音。
const ALLOW_PATTERN = new Map([
  ['13800001234', '引擎/档案测试的占位手机号（138 段 + 顺号），引擎单测里当输入值用'],
  ['13800000000', '全 0 占位手机号，多处单测用它断言"写入落到了号码框而不是 +86 框"'],
  ['13800044712', '档案 md 导入测试的占位手机号（假档案：沈砚清 / 同济大学 一套）'],
  ['19900000000', '档案测试的占位手机号，与真实号码同前缀但号码段全是 0'],
  ['110101199001011234', '国标示例身份证号（北京东城 / 1990-01-01 / 顺序号 1234），never 类断言专用'],
]);
export { ALLOW_PATTERN };

// 模式判据（不需要档案，CI 与 pre-commit 都用）。
// 手机号/身份证号都加数字边界，否则会被 12 位学号这类长数字串误命中。
export const PATTERNS = [
  { kind: '绝对路径', re: /\/Users\/[a-zA-Z0-9._-]+/g, why: '泄露使用者身份与本机目录结构' },
  { kind: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, why: '个人标识符，已公开过一次' },
  { kind: '身份证号', re: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, why: 'never 类字段，绝不能出现在仓库里' },
];

// 一批 (标识符, 文本) → 泄漏清单。纯函数，有单测。
export function scanTexts(entries, values) {
  const leaks = [];
  for (const [where, text] of entries) {
    if (values) {
      for (const [val, keys] of values) {
        if (text.includes(val)) leaks.push({ kind: '档案值', val, keys: [...keys][0], where });
      }
    }
    for (const p of PATTERNS) {
      const m = text.match(p.re);
      if (!m) continue;
      for (const hit of new Set(m)) {
        if (ALLOW_PATTERN.has(hit)) continue;
        leaks.push({ kind: p.kind, val: hit, keys: '', where });
      }
    }
  }
  return leaks;
}

export function collectPrivateValues(root = ROOT) {
  const vals = new Map();
  const files = [];
  const p = join(root, 'private/profile.json');
  if (existsSync(p)) files.push(p);
  const dir = join(root, 'private/profiles');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.push(join(dir, f));
  }
  if (files.length === 0) return null;

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

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 }).toString();

// C 判据：private/ 下的路径被跟踪 = 最直接的违规。
function trackedPrivatePaths() {
  return git('ls-files').split('\n').filter((f) => f.startsWith('private/'));
}

function treeEntries() {
  return git('ls-files').split('\n')
    .filter((f) => !!f)
    .map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
}

// 扫 index，不是扫磁盘。区分度在这里：`git add` 后又在磁盘上改干净的文件，
// 提交进去的仍是脏内容。
function stagedEntries() {
  const names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
  return names
    .map((f) => [f + ' (staged)', git('show', `:${f}`)])
    .filter(([, text]) => !BINARY.test(text));
}

// 历史：按提交切开 patch，命中就能点名是哪个 SHA —— 因为"改工作树删不掉历史"。
function historyEntries() {
  const out = execFileSync('git', ['log', '-p', '--all', '--no-color', '--format=COMMIT%x00%h'], {
    cwd: ROOT, maxBuffer: 512 * 1024 * 1024,
  }).toString();
  const chunks = out.split('COMMIT\u0000');
  const entries = [];
  for (const c of chunks) {
    if (!c) continue;
    const nl = c.indexOf('\n');
    const sha = (nl < 0 ? c : c.slice(0, nl)).trim();
    const body = nl < 0 ? '' : c.slice(nl + 1);
    if (!sha || BINARY.test(body)) continue;
    entries.push([`commit ${sha}`, body]);
  }
  return entries;
}

export function collectEntries(scope) {
  return scope === 'history' ? historyEntries() : scope === 'staged' ? stagedEntries() : treeEntries();
}

function main() {
  const needValues = !NO_PROFILE;
  const values = needValues ? collectPrivateValues() : null;
  if (needValues && !values) {
    const hasPrivateDir = existsSync(join(ROOT, 'private'));
    if (hasPrivateDir) {
      // 本该有档案却没有 → 拒绝放行。这是防"改名/误删掉档案让守卫静默失效"。
      // 不提供 --allow-missing-profile 这类逃生门（2026-09-23 删）：零调用方，
      // 而它就是"让守卫失效"本身。要临时跳过就显式改用 --patterns，那会留下可见痕迹。
      console.error('check-private-leak: 拒绝放行 —— private/ 目录在，但读不出 profile.json。');
      console.error('  这是**失败关闭**，不是错误：档案本该在这里，读不出来就得先查清楚。');
      console.error('  查因：private/profile.json 是否被改名/删掉/写成坏 JSON？');
      console.error('  确认只是本机缺档案、要继续，请显式用 --patterns（只跑模式判据，覆盖面更小）。');
      process.exit(1);
    }
    // private/ 根本不存在（新克隆 / 贡献者机器）→ 降级为模式判据，但把话说明白。
    console.error('check-private-leak: 本 checkout 没有 private/（新克隆或贡献者机器）——');
    console.error('  按档案值逐条比对做不了，降级为模式判据（本机路径 / 手机号 / 身份证号）。');
    console.error('  这只覆盖三类可模式化的数据；**你自己有档案时请在本机主 checkout 下提交**。');
  }

  let entries;
  try {
    entries = collectEntries(SCOPE);
  } catch (e) {
    console.error(`check-private-leak: 取数失败（git 命令出错）: ${String(e.message).slice(0, 200)}`);
    process.exit(1);
  }

  const leaks = scanTexts(entries, values);
  if (SCOPE === 'tree' || SCOPE === 'staged') {
    for (const p of trackedPrivatePaths()) {
      leaks.push({ kind: 'private/被跟踪', val: p, keys: '', where: 'git ls-files' });
    }
  }

  const scope = SCOPE === 'history' ? `${entries.length} 个提交的 patch`
    : SCOPE === 'staged' ? `${entries.length} 个暂存文件`
      : `${entries.length} 个已跟踪文件`;
  const judge = values ? `${values.size} 个档案值 + ${PATTERNS.length} 类模式` : `${PATTERNS.length} 类模式（无档案）`;
  const tag = `${SCOPE}${NO_PROFILE ? '/patterns' : ''}`;

  if (leaks.length === 0) {
    console.log(`check-private-leak[${tag}]: 干净（${judge} × ${scope}）。`);
    return 0;
  }

  console.error(`check-private-leak[${tag}]: 发现 ${leaks.length} 处泄漏，禁止继续：`);
  for (const l of leaks) console.error(`  [${l.kind}] ${JSON.stringify(l.val)}  ← ${l.where}${l.keys ? '  (' + l.keys + ')' : ''}`);
  if (SCOPE === 'history') {
    console.error('');
    console.error('  历史里的值**删不掉**：重写历史 + force push 也不管用，GitHub 仍按旧 SHA 提供对象。');
    console.error('  彻底处理只有删库重建；否则请把这几条当成已公开处理。');
  }
  if (SCOPE === 'staged') {
    console.error('');
    console.error('  这是 pre-commit 钩子拦下的。修法：把真值换成泛称/示例值，重新 git add。');
    console.error('  禁止用 --no-verify 绕过（AGENTS §一）。');
  }
  return 1;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) process.exit(main());
