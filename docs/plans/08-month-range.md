# 08 · 月区间（起止时间）自动化：研究、审查与实测记录

> 起因（用户）：「为啥起止时间的选择这么困难？广泛搜索资料，提供多个方案，独立 agent 审查。」
> 结论先行：**飞书月区间本轮未攻克，落人工**（每字段 ~10 秒）。Moka 的 4 下拉路径 `fillMonthRange` 已通。
> 本文档记录全部证据链，下次遇到 antd fork 站点时按「下次攻击路径」继续，不要重复本研究。

## 一、问题本质（为什么每次都搞不定）

| 站点 | 结构 | 已有自动化 |
| --- | --- | --- |
| Moka | `sd-Select` 4 个下拉（起始年/月、结束年/月） | ✅ `fillMonthRange`（rangeSel/rangeSelectSel 声明式） |
| 飞书 | `atsx-date-picker-period-month`：可见层是纯文本展示，盒内 1 个 `period-hidden-input`；点击后弹面板 = **两个可编辑 input + 年/月两列** | ❌ |

难的根源不是"日期控件"这个类别，而是**每个组件库的月区间交互模型都不同**，且飞书的值链路（hidden input ↔ React state ↔ display）三处互不同步，任何一处直写都是假象。

## 二、实测证据链（2026-09-22，全部亲手验证）

1. **native setter 直写 hidden input = DOM 假象**：`input.value` 从 "" 变成写入值，display（"2023-09 2027-06"）纹丝不动。审查者定性：hidden input 是**提交值镜像，没有 onChange 接线**——这解释了它为什么叫 hidden-input 也解释了直写必败。
2. **合成事件（dispatchEvent）打不开面板**：mousedown/mouseup/click 全派发，面板不渲染。
3. **`mouse_click`（真实鼠标）能打开面板**：截图证实面板 = 两个可编辑 input + 年/月两列（截图里年列 2023-2027、月列 04-09——**被当前值/disabledDate 限死的窗口**）。
4. **真实点击后焦点落在 hidden input 上**（`document.activeElement` 实测）——审查者质疑的"焦点未证实"补上了。
5. **`key_type` 真实键入成功**：`inputNow: "2021-09"`（逐键进了 hidden input）。
6. **但 Enter（`key_type "\n"` 与 `send_keys {keys:"Enter"}`，dispatched:1 os:mac）都不触发提交**：display 仍为占位。→ **方案 A 的核心假设被否证：飞书 fork 的 hidden input 不是 rc-picker 的键盘提交入口**。
7. 试验脏值已全部清理（hidden input 恢复空，用户手动填的教育起止 2023-09/2027-06 完好）。
8. 附带确认：`scan()` 对 date 字段报 `<有值>` 是把 placeholder 当值——**判定 date 有无值只能靠回读 display 或 hidden input**。

## 三、方案集与审查结论（独立 agent 审查，2026-09-22）

| 方案 | 内容 | 审查结论 | 实测结果 |
| --- | --- | --- | --- |
| A 真实点击+键入 | mouse_click 开面板 → key_type 起值 → Enter → 止值 | 有两洞（焦点、Enter 缺口），仍排第一 | ❌ 键入成功但 Enter 不提交（否证 #6） |
| B 面板两列点选 | 点年列+月列 | **伪方案，判死**：两列被 disabledDate 限死（实测年列最低 2023），档案里硕士 2022、本科 2018、项目 2021 全在窗口外，点选永远选不到且静默 | 未实施 |
| C cdp 直通 | 桥接 `cdp` 动作发 Input.* | 冗余：不解决 A 的焦点/提交问题，多一层坐标依赖；仅当真实事件被站点拒时用 | 未实施 |
| D 人工 | 每字段 ~10 秒 | 不是答案，是兜底 | ✅ 当前状态 |

审查者的关键判断（被实测证实/修正）：
- ✅ "hidden input 没有 onChange 接线" —— 解释了 native setter 必败
- ✅ "焦点是否落在起 input"是真缺口 —— 实测落在 hidden input（但没用）
- ❌ "A 能成" —— 键入成功但提交路径不存在，飞书 fork 改了键盘行为
- ✅ "≤2 轮失败即落人工" —— 执行了

## 四、下次攻击路径（遇到 antd fork 站点时）

1. **fill 面板 input 变体（未试）**：mouse_click 开面板后**立即**（面板存活窗口内）用桥接 `fill {selector}` 对面板内两个可见 input 填值——面板 input 是真正有 onChange 接线的元素。本轮卡在"面板随焦点关闭、二次 evaluate 时已关"，下次用 `find` 动作（返回 @e ref）在面板存活的同一轮里完成。
2. `cdp` 动作发 `Input.dispatchKeyEvent`（keyDown+keyUp 带 keyCode 13）替代 `send_keys`——更底层的 Enter。
3. 检查 antd fork 是否有 `needConfirm`/`ok` 按钮（v5.14+ 行为差异）。
4. 若仍不通：**接受月区间为"每站人工"**，把它写进适配器的 `manualFields` 声明（结构化的待手动清单），不要造通用机器（§2.4）。

## 五、当前状态（本页）

起止时间 6 个：教育[0] 已填（用户手点，2023-09~2027-06），其余 5 个空（教育1/2、工作、项目×2），**留人工**。
档案对应值：edu[1] 2022-09~2023-09 / edu[2] 2018-09~2022-06 / 工作 2022-09~至今 / 项目见 `private/profile.json` projects。
