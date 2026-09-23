// 黄金用例 —— 锁住"当前已验证的行为"，把锁从文档条款变成会红的测试。
//
// 这个文件的纪律与其它测试不同：
//   断言红 = 行为变更 = 规范变更。唯一正确的流程是先向人确认这次变更是否有意，
//   再改这份文件里的期望值。禁止为了让测试变绿而顺手改断言或放宽代码。
//   （对应 AGENTS.md §二：改规范必须过人，AI 不得自行决策。）
//
// 每条用例头部写清：锁的是什么契约、谁依赖它、原本为什么没被锁住。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emptyValues, OVERRIDABLE_KEYS } from '../tools/profile.schema.mjs';
import { buildMapping, resolvePaths } from '../tools/profile-io.mjs';
import { makeDom, loadEngine, readFixture, MOKA } from './helpers/jsdom-setup.mjs';

const HTML = readFixture(MOKA);
const byId = (x) => Object.fromEntries((Array.isArray(x) ? x : x.fields).map((f) => [f.id, f]));

const inputOf = (doc, label) => {
  const box = [...doc.querySelectorAll('.apply-field-eeeeeeee')].find((b) => (b.textContent || '').includes(label));
  return box ? box.querySelector('input') : null;
};

// ── fillTexts：吞值 → 重试 → 如实报告 ─────────────────────────────────────
//
// 契约（AGENTS.md "已验证的底层技法"第一条的另一半）：
//   写入后同步读值恒等于刚写的值 —— "被 React 吞掉"只能在 sleep 之后复核发现；
//   被吞的写入自动重试一次，重试失败绝不报成功。
// engine.js L440-469 这整段在 jsdom 里过去测不了（jsdom 不吞值），是零覆盖路径。
// 下面的 mock 用真实 React 的时序：input 事件后异步把 DOM 值恢复成旧 state。

test('黄金·fillTexts：写入被 React 吞掉后自动重试，值真实粘住，retried 如实上报', async () => {
  const dom = makeDom(HTML);
  const ja = loadEngine(dom);
  const inp = inputOf(dom.window.document, '推荐码');
  const seen = { input: 0, change: 0 };
  let writes = 0;
  inp.addEventListener('input', () => {
    seen.input++;
    if (writes++ === 0) setTimeout(() => { inp.value = ''; }, 0); // 首次写入被重渲染吞掉
  });
  inp.addEventListener('change', () => { seen.change++; });

  const r = JSON.parse(await ja.fillTexts({ 'main>>推荐码': 'REF-7' }));

  assert.deepEqual(r.retried, ['main>>推荐码'], '被吞的写入必须出现在 retried 里');
  assert.equal(r.ok, 1, '重试恢复后计入成功');
  assert.equal(r.failed.length, 0);
  const a = byId(JSON.parse(ja.readAll()));
  assert.equal(a['main>>推荐码'].value, 'REF-7', '重试后的值必须真实粘在 input 上');
  // native setter + input/change 事件契约：每次写入各发一次（首写 + 重试 = 各 2）
  assert.equal(seen.input, 2);
  assert.equal(seen.change, 2);
});

test('黄金·fillTexts：重试后仍被吞时报 verify 失败，绝不报成功', async () => {
  const dom = makeDom(HTML);
  const ja = loadEngine(dom);
  const inp = inputOf(dom.window.document, '推荐码');
  inp.addEventListener('input', () => { setTimeout(() => { inp.value = ''; }, 0); }); // 每次都吞

  const r = JSON.parse(await ja.fillTexts({ 'main>>推荐码': 'REF-7' }));

  // 与 fillDate 的 readonly-unverifiable、setChoice 的 not-checked 同一条纪律：
  // "看起来写了、实际存不住"的字段比明确失败危险得多 —— ok 计数里不许有它。
  assert.equal(r.ok, 0, '存不住的写入不许计入 ok');
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, 'main>>推荐码');
  assert.equal(r.failed[0].phase, 'verify', '失败发生在复核阶段，不是定位或写入');
  assert.equal(r.failed[0].err, 'value-not-stuck-after-retry');
  assert.equal(r.failed[0].attempted, 'REF-7', '失败报告带回尝试值');
  assert.equal(r.failed[0].final, '', 'final 是复读结果，被吞后必须是空');
  assert.deepEqual(r.retried, ['main>>推荐码'], '重试确实发生过了');
});

