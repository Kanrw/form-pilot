// 个人档案的读写、导入、渲染与守卫（node:test）。
//
// 覆盖范围限定在"输入固定时行为可确定"的部分。端口绑定与真实浏览器时序不进这里 ——
// 它们脆弱且复现差，进 tests/manual-e2e.md 人工过。
//
// 带 ★ 的几条各自对应一个真实会踩的失败，不是凑覆盖率。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCORED, SECTIONS, emptyValues, exportSchema, validateOverrides, validateValues } from '../tools/profile.schema.mjs';
import {
  assertInsidePrivate,
  assertVersionName,
  buildMapping,
  expandRangeToDay,
  importMarkdown,
  listVersions,
  readValues,
  readVersion,
  resolvePaths,
  resolveValues,
  serialize,
  summarize,
  versionFile,
  writeText,
  writeValues,
  writeVersion,
} from '../tools/profile-io.mjs';
import { createContext, route } from '../scripts/profile.mjs';
import { loadProfileEditor, makeDom } from './helpers/jsdom-setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = { host: '127.0.0.1:8787' };

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'form-pilot-profile-'));
}

function ctxFor(root) {
  return createContext({ root, toolsDir: join(ROOT, 'tools') });
}

function seededRoot() {
  const root = tempRoot();
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.name'] = '示例';
  values['basic.phone'] = '13800000000';
  values['intent.targetRole'] = '基准岗位';
  writeValues(paths, values);
  return { root, paths };
}

// ── 映射表 ──────────────────────────────────────────────────────────────────

test('映射表必须排除 never 字段', () => {
  const root = tempRoot();
  const values = emptyValues();
  values['basic.name'] = '沈砚清';
  values['basic.idNumber'] = '110101199001011234';

  const md = buildMapping(values, resolvePaths(root));
  assert.ok(md.includes('沈砚清'), 'auto 字段应出现在映射表里');
  // ★ 证件号码的值一旦出现在这里，就会被贴进对话、再去填表 —— 引擎不收这类值。
  assert.ok(!md.includes('110101199001011234'), 'never 字段的值绝不能出现在映射表里');

  // 「待你手动」这一段本来就该点名"证件号码"—— 那是告诉用户这一项要自己填。
  // 但它绝不能出现在任何一张"字段 → 值"表里。
  const tables = md.split('## 待你手动')[0];
  assert.ok(!tables.includes('证件号码'), 'never 字段不能出现在映射表的值表里');
  assert.ok(md.split('## 待你手动')[1].includes('证件号码'), '待你手动清单要点名它');
});

// ── markdown 导入 ───────────────────────────────────────────────────────────

test('导入 docs/profile-template.md：字段位无遗漏、占位文本不成值、空段被丢弃', () => {
  const template = readFileSync(join(ROOT, 'docs/profile-template.md'), 'utf8');
  const { values, notes, missing } = importMarkdown(template);

  // ★ schema 加了字段却忘了同步模板，或模板改了字段名 —— 这条就是那个报警器。
  assert.deepEqual(missing, [], 'schema 里每个字段都该能在模板里找到');
  assert.deepEqual(notes, [], '模板与 schema 之间不该有对不上的标签或区段标题');

  assert.equal(values['basic.idType'], '身份证', '单选项的默认值应保留');
  assert.equal(values['basic.birthDate'], '', 'YYYY-MM-DD 是模板的指导文字，不是值');
  assert.equal(values['basic.phone'], '');
  assert.equal(values['education'].length, 0, '模板里的空示例段不该变成一条真实经历');
  assert.equal(values['experience'].length, 0);
  assert.equal(values['basic.idType'], '身份证', '单选项的默认值应保留');
  assert.equal(values['answers'].length, 3, '长文本区段按问答对导入');
  assert.equal(values['answers'][0].question, '自我介绍（300 字内）');
});

