# form-pilot 引擎架构加固规划（01）

> 范围：仅规划，不写实现。基线为 `job-apply-v2/references/engine.md`（Moka 实测版）。
> 优先级：P0 = 不做会在真实表单上出错；P1 = 显著影响成功率；P2 = 增强。

## 一、风险清单

| # | 风险 | 现状 | 优先级 |
| --- | --- | --- | --- |
| R1 | 菜单检测竞态：残留菜单 / 常驻 menu 类元素导致归属误判 | 前后数组对比 + `visibleMenus().pop()` 兜底 | **P0** |
| R2 | 重复区块 `label#n` 编号在"新增一行"后漂移 | 全局按 DOM 序编号 | **P0** |
| R3 | 单选/多选/布尔三类控件无统一接口；多选需点"确定"才生效 | 全部走 pickOption，北森确定按钮无抽象 | **P1** |
| R4 | 日期/级联控件：哪些自动、哪些留手动，判定归属未定 | SKILL.md 一句"建议留手动" | **P1** |
| R5 | Shadow DOM / 同域 iframe 内控件，选择器全失效 | 无探测，静默漏字段 | P2 |
| R6 | 填写中途异常：stale element、fillTexts 部分失败的事务性 | 每次重查 + 单字段重试一次 | **P1** |
| R7 | 大表单：单次 evaluate 体积上限、scan 长 JSON 返回值截断 | 无分块，compact JSON 靠自觉 | **P1** |
| R8 | 幂等与重入：重复注入、多次 scan、fillTexts/pickOption 重跑 | 仅有 `if (window.__ja) return` 守卫 | **P1** |
| R9 | 与 v1 安全闸门衔接：填前快照 → 填后 diff，供用户核对"只改了该改的" | 无快照/diff 概念，只有 readAll | **P1** |

## 二、加固设计

### R1 菜单归属判定（P0）

**问题**：`before.includes(m)` 依赖数组引用比较，但 `visibleMenus()` 每次重新 querySelectorAll，残留菜单（上次未关）和常驻菜单（页面自带的导航 menu）都会被纳入候选，`.pop()` 兜底等于赌博。

**方案**：`openMenu(trigger)` 封装"清场 → 快照 → 触发 → 差集 + 几何归属"四步：

```js
async openMenu(trigger) {
  this.closeAllMenus();                        // ① 清场：Esc + body click，拿到干净基线
  await sleep(150);
  const before = new Set(this.visibleMenus()); // ② 快照存 Set，O(1) 归属查询
  synthClick(trigger);
  for (let i = 0; i < 10; i++) {               // ③ 等新菜单
    await sleep(200);
    const fresh = this.visibleMenus().filter(m => !before.has(m));
    if (fresh.length === 1) return fresh[0];
    if (fresh.length > 1) return this.nearest(fresh, trigger); // ④ 几何归属
  }
  return null;
}
nearest(menus, trigger) {                      // 多个新菜单时取距触发器最近者
  const r = trigger.getBoundingClientRect();
  return menus.map(m => { const q = m.getBoundingClientRect();
    return { m, d: Math.abs(q.top - r.bottom) + Math.abs(q.left - r.left) }; })
    .sort((a, b) => a.d - b.d)[0].m;
}
```

**理由**：① 清场消除"上次没关干净"这一最大噪声源，代价仅 150ms；② Set 差集严格区分"新出现"与"常驻"，常驻菜单永不在差集内；③ 多个 portal 同时弹出（如校验提示层）时用垂直距离选最近者，下拉菜单几乎总是贴着触发器渲染。删除 `.pop()` 兜底——找不到就是失败，返回 `menu-not-open` 走降级链，好过选错菜单。

### R2 区块化字段 ID（P0）

**问题**：`label#n` 是全局编号，教育经历"添加一行"后，其后所有同名字段编号 +1，此前生成的映射表全部错位。

**方案**：ID 从扁平编号升级为结构化路径 `blockKind[rowIndex]>>label`，适配器声明区块签名：

