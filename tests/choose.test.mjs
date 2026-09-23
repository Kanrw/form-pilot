// scripts/choose.mjs 的纯函数单测。
//
// 这里只测不碰浏览器的那几层：字段寻址解析、选项匹配、以及"候选 → 点哪个 tag"。
// 真正的"点触发器 → 点选项"是桥的真实坐标点击，jsdom 覆盖不到 ——
// 它的验收在真实页面上（见 AGENTS §五 北森一节），本文件不假装覆盖它。
//
// ★ 2026-09-23 修：原先 matchOption 有 6 例单测却**不被生产路径调用**（页内另有一份
//   语义不同的匹配器），等于单测在替一份不运行的代码背书。现在生产路径就是
//   `chooseCandidate` → `matchOption`，下面这两组测试覆盖的**就是跑的那份**。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { norm, parseTarget, parseSet, matchOption, chooseCandidate } from '../scripts/choose.mjs';

test('norm：折叠空白并去首尾', () => {
  assert.equal(norm('  未婚 \n'), '未婚');
  assert.equal(norm('示例大学\t示例专业'), '示例大学 示例专业');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});

test('parseTarget：无 # 时按第 1 个', () => {
  assert.deepEqual(parseTarget('学历'), { label: '学历', index: 1 });
  assert.deepEqual(parseTarget('外语证书/分数'), { label: '外语证书/分数', index: 1 });
});

test('parseTarget：带 # 时按第 n 个（1 起）', () => {
  assert.deepEqual(parseTarget('学历#3'), { label: '学历', index: 3 });
  assert.deepEqual(parseTarget('学位 #2'), { label: '学位', index: 2 });
});

test('parseSet：按第一个 = 切，值里允许再有 =', () => {
  assert.deepEqual(parseSet('婚姻状况=未婚'), { label: '婚姻状况', index: 1, value: '未婚', key: '婚姻状况' });
  const t = parseSet('学历#2=硕士研究生');
  assert.equal(t.label, '学历');
  assert.equal(t.index, 2);
  assert.equal(t.value, '硕士研究生');
  assert.equal(t.key, '学历#2');
  assert.equal(parseSet('外语证书/分数=CET-6（2019-06）').value, 'CET-6（2019-06）');
});

test('parseSet：缺 = 或缺字段名/值时报 null，不猜', () => {
  assert.equal(parseSet('婚姻状况'), null);
  assert.equal(parseSet('=未婚'), null);
  assert.equal(parseSet('婚姻状况='), null);
});

test('matchOption：精确命中', () => {
  const r = matchOption(['博士研究生', '硕士研究生', '本科'], '硕士研究生');
  assert.equal(r.how, 'exact');
  assert.equal(r.raw, '硕士研究生');
});

test('matchOption：全角/半角括号与空格差异算 loose，不算失败', () => {
  const r = matchOption(['英语（六级）', '日语'], '英语(六级)');
  assert.equal(r.how, 'loose');
  assert.equal(r.raw, '英语（六级）');
});

test('matchOption：唯一包含命中', () => {
  const r = matchOption(['全国大学英语六级考试', '雅思'], '英语六级');
  assert.equal(r.how, 'contains');
  assert.equal(r.raw, '全国大学英语六级考试');
});

test('matchOption：≥2 个候选报 ambiguous，绝不替使用者挑一个', () => {
  const r = matchOption(['英语四级', '英语六级'], '英语');
  assert.equal(r.how, 'ambiguous');
  assert.deepEqual(r.candidates, ['英语四级', '英语六级']);
});

test('matchOption：一个都不命中报 none（把选项列表回给调用方去人看）', () => {
  assert.equal(matchOption(['未育', '已育'], '离异').how, 'none');
});

test('matchOption：选项里重复的同一个值只算一次精确命中', () => {
  const r = matchOption(['本科', '本科'], '本科');
  assert.equal(r.how, 'ambiguous');
});

// ── chooseCandidate：生产路径真正调用的判断（候选 → 点哪个 tag）──────────────
// 这一组的价值在于：它覆盖的就是 main()/chooseOne 里跑的那段，不是另一份复制品。

const cands = (...texts) => texts.map((t, i) => ({ tag: 'x' + i, text: t }));

test('chooseCandidate：唯一精确命中 → 点它那个 tag', () => {
  const r = chooseCandidate(cands('未婚', '已婚', '离异'), '已婚');
  assert.equal(r.tag, 'x1');
  assert.equal(r.how, 'exact');
  assert.equal(r.text, '已婚');
});

test('chooseCandidate：文本重复 → 报 ambiguous，绝不"取第一个"', () => {
  // 实测场景：上一格菜单没关掉时，候选里会混进另一个字段的选项。
  // 这时候"取第一个"会把值点进别人的面板 —— 静默错填。
  const r = chooseCandidate(cands('本科', '硕士研究生', '本科'), '本科');
  assert.equal(r.err, 'option-ambiguous');
  assert.deepEqual(r.candidates, ['本科', '本科']);
  assert.equal(r.tag, undefined);
});

test('chooseCandidate：括号/空格差异算 loose，照样能选中', () => {
  const r = chooseCandidate(cands('英语（六级）', '日语'), '英语(六级)');
  assert.equal(r.tag, 'x0');
  assert.equal(r.how, 'loose');
});

test('chooseCandidate：唯一包含命中', () => {
  const r = chooseCandidate(cands('全国大学英语六级考试', '雅思'), '英语六级');
  assert.equal(r.tag, 'x0');
  assert.equal(r.how, 'contains');
});

test('chooseCandidate：一个都不命中 → option-not-found，并把候选原样回给调用方人看', () => {
  const r = chooseCandidate(cands('未育', '已育'), '离异');
  assert.equal(r.err, 'option-not-found');
  assert.deepEqual(r.options, ['未育', '已育']);
});

test('chooseCandidate：多个候选同等包含 → ambiguous', () => {
  const r = chooseCandidate(cands('英语四级', '英语六级'), '英语');
  assert.equal(r.err, 'option-ambiguous');
});