test('导入手写的 md：值落位到正确的段', () => {
  const md = [
    '## 1. 基本信息',
    '- 姓名：沈砚清',
    '- 手机号码：13800044712',
    '- 出生日期：YYYY-MM-DD（用于"出生日期(年龄)"类字段）',
    '',
    '## 2. 教育经历',
    '### [0] 最高学历',
    '- 学校名称：同济大学',
    '- 就读时间：2019-09 -- 2023-06',
    '- 受教育类型：全日制 / 非全日制',
    '### [1] 第二学历',
    '- 学校名称：华中科技大学',
  ].join('\n');

  const { values } = importMarkdown(md);
  assert.equal(values['basic.name'], '沈砚清');
  assert.equal(values['basic.phone'], '13800044712');
  assert.equal(values['basic.birthDate'], '', '带 YYYY 的指导文字不成值');
  assert.equal(values['education'].length, 2);
  assert.equal(values['education'][0].school, '同济大学');
  assert.equal(values['education'][0].period, '2019-09-01 -- 2023-06-30', '区间补到日');
  assert.equal(values['education'][0].studyType, '', '「全日制 / 非全日制」是选项说明，不是选择结果');
  assert.equal(values['education'][1].school, '华中科技大学');
});

// ── 日期写法 ────────────────────────────────────────────────────────────────

test('日期：导入归一化并补到日，补了什么要说出来', () => {
  const md = [
    '## 1. 基本信息',
    '- 出生日期：2000.02',
    '## 2. 教育经历',
    '### [0] 最高学历',
    '- 就读时间：2019.09 - 2023.06',
    '### [1] 第二段',
    '- 就读时间：2023.09 — 至今',
  ].join('\n');
  const { values, assumedDates } = importMarkdown(md);

  assert.equal(values['basic.birthDate'], '2000-02', '单独日期只归一化，不擅自补日');
  // ★ 表单的日期是"年 → 月 → 日"三级选择：档案里存到日，填表时就不用每处现场补一个日子。
  assert.equal(values.education[0].period, '2019-09-01 -- 2023-06-30', '开始补月初、结束补月末');
  assert.equal(values.education[1].period, '2018-09-01 -- 至今');
  assert.equal(assumedDates.length, 2, '补了哪几处必须报出来，不能冒充事实');
  assert.ok(assumedDates[0].includes('开始补日'));
  assert.deepEqual(validateValues(values).errors, []);
});

test('日期区间：只有年份时不能被切出多余的短横线', () => {
  // ★ 左半边原来用允许尾随分隔符的贪婪写法，`2021 -- 2025` 被切成 `2021 -` + `-` + `2025`，
  //   存成 `2021 - -- 2025`，然后校验必然报错 —— 是解析器的 bug，不是数据的写法问题。
  const md = [
    '## 2. 教育经历',
    '### [0]',
    '- 就读时间：2021 -- 2025',
    '### [1]',
    '- 就读时间：2021 - 2025',
    '### [2]',
    '- 就读时间：2021年9月 - 2025年6月',
  ].join('\n');
  const { values } = importMarkdown(md);

  assert.equal(values.education[0].period, '2021-01-01 -- 2025-12-31', '只给年份：年初到年末');
  assert.equal(values.education[1].period, '2021-01-01 -- 2025-12-31');
  assert.equal(values.education[2].period, '2021-09-01 -- 2025-06-30');
  assert.deepEqual(validateValues(values).errors, []);
});

// ── 值里的批注 ──────────────────────────────────────────────────────────────

test('值里带批注 → warn，不阻断', () => {
  const values = emptyValues();
  values['basic.nationality'] = '中国（由"共青团员 + <示例大学>"推断，**待你确认**）';

  const { errors, warnings } = validateValues(values);
  // 批注不是格式错：拦下来会让人没法保存，但它必须被说出来，
  // 否则这串字会跟着表单提交出去 —— 这是最难被发现的一类错。
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.key === 'basic.nationality' && /批注/.test(w.message)));
});

// ── 标签写法 ────────────────────────────────────────────────────────────────

test('标签的别写法与 markdown 强调都能对上', () => {
  const md = [
    '## 1. 基本信息',
    '**微信号**：demo-account',
    '## 2. 教育经历',
    '### [0] 最高学历',
    '- GPA / 排名：3.7 / 12',
  ].join('\n');
  const { values, notes } = importMarkdown(md);

  // ★ 用户自己那份档案的写法与 schema 不同名 → 名字对不上就等于静默丢字段。
  assert.equal(values['basic.wechat'], 'demo-account', '别名 微信号 → 微信');
  assert.equal(values.education[0].gpa, '3.7 / 12', '别名 GPA / 排名 → GPA / 成绩排名');
  assert.deepEqual(notes, [], '`**标签**：` 这种没有短横线的写法也要认，且不该报"找不到字段"');
});

