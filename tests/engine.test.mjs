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

test('fillDate() 在选择式日期上动手前就转向 fillMonthRange', async () => {
  const ja = loadEngine(makeDom(RANGE_HTML));
  const r = JSON.parse(await ja.fillDate('main>>就读时间', '2022-09'));
  // ★ 实测 Moka「毕业时间（月）」「英语证书获得时间」是 2 个下拉的单月变体，
  //   「就读时间」是 4 个下拉的区间变体，容器类名都是 month-range-select，都没有文本框。
  //   不提前挡掉的话，fillDate 会先往下拉内部的 input 写字（污染控件），再报 display-not-updated，
  //   而报错只字不提真正该用的方法。
  assert.equal(r.err, 'select-based-date');
  assert.equal(r.wrote, undefined, '一个字都不该写进去');
  assert.match(r.hint, /fillMonthRange/);
});

// ── 月区间（fillMonthRange）与菜单候选去嵌套 ─────────────────────────
//
// 菜单出现时序 jsdom 测不了（没有真实渲染），能测的是：字段定位、参数校验、下拉计数，
// 以及"候选里互相嵌套的元素只留最外层"这条纯 DOM 关系。

const RANGE_HTML = `
<div class="apply-field-m1 string_info">
  <div class="title-m1"><span><span>民族</span></span></div>
  <div class="sd-Select-container-m1"><input class="sd-Input-input"></div>
</div>
<div class="apply-field-m2 date_info">
  <div class="title-m2"><span><span>就读时间</span></span></div>
  <div class="month-range-select-x">
    <span><div class="sd-Select-container-a"></div></span>
    <span><div class="sd-Select-container-b"></div></span>
    <span><div class="sd-Select-container-c"></div></span>
    <span><div class="sd-Select-container-d"></div></span>
  </div>
</div>
<div class="apply-field-m3 date_info">
  <div class="title-m3"><span><span>半截区间</span></span></div>
  <div class="month-range-select-x">
    <span><div class="sd-Select-container-e"></div></span>
    <span><div class="sd-Select-container-f"></div></span>
  </div>
</div>`;

test('fillMonthRange() 只认月区间字段', async () => {
  const ja = loadEngine(makeDom(RANGE_HTML));
  const a = JSON.parse(await ja.fillMonthRange('main>>民族', '2022-09'));
  assert.equal(a.err, 'not-a-month-range', '普通下拉不该被当成月区间');
  const b = JSON.parse(await ja.fillMonthRange('main>>不存在', '2022-09'));
  assert.equal(b.err, 'field-not-found');
});

test('fillMonthRange() 非法年月在写页面前就拦住', async () => {
  const ja = loadEngine(makeDom(RANGE_HTML));
  assert.equal(JSON.parse(await ja.fillMonthRange('main>>就读时间', '去年')).err, 'bad-ym');
  assert.equal(JSON.parse(await ja.fillMonthRange('main>>就读时间', '22-09')).err, 'bad-ym');
  // ★ 月份越界必须在这里拦住。放过去会一路走到下拉里匹配不到，报的是 option-not-found，
  //   排查者会去怀疑站点改版，而真凶通常是档案里的日期写错了。
  assert.equal(JSON.parse(await ja.fillMonthRange('main>>就读时间', '2022-09', '2023-13')).err, 'bad-ym');
});

test('fillMonthRange() 下拉不够时报出缺几个，而不是硬填', async () => {
  const ja = loadEngine(makeDom(RANGE_HTML));
  const r = JSON.parse(await ja.fillMonthRange('main>>半截区间', '2022-09', '2023-09'));
  assert.equal(r.err, 'range-selects-missing');
  assert.equal(r.selects, 2, '实际只有起始两个下拉');
  assert.equal(r.need, 4, '给了结束时间就需要 4 个');
});

test('菜单候选里嵌套的元素只留最外层：失败报告的 menus 不虚报', async () => {
  const dom = makeDom(`
<div class="apply-field-n1 string_info">
  <div class="title-n1"><span><span>民族</span></span></div>
  <div class="sd-Select-container-n1"><input class="sd-Input-input"></div>
</div>`);
  const ja = loadEngine(dom);
  const doc = dom.window.document;
  let fired = false;
  doc.addEventListener('click', () => {
    if (fired) return;
    fired = true;
    const panel = doc.createElement('div');
    panel.className = 'sd-Select-menu-n1';
    panel.innerHTML = '<div class="sd-Menu-container-p"><div class="sd-Menu-content-item-p">汉族</div></div>'
      + '<div class="sd-Menu-container-q"><div class="sd-Menu-content-item-q">壮族</div></div>';
    doc.body.appendChild(panel);
  });

  const r = JSON.parse(await ja.pickOption('main>>民族', '不存在的选项'));
  assert.equal(r.err, 'option-not-found');
  // ★ 实测 Moka 点开「民族」一个下拉，menuSel 同时命中面板与它内部的 58 个
  //   sd-Menu-container-*。若不去嵌套，这里会报 3（1 面板 + 2 单项容器），
  //   让现场排查的人以为同时弹了 3 个菜单。
  assert.equal(r.menus, 1, '嵌套的选项容器不该计入候选');
  assert.deepEqual(r.available, ['汉族', '壮族'], '面板里的选项要能被读到');
});