```js
// 适配器新增
moka: { ..., blockSels: { edu: '[class*=educations] [class*=form-item-wrap]',
                          work: '[class*=companys] [class*=form-item-wrap]' },
        addRowText: { edu: '添加教育经历', work: '添加工作经历' } }
// 引擎扫描
scan() {
  const out = [];
  for (const box of this.fields()) {
    const blk = this.blockOf(box);   // 向上匹配 blockSels，命中返回 {kind, index}
    const id = blk ? `${blk.kind}[${blk.index}]>>${label}` : `main>>${label}`;
    out.push({ id, ... });
  }
}
findField(id) {                      // 先定位区块容器，再容器内按 label 找
  const m = id.match(/^(?:(\w+)\[(\d+)\]|main)>>(.+)$/); ... }
```

`blockOf` 按 `blockSels` 选择器向上 `closest`，`index` 为同 kind 容器在 DOM 中的序号。**"添加一行"抽象**：`__ja.addRow(kind)` —— 按 `addRowText[kind]` 在页面找按钮（`[...document.querySelectorAll('button,a,div,span')].find(b => norm(b.textContent).includes(norm(addRowText[kind])))`）点击，等待区块计数 +1，返回新行 index。**理由**：新增行只改变该 block 内部的行数，`edu[1]>>学校名称` 在添加 `edu[2]` 后依然指向原字段；全局编号漂移被限制在区块边界内。`main>>` 前缀同时消掉了普通字段的 `#n` 歧义。

### R3 choice 统一接口（P1）

**问题**：Moka"是否"是下拉、北森是 `div.phoenix-radio`、原生是 `<input type=radio>`，三种形态塞不进 pickOption；北森多选菜单选完须点"确定"，否则不生效。

**方案**：新增 `setChoice(id, value)`，由适配器声明 `choiceKind` 分发：

```js
// 适配器新增
beisen: { ..., choiceKind: 'custom-radio',       // custom-radio | native | dropdown
          radioSel: 'div.phoenix-radio',
          radioCheckedCls: '--checked',
          menuConfirmSel: null,                  // 引擎按文本"确定"兜底
          menuConfirmText: '确定' }
// 引擎
async setChoice(id, value) {
  const box = this.findField(id);
  if (A.choiceKind === 'dropdown') return this.pickOption(id, value);      // Moka 是否
  const radios = A.choiceKind === 'native'
    ? [...box.querySelectorAll('input[type=radio]')]
    : [...box.querySelectorAll(A.radioSel)];
  const target = radios.find(r => norm((r.closest('label')||r.parentElement).textContent) === norm(value));
  if (!target) return { ok:false, err:'choice-not-found' };
  if (A.choiceKind === 'native') { target.click(); return { ok: target.checked }; }
  synthClick(target); await sleep(300);
  return { ok: (target.className||'').includes(A.radioCheckedCls) };      // 用 class 验证
}
```

`pickOption` 增加 `mode`：`'single'`（默认，选完验关菜单）| `'multi'`（循环点多个项 → 点 `menuConfirmText` 按钮 → 再验证）。**理由**：三种形态的"动词"一致（选中一个值），差异只在定位与验证方式，属于适配器职责；menuConfirm 做成钩子而非引擎内置分支，因为"要不要确定、确定按钮长什么样"是纯站点属性。多选重入安全：点项前检查该项是否已带选中态，已选则跳过。

### R4 日期/级联策略（P1）

**方案**：**声明在适配器，试探在引擎**。适配器给出 `datePolicy` / `cascadePolicy`：`'auto' | 'manual'`；引擎提供 `fillDate(id, 'YYYY-MM-DD')`：

```js
async fillDate(id, ymd) {
  if (A.datePolicy === 'manual') return { ok:false, manual:true };
  const box = this.findField(id);
  const inp = box.querySelector(A.textInputSel);
  if (!inp || inp.readOnly) return { ok:false, manual:true, err:'readonly' };
  setNativeValue(inp, ymd); inp.dispatchEvent(new Event('blur', {bubbles:true}));
  await sleep(400);
  return { ok: inp.value.includes(ymd) };   // 控件拒收则值被清空 → 转手动
}
```

scan 输出对 `day_info-*` / 容器类含 `cascade|area` 的字段直接标 `type:'date'|'cascade'`，LLM 在映射阶段就将其列入待手动清单，不进 fillTexts。**理由**："这个控件接不接受直接输入"只有试过才知道（试探逻辑通用，放引擎）；"要不要试"是站点经验（声明放适配器）。级联一律 manual：三级面板 + 异步加载 + 文本重复（全国几十个"朝阳区"），自动化收益低风险高，不值得写引擎逻辑。