// ── 三分类映射：五类值在映射表里的位置穷举 ──────────────────────────────────
//
// 契约（AGENTS.md 隐私边界）："会进映射"的唯一表述是 AUTOFILL[...].inMap。
// 已有测试锁了 never 不出现（profile.test.mjs）；这里把五类字段的完整处置
// 固化成一张快照 —— 任何分类行为的改动（如 note 进值表、path 值进引擎）
// 都会在这里红，必须过人。

test('黄金·三分类映射：五类值各归其位，引擎映射只含 auto + confirm', () => {
  const root = mkdtempSync(join(tmpdir(), 'form-pilot-golden-'));
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.name'] = '自动值-A';              // auto
  values['intent.targetRole'] = '确认值-B';        // confirm，有值
  values['selfEvaluation.text'] = '确认值-C';      // confirm，有值
  values['answers'][0].scope = '附注值-D';         // note
  values['basic.idNumber'] = 'NEVER-VALUE-E';     // never（合成 token，非真实证件号）
  values['attachments'] = [{ purpose: '简历', file: '/tmp/resume-golden.pdf' }]; // note + path

  const md = buildMapping(values, paths);
  const engineTables = md.split('## 附件路径')[0]; // 引擎真正会收到的"字段 → 值"表

  assert.ok(engineTables.includes('自动值-A'), 'auto 值必须进引擎映射');
  assert.ok(engineTables.includes('确认值-B') && engineTables.includes('确认值-C'),
    'confirm 有值也进映射 —— 确认发生在对话闸门，不在映射层');
  assert.ok(!engineTables.includes('附注值-D'), 'note 值不进引擎映射');
  assert.ok(!engineTables.includes('/tmp/resume-golden.pdf'), 'path 值不进引擎映射（附件走桥上传，不经引擎）');
  assert.ok(!engineTables.includes('NEVER-VALUE-E'), 'never 值不进引擎映射');
  assert.ok(!md.includes('NEVER-VALUE-E'), 'never 值在整张映射表的任何位置都不出现');
  assert.ok(md.includes('附注值-D'), 'note 值只出现在附注段（标注"不进填表映射"）');
  assert.ok(md.split('## 附件路径')[1].includes('/tmp/resume-golden.pdf'), 'path 值只出现在附件路径段');

  const manual = md.split('## 待你手动')[1] || '';
  assert.ok(manual.includes('证件号码'), 'never 字段进待你手动清单');
  assert.ok(manual.includes('期望薪资'), 'confirm 无值也进待你手动清单');
});

// ── 投放版本白名单：内容快照 ────────────────────────────────────────────────
//
// 契约（AGENTS.md）："版本能覆盖什么由 OVERRIDABLE_KEYS 白名单卡死（当前 9 项）"。
// 已有测试锁了具体键被拒（basic.phone）；这里锁的是白名单的完整内容——
// AI 加新字段时顺手写 overridable: true，或删掉某个 overridable，
// 只有这条测试会红。红 = 规范变更 = 必须人批准，不许顺手同步这份列表。

test('黄金·投放版本白名单：恰好 9 项，内容快照', () => {
  assert.deepEqual([...OVERRIDABLE_KEYS].sort(), [
    'intent.availableFrom',
    'intent.expectedSalary',
    'intent.graduateStatus',
    'intent.targetCities',
    'intent.targetDirections',
    'intent.targetIndustries',
    'intent.targetRole',
    'intent.transferPreference',
    'selfEvaluation.text',
  ]);
});
