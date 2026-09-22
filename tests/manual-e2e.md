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