### R5 Shadow DOM / iframe（P2）

**方案**：scan 前跑 `probeEnv()` 探测，不追求全自动：

```js
probeEnv() {
  const shadowHosts = [...document.querySelectorAll('*')].filter(e => e.shadowRoot).length;
  const iframes = [...document.querySelectorAll('iframe')].map(f => {
    try { return { src: f.src.slice(0,60), sameOrigin: !!f.contentDocument,
                   fields: f.contentDocument.querySelectorAll('input,textarea').length }; }
    catch { return { src: f.src.slice(0,60), sameOrigin: false }; } });
  return { shadowHosts, iframes };
}
```

- 同域 iframe 且内有字段：返回提示，由调用方决定是否对该 frame 单独 evaluate 注入引擎（WebBridge evaluate 支持 frame 定向时直接注入；否则列入待手动）。
- 存在 shadowHosts：报告数量并提示，提供 `deepScan()`（递归 shadowRoot 的 querySelectorAll）作为显式开启的慢路径，默认关闭。
- 跨域 iframe：无法注入，直接列入待手动并说明原因。

**理由**：求职表单主流程极少整页 shadow/iframe（多为验证码、编辑器富文本），全自动穿透成本不成比例；探测 + 明确降级提示比静默漏字段（用户提交才发现缺项）强一个量级。故 P2。

### R6 异常恢复（P1）

**stale element**：维持"每次操作重新 findField"策略，理由：重渲染后 React 复用同位置 DOM，结构化 ID（R2）+ 现查现用天然免疫 stale；真正会 stale 的是跨 await 持有元素引用的场景——规约：**任何元素引用不得跨 sleep 使用**（`openMenu` 拿到的 menu 在点选项前重新校验 `menu.isConnected`，掉了就重开一次）。

**fillTexts 事务性**：**不回滚**。理由：① 表单填写无原子性可言，回滚要逆向触发联动，比正向更危险；② 用户最终有人工核对闸门（R9），部分失败不是灾难；③ 报告必须足够详细以支撑人工/LLM 决策。报告格式：

```js
// fillTexts 返回
{ ok: 12, failed: [{ id:'main>>手机号', phase:'verify', err:'value-not-stuck',
                     attempted:'138...', final:'' }],
  retried: ['main>>姓名'],                    // 重渲染吞值后重填成功
  unchanged: [] }                             // 写入后 React 又改回去的（联动）
```

phase 枚举 `locate | fill | verify`，让失败定位到环节。**理由**：`unchanged` 与 `failed` 分开报——前者可能是控件联动改写（如选"应届"清空工作年限），属于正常行为，不该进失败清单。

### R7 大表单性能（P1）

**方案**：① 注入分两块：`__ja_core`（工具函数 + 主体，minify 后 < 8KB）与 `__ja_adapters`，各自 IIFE 幂等；② scan/readAll 支持分页 `{offset, limit}`，返回 `{total, fields:[...]}`，调用方按 total 决定拉几轮；③ fillTexts 的 map 由调用方分批（每批 ≤ 25 字段）——循环在页内，分批只多几次 HTTP 往返，毫秒级；④ 所有返回值 `JSON.stringify` 无空格，且单字段 value 截断 200 字符（textarea 长文不拖垮返回值）。**理由**：截断的 JSON 是静默灾难（parse 失败但 HTTP 200），分页把风险从"赌桥不截断"变成"确定有界"；60 字段实测 compact JSON 约 6–10KB，分页后单次 < 4KB 足够安全。

### R8 幂等与重入（P1）

**方案**：① `window.__ja` 守卫升级：存在时比较 `__ja.version`，同版本直接复用，低版本覆盖重注入；`use()` 可重复调用（纯 Object.assign）；② scan/readAll/probeEnv 纯读取，天然幂等；③ fillTexts 写同值幂等（native setter 无追加语义）；④ pickOption/setChoice 重入安全：操作前先读当前值，已等于目标则直接返回 `{ok:true, already:true}` 不再点菜单；⑤ 加运行锁：`__ja._busy` 标志，pickOption/openMenu 入口检查，防止调用方并发开两个菜单（引擎不支持并行下拉，显式报错好过互相污染）。**理由**：LLM 在网络抖动后必然重试，引擎重跑同一条命令必须收敛到同一状态，否则"多选点两次变成取消"这类事故无法向用户解释。

