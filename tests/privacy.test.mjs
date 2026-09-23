// 隐私守卫的纯函数单测。
//
// 这里只测判据本身（模式匹配 + 扫描合并）。取数层（git ls-files / git show :path /
// git log -p）是真 git 调用，不在这里假装覆盖 —— 它们由三条命令各自的真实运行验证，
// 见 AGENTS §一 的三层闸门。
//
// ★ 本文件里**不许出现字面量样本号码/真值**：样本一律用 parts.join('') 在运行时拼。
// 原因有两条，都不是洁癖：
//   1. 守卫要扫这个文件（它不再把自己排除在外），字面量会被自己的规则拦下；
//   2. 更重要的：写这版测试时我一次连续抄进了三样真东西 —— 真实学号（当"12 位数字样本"）、
//      真实爱好（当"多词值"）、真实本机路径（当"绝对路径样本"）。三个都是 pre-commit
//      钩子挡下来的，不是我发现的。拼接这个动作强制人先想一下"这串到底是编的还是真的"。
// 别为了可读性把 parts 改回字面量 —— 那正是事故的入口。
const fake = (...parts) => parts.join('');

// 示例号码族（都是编的，且刻意与任何真实号码不同段）
const PH_OK = fake('138', '1234', '5678');       // 形态合法、内容虚构
const PH_NEAR = fake('138', '0000', '9999');     // 与白名单里的 13800000000 同段，用来验证"白名单不按前缀放行"
const PH_NEAR2 = fake('138', '0000', '0001');
const ID_OK = fake('110105', '19491231', '002', 'X'); // 国标示例号段（1949-12-31 是示例生日）
const ID_19 = fake('110105', '19491231', '0021', '1'); // 19 位，边界外，不该命中
const NUM12 = fake('1234', '5678', '9012');      // 12 位普通数字：不能被当成手机号
const PATH_ROOT = fake('/', 'Users', '/');        // 本机路径前缀也拼接，理由同上
const USERDIR = fake('some', 'one', '/Documents');

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanTexts, collectPrivateValues, PATTERNS, ALLOW_PATTERN } from '../scripts/check-private-leak.mjs';

const kinds = (leaks) => new Set(leaks.map((l) => l.kind));

test('模式判据：抓手机号', () => {
  assert.ok(kinds(scanTexts([['x.md', `联系电话 ${PH_OK} 请拨打`]], null)).has('手机号'));
});

test('模式判据：11 位号码前后粘着别的数字时不算手机号（12 位学号不能误命中）', () => {
  assert.equal(scanTexts([['x.md', `学号 ${NUM12} 已登记`]], null).length, 0);
  assert.equal(scanTexts([['x.md', `流水号 9${PH_OK} 与 ${PH_OK}9`]], null).length, 0);
});

test('模式判据：抓本机绝对路径，但不抓占位写法 /Users/<用户名>', () => {
  assert.ok(kinds(scanTexts([['x.md', `路径 ${PATH_ROOT}${USERDIR}`]], null)).has('绝对路径'));
  assert.equal(scanTexts([['x.md', `路径 ${PATH_ROOT}<用户名>/Documents`]], null).length, 0);
});

test('模式判据：抓 18 位身份证号', () => {
  assert.ok(kinds(scanTexts([['x.md', `证件号 ${ID_OK}`]], null)).has('身份证号'));
  assert.equal(scanTexts([['x.md', `编号 ${ID_19}`]], null).length, 0);
});

test('同一个值出现多次只报一次', () => {
  const leaks = scanTexts([['x.md', `${PH_OK} 和 ${PH_OK}`]], null);
  assert.equal(leaks.filter((l) => l.kind === '手机号').length, 1);
});

test('档案值判据：整值命中要报，并带上来源字段名', () => {
  const values = new Map([['示例值甲', new Set(['education[0].programType'])]]);
  const leaks = scanTexts([['AGENTS.md', '这里写了示例值甲']], values);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].kind, '档案值');
  assert.equal(leaks[0].keys, 'education[0].programType');
  assert.equal(leaks[0].where, 'AGENTS.md');
});