test('补日约定：月初与月末，闰月也要对', () => {
  assert.equal(expandRangeToDay('2023-09 -- 2027-06').text, '2023-09-01 -- 2027-06-30');
  assert.equal(expandRangeToDay('2019-02 -- 2020-02').text, '2019-02-01 -- 2020-02-29', '闰年二月是 29 日');
  assert.equal(expandRangeToDay('2024 -- 2025').text, '2024-01-01 -- 2025-12-31');
  assert.equal(expandRangeToDay('2023-09 -- 至今').text, '2018-09-01 -- 至今');
  // 已经到日的值不能被改动 —— 补日只补缺的精度，不重写已知事实
  assert.deepEqual(expandRangeToDay('2022-09-02 -- 2026-06-30'), { text: '2022-09-02 -- 2026-06-30', assumed: [] });
});

// ── 校验 ────────────────────────────────────────────────────────────────────


test('校验严重级：格式错是 error，留空只给 warn，且消息不回显值', () => {
  const values = emptyValues();

  const blank = validateValues(values);
  assert.equal(blank.errors.length, 0, '★ 空档案不能报错 —— 留空比猜值安全，是文档写死的口径');
  assert.ok(blank.warnings.some((w) => w.label.includes('姓名')), '建议填的字段为空只给 warn');

  values['basic.phone'] = '1380013';
  values['basic.email'] = 'nope';
  values.education.push({ period: '2023/09-2027/06' });
  const bad = validateValues(values);
  assert.equal(bad.errors.length, 3, '手机号 / 邮箱 / 时间区间各一条');
  assert.ok(bad.errors.every((e) => e.level === 'error'));

  // ★ stdout 可能被贴进对话：校验消息里出现字段值，等于把档案带出 private/。
  const blob = JSON.stringify([bad.errors, bad.warnings]);
  assert.ok(!blob.includes('1380013'), '错误消息不得回显手机号');
  assert.ok(!blob.includes('nope'), '错误消息不得回显邮箱');
  assert.ok(!blob.includes('2023/09-2027/06'), '错误消息不得回显时间');
});

// ── 序列化 ──────────────────────────────────────────────────────────────────

test('键序稳定且等于 schema 顺序', () => {
  const values = emptyValues();
  values.education.push({ school: 'A' }, { school: 'B', period: '2019-09 -- 2023-06' });

  const parsed = JSON.parse(serialize(values));
  const keys = Object.keys(parsed.values);
  assert.equal(keys[0], 'basic.name', '固定区段的键按 schema 顺序排');
  const basicKeys = SECTIONS.find((x) => x.key === 'basic').fields.map((x) => `basic.${x.key}`);
  assert.deepEqual(keys.slice(0, basicKeys.length), basicKeys, '固定区段按 schema 顺序铺开');
  assert.ok(keys.indexOf('education') > keys.indexOf(basicKeys[basicKeys.length - 1]), '区段顺序 = schema 顺序');
  assert.deepEqual(parsed.values.education.map((i) => i.school), ['A', 'B']);
  const eduKeys = SECTIONS.find((x) => x.key === 'education').fields.map((x) => x.key);
  assert.deepEqual(Object.keys(parsed.values.education[0]), eduKeys, '段内键序 = schema 字段顺序');
});

test('读→写幂等，且第二次写入留下备份', () => {
  const root = tempRoot();
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.name'] = '沈砚清';
  values.education.push({ school: '同济大学' });

  writeValues(paths, values);
  const first = readFileSync(paths.profilePath, 'utf8');
  assert.ok(!existsSync(paths.backupPath), '首次创建没有旧文件可备份');

  const read = readValues(paths);
  writeValues(paths, read.values, { unknownKeys: read.unknownKeys });
  const second = readFileSync(paths.profilePath, 'utf8');

  // ★ 不幂等 → 每次保存都整片 diff，验收里"只动改过的那几行"直接失效。
  assert.equal(second, first, '读→写必须幂等');
  assert.ok(existsSync(paths.backupPath), '覆盖已有文件前必须备份');
});