### R9 快照 → diff 报告（P1）

**方案**：`snapshot()` 把 scan 结果（id → value）存入 `window.__ja._snap0` 并返回条数；`diff()` 重跑 scan 与快照对比：

```js
diff() {
  const now = Object.fromEntries(this.scanFields().map(f => [f.id, f.value]));
  const changed = [], outside = [];   // outside = 不在填写计划内却变了的字段
  for (const [id, v] of Object.entries(now)) {
    const old = this._snap0[id] ?? '';
    if (old !== v) (this._plan.has(id) ? changed : outside).push({ id, from: old, to: v });
  }
  return { changed, outside, missing: [...this._plan].filter(id => !(id in now)) };
}
```

调用方在 fillTexts 前把确认过的映射表 key 交给 `__ja._plan = new Set(keys)`。**理由**：这是 v1"用户核对后才提交"闸门的引擎支撑。`outside` 桶是关键增量——填 A 触发 B 联动（选城市清空区县）时用户能看到计划外变更，这正是"只改了该改的"的可核验证据，纯引擎能力，LLM 外层无法廉价实现。

## 三、接口变更（引擎 API 最终形态）

```js
__ja.version                                        // '0.2.0'
__ja.use(adapter)                                   // adapter 新增：blockSels / addRowText /
                                                    //   choiceKind / radioSel / radioCheckedCls /
                                                    //   menuConfirmText / datePolicy / cascadePolicy
__ja.probeEnv()      → {shadowHosts, iframes[]}     // R5 环境探测（scan 前必跑）
__ja.detect()        → 'moka'|'beisen'|'generic'
__ja.scan({offset,limit}) → {total, fields:[{id:'edu[0]>>学校名称', type, required, value}]}
__ja.snapshot()      → {count}                      // R9 填前快照
__ja.setPlan(ids[])                                 // R9 声明计划变更集合
__ja.addRow(kind)    → {ok, index}                  // R2 添加经历行
__ja.fillTexts(map)  → {ok, failed[], retried[], unchanged[]}   // R6 分阶段报告
__ja.setChoice(id, value)                           // R3 radio/bool 统一入口
__ja.pickOption(id, text, {mode:'single'|'multi', search})      // R1/R3
__ja.fillDate(id, 'YYYY-MM-DD') → {ok}|{manual:true}            // R4
__ja.readAll({offset,limit})                        // 分页回读
__ja.diff()          → {changed[], outside[], missing[]}        // R9 核对报告
```

内部规约：元素引用不跨 sleep 复用（R6）；菜单操作串行且持 `_busy` 锁（R8）；返回值一律 compact JSON + value ≤200 字符（R7）。

## 四、实施顺序

| 序 | 项 | 依赖 | 验收 |
| --- | --- | --- | --- |
| 1 | R1 openMenu 归属判定 | 无 | Moka 连续选 5 个下拉无错菜单；残留菜单场景人工构造复测 |
| 2 | R2 区块化 ID + addRow | 无 | Moka 教育经历加一行后，加行前生成的 fillTexts map 仍全部命中 |
| 3 | R9 snapshot/diff | R2（ID 稳定才有意义） | 填完输出 diff，outside 桶能捕获一次人为联动 |
| 4 | R3 setChoice + menuConfirm | R1 | 北森多选菜单选 2 项点确定后值生效；Moka"是否"走 dropdown 分支 |
| 5 | R4 fillDate 试探 | 无 | Moka day_info 可输则填、不可输进 manual 清单 |
| 6 | R6 报告格式 + isConnected 校验 | R2 | 故意填一个不存在 label，failed.phase='locate' 正确上报 |
| 7 | R7 分页/分块 | 无 | 60+ 字段表单 scan 两轮拉全，无 JSON 截断 |
| 8 | R8 版本守卫 + 运行锁 | 1–7 | 重复注入、pickOption 重跑、并发调用三类场景幂等 |
| 9 | R5 probeEnv | 无 | 含 iframe 的测试页输出正确探测与降级提示 |

理由：1、2 是正确性地基（P0）必须最先；3 依赖稳定 ID 但本身是纯读取、零风险，紧随其后可让后续所有改动自带回归验证手段（每步改完跑 diff 看 outside）；4–8 按站点覆盖率与依赖关系排列；9 最后，因属低频场景的兜底。
