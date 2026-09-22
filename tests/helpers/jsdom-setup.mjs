// jsdom 打桩与引擎加载。
//
// 三个 jsdom 缺陷必须补，否则引擎的核心过滤逻辑全灭：
//   1. jsdom 不做布局 → offsetHeight 恒 0 → fields() 的 `offsetHeight > 0` 把所有字段滤掉。
//      桩返回 40 而不是 1：同时满足 visibleMenus 的 `> 30`，将来测菜单不用改桩。
//   2. scrollIntoView 未实现 → synthClick 会抛。
//   3. jsdom 没有真实可见性 → document.hidden 恒 true（visibilityState 默认 prerender），
//      引擎的前台守卫会因此拒掉每一个异步方法。桩成 false；
//      需要测"后台标签页"的用例自己 defineProperty 覆盖回去。
//
// 加载方式刻意用 `dom.window.eval(源码字符串)` 而不是 `import`：
// 引擎是浏览器 IIFE，不该被 Node 的模块系统加载（package.json 因此不设 type）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function makeDom(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    get() { return 40; },
    configurable: true,
  });
  Object.defineProperty(dom.window.document, 'hidden', {
    get() { return false; },
    configurable: true,
  });
  dom.window.Element.prototype.scrollIntoView = function () {};
  return dom;
}

export function loadEngine(dom, { adapters = true, adapter = 'moka' } = {}) {
  dom.window.eval(readFileSync(join(ROOT, 'engine/engine.js'), 'utf8'));
  if (adapters) {
    dom.window.eval(readFileSync(join(ROOT, 'engine/adapters.js'), 'utf8'));
    dom.window.eval(`window.__ja.use(window.__jaAdapters[${JSON.stringify(adapter)}])`);
  }
  return dom.window.__ja;
}

export function readFixture(name) {
  return readFileSync(join(ROOT, 'tests/fixtures', name), 'utf8');
}

// 档案界面脚本同样是浏览器 IIFE，同样不该被 Node 的模块系统加载。
// 加载后不自动启动：boot 只在带 [data-profile-editor] 的真页面骨架里跑，
// 测试用的空壳拿到的是一组可直接调用的渲染函数。
export function loadProfileEditor(dom) {
  dom.window.eval(readFileSync(join(ROOT, 'tools/profile-editor.js'), 'utf8'));
  return dom.window.__profileEditor;
}

export const MOKA = 'moka.html';
