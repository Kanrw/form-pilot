// scripts/filltext.mjs 的纯函数单测。
//
// 定位与回读是"按 label 找盒内唯一可见控件"，可以在 jsdom 里忠实复现 ——
// 尤其是那个静默错写事故：**标记残留 + 全局选择器取第一个**。这个属性必须测住，
// 因为它的失败形态是"读写两边错到一起、报告显示已验证"，不测就没人能发现。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { pickField, parseSet, tagName, norm } from '../scripts/filltext.mjs';

// jsdom 里 offsetWidth/offsetHeight 恒为 0；用桩显式声明"可见"，与 tests/helpers 同法
function makeDom(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  for (const el of dom.window.document.querySelectorAll('input, textarea')) {
    Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 24, configurable: true });
  }
  return dom.window.document;
}

test('pickField：按 label 命中盒内唯一可见 input', () => {
  const doc = makeDom('<div class="form-item"><label>姓名</label><input value="x"></div>');
  const r = pickField(doc, '姓名');
  assert.equal(r.el.value, 'x');
});

test('pickField：textarea 也算目标控件（第一版只查 input，三个 textarea 全被误报为 n=0）', () => {
  const doc = makeDom('<div class="form-item"><label>兴趣爱好</label><textarea>爱好甲</textarea></div>');
  assert.equal(pickField(doc, '兴趣爱好').el.value, '爱好甲');
});

test('pickField：盒内有多个可见控件 → 拒写，不猜第一个（与引擎 composite-field 同一纪律）', () => {
  const doc = makeDom('<div class="form-item"><label>手机号码</label><input value="+86"><input value=""></div>');
  const r = pickField(doc, '手机号码');
  assert.equal(r.err, 'composite-or-none');
  assert.equal(r.n, 2);
});

test('pickField：label 不匹配返回 box-not-found，不误配同前缀字段', () => {
  const doc = makeDom('<div class="form-item"><label>最高学历</label><input></div>');
  assert.equal(pickField(doc, '学历').err, 'box-not-found');
  assert.ok(pickField(doc, '最高学历').el);
});

test('pickField：拿到的永远是**本盒内**的控件 —— 标记残留也不会串到别的字段', () => {
  // 这就是事故现场：两个盒子各有一个控件，且都带着同名标记。
  // 用全局 querySelector('[data-fp-fill=f0]') 会拿到第一个（姓名），按 label 则各归各位。
  const doc = makeDom(`
    <div class="form-item"><label>姓名</label><input data-fp-fill="f0" value="姓名值"></div>
    <div class="form-item"><label>获得证书</label><textarea data-fp-fill="f0">证书值</textarea></div>
  `);
  assert.equal(pickField(doc, '姓名').el.value, '姓名值');
  assert.equal(pickField(doc, '获得证书').el.tagName, 'TEXTAREA');
  assert.equal(pickField(doc, '获得证书').el.value, '证书值');
});

test('pickField：同名 label 出现多次时按 index 取第 n 行（多行区块靠它定位）', () => {
  const doc = makeDom(`
    <div class="form-item"><label>项目名称</label><input value="项目甲"></div>
    <div class="form-item"><label>项目名称</label><input value="项目乙"></div>
    <div class="form-item"><label>项目名称</label><input value="项目丙"></div>
  `);
  assert.equal(pickField(doc, '项目名称').el.value, '项目甲');
  assert.equal(pickField(doc, '项目名称', 2).el.value, '项目乙');
  assert.equal(pickField(doc, '项目名称', 3).el.value, '项目丙');
});

test('pickField：index 越界报 box-not-found，并回报实际找到几个（不静默取最后一个）', () => {
  const doc = makeDom('<div class="form-item"><label>项目名称</label><input value="唯一"></div>');
  const r = pickField(doc, '项目名称', 3);
  assert.equal(r.err, 'box-not-found');
  assert.equal(r.n, 1);
});

test('parseSet：支持 `label#n` 行索引，从 1 起；不带 # 即第 1 行', () => {
  assert.deepEqual(parseSet('外语等级=六级'), { label: '外语等级', index: 1, value: '六级', key: '外语等级' });
  const t = parseSet('项目名称#2=LK-99');
  assert.equal(t.label, '项目名称');
  assert.equal(t.index, 2);
  assert.equal(t.value, 'LK-99');
  assert.equal(t.key, '项目名称#2');
});

test('parseSet：值里允许出现 # 和 =，按最后一个 #n 与第一个 = 切', () => {
  const t = parseSet('项目描述#3=第 1 点：A=B，C#4 也算值');
  assert.equal(t.label, '项目描述');
  assert.equal(t.index, 3);
  assert.equal(t.value, '第 1 点：A=B，C#4 也算值');
});

test('parseSet：缺 label/值/#0 时报 null，不猜', () => {
  assert.equal(parseSet('外语等级'), null);
  assert.equal(parseSet('=六级'), null);
  assert.equal(parseSet('外语等级='), null);
  assert.equal(parseSet('项目名称#0=甲'), null);
});

test('tagName：同一 run 内不重名，不同 run 不重名（跨轮次残留不会撞车）', () => {
  const a = new Set([0, 1, 2].map((i) => tagName('runA', i)));
  const b = new Set([0, 1, 2].map((i) => tagName('runB', i)));
  assert.equal(a.size, 3);
  assert.equal(b.size, 3);
  for (const t of b) assert.ok(!a.has(t));
});

test('norm：折叠空白（label 第二行常有必填星号）', () => {
  assert.equal(norm('  学校名称 \n * '), '学校名称 *');
  assert.equal(norm(null), '');
});
