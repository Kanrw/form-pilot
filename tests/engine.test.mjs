// 引擎纯逻辑回归（jsdom）。
//
// 覆盖范围刻意限定在"DOM 形状固定时行为可确定"的部分：detect / scan / findField / fillTexts。
// 菜单出现时序、portal、isTrusted 降级在 jsdom 里没有真实渲染时序，测不了 ——
// 那些进 tests/manual-e2e.md，在真实页面上人工跑。
//
// 断言里带 ★ 的几条各自对应一个真实踩过的缺陷，不是凑覆盖率。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, loadEngine, readFixture, MOKA } from './helpers/jsdom-setup.mjs';

const HTML = readFixture(MOKA);
const moka = () => loadEngine(makeDom(HTML));
const byId = (x) => Object.fromEntries((Array.isArray(x) ? x : x.fields).map((f) => [f.id, f]));

test('detect() 按 DOM 签名认站点', () => {
  assert.equal(loadEngine(makeDom(HTML), { adapters: false }).detect(), 'moka');
  assert.equal(
    loadEngine(makeDom('<div class="form-item"><i class="phoenix-x"></i></div>'), { adapters: false }).detect(),
    'beisen'
  );
  assert.equal(loadEngine(makeDom('<div><input type="text"></div>'), { adapters: false }).detect(), 'generic');
});

test('scan() 字段数与 ID 单射', () => {
  const s = JSON.parse(moka().scan());
  // ★ fixture 里 10 个字段 + 4 个 apply-fields-* wrapper。
  //   fieldSel 一旦退回 `[class*=apply-field]`（少尾横线）这里立刻变成 14。
  assert.equal(s.total, 10, 'fieldSel 必须排除 apply-fields-* wrapper');
  // ★ ID 是 fillTexts(map) 的 key，重名即静默填错字段
  assert.equal(s.total, new Set(s.fields.map((f) => f.id)).size, 'ID 必须单射');
});

test('scan() 区块前缀与类型映射', () => {
  const m = byId(JSON.parse(moka().scan()));

  assert.ok(m['main>>推荐码'], '不在 blockSections 的区块应走 main>>');
  assert.equal(m['main>>推荐码'].block, 'main');

  assert.ok(m['edu[0]>>学校名称'], '区块字段应带 kind[row]>> 前缀');
  assert.ok(m['edu[1]>>学校名称'], '同区块第二行 → rowIndex=1');
  assert.equal(m['edu[0]>>学校名称'].block, 'edu[0]');
  assert.equal(m['edu[1]>>学校名称'].block, 'edu[1]');

  assert.ok(m['main>>个人网站#2'], 'main 内重名 label 必须加 #n 消歧');

  assert.equal(m['main>>推荐码'].type, 'text');
  // ★ bool/select 类字段：真实页面上这类下拉的 input 不是 readonly，
  //   启发式会判成 text → 写值不生效且不报错。必须靠 typeMap。
  assert.equal(m['main>>是否内推'].type, 'select', 'select_info 必须映射成 select');
  assert.equal(m['edu[0]>>就读时间'].type, 'date', 'date_info 必须映射成 date');
});

test('fillTexts() 写入 / 回读 / 失败分类', async () => {
  const ja = moka();
  const r = JSON.parse(await ja.fillTexts({
    'main>>推荐码': 'REF-1',
    'edu[1]>>学校名称': '示例大学',
    'main>>是否内推': '否',
    'main>>不存在的字段': 'x',
  }));

  assert.equal(r.ok, 2, '两个文本字段应成功');
  assert.deepEqual(r.retried, [], 'jsdom 不会吞值，不该触发重试');

  const f = Object.fromEntries(r.failed.map((x) => [x.id, x]));
  assert.equal(f['main>>是否内推'].err, 'not-text:select', '非文本字段应在报告里归类，而不是硬写');
  assert.equal(f['main>>是否内推'].phase, 'locate');
  assert.equal(f['main>>不存在的字段'].err, 'field-not-found');
  assert.equal(f['main>>不存在的字段'].phase, 'locate');
  assert.equal(f['main>>不存在的字段'].attempted, 'x', '失败报告要带回尝试值，供人工核对');
});