test('schema 不认识的键被保留', () => {
  const root = tempRoot();
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.name'] = '沈砚清';
  writeValues(paths, values, { unknownKeys: { 'legacy.oldField': 'keep-me' } });

  const read = readValues(paths);
  assert.deepEqual(read.unknownKeys, { 'legacy.oldField': 'keep-me' });
  writeValues(paths, read.values, { unknownKeys: read.unknownKeys });
  assert.equal(JSON.parse(readFileSync(paths.profilePath, 'utf8')).values['legacy.oldField'], 'keep-me');
});

// ── 路径守卫 ────────────────────────────────────────────────────────────────

test('写入路径必须落在 private/ 内', () => {
  const root = tempRoot();
  const paths = resolvePaths(root);

  // ★ 个人数据写到仓库里 = 泄露，这条是代码层的隐私边界。
  assert.throws(() => assertInsidePrivate(join(root, 'profile.json'), paths), /拒绝写入/);
  assert.throws(() => writeText(paths, join(root, 'docs/leak.md'), 'x'), /拒绝写入/);
  assert.throws(() => writeText(paths, join(root, '..', 'leak.md'), 'x'), /拒绝写入/);

  const ok = writeText(paths, join(paths.privateDir, 'mapping.md'), '# ok');
  assert.ok(existsSync(ok));
});

// ── HTTP 契约 ───────────────────────────────────────────────────────────────

