// scripts/choose.mjs 的纯函数单测。
//
// 这里只测不碰浏览器的那几层：字段寻址解析、选项匹配。
// 真正的"点触发器 → 点选项"是桥的真实坐标点击，jsdom 覆盖不到 ——
// 它的验收在真实页面上（见 AGENTS §五 北森一节），本文件不假装覆盖它。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { norm, parseTarget, parseSet, matchOption } from '../scripts/choose.mjs';

test('norm：折叠空白并去首尾', () => {
  assert.equal(norm('  未婚 \n'), '未婚');
  assert.equal(norm('示例大学\t物理学'), '示例大学 物理学');
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