test('标签页在后台时立即报错，不进入无限等待', async () => {
  const dom = makeDom(RANGE_HTML);
  const ja = loadEngine(dom);
  // ★ 实测：hidden 标签页里 `await new Promise(r => setTimeout(r, 1500))` 30 秒都没触发，
  //   而同页的同步 evaluate 秒回 —— 定时器被节流，所有 await sleep 永不返回。
  //   这类失败不报错、不返回、也不超时，所以入口必须自己拦。
  Object.defineProperty(dom.window.document, 'hidden', { value: true, configurable: true });

  assert.equal(JSON.parse(await ja.fillMonthRange('main>>就读时间', '2022-09')).err, 'tab-hidden');
  assert.equal(JSON.parse(await ja.pickOption('main>>民族', '汉族')).err, 'tab-hidden');
  assert.equal(JSON.parse(await ja.fillDate('main>>就读时间', '2022')).err, 'tab-hidden');
  assert.equal(JSON.parse(await ja.addRow('edu')).err, 'tab-hidden');

  const c = JSON.parse(await ja.fillTexts({ 'main>>民族': 'x', 'main>>就读时间': 'y' }));
  assert.equal(c.ok, 0);
  assert.equal(c.err, 'tab-hidden');
  assert.equal(c.failed.length, 2, '形状不变：每个字段各报一条');
  assert.deepEqual(c.retried, []);
});

// ── 飞书（feishu）｜2026-09-22 首次适配 ─────────────────────
// 结构事实来自真实申请页的只读探测（scripts/probe.mjs），此处用合成 DOM 固化：
//   盒子 = atsx-form-item（完整 token）；类型写在内部组件类名上；
//   <label> 是干净的字段名事实源（[class*=fieldName] 会混入已填值）。

const FEISHU_HTML = `<div>
  <div class="atsx-form-item">
    <label>姓名</label>
    <div class="atsx-form-item-control"><input type="text" class="atsx-input atsx-input-lg"></div>
  </div>
  <div class="atsx-form-item">
    <label>政治面貌</label>
    <div class="atsx-form-item-control">
      <div class="atsx-select atsx-select-lg">
        <div class="atsx-select-selection atsx-select-selection--single">
          <div class="atsx-select-search atsx-select-search--inline">
            <input type="text" class="atsx-select-search__field">
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="atsx-form-item">
    <label>起止时间</label>
    <div class="atsx-form-item-control">
      <span class="atsx-date-picker atsx-date-picker-period-month">
        <input type="text" class="atsx-date-picker-period-hidden-input">
      </span>
    </div>
  </div>
</div>`;

test('detect() 认飞书签名（atsx-form-item 完整词）', () => {
  assert.equal(loadEngine(makeDom(FEISHU_HTML), { adapters: false }).detect(), 'feishu');
});

test('★ 子树判据：类型在组件上、不在盒子类名上时仍能判对（飞书 8 个下拉静默错挡）', () => {
  // 必须配 feishu 适配器：generic 的就近容器会把下拉的盒子定位到
  // atsx-select-search 那层，测不到真实形态。typeMap 为空 → 走 heuristicType。
  const s = JSON.parse(loadEngine(makeDom(FEISHU_HTML), { adapter: 'feishu' }).scan());
  const byId = Object.fromEntries(s.fields.map((f) => [f.id, f]));
  // 飞书形态：盒子 class 只有 atsx-form-item，下拉 input 是 atsx-select-search__field
  // 且**不是 readonly** —— cls 判据与 readonly 判据全部落空。修复前这两个都判成
  // text，fillTexts 往下拉输入框写值静默无效（与 Moka bool_info 同类、根因不同）。
  // 未声明 blockSections → 降级 ID 形态（AGENTS.md §七）：裸 <label>，无 main>> 前缀。
  assert.equal(byId['政治面貌'].type, 'select', 'select-search 必须被子树判据抓到');
  assert.equal(byId['起止时间'].type, 'date', 'date-picker 必须被子树判据抓到');
  assert.equal(byId['姓名'].type, 'text', '纯 input 不受子树判据误伤');
});

test('feishu 适配器：~= 完整词匹配选盒子，label 作字段名，重复靠 #n 消歧', () => {
  const s = JSON.parse(loadEngine(makeDom(FEISHU_HTML), { adapter: 'feishu' }).scan());
  assert.equal(s.total, 3, '[class~=] 不许误中 form-item-control/-children/-label');
  assert.equal(s.total, new Set(s.fields.map((f) => f.id)).size, 'ID 单射');
  assert.ok(s.fields.every((f) => f.label), '每个盒子都取到 label');
});