test('findField() 精确到行：填 edu[1] 不动 edu[0]', async () => {
  const ja = moka();
  await ja.fillTexts({ 'edu[1]>>学校名称': 'B 校' });
  const a = byId(JSON.parse(ja.readAll()));
  assert.equal(a['edu[1]>>学校名称'].value, 'B 校');
  // ★ 同名字段的另一行不能被写 —— rowIndex 定位错就会串
  assert.equal(a['edu[0]>>学校名称'].value, '', 'edu[0] 不应被 edu[1] 的写入波及');
});

test('findField() main 内重名落到不同 input', async () => {
  const ja = moka();
  await ja.fillTexts({ 'main>>个人网站': 'A 站', 'main>>个人网站#2': 'B 站' });
  const a = byId(JSON.parse(ja.readAll()));
  // ★ 这是我实现期补的消歧（plan 01 R2 原本只对降级形态消歧）的回归位
  assert.equal(a['main>>个人网站'].value, 'A 站');
  assert.equal(a['main>>个人网站#2'].value, 'B 站');
});

test('fillDate() 值不在 input 上时不许报成功', async () => {
  const ja = moka();
  const r = JSON.parse(await ja.fillDate('edu[0]>>就读时间', '2022-01'));
  // ★ 实测 Moka「就读时间」：input.value 写进去了（甚至重渲染后还在），
  //   但应用把真实值渲染在 sd-Input-display-value 里 —— 那几个仍然是空的。
  //   只看 input 回读就会报"填上了"，而提交时该字段是空的。
  assert.equal(r.ok, false, 'input 粘住 ≠ 应用接受');
  assert.equal(r.err, 'display-not-updated');
  assert.equal(r.verifiedBy, 'display', '有 display 元素时必须以它为准');
  assert.deepEqual(r.wrote, ['2022', '01'], '写入照做，只是不许声称成功');
  assert.equal(r.unfilledInputs, 2, '4 个 input 的区间只填起始，结束留空 = 至今');
});

test('fillDate() 无 display 元素时走 input 验证并成功', async () => {
  const ja = moka();
  const r = JSON.parse(await ja.fillDate('main>>毕业时间（月）', '2026-06'));
  assert.equal(r.ok, true);
  assert.equal(r.verifiedBy, 'input');
  assert.deepEqual(r.after, ['2026', '06'], '值必须真落进 input');
});

test('fillDate() 只有年份时补 01，且把假设报出来', async () => {
  const ja = moka();
  const r = JSON.parse(await ja.fillDate('main>>毕业时间（月）', '2026'));
  assert.deepEqual(r.wrote, ['2026', '01'], '缺月份按用户规则补 01');
  // ★ 静默默认会把"我只有年份"这个数据缺口掩盖掉，必须显式上报
  assert.deepEqual(r.assumed, ['month', 'day']);
});

test('fillDate() 只读日期控件绝不报成功', async () => {
  const ja = moka();
  const r = JSON.parse(await ja.fillDate('main>>出生日期 (年龄)', '2000-02-01'));
  // ★ 实测：只读 input 的程序化写入能把值粘在 DOM 上，但 React 只在 state 变化时重渲染，
  //   state 为空时假值会一直挂着 —— 看着填好了，提交时是空的。所以这里必须失败。
  assert.equal(r.ok, false, '不可验证就不能报成功');
  assert.equal(r.err, 'readonly-unverifiable');
  assert.equal(r.readonlyInputs, 1);
});

test('fillDate() 拒绝非日期字段与非法格式', async () => {
  const ja = moka();
  const a = JSON.parse(await ja.fillDate('main>>推荐码', '2000-01-01'));
  assert.equal(a.err, 'not-a-date-field');
  const b = JSON.parse(await ja.fillDate('edu[0]>>就读时间', '去年'));
  assert.equal(b.err, 'bad-ymd');
  const c = JSON.parse(await ja.fillDate('main>>不存在', '2022'));
  assert.equal(c.err, 'field-not-found');
});
