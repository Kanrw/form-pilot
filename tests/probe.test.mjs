// 站点探针回归（jsdom）。
//
// 只测 PROBE_CODE 本身 —— 它在 `scripts/probe.mjs` 里以字符串导出，
// 好处是不需要桥接和真实浏览器就能跑结构推断的全部逻辑。
// 桥接层（--session / evaluate / 退出码）不在这里，那部分只有真实页面能验。
//
// 断言里带 ★ 的几条各自对应一个真实踩过的缺陷或一个已否决的错误结论，
// 不是凑覆盖率。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFixture, MOKA } from './helpers/jsdom-setup.mjs';
import { PROBE_CODE } from '../scripts/probe.mjs';

const HTML = readFixture(MOKA);

// 跑一次探针注入体。withText=true 才输出页面文本（默认是 false）。
function probe(html, withText) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.__PROBE_TEXT = Boolean(withText);
  return JSON.parse(dom.window.eval(PROBE_CODE));
}

// AGENTS.md §五 校正 2 的真实形态：容器类名里没有 select，
// 子树里才是 sd-Select-container + sd-Input-display-value，且 input 非 readonly。
const BOOL_INFO_DOM = `<div class="apply-blocks-root"><div class="apply-block-b1">
  <div class="apply-fields-g1">
    ${[1, 2, 3].map((i) => `<div class="apply-field-b${i} bool_info-hash${i}">
      <span class="title-hash">是否有实习经历${i}</span>
      <div class="sd-Select-container"><input type="text" /><span class="sd-Input-display-value"></span></div>
    </div>`).join('')}
    ${[1, 2, 3].map((i) => `<div class="apply-field-t${i} string_info-hash${i}">
      <span class="title-hash">姓名${i}</span><input type="text" />
    </div>`).join('')}
  </div></div></div>`;

test('探针能勾出零套娃的字段容器，并让尾横线差异自己浮现', () => {
  const r = probe(HTML);
  const best = r.containers[0];

  // ★ 这条只在容器内引发过一次真实返工：排序一度用"含控件的节点数"，
  //   于是含 8 个套娃的 apply- 压过了零套娃的 apply-field-（jsdom 跑出来的）。
  assert.equal(best.prefix, 'apply-field-', '首位必须是零套娃的真字段容器');
  assert.equal(best.nested, 0);
  assert.equal(best.total, 10, '应与 scan() 认定的字段数一致');

  // ★ 同 (total,covered) 的等价前缀会派生几十个变体把名额挤光，
  //   必须分组只留一个代表，否则这条候选掉出 Top40 找不回来。
  const wide = r.containers.find((c) => c.total === 14);
  assert.ok(wide, '应存在覆盖 14 个元素的宽候选');
  assert.ok(wide.nested > 0, '宽候选必须标出套娃数，供人工看出少了尾横线');
});

test('类型判据抬到子树：bool_info 不被判成文本框', () => {
  const r = probe(BOOL_INFO_DOM);
  const boolInfo = r.types.find((t) => t.token === 'bool_info');
  const stringInfo = r.types.find((t) => t.token === 'string_info');
  assert.ok(boolInfo, '类型 key 取前两段，不能取完整类名（每个字段后缀都不同）');

  // ★ 这是本次的裁决依据：engine.js:78 停在 box.className，
  //   所以 bool_info 两条判据（类名含 select / input 是 readonly）全部落空。
  assert.equal(/select|dropdown/i.test(boolInfo.token), false, '类名判据在此确实失败');
  assert.equal(boolInfo.readonly, 0, 'readonly 判据在此也确实失败');
  assert.equal(boolInfo.select, boolInfo.n, '子树判据必须全部命中');

  assert.equal(stringInfo.select, 0, '真文本框不得被误判成下拉');
});

test('默认不输出任何页面文本', () => {
  const r = probe(BOOL_INFO_DOM);
  assert.deepEqual(r.texts, [], '隐私边界：omit --text 时不得带出标签值');

  const withText = probe(BOOL_INFO_DOM, true);
  assert.ok(withText.texts.length > 0, '--text 才输出');
  assert.ok(!/简历|身份证|手机/.test(JSON.stringify(withText.texts.map((t) => t.label))));
  assert.ok(withText.texts.every((t) => t.label.length <= 40), '标签文本必须截断');
});
