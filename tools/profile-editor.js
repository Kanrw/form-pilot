/* 个人档案界面 —— 登记表。
 *
 * 两件事刻意不在这里做：
 *   1. 分类统计、完整度、待你手动清单全部由服务端算（schema 在那边）。
 *      两侧各算一遍就会有两个数字，用户会先不信界面、再不信工具。
 *   2. 校验的判定权在服务端。这里只做两件轻活：失焦时按 schema 的 pattern 即时提示，
 *      以及把服务端返回的错误渲染出来 —— 规则本身不复制。
 *
 * 写成 IIFE 挂 window.__profileEditor，不用 ESM：与 engine.js 一致，
 * package.json 不需要 type 字段，测试用 jsdom eval 加载（见 tests/helpers/jsdom-setup.mjs）。
 */

(function () {
  'use strict';

  // ── DOM 小工具 ──────────────────────────────────────────────

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
        else if (key === 'on') Object.keys(value).forEach(function (ev) { node.addEventListener(ev, value[ev]); });
        else node.setAttribute(key, value);
      });
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function isBlank(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  // 与服务端约定好的行键：固定字段 `section.field`，段内字段 `section[i].field`。
  function rowId(sectionKey, fieldKey, index) {
    return index === null || index === undefined ? sectionKey + '.' + fieldKey : sectionKey + '[' + index + '].' + fieldKey;
  }

  // ── 数据访问 ───────────────────────────────────────────────

  function readValue(values, section, fieldKey, index) {
    if (section.repeatable) {
      var arr = Array.isArray(values[section.key]) ? values[section.key] : [];
      var item = arr[index] || {};
      return isBlank(item[fieldKey]) ? '' : String(item[fieldKey]);
    }
    var flat = values[section.key + '.' + fieldKey];
    return isBlank(flat) ? '' : String(flat);
  }

  function writeValue(values, section, fieldKey, index, value) {
    if (section.repeatable) {
      if (!Array.isArray(values[section.key])) values[section.key] = [];
      while (values[section.key].length <= index) values[section.key].push({});
      values[section.key][index][fieldKey] = value;
      return;
    }
    values[section.key + '.' + fieldKey] = value;
  }

  function sectionByKey(schema, key) {
    var found = null;
    schema.sections.forEach(function (section) { if (section.key === key) found = section; });
    return found;
  }

  function statOf(stats, key) {
    return (stats && stats.perSection && stats.perSection[key]) || { filled: 0, slots: 0, segments: 0 };
  }

  function indexByKey(list) {
    var map = {};
    (list || []).forEach(function (item) { map[item.key] = item; });
    return map;
  }

  // ── 控件 ──────────────────────────────────────────────────

  var PLACEHOLDER = {
    daterange: '2023-09 -- 2027-06，在读写到「至今」',
    cascade: '例：浙江省 / 杭州市',
    path: '绝对路径或 ~/ 开头',
  };

  function isFullDay(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
  }

  function splitRange(value) {
    var s = String(value || '').trim();
    if (!s) return { start: '', end: '' };
    var m = /^(.+?)\s*(?:--|~|至)\s*(.+?)$/.exec(s);
    if (!m) return null;
    if (/至今|现在|目前/.test(m[2])) return { start: m[1].trim(), end: '' };
    return { start: m[1].trim(), end: m[2].trim() };
  }

  // 起止时间用两个原生日期控件：填表时这些字段多是"年→月→日"三级选择，
  // 档案里也该是选出来的、到日的值，而不是一行自由文本。
  // 只到月/年的旧值不交给日期控件（控件会把不合规的值显示成空，一保存就静默清掉），退化成文本框。
  function buildRange(domId, parts, commit, onBlur) {
    var wrap = el('span', { class: 'range-control' });
    var start = el('input', { type: 'date', id: domId, 'aria-label': '开始日期' });
    start.value = parts.start;
    var end = el('input', { type: 'date', 'aria-label': '结束日期（留空＝至今）' });
    end.value = parts.end;

    var current = function () {
      if (!start.value && !end.value) return '';
      return start.value + ' -- ' + (end.value || '至今');
    };
    var compose = function () { commit(current()); };
    var blur = function () { if (onBlur) onBlur(current()); };
    start.addEventListener('change', compose);
    end.addEventListener('change', compose);
    start.addEventListener('blur', blur);
    end.addEventListener('blur', blur);

    wrap.appendChild(start);
    wrap.appendChild(el('span', { class: 'range-sep', text: '～' }));
    wrap.appendChild(end);
    if (!parts.end) wrap.appendChild(el('span', { class: 'range-note', text: '结束留空＝至今' }));
    return wrap;
  }

  function makeControl(field, domId, value) {
    var hint = field.hint || PLACEHOLDER[field.type] || '';

    if (field.type === 'textarea') {
      var area = el('textarea', { id: domId, rows: 3, placeholder: hint });
      area.value = value;
      return area;
    }

    if (field.type === 'select') {
      var select = el('select', { id: domId });
      select.appendChild(el('option', { value: '', text: '未填' }));
      (field.options || []).forEach(function (option) { select.appendChild(el('option', { value: option, text: option })); });
      // 值不在建议选项里也要保住，否则一保存就被静默改掉
      if (!isBlank(value) && (field.options || []).indexOf(value) < 0) {
        select.appendChild(el('option', { value: value, text: value + '（自定义）' }));
      }
      select.value = value;
      return select;
    }

    var attrs = { id: domId, type: 'text', placeholder: hint };
    if (field.type === 'tel') attrs.type = 'tel';
    if (field.type === 'email') attrs.type = 'email';
    if (field.type === 'date') {
      // 非标准日期值交给原生日期控件会被吃掉、保存时静默清空 —— 退化成文本框保住原值
      attrs.type = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date' : 'text';
    }
    var input = el('input', attrs);
    input.value = value;
    return input;
  }

  // 版本视图里把不该动的控件变只读。disabled 会连选中共复制都做不了，
  // 所以文本类用 readOnly，select 与日期控件只能用 disabled（它们没有 readOnly）。
  function lockControl(control) {
    var nodes = control.matches && control.matches('input,textarea,select')
      ? [control]
      : Array.prototype.slice.call(control.querySelectorAll('input,textarea,select'));
    nodes.forEach(function (node) {
      if (node.tagName === 'SELECT' || node.type === 'date') node.disabled = true;
      else node.readOnly = true;
    });
    return control;
  }

  function pathBadge(id, ctx) {
    var check = null;
    (ctx.pathChecks || []).forEach(function (item) { if (item.key === id) check = item; });
    if (!check || !check.path) return el('span', { class: 'path-badge', text: '未填' });
    return check.exists
      ? el('span', { class: 'path-badge', text: '已找到' })
      : el('span', { class: 'path-badge missing', text: '未找到' });
  }

  function markCell(field, id, ctx) {
    if (field.autofill === 'auto') return el('span', { class: 'mark mark-auto', text: '可自动填' });
    if (field.autofill === 'confirm') return el('span', { class: 'mark mark-confirm', text: '需确认' });
    if (field.autofill === 'path') return pathBadge(id, ctx);
    return el('span', { class: 'mark mark-muted', text: field.autofill === 'never' ? '不导出' : '不导出' });
  }

  function messageFor(id, field, ctx) {
    var error = ctx.errors && ctx.errors[id];
    if (error) return { kind: 'error', text: error.message };
    var warning = ctx.warnings && ctx.warnings[id];
    if (warning) return { kind: 'warn', text: warning.message };
    if (field.hint) return { kind: 'hint', text: field.hint };
    return null;
  }

  function controlFor(field, domId, value, id, section, index, ctx) {
    var emit = function (next) { ctx.onEdit(id, section, field.key, index, next); };
    var check = function (next) { ctx.onLiveCheck(id, field, next); };

    if (field.type === 'daterange') {
      var parts = splitRange(value);
      if (parts && isFullDay(parts.start) && (!parts.end || isFullDay(parts.end))) {
        return buildRange(domId, parts, emit, check);
      }
    }
    var control = makeControl(field, domId, value);
    control.addEventListener('input', function () { emit(control.value); });
    control.addEventListener('change', function () { emit(control.value); });
    control.addEventListener('blur', function () { check(control.value); });
    return control;
  }

  function fieldRow(section, field, index, ctx) {
    var id = rowId(section.key, field.key, index);
    var domId = 'f-' + id.replace(/[^A-Za-z0-9]+/g, '-');
    var value = readValue(ctx.values, section, field.key, index);
    var overridden = !!(ctx.overrides && Object.prototype.hasOwnProperty.call(ctx.overrides, id));
    // 版本视图里只有白名单字段能改。通用事实（手机号、教育、论文…）在版本里物理上改不动 ——
    // 否则"我改了手机号"其实只改了某个版本，下次投别的岗位才发现。
    var locked = !!ctx.version && !field.overridable;
    var message = messageFor(id, field, ctx);
    // 文本框的 hint 已经当占位符显示过了，别再在下面重复一遍（日期控件与下拉没有占位符，则不在此列）。
    if (message && message.kind === 'hint' && field.hint && field.type !== 'select') message = null;
    // 原生日期控件按浏览器区域显示：这台机器上是 DD/MM/YYYY，所以 2001-01-01 显示成 01/01/2001。
    // 存的值始终是 ISO YYYY-MM-DD，把 ISO 回显出来，免得用户按显示格式去读。
    if (field.type === 'date' && !isBlank(value) && !message) {
      message = { kind: 'hint', text: '存的是 ' + value };
    }

    var rowClass = 'field-row';
    if (message && message.kind === 'error') rowClass += ' is-error';
    if (locked) rowClass += ' is-locked';
    var row = el('div', { class: rowClass, dataset: { rowkey: id } });

    var label = el('label', { class: 'field-label', for: domId, text: field.label });
    if (overridden) {
      label.appendChild(el('span', { class: 'badge-override', text: '本版本已改', title: '这个值只在这个版本生效' }));
    }
    if (locked) label.setAttribute('title', '通用事实：不在版本白名单里，要改就切回基准档案');
    row.appendChild(label);

    var control = controlFor(field, domId, value, id, section, index, ctx);
    if (locked) lockControl(control);
    row.appendChild(control);
    row.appendChild(markCell(field, id, ctx));

    var msgClass = 'field-msg';
    if (message && message.kind === 'error') msgClass += ' msg-error';
    if (message && message.kind === 'warn') msgClass += ' msg-warn';
    var msg = el('p', { class: msgClass });
    if (message) msg.appendChild(document.createTextNode(message.text));
    if (overridden) {
      msg.appendChild(el('button', {
        type: 'button', class: 'link restore-btn', text: '还原为基准',
        on: { click: function () { ctx.onAction({ type: 'restore-override', id: id }); } },
      }));
    }
    row.appendChild(msg);
    return row;
  }

  // ── 登记表 ────────────────────────────────────────────────

  function segmentBlock(section, index, total, ctx) {
    var block = el('div', { class: 'segment' });
    var head = el('div', { class: 'segment-head' }, [
      el('h2', { text: section.label }),
      el('span', { class: 'ord', text: '第 ' + (index + 1) + ' 段 / 共 ' + total + ' 段' }),
      el('span', { class: 'spacer' }),
    ]);
    if (index > 0) {
      head.appendChild(el('button', {
        type: 'button', class: 'link', text: '上移',
        on: { click: function () { ctx.onAction({ type: 'move-segment', section: section.key, index: index, delta: -1 }); } },
      }));
    }
    if (index < total - 1) {
      head.appendChild(el('button', {
        type: 'button', class: 'link', text: '下移',
        on: { click: function () { ctx.onAction({ type: 'move-segment', section: section.key, index: index, delta: 1 }); } },
      }));
    }
    head.appendChild(el('button', {
      type: 'button', class: 'link', text: '删除这一段',
      on: { click: function () { ctx.onAction({ type: 'remove-segment', section: section.key, index: index }); } },
    }));
    block.appendChild(head);

    section.fields.filter(function (field) { return field.autofill !== 'never'; }).forEach(function (field) {
      block.appendChild(fieldRow(section, field, index, ctx));
    });
    return block;
  }

  function renderSection(node, ctx) {
    clear(node);
    var section = sectionByKey(ctx.schema, ctx.section) || ctx.schema.sections[0];
    if (!section) return node;
    var stat = statOf(ctx.stats, section.key);

    node.appendChild(el('div', { class: 'section-head' }, [
      el('h2', { text: section.label }),
      el('span', {
        class: 'meta',
        text: section.repeatable ? stat.segments + ' 段' : stat.filled + ' / ' + stat.slots + ' 已填',
      }),
    ]));

    var neverFields = section.fields.filter(function (field) { return field.autofill === 'never'; });

    if (section.repeatable) {
      var arr = Array.isArray(ctx.values[section.key]) ? ctx.values[section.key] : [];
      arr.forEach(function (item, index) { node.appendChild(segmentBlock(section, index, arr.length, ctx)); });
      if (!arr.length) {
        node.appendChild(el('p', { class: 'field-msg', text: '这一段还是空的。点下面的「添加一段」。' }));
      }
      node.appendChild(el('div', { style: 'margin-top:16px' }, [
        el('button', {
          type: 'button', text: '添加一段',
          on: { click: function () { ctx.onAction({ type: 'add-segment', section: section.key }); } },
        }),
      ]));
    } else {
      section.fields
        .filter(function (field) { return field.autofill !== 'never'; })
        .forEach(function (field) { node.appendChild(fieldRow(section, field, null, ctx)); });
    }

    if (neverFields.length) {
      // 围栏是渲染规则，不是区段：任何 autofill=never 的字段都落进来。
      var fence = el('div', { class: 'fence' }, [
        el('p', { class: 'fence-title', text: '本地记录 · 引擎永不使用' }),
        el('p', { class: 'fence-note', text: '这里的值不进任何映射，也不会随表单提交。留空完全正常。' }),
      ]);
      neverFields.forEach(function (field) { fence.appendChild(fieldRow(section, field, null, ctx)); });
      node.appendChild(fence);
    }
    return node;
  }

  function renderRail(node, ctx) {
    clear(node);
    ctx.schema.sections.forEach(function (section) {
      var stat = statOf(ctx.stats, section.key);
      var count = section.repeatable ? stat.segments + ' 段' : stat.filled + '/' + stat.slots;
      var button = el('button', {
        type: 'button',
        class: 'rail-item',
        'aria-current': String(ctx.section === section.key),
      }, [el('span', { text: section.short || section.label }), el('span', { class: 'count', text: count })]);
      button.addEventListener('click', function () { ctx.onAction({ type: 'goto-section', section: section.key }); });
      node.appendChild(button);
    });
    return node;
  }

  // 覆盖键 → 人能读的标签（`intent.targetRole` → 「求职意向 · 意向岗位」）
  function overrideLabel(schema, key) {
    var found = key;
    schema.sections.forEach(function (section) {
      section.fields.forEach(function (field) {
        if (section.key + '.' + field.key === key) found = section.label + ' · ' + field.label;
      });
    });
    return found;
  }

  var CATEGORY_HELP = {
    auto: '值不随公司变，映射确认后由引擎批量填',
    confirm: '值随公司/岗位的口径变，必须每项单独确认',
    never: '引擎不提供也不接受这类值，也不会出现在映射表里',
    path: '本机文件路径：只做存在性校验，上传走桥，不经引擎',
    note: '给人看的记录，不进映射',
  };

  function renderAside(node, ctx) {
    clear(node);
    var stats = ctx.stats || { byAutofill: {}, manual: [] };
    var categories = ctx.schema.categories || {};

    node.appendChild(el('h2', { text: '分类统计' }));
    ['auto', 'confirm', 'never', 'path', 'note'].forEach(function (key) {
      var bucket = stats.byAutofill && stats.byAutofill[key];
      if (!bucket || !bucket.slots) return;
      var catLabel = (categories[key] || {}).label || key;
      var row = el('div', { class: 'stat-row' }, [
        el('span', { class: 'mark mark-' + key, text: catLabel }),
        el('span', { class: 'num', text: bucket.filled + ' / ' + bucket.slots }),
      ]);
      row.setAttribute('title', CATEGORY_HELP[key] || catLabel);
      node.appendChild(row);
    });

    var inMap = ((stats.byAutofill || {}).auto || { filled: 0 }).filled + ((stats.byAutofill || {}).confirm || { filled: 0 }).filled;
    node.appendChild(el('div', { class: 'divider' }));
    // 分类的含义与"最后怎么确认"必须写在界面上 —— 不然用户只能来问。
    node.appendChild(el('p', { class: 'legend', text: '可自动填：值不随公司变，映射确认后批量填。' }));
    node.appendChild(el('p', { class: 'legend', text: '需确认：值随公司/岗位的口径变（用词、选项集、薪资口径），每项单独过。' }));
    node.appendChild(el('p', { class: 'legend', text: '永不自动填：引擎不提供也不接受，也不会出现在映射表里。' }));
    node.appendChild(el('p', { class: 'legend', text: '怎么确认：点下面的「映射表」复制给助手，它会按目标表单逐项列出核对。' }));
    node.appendChild(el('div', { class: 'divider' }));
    node.appendChild(el('p', { text: '引擎将收到 ' + inMap + ' 个字段的映射' }));

    var manual = stats.manual || [];
    node.appendChild(el('div', { class: 'divider' }));
    node.appendChild(el('h2', { text: '待你手动 ' + manual.length }));
    if (!manual.length) node.appendChild(el('p', { class: 'manual-item', text: '（无）' }));
    manual.slice(0, 10).forEach(function (item) {
      node.appendChild(el('p', { class: 'manual-item', text: item.label }));
    });
    if (manual.length > 10) node.appendChild(el('p', { class: 'manual-item', text: '… 还有 ' + (manual.length - 10) + ' 项' }));

    if (ctx.version) {
      var keys = Object.keys(ctx.overrides);
      node.appendChild(el('div', { class: 'divider' }));
      node.appendChild(el('h2', { text: '本版本覆盖 ' + keys.length + ' 项' }));
      if (!keys.length) node.appendChild(el('p', { class: 'manual-item', text: '（与基准一致）' }));
      keys.forEach(function (key) {
        node.appendChild(el('p', { class: 'manual-item', text: overrideLabel(ctx.schema, key) }));
      });
    }

    node.appendChild(el('div', { class: 'stack' }, [
      el('button', {
        type: 'button', text: '映射表',
        on: { click: function () { ctx.onAction({ type: 'show-mapping' }); } },
      }),
    ]));
    node.appendChild(el('p', { class: 'manual-item', text: '复制后发给助手，就是填表的第一道确认。' }));
    return node;
  }

  // ── 页面装配 ──────────────────────────────────────────────

  function boot() {
    var els = {
      rail: document.getElementById('rail'),
      main: document.getElementById('main'),
      aside: document.getElementById('aside'),
      file: document.getElementById('file-path'),
      completeness: document.getElementById('stat-completeness'),
      saveState: document.getElementById('save-state'),
      save: document.getElementById('save'),
      banner: document.getElementById('banner'),
      version: document.getElementById('version'),
      versionNote: document.getElementById('version-note'),
    };

    var state = {
      section: 'basic',
      schema: null,
      values: {},
      baseValues: {},
      version: '',
      versions: [],
      overrides: {},
      overridableKeys: {},
      unknownKeys: {},
      stats: null,
      errors: {},
      warnings: {},
      pathChecks: [],
      dirty: false,
      changed: {},
      filePath: '',
      legacyMdExists: false,
      exists: false,
    };

    function setSaveState(text) { els.saveState.textContent = text; }

    function ctx() {
      return {
        schema: state.schema,
        values: state.values,
        stats: state.stats,
        errors: state.errors,
        warnings: state.warnings,
        pathChecks: state.pathChecks,
        section: state.section,
        version: state.version,
        overrides: state.overrides,
        onEdit: onEdit,
        onLiveCheck: onLiveCheck,
        onAction: onAction,
      };
    }

    function applyServerResult(body) {
      state.stats = body.stats || state.stats;
      state.errors = indexByKey(body.errors);
      state.warnings = indexByKey(body.warnings);
      state.pathChecks = body.pathChecks || state.pathChecks;
    }

    function renderVersionPicker() {
      var node = els.version;
      clear(node);
      node.appendChild(el('option', { value: '', text: '基准档案' }));
      state.versions.forEach(function (v) {
        node.appendChild(el('option', { value: v.name, text: v.name + ' · 覆盖 ' + v.overrides + ' 项' }));
      });
      node.appendChild(el('option', { value: '__new__', text: '＋ 新建版本（从基准开始）…' }));
      node.appendChild(el('option', { value: '__copy__', text: '复制当前版本…' }));
      node.value = state.version;
    }

    function renderVersionNote() {
      var node = els.versionNote;
      clear(node);
      if (!state.version) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      var count = Object.keys(state.overrides).length;
      node.appendChild(el('strong', { text: '版本「' + state.version + '」' }));
      node.appendChild(el('span', { text: '：只有口径字段（求职意向、自我评价）能改，覆盖了 ' + count + ' 项；通用事实切回基准档案改。' }));
    }

    function render() {
      els.file.textContent = state.filePath || '';
      els.file.title = state.filePath || '';
      els.completeness.textContent = state.stats ? state.stats.completeness : '—';

      renderVersionPicker();
      renderVersionNote();
      renderRail(els.rail, ctx());
      renderSection(els.main, ctx());
      renderAside(els.aside, ctx());
    }

    function refreshRow(id) {
      var row = els.main.querySelector('[data-rowkey="' + id + '"]');
      if (!row) return;
      var error = state.errors[id];
      var warning = state.warnings[id];
      row.classList.toggle('is-error', !!error);
      var msg = row.querySelector('.field-msg');
      if (!msg) return;
      msg.className = 'field-msg';
      msg.textContent = '';
      if (error) { msg.classList.add('msg-error'); msg.textContent = error.message; }
      else if (warning) { msg.classList.add('msg-warn'); msg.textContent = warning.message; }
    }

    function onEdit(id, section, fieldKey, index, value) {
      // 双保险：界面上已经锁住了，这里再挡一次 —— 覆盖集一旦混进通用事实，
      // 就变成"改了某个版本的手机号"这种静默错误。
      if (state.version && !state.overridableKeys[id]) return;
      writeValue(state.values, section, fieldKey, index, value);
      if (state.version) state.overrides[id] = value;
      state.dirty = true;
      state.changed[id] = true;
      if (state.errors[id]) { delete state.errors[id]; refreshRow(id); }
      setSaveState('有未保存改动');
    }

    // 即时提示只按 schema 的 pattern 走；判定权仍在服务端。
    function onLiveCheck(id, field, value) {
      if (!field.pattern || isBlank(value)) { if (state.errors[id]) { delete state.errors[id]; refreshRow(id); } return; }
      var ok = true;
      try { ok = new RegExp(field.pattern.source, field.pattern.flags).test(String(value).trim()); } catch (e) { ok = true; }
      if (ok) { if (state.errors[id]) { delete state.errors[id]; refreshRow(id); } return; }
      state.errors[id] = { key: id, level: 'error', message: field.pattern.message };
      refreshRow(id);
    }

    function onAction(action) {
      if (action.type === 'goto-section') { state.section = action.section; render(); return; }
      if (action.type === 'add-segment') {
        var section = sectionByKey(state.schema, action.section);
        if (!section) return;
        if (!Array.isArray(state.values[action.section])) state.values[action.section] = [];
        state.values[action.section].push({});
        state.dirty = true;
        setSaveState('有未保存改动');
        render();
        return;
      }
      if (action.type === 'remove-segment') {
        var arr = state.values[action.section] || [];
        arr.splice(action.index, 1);
        state.dirty = true;
        setSaveState('有未保存改动');
        render();
        return;
      }
      if (action.type === 'move-segment') {
        var list = state.values[action.section] || [];
        var to = action.index + action.delta;
        if (to < 0 || to >= list.length) return;
        var moved = list.splice(action.index, 1)[0];
        list.splice(to, 0, moved);
        state.dirty = true;
        setSaveState('有未保存改动');
        render();
        return;
      }
      if (action.type === 'restore-override') {
        delete state.overrides[action.id];
        // 用服务端给的基准值回填，不在前端重新实现"基准 ⊕ 覆盖"的合并
        state.values[action.id] = state.baseValues[action.id] === undefined ? '' : state.baseValues[action.id];
        state.dirty = true;
        state.changed[action.id] = true;
        render();
        setSaveState('已还原（未保存）');
        return;
      }
      if (action.type === 'save') { save(); return; }
      if (action.type === 'show-mapping') { showMapping(); return; }
    }

    function applyProfile(body) {
      state.schema = body.schema;
      state.overridableKeys = {};
      body.schema.sections.forEach(function (section) {
        if (section.repeatable) return;
        section.fields.forEach(function (field) {
          if (field.overridable) state.overridableKeys[section.key + '.' + field.key] = true;
        });
      });
      state.values = body.values;
      state.version = body.version || '';
      state.overrides = body.overrides || {};
      state.versions = body.versions || [];
      state.unknownKeys = body.unknownKeys || {};
      state.filePath = body.filePath;
      state.exists = body.exists;
      state.legacyMdExists = body.legacyMdExists;
      applyServerResult(body);
      render();
    }

    function load() {
      // 先拿基准（还原时要回填它的值），再按当前版本取解析后的视图。
      return fetch('/api/profile')
        .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
        .then(function (result) {
          if (result.status !== 200) { setSaveState('读取失败：' + (result.body.error || result.status)); return null; }
          state.baseValues = result.body.values;
          state.defaultVersion = result.body.version || '';
          applyProfile(result.body);
          // 服务进程的 schema 是启动时加载的：改完 schema 不重启，界面会继续用旧规则校验，
          // 报出来的错对不上文件内容，看起来像代码 bug。
          if (result.body.schemaStale) showStaleBanner();
          else if (!result.body.exists && result.body.legacyMdExists) showImportBanner();
          return state.version ? loadVersion(state.version) : null;
        })
        .catch(function (error) { setSaveState('读取失败：' + error.message); });
    }

    function loadVersion(name) {
      return fetch('/api/profile?version=' + encodeURIComponent(name))
        .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
        .then(function (result) {
          if (result.status !== 200) {
            setSaveState('切换失败：' + (result.body.message || result.body.error || result.status));
            return null;
          }
          applyProfile(result.body);
          state.dirty = false;
          state.changed = {};
          setSaveState('已加载版本「' + name + '」');
          return null;
        });
    }

    function switchVersion(name) {
      if (state.dirty && !window.confirm('当前有未保存的改动，切换版本会丢掉。继续吗？')) {
        renderVersionPicker();
        return null;
      }
      if (!name) {
        state.version = '';
        state.overrides = {};
        state.dirty = false;
        state.changed = {};
        return load();
      }
      state.dirty = false;
      state.changed = {};
      return loadVersion(name);
    }

    function createVersion(kind) {
      var suggestion = kind === 'copy' && state.version ? state.version + '-2' : '新版本';
      var name = window.prompt(kind === 'copy' ? '复制当前版本，新版本叫什么？' : '新建一个版本（从基准开始），叫什么？', suggestion);
      if (!name) { renderVersionPicker(); return null; }
      return fetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), from: kind === 'copy' ? state.version : '' }),
      })
        .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
        .then(function (result) {
          if (result.status !== 200) {
            setSaveState('新建失败：' + (result.body.message || result.body.error));
            renderVersionPicker();
            return null;
          }
          state.version = result.body.name;
          state.overrides = {};
          setSaveState('已新建版本「' + result.body.name + '」');
          return loadVersion(result.body.name);
        })
        .catch(function (error) { setSaveState('新建失败：' + error.message); return null; });
    }

    function showStaleBanner() {
      clear(els.banner);
      els.banner.hidden = false;
      els.banner.appendChild(el('strong', { text: '字段定义改过了。' }));
      els.banner.appendChild(el('span', { text: '界面还在按旧规则校验，重启一次 --ui 才会生效。' }));
      els.banner.appendChild(el('button', {
        type: 'button', class: 'link', text: '仍然继续',
        on: { click: function () { els.banner.hidden = true; } },
      }));
    }

    function save() {
      if (!state.schema) return;
      setSaveState('保存中…');
      var url = state.version ? '/api/profile?version=' + encodeURIComponent(state.version) : '/api/profile';
      var payload = state.version
        ? { overrides: state.overrides }
        : { values: state.values, unknownKeys: state.unknownKeys };
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
        .then(function (result) {
          applyServerResult(result.body);
          if (result.status !== 200) {
            state.dirty = true;
            setSaveState('未保存：有 ' + (result.body.errors || []).length + ' 个格式问题');
            render();
            return;
          }
          state.dirty = false;
          var at = new Date(result.body.savedAt);
          setSaveState('已保存 ' + ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2));
          render();
          Object.keys(state.changed).forEach(function (id) {
            var row = els.main.querySelector('[data-rowkey="' + id + '"]');
            if (!row) return;
            row.classList.add('is-saved');
            setTimeout(function () { row.classList.remove('is-saved'); }, 220);
          });
          state.changed = {};
        })
        .catch(function (error) { setSaveState('保存失败：' + error.message); });
    }

    function showMapping() {
      var existing = document.getElementById('mapping-panel');
      if (existing) { existing.remove(); return; }
      fetch('/api/mapping')
        .then(function (response) { return response.text(); })
        .then(function (text) {
          var area = el('textarea', { rows: 14, readonly: 'readonly', 'aria-label': '映射表' });
          area.style.width = '100%';
          area.style.fontFamily = 'var(--font-mono)';
          area.style.fontSize = '11px';
          area.value = text;
          var panel = el('div', { id: 'mapping-panel', class: 'stack' }, [
            el('p', { class: 'manual-item', text: '映射表（不含「永不自动填」的字段）' }),
            area,
          ]);
          els.aside.appendChild(panel);
          area.focus();
          area.select();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
        })
        .catch(function (error) { setSaveState('映射表生成失败：' + error.message); });
    }

    function showImportBanner() {
      clear(els.banner);
      els.banner.hidden = false;
      els.banner.appendChild(el('strong', { text: '还没有档案文件。' }));
      els.banner.appendChild(el('span', { text: '检测到 private/profile.md，可以直接导入，不用敲命令：' }));
      els.banner.appendChild(el('button', { type: 'button', text: '从 profile.md 导入', on: { click: function () { runImport(false); } } }));
      els.banner.appendChild(el('button', {
        type: 'button', class: 'link', text: '先不管',
        on: { click: function () { els.banner.hidden = true; } },
      }));
    }

    function runImport(force) {
      fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!force }),
      })
        .then(function (response) { return response.json().then(function (body) { return { status: response.status, body: body }; }); })
        .then(function (result) {
          if (result.status === 200) {
            els.banner.hidden = true;
            setSaveState('已导入 ' + result.body.matchedFields + ' 个字段');
            return load();
          }
          if (result.status === 409 && !force) {
            var go = window.confirm('档案里已经有内容了。导入会覆盖它（覆盖前会自动备份成 profile.json.bak）。继续吗？');
            if (go) return runImport(true);
            return null;
          }
          setSaveState('导入失败：' + (result.body.message || result.body.error));
          return null;
        })
        .catch(function (error) { setSaveState('导入失败：' + error.message); });
    }

    els.save.addEventListener('click', save);
    els.version.addEventListener('change', function () {
      var value = els.version.value;
      if (value === '__new__' || value === '__copy__') createVersion(value === '__copy__' ? 'copy' : 'new');
      else switchVersion(value);
    });
    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); save(); }
    });
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });

    load();
  }

  window.__profileEditor = {
    el: el,
    clear: clear,
    rowId: rowId,
    readValue: readValue,
    writeValue: writeValue,
    isBlank: isBlank,
    renderSection: renderSection,
    renderRail: renderRail,
    renderAside: renderAside,
  };

  // 只有真页面（带 data-profile-editor 的骨架）才自动启动；测试里的空壳不会触发，也不会去打网络。
  if (document.querySelector('[data-profile-editor]')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
}());
