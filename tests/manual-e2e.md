# 真实浏览器回归清单

jsdom 测不了的都在这里：菜单出现时序、body 级 portal、`isTrusted` 降级、
加行后的 DOM 重排。**每个适配器一节，发布前在真实页面上人工过一遍。**

准备：

```bash
node scripts/status.mjs                                   # 必须 ok:true
# 每个 session 第一步永远是 navigate —— tab 绑定是易失的
curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"<申请页 URL>","newTab":true,"group_title":"form-pilot e2e"},"session":"form-e2e"}'
node scripts/inject.mjs --session form-e2e
```

**★ 目标标签页必须在前台可见。** Chrome 节流后台标签页的定时器，而引擎每个异步方法都靠
`sleep` 驱动 —— 后台状态下全部变成无限等待（不报错、不返回）。引擎入口有守卫会回
`err:'tab-hidden'`，但**填到一半被切到后台仍会挂住**。开始前先确认标签页在最前面：

```js
document.hidden   // 必须是 false
```

判据一律是**页面上的可见结果**，不是引擎返回值。引擎说 ok 但字段没变，算失败。

## moka（mokahr.com）｜verified 2026-09-22

参考页：`https://app.mokahr.com/campus-recruitment/<orgSlug>/<orgId>#/job/<id>/apply`

| # | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- |
| 1 | `__ja.detect()` | `'moka'` | ☐ |
| 2 | `__ja.scan()` | 字段识别率 ≥90%；必填标记无漏；`total` 等于页面上真实字段数 | ☐ |
| 3 | 抽查 ID | 教育背景下的字段是 `edu[0]>>学校名称`；个人信息下是 `main>>姓名` | ☐ |
| 4 | 逐个字段肉眼核对 label | 没有把某个 field 的 label 读成相邻字段的 | ☐ |
| 5 | `fillTexts` 批量填 10 个文本字段 | 10 个全部落值；React 重渲染后**值保持**（等 3 秒再看一次） | ☐ |
| 6 | 回读 `readAll()` | 值与写入一致；无 `retried` | ☐ |
| 7 | **连续 5 个下拉** `pickOption` | 每个约 2–3 秒；无一次点到别的菜单；选中后 display-value 更新 | ☐ |
| 8 | 「是否」类字段（`bool_info`） | 走下拉路径选中，值生效 —— 这类字段若被当成文本框，表现为**静默无效** | ☐ |
| 9 | 日期字段（`day_info`） | 落在"待手动"清单里，不被 fillTexts 尝试写入 | ☐ |
| 10 | 上传类字段 | `readAll` 报 `file` 类型；不尝试写值 | ☐ |
| 11 | `addRow('edu')` | 区块内多出一行；返回 `{ok:true,from:1,to:2}`；**旧行的值与 ID 不变** | ☐ |
| 12 | 加行后重新 `scan()` | 出现 `edu[1]>>学校名称`，且 `edu[0]>>学校名称` 仍指向原来那一行 | ☐ |
| 13 | 故意传一个不存在的 id 给 `fillTexts` | `failed[].phase === 'locate'`，`err === 'field-not-found'` | ☐ |
| 14 | 合成事件是否被拒 | 若菜单打不开，记录该字段；不在此控件上反复重试 | ☐ |
| 15 | 最终状态 | **停在提交按钮前，未提交**；截图留档 | ☐ |
| 16 | `fillMonthRange('edu[1]>>就读时间', '2022-09', '2023-09')` | 4 个下拉依次选中，回读与写入一致。**「就读时间」是选择式月区间，不要用 `fillDate`** —— 它会往 4 个下拉内部的 input 写值，在报错的同时已经写坏控件状态 | ☐ |

### moka 的已知坑（踩过就别再踩）

- 字段容器是 `apply-field-*`，**复数 `apply-fields-*` 是行分组**，选择器少一个尾横线就会多算 16 个。
- 加行按钮文本是「添加」两个字，页面上多个按钮同名 —— 只能区块内定位。
- 选「其他」类选项后可能展开子输入框；以填入前的快照为准。

## beisen（*.zhiye.com）｜verified: null，未实测

**首次实际使用时校准，然后回来填这一节并把 `adapters.js` 里的 `verified` 改成当天日期。**
已知待验证项（来源：v1 指南，未实测）：

- 单选是 `div.phoenix-radio`，不是原生 radio → 属 R3，`setChoice` 尚未实现（AGENTS.md §2.4）
- 多选菜单选完要点面板内「确定」才生效 → 同上，R3
- 菜单 portal 在 body 底部 `.common-unmodeled-layer`（取高度 >100 的可见者）
- 重渲染会清临时 class → 不要用固定 class 标记元素，每次现找现点

## generic（未知系统）｜首次遇到时跑

| # | 步骤 | 预期 |
| --- | --- | --- |
| 1 | `__ja.detect()` | `'generic'` |
| 2 | `__ja.scan()` | 字段识别率 ≥90% |
| 3 | 不够用 | 跑站点探针 dump 结构 → 整理成 ≤20 行注册项 → 带 `verified` 日期沉淀回 `engine/adapters.js` |

单次适配目标 ≤5 分钟（`02-adapters-testing.md` §二）。

## 个人档案界面（`scripts/profile.mjs --ui`）｜结构已核、窄屏未核