test('档案值判据：前缀子串是已知盲区，不报（逐词比对会误伤通用词）', () => {
  const values = new Map([['示例爱好甲、示例爱好乙、示例爱好丙', new Set(['hobbies'])]]);
  assert.equal(scanTexts([['x.md', '爱好是示例爱好甲、示例爱好乙']], values).length, 0);
});

test('两个判据同时命中时各报一条，不互相吞掉', () => {
  const values = new Map([[PH_OK, new Set(['basic.phone'])]]);
  const leaks = scanTexts([['x.md', `档案手机 ${PH_OK}`]], values);
  assert.deepEqual([...kinds(leaks)].sort(), ['手机号', '档案值'].sort());
});

test('没有档案时（values=null）只跑模式判据，不崩', () => {
  assert.equal(scanTexts([['x.md', '干净文本']], null).length, 0);
});

test('PATTERNS 每条都写了理由（白名单/判据最容易被人顺手放宽）', () => {
  for (const p of PATTERNS) assert.ok(p.why && p.why.length > 4, `${p.kind} 缺 why`);
});

test('ALLOW_PATTERN：每条都有理由，且条数有上界 —— 一涨就说明有人在拿白名单消音', () => {
  assert.ok(ALLOW_PATTERN.size <= 10, `白名单已 ${ALLOW_PATTERN.size} 条，超上界就得先说明理由`);
  for (const [val, why] of ALLOW_PATTERN) {
    assert.ok(why && why.length >= 10, `${val} 的理由太短，等于没有理由`);
    assert.ok(/占位|示例|全 0/.test(why), `${val} 的理由必须说明它为什么不是真实数据`);
  }
});

test('ALLOW_PATTERN 只对**精确值**生效，不做前缀/段匹配', () => {
  assert.equal(scanTexts([['x.md', `联系 ${PH_NEAR}`]], null).length, 1);
  assert.equal(scanTexts([['x.md', `联系 ${PH_NEAR2}`]], null).length, 1);
});

test('collectPrivateValues：没有 private/ 时返回 null（由调用方决定失败关闭）', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const empty = mkdtempSync(`${tmpdir()}/fp-nopriv-`);
  assert.equal(collectPrivateValues(empty), null);
});

test('本文件自身不含任何字面量号码（拼接纪律的回归）', async () => {
  const { readFileSync } = await import('node:fs');
  const self = readFileSync(new URL(import.meta.url), 'utf8');
  assert.equal(scanTexts([['tests/privacy.test.mjs', self]], null).length, 0);
});

// ── 守卫的守卫：钩子本身是最容易被"顺手改坏"的地方 ──────────────────────────
// 这两条都是实测踩出来的，不是预防性臆想：
//   ① 第一版钩子按 `-f private/profile.json` 判断，档案一改名就悄悄退到弱判据，
//      严格模式永远没机会跑 —— 在临时克隆里提交被放行才发现的。
//   ② 钩子的可执行位丢了 git 不会报错，它只是**不再运行** —— 最安静的失效形态。

const HOOKS = ['pre-commit', 'pre-push'];

test('钩子文件存在且带可执行位（丢了 git 不报错，只是静默不跑）', async () => {
  const { statSync, existsSync } = await import('node:fs');
  for (const h of HOOKS) {
    const p = new URL(`../.githooks/${h}`, import.meta.url);
    assert.ok(existsSync(p), `缺 .githooks/${h}`);
    assert.ok((statSync(p).mode & 0o111) !== 0, `.githooks/${h} 没有可执行位`);
  }
});

test('pre-commit 按 private/ **目录**判断，不是按 profile.json 文件', async () => {
  const { readFileSync } = await import('node:fs');
  const sh = readFileSync(new URL('../.githooks/pre-commit', import.meta.url), 'utf8');
  assert.match(sh, /\[\s+-d private\s+\]/, '缺少 `[ -d private ]` 分支');
  assert.ok(!/\[\s+-f private\/profile\.json\s+\]/.test(sh),
    '按 profile.json 文件判断会让"档案被改名"静默退到弱判据，等于废掉失败关闭');
});

test('pre-commit 无档案时走 --staged --patterns（否则新克隆一个提交都做不了）', async () => {
  const { readFileSync } = await import('node:fs');
  const sh = readFileSync(new URL('../.githooks/pre-commit', import.meta.url), 'utf8');
  assert.match(sh, /--staged --patterns/);
});