test('Host 头不是回环一律 403', async () => {
  const ctx = ctxFor(tempRoot());
  // ★ DNS rebinding：本机任一网页把域名指到 127.0.0.1 就能读写这份档案。
  for (const host of ['evil.example:8787', '192.168.31.7:8787', '', undefined]) {
    const res = await route({ method: 'GET', url: '/api/profile', headers: { host }, body: '' }, ctx);
    assert.equal(res.status, 403, `Host=${host} 应被拒`);
  }
  const ok = await route({ method: 'GET', url: '/api/profile', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(ok.status, 200);
});

test('静态资源走白名单，穿越路径取不到 private/', async () => {
  const ctx = ctxFor(tempRoot());
  const html = await route({ method: 'GET', url: '/', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(html.status, 200);
  assert.ok(String(html.body).includes('profile-editor'));

  const css = await route({ method: 'GET', url: '/tools/profile-editor.css', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(css.status, 200);

  const evil = await route({ method: 'GET', url: '/tools/../private/profile.json', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(evil.status, 404);
  const other = await route({ method: 'GET', url: '/tools/profile.schema.mjs', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(other.status, 404, '白名单外的一律 404');
});

test('PUT 有格式错误时拒绝保存，且不落盘', async () => {
  const root = tempRoot();
  const ctx = ctxFor(root);
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.phone'] = '123';

  const rejected = await route({ method: 'PUT', url: '/api/profile', headers: LOOPBACK, body: JSON.stringify({ values }) }, ctx);
  assert.equal(rejected.status, 400);
  assert.equal(JSON.parse(rejected.body).ok, false);
  assert.ok(JSON.parse(rejected.body).errors.length > 0);
  // ★ 错值一旦进档案，就会跟着表单提交出去。
  assert.ok(!existsSync(paths.profilePath), '有格式错误时不得写文件');

  values['basic.phone'] = '13800044712';
  const accepted = await route({ method: 'PUT', url: '/api/profile', headers: LOOPBACK, body: JSON.stringify({ values }) }, ctx);
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(accepted.body).ok, true);
  assert.ok(existsSync(paths.profilePath));
  assert.ok(JSON.parse(accepted.body).stats.manual.some((m) => m.label.includes('证件号码')), '待你手动清单应含证件号码');
});

test('GET /api/mapping 也不含 never 字段', async () => {
  const root = tempRoot();
  const ctx = ctxFor(root);
  const paths = resolvePaths(root);
  const values = emptyValues();
  values['basic.idNumber'] = '110101199001011234';
  writeValues(paths, values);

  const res = await route({ method: 'GET', url: '/api/mapping', headers: LOOPBACK, body: '' }, ctx);
  assert.equal(res.status, 200);
  assert.ok(!String(res.body).includes('110101199001011234'));
});

test('POST /api/import 在已有内容时先回 409，带 force 才覆盖', async () => {
  const root = tempRoot();
  const ctx = ctxFor(root);
  const paths = resolvePaths(root);

  // 先造一份 legacy markdown（用公开模板，不含真实个人信息）
  writeText(paths, paths.legacyMd, readFileSync(join(ROOT, 'docs/profile-template.md'), 'utf8'));

  const first = await route({ method: 'POST', url: '/api/import', headers: LOOPBACK, body: '{}' }, ctx);
  assert.equal(first.status, 200);
  assert.ok(JSON.parse(first.body).matchedFields > 30);

  const values = readValues(paths).values;
  values['basic.name'] = '沈砚清';
  writeValues(paths, values);

  const guarded = await route({ method: 'POST', url: '/api/import', headers: LOOPBACK, body: '{}' }, ctx);
  assert.equal(guarded.status, 409, '★ 有内容时不许静默覆盖');

  const forced = await route({ method: 'POST', url: '/api/import', headers: LOOPBACK, body: JSON.stringify({ force: true }) }, ctx);
  assert.equal(forced.status, 200);
  assert.ok(existsSync(paths.backupPath));
});

// ── 投放版本 ────────────────────────────────────────────────────────────────

test('投放版本：只存差异，通用事实永远来自基准', () => {
  const { paths } = seededRoot();
  writeVersion(paths, '半导体岗', { 'intent.targetRole': '模型研发工程师' });

  const r = resolveValues(paths, '半导体岗');
  assert.equal(r.values['intent.targetRole'], '模型研发工程师', '覆盖优先');
  assert.equal(r.values['basic.phone'], '13800000000', '通用事实来自基准');
  assert.equal(Object.keys(r.overrides).length, 1);
  assert.deepEqual(listVersions(paths).map((v) => `${v.name}:${v.count}`), ['半导体岗:1']);
});

test('投放版本：白名单外的键不许进版本文件', () => {
  const { paths } = seededRoot();

  // ★ 放开覆盖 = "我改了手机号"其实只改了某个版本，下次投别的岗位才发现，而且是静默的。
  assert.equal(validateOverrides({ 'basic.phone': '1' }).length, 1);
  assert.equal(validateOverrides({ 'intent.targetRole': 'x' }).length, 0);
  // 落盘时也要挡住：静默丢弃会让调用方以为存进去了
  assert.throws(() => writeVersion(paths, '脏版本', { 'basic.phone': '999' }), /不允许覆盖/);
  assert.ok(!existsSync(versionFile(paths, '脏版本')));
});

test('投放版本：版本名不合法直接拒绝', () => {
  assert.throws(() => assertVersionName('../逃逸'), /不合法/);
  assert.throws(() => assertVersionName('a/b'), /不合法/);
  assert.throws(() => assertVersionName(''), /不能为空/);
  assert.throws(() => assertVersionName(' 前后空格 '), /空白/);
  assert.equal(assertVersionName('半导体岗-2027'), '半导体岗-2027');
});

test('PUT ?version= 只写版本文件，基准一个字节都不动', async () => {
  const { root, paths } = seededRoot();
  const ctx = ctxFor(root);
  const baseBefore = readFileSync(paths.profilePath, 'utf8');
  writeVersion(paths, '半导体岗', {});

  const res = await route({
    method: 'PUT',
    url: '/api/profile?version=半导体岗',
    headers: LOOPBACK,
    body: JSON.stringify({ overrides: { 'intent.targetRole': '模型研发工程师' } }),
  }, ctx);

  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).version, '半导体岗');
  assert.equal(readFileSync(paths.profilePath, 'utf8'), baseBefore, '基准文件不该被动过');
  assert.equal(readVersion(paths, '半导体岗').overrides['intent.targetRole'], '模型研发工程师');
});

test('PUT ?version= 带白名单外的键 → 400 且不落盘', async () => {
  const { root, paths } = seededRoot();
  const ctx = ctxFor(root);
  writeVersion(paths, '半导体岗', {});

  const res = await route({
    method: 'PUT',
    url: '/api/profile?version=半导体岗',
    headers: LOOPBACK,
    body: JSON.stringify({ overrides: { 'basic.phone': '19900000000' } }),
  }, ctx);
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.body).errors.length > 0);
  assert.equal(Object.keys(readVersion(paths, '半导体岗').overrides).length, 0);
});

test('POST /api/versions：新建为空、复制逐字复制、重名 409', async () => {
  const { root, paths } = seededRoot();
  const ctx = ctxFor(root);
  writeVersion(paths, '半导体岗', { 'intent.targetRole': '模型研发工程师', 'intent.targetCities': '<示例城市>' });

  const created = await route({ method: 'POST', url: '/api/versions', headers: LOOPBACK, body: JSON.stringify({ name: '学术岗' }) }, ctx);
  assert.equal(created.status, 200);
  assert.equal(JSON.parse(created.body).overrides, 0, '从基准新建 = 空覆盖集');

  const copied = await route({ method: 'POST', url: '/api/versions', headers: LOOPBACK, body: JSON.stringify({ name: '半导体岗-深圳', from: '半导体岗' }) }, ctx);
  assert.equal(copied.status, 200);
  assert.equal(JSON.parse(copied.body).overrides, 2, '复制 = 逐字带走覆盖集');
  assert.deepEqual(readVersion(paths, '半导体岗-深圳').overrides, readVersion(paths, '半导体岗').overrides);

  const dup = await route({ method: 'POST', url: '/api/versions', headers: LOOPBACK, body: JSON.stringify({ name: '学术岗' }) }, ctx);
  assert.equal(dup.status, 409);
});

test('POST 的请求体要被读到（新建版本走的就是这条）', async () => {
  const { root } = seededRoot();
  const ctx = ctxFor(root);
  // ★ 曾经只给 PUT 读体，POST 永远拿到空对象 → 界面「新建版本」直接报"版本名不能为空"
  const res = await route({ method: 'POST', url: '/api/versions', headers: LOOPBACK, body: JSON.stringify({ name: '学术岗' }) }, ctx);
  assert.equal(res.status, 200, JSON.stringify(JSON.parse(res.body)));
  assert.equal(JSON.parse(res.body).name, '学术岗');
});

test('GET /api/profile?version= 返回合并后的值', async () => {
  const { root, paths } = seededRoot();
  const ctx = ctxFor(root);
  writeVersion(paths, '半导体岗', { 'intent.targetRole': '模型研发工程师' });

  const res = await route({ method: 'GET', url: '/api/profile?version=半导体岗', headers: LOOPBACK, body: '' }, ctx);
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(body.version, '半导体岗');
  assert.equal(body.values['intent.targetRole'], '模型研发工程师');
  assert.equal(body.values['basic.phone'], '13800000000');
  assert.equal(body.versions.length, 1);

  const base = JSON.parse((await route({ method: 'GET', url: '/api/profile', headers: LOOPBACK, body: '' }, ctx)).body);
  assert.equal(base.version, null, '不带 version 时是基准');
  assert.equal(base.values['intent.targetRole'], '基准岗位');
});

// ── 界面渲染 ────────────────────────────────────────────────────────────────

function editorFixture() {
  const dom = makeDom('<!DOCTYPE html><html><body><div id="main"></div><div id="rail"></div><div id="aside"></div></body></html>');
  const editor = loadProfileEditor(dom);
  const schema = JSON.parse(JSON.stringify(exportSchema()));
  const values = emptyValues();
  const build = (section, extra) => Object.assign({
    schema,
    values,
    stats: summarize(values),
    errors: {},
    warnings: {},
    pathChecks: [],
    section,
    onEdit() {},
    onLiveCheck() {},
    onAction() {},
  }, extra || {});
  const mount = (id) => dom.window.document.getElementById(id);
  return { dom, editor, schema, values, build, mount };
}

test('登记表：行数、分类标记、never 围栏与 schema 一致', () => {
  const f = editorFixture();
  const node = f.editor.renderSection(f.mount('main'), f.build('basic'));
  const section = f.schema.sections.find((s) => s.key === 'basic');
  const countOf = (autofill) => section.fields.filter((x) => x.autofill === autofill).length;

  // ★ 界面与服务端分类不同步时，用户会看到"可自动填"却在填表时没人填。
  assert.equal(node.querySelectorAll('.field-row').length, section.fields.length, '每个字段一行');
  assert.equal(node.querySelectorAll('.mark-auto').length, countOf('auto'));
  assert.equal(node.querySelectorAll('.mark-confirm').length, countOf('confirm'));
  assert.equal(node.querySelectorAll('.fence .field-row').length, countOf('never'), 'never 字段必须落在围栏里，而不是混在普通行里');
  assert.ok(node.querySelector('.fence').textContent.includes('引擎永不使用'));

  const rowKeys = Array.from(node.querySelectorAll('.field-row')).map((row) => row.dataset.rowkey);
  assert.ok(rowKeys.includes('basic.phone'), '行键必须与服务端校验结果的键一致');
  assert.ok(rowKeys.includes('basic.idNumber'));
});

test('版本视图：只有白名单字段可编辑，通用事实只读', () => {
  const f = editorFixture();
  f.values['basic.phone'] = '13800000000';
  const ctx = f.build('basic', { version: '半导体岗', overrides: {} });
  const node = f.editor.renderSection(f.mount('main'), ctx);

  // ★ 通用事实在版本视图里物理上改不动 —— 这条不做，"我改了手机号"就会变成
  //   "只改了某个版本的手机号"，下次投别的岗位才发现。
  const phone = node.querySelector('[data-rowkey="basic.phone"] input');
  assert.equal(phone.readOnly, true);
  assert.ok(node.querySelector('[data-rowkey="basic.phone"]').className.includes('is-locked'));
  assert.equal(node.querySelector('[data-rowkey="basic.gender"] select').disabled, true, 'select 只能 disabled');
});

test('版本视图：被覆盖的行有标记与还原入口，白名单字段仍可编辑', () => {
  const f = editorFixture();
  f.values['intent.targetRole'] = '模型研发工程师';
  const ctx = f.build('intent', { version: '半导体岗', overrides: { 'intent.targetRole': '模型研发工程师' } });
  const node = f.editor.renderSection(f.mount('main'), ctx);

  const hit = node.querySelector('[data-rowkey="intent.targetRole"]');
  assert.ok(hit.querySelector('.badge-override'), '被覆盖的行要标出来：这个值只在这个版本生效');
  assert.ok(hit.querySelector('.restore-btn'), '要能一条条还原');
  assert.equal(hit.querySelector('input').readOnly, false, '白名单字段仍可编辑');
  assert.ok(!node.querySelector('[data-rowkey="intent.targetCities"] .badge-override'), '没被覆盖的行不标');
});

test('日期区间用两个原生日期控件，不是自由文本', () => {
  const f = editorFixture();
  f.values.education.push({ period: '2023-09-01 -- 2027-06-30' });
  const node = f.editor.renderSection(f.mount('main'), f.build('education'));
  const row = node.querySelector('[data-rowkey="education[0].period"]');
  const pickers = row.querySelectorAll('input[type="date"]');

  // ★ 填表时这类字段多是"年→月→日"三级选择；档案里也该是选出来的值，而不是手打一行文本。
  assert.equal(pickers.length, 2, '起止各一个日期控件');
  assert.equal(pickers[0].value, '2023-09-01');
  assert.equal(pickers[1].value, '2027-06-30');

  // 只到月的旧值退化成文本框：日期控件会把不合规的值显示成空，一保存就静默清掉。
  f.values.education[0].period = '2023-09 -- 2027-06';
  const row2 = f.editor.renderSection(f.mount('main'), f.build('education')).querySelector('[data-rowkey="education[0].period"]');
  assert.equal(row2.querySelectorAll('input[type="date"]').length, 0);
  assert.equal(row2.querySelector('input').value, '2023-09 -- 2027-06');
});

test('登记表：日期字段回显 ISO 值，消歧义', () => {
  const f = editorFixture();
  f.values['basic.birthDate'] = '2001-01-01';
  const node = f.editor.renderSection(f.mount('main'), f.build('basic'));
  const row = node.querySelector('[data-rowkey="basic.birthDate"]');
  // ★ 原生日期控件按浏览器区域显示（这台机器上是 DD/MM/YYYY，即 10/02/2000），
  //   存的值始终是 ISO —— 不把 ISO 写出来，用户会按显示格式去读。
  assert.ok(row.querySelector('.field-msg').textContent.includes('2001-01-01'));
});

test('登记表：可重复区段按段渲染，空时给添加入口', () => {
  const f = editorFixture();
  const fieldCount = f.schema.sections.find((s) => s.key === 'education').fields.length;

  const empty = f.editor.renderSection(f.mount('main'), f.build('education'));
  assert.equal(empty.querySelectorAll('.segment').length, 0);
  assert.ok(empty.textContent.includes('添加一段'));

  f.values.education.push({ school: '同济大学' });
  f.values.education.push({ school: '华中科技大学' });
  const two = f.editor.renderSection(f.mount('main'), f.build('education'));
  assert.equal(two.querySelectorAll('.segment').length, 2);
  assert.equal(two.querySelectorAll('.field-row').length, fieldCount * 2);
  assert.ok(two.textContent.includes('第 2 段 / 共 2 段'));
});

test('分类与侧栏说明：日期区间是 auto，界面必须解释三个分类', () => {
  // ★ 分类描述的是"值需不需要人判断"，不是"控件难不难填"。
  //   日期区间曾因"表单日期三级选择难自动化"被标成 confirm，会让人以为每处日期都要再确认一遍。
  const dateRanges = SECTIONS.flatMap((s) => s.fields).filter((x) => x.type === 'daterange');
  assert.ok(dateRanges.length >= 3);
  assert.ok(dateRanges.every((x) => x.autofill === 'auto'), '日期精确到日后值唯一，不该要人逐项确认');

  const f = editorFixture();
  const aside = f.editor.renderAside(f.mount('aside'), Object.assign(f.build('basic'), { stats: summarize(f.values) }));
  const legend = aside.textContent;
  // ★ 用户问"需确认是什么意思、最后怎么确认" = 界面没写清楚。
  assert.ok(legend.includes('可自动填'), '要说明可自动填');
  assert.ok(legend.includes('需确认') && legend.includes('每项单独过'), '要说明需确认 + 必须逐项过');
  assert.ok(legend.includes('永不自动填') && legend.includes('不提供也不接受'), '要说明永不自动填');
  assert.ok(legend.includes('映射表') && legend.includes('助手'), '要说清最后在哪一步确认');
});

test('侧栏统计来自服务端 summarize，且分母排除 never', () => {
  const f = editorFixture();
  f.values['basic.name'] = '沈砚清';
  const stats = summarize(f.values);

  // 用 schema 现算期望值，避免把字段数抄进测试
  const expectedSlots = f.schema.sections.reduce((sum, section) => {
    const segments = section.repeatable ? (Array.isArray(f.values[section.key]) ? f.values[section.key].length : 0) : 1;
    return sum + segments * section.fields.filter((x) => SCORED.has(x.autofill)).length;
  }, 0);
  const basic = f.schema.sections.find((s) => s.key === 'basic');

  assert.equal(stats.slots, expectedSlots);
  assert.equal(stats.filled, 1, 'answers 预置的三个题目是 note，不该算成已填');
  assert.equal(stats.completeness, `${stats.filled}/${stats.slots}`);
  assert.equal(stats.perSection.basic.slots, basic.fields.filter((x) => SCORED.has(x.autofill)).length);
  assert.equal(stats.perSection.basic.neverSlots, basic.fields.filter((x) => x.autofill === 'never').length);
  assert.ok(stats.manual.some((m) => m.label.includes('证件号码')));

  const aside = f.editor.renderAside(f.mount('aside'), Object.assign(f.build('basic'), { stats }));
  assert.ok(aside.textContent.includes('分类统计'));
  assert.ok(aside.textContent.includes('待你手动'));
});