**为什么在这里**：结构层由 `tests/profile.test.mjs` 的 jsdom 用例覆盖，"看起来对不对"
已用 kimi-webbridge 在真实浏览器里核过一次（三栏宽度、行数、标记数、围栏，数值记在
`docs/plans/06-profile-ui.md §十三`）。**下面第 9 条（窄屏）还没跑过** ——
桥接开的是当前窗口宽度，没改视口。

```bash
node scripts/profile.mjs --ui          # → http://127.0.0.1:8787
```

| # | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- |
| 1 | 1280 宽打开 | 三栏比例正常：左轨不挤、字段名（等宽）不换行、右栏数字右对齐不错位 | ☑ 210/769/240，无横向溢出 |
| 2 | 看 `基本信息` 底部 | `证件号码` 在**朱砂虚线围栏**里，不在普通行中间 | ☑ 围栏存在，内含 1 行 |
| 3 | 改 3 个字段 → 保存 | 顶栏变「已保存 HH:MM」；改过的行下沿有一条墨线扫过 | ☐ |
| 4 | 直接看文件 | `private/profile.json` 的 diff **只动那 3 行**（键序稳定才做得到） | ☐ |
| 5 | 手机号故意填 10 位 | 失焦即红字；点保存被拒、文件不变 | ☐ |
| 6 | 点「映射表」 | 出现只读文本域并已全选；内容里**搜不到**证件号码的值 | ☐ |
| 7 | 粘一个不存在的附件路径 | 该行右侧变「未找到」；保存仍成功（只是 warn） | ☐ |
| 8 | 缩到 768 宽 | 左轨变成横向区段条；字段行变成标签在上、输入在下 | ☐ |
| 9 | 键盘走一遍 | Tab 顺序按行；焦点环可见；⌘S 能保存 | ☐ |

界面上的数字（完整度、分类统计、待你手动）**一律由服务端算**。如果它和 `--check` 的输出对不上，
那是 bug，不要改数字去对齐。

**改了 `tools/profile.schema.mjs` 之后必须重启 `--ui`**：Node 的 ESM 只加载一次。
界面会在顶部提示"字段定义改过了"，看到提示就重启，别去怀疑代码。

## feishu（*.jobs.feishu.cn）｜只读探测 2026-09-22，L3 受控写未跑

参考页：记忆科技校招申请页（`varp4lp3dbc.jobs.feishu.cn`）。

已验证（L2 只读，2026-09-22）：

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | `detect()` | `feishu` ✔ |
| 2 | `scan()` | total 26 / 唯一 26（`起止时间#2` 自动消歧）✔ |
| 3 | 类型判定 | 10 select + 2 date + 2 textarea + 9 text 全对 —— **全靠子树判据**，typeMap 无从写起 ✔ |
| 4 | `unknown` 语义 | 「意向城市」「手机号码」是**只读展示**（值来自账号资料，盒内无 input），报 unknown 属正确行为 ✔ |

L3 校准清单（首次受控写时做，然后回填本节）：

- 菜单 portal 位置与 `itemSel`/`valueSel`（pickOption 依赖；打开菜单属页面状态变更）
- `fillTexts` 批量写 + 回读（此站的输入是 `atsx-input`，与 Moka 不同的 native setter 场景）
- `起止时间` 是 `atsx-date-picker-period-month` 月区间 → 走 `fillMonthRange`（该 API 的第二个站点验证）
- 「学校名称」是下拉（Moka 上是文本框）—— 站点间语义反转，别凭经验选路径

已知坑：

- **SPA 渲染极慢且和窗口焦点相关**：窗口失焦时页面挂 loading 近 2 分钟（数据 92 个请求早已返回）。
  注入前先 evaluate 确认 `[class~="atsx-form-item"]` 数量 > 0，否则等待或把窗口切到前台。
- 盒子选择器必须 `[class~="atsx-form-item"]`（完整词）：裸 `[class*=atsx-form-item]` 实测命中 156 个节点（真盒子 28 个）。
- `<label>` 是干净的字段名事实源；`[class*=fieldName]` 的 textContent 会混入已填值（如"意向城市东莞"），不可用。
- 「个人证件」是 `id-card-wrap`（never 类，永不自动填）。

### feishu L3 受控写结果（2026-09-22 实测回填）

| 项 | 结果 |
| --- | --- |
| fillTexts 文本 10 个 | 全部落值、回读一致（atsx-input 走 native setter 无障碍） |
| pickOption 性别/国籍/政治面貌 | ✔（校准 menuSel 后） |
| 学校名称（搜索型下拉） | ✔ 输入关键字→联想→点匹配项，需专用路径 |
| 学历/直系亲属/渠道/排名 | ✔ 手动事件序列（input 上 mousedown/focus/mouseup/click → 点可见项） |
| pickOption menu-not-open 复发 | 残留菜单 + closeMenus 后引擎 openMenuFor 仍失败 → 手动事件序列可解，**pickOption 在本站不可靠，适配器注释已写明** |
| 期望工作地点 | ✗ 跳过：菜单 available 恒为空（疑似级联，需真实鼠标） |
| 起止时间 ×2 | ✗ 跳过：`atsx-date-picker-period-month` = 隐藏 input + 日历弹层，与 Moka 4 下拉完全不同，fillMonthRange 不适用，留手动 |
| 上传简历 | ✔ bridge `upload {selector:"input[type=file]", files:[绝对路径]}` |
| scan 报 `<有值>` 的 date | **是误读**：valueOf 把 placeholder 文案当成值。回读空 → 别信 scan 的 date 有值 |
