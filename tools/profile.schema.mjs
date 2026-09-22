// 个人档案的字段定义 —— 唯一来源。
//
// 职责分离（见 docs/plans/06-profile-ui.md §四）：
//   本文件 = 字段定义（标签、类型、分类、校验规则）；
//   private/profile.json = 只有值。
// 分类刻意只写在这里，不写进数据文件 —— 否则同一个事实存两处，
// 而"永不自动填"恰恰是最不能靠两处同步来保证的一条。

export const SCHEMA_VERSION = 1;

// 分类枚举。inMap 决定该字段是否出现在给引擎的映射表里。
//
// 分类要回答的问题是"**值**需不需要人判断"，不是"**控件**难不难填"：
// 日期区间曾经被标成 confirm（理由是表单的日期三级选择难自动化），那是控件的难度；
// 值本身精确到日之后是唯一的，就该是 auto。标错会让人以为每处日期都得再确认一遍。
export const AUTOFILL = {
  auto: { label: '可自动填', inMap: true },
  confirm: { label: '需确认', inMap: true },
  never: { label: '永不自动填', inMap: false },
  path: { label: '路径', inMap: false },
  note: { label: '记录', inMap: false },
};

// 校验规则里"只提示不阻断"的缺席检查：留空比对错值安全（docs/profile-template.md 的口径）。
// 日期故意不要求到日：简历常常只有年月，而引擎的 fillDate 接受 'YYYY' / 'YYYY-MM' / 'YYYY-MM-DD'
// 并把补出来的部分记在 assumed 里。档案比引擎还严，只会逼用户去编一个日子。
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
// 区间两侧同样只要求"到引擎能接受的最粗精度"：只有年份是合法的（简历上常见），
// fillDate 会把补出来的月份/日期报在 assumed 里，不缺信息。
const RANGE_RE = /^\d{4}(-\d{2}(-\d{2})?)?\s*(--|~|至)\s*(\d{4}(-\d{2}(-\d{2})?)?|至今)$/;
const DATERANGE_MESSAGE = '用 YYYY-MM -- YYYY-MM（只有年份也可以），在读写到「至今」';

// 值里混进作者自己的批注 —— 这种串会被原样填进表单提交出去，是最难发现的一类错。
const ANNOTATION_RE = /\*\*|待你确认|待确认|待核实/;

function f(key, label, type, autofill, extra = {}) {
  return {
    key,
    label,
    type,
    autofill,
    options: extra.options || null,
    hint: extra.hint || '',
    recommended: !!extra.recommended,
    validate: extra.validate || null,
    // 同一个字段在别的写法里叫什么。迁移时会遇到用户自己那份档案的写法，
    // 名字对不上就等于丢字段（命名失败：导入报 ok，值却没了）。
    aliases: extra.aliases || null,
    // 是否允许被"投放版本"覆盖。默认不允许 —— 版本能覆盖什么必须是显式声明的，
    // 否则"改手机号"会变成"改了某个版本的手机号"（静默，下次投别的岗位才发现）。
    overridable: !!extra.overridable,
  };
}

function err(pattern, message) {
  return { pattern, level: 'error', message };
}

export const SECTIONS = [
  {
    key: 'basic',
    label: '基本信息',
    short: '基本信息',
    repeatable: false,
    fields: [
      f('name', '姓名', 'text', 'auto', { recommended: true }),
      f('englishName', '英文名', 'text', 'auto'),
      f('formerName', '曾用名', 'text', 'auto', { hint: '没有就留空' }),
      f('gender', '性别', 'select', 'auto', { options: ['男', '女'] }),
      f('birthDate', '出生日期', 'date', 'auto', { validate: err(DATE_RE, '用 YYYY-MM-DD；只有年月就写 YYYY-MM（引擎会按 01 补日并报出来）') }),
      f('height', '身高', 'text', 'auto', { hint: '表格要求的带上单位，如 176 cm' }),
      f('weight', '体重', 'text', 'auto'),
      f('ethnicity', '民族', 'text', 'auto'),
      f('politicalStatus', '政治面貌', 'select', 'confirm', {
        options: ['中共党员', '中共预备党员', '共青团员', '民主党派', '群众'],
        hint: '各家用词不同，填表时逐项确认',
      }),
      f('maritalStatus', '婚姻状况', 'select', 'auto', { options: ['未婚', '已婚'] }),
      f('nationality', '国籍', 'text', 'auto'),
      f('overseasResidence', '海外永久居留权', 'select', 'auto', { options: ['是', '否'] }),
      f('idType', '证件类型', 'select', 'auto', { options: ['身份证'] }),
      f('idNumber', '证件号码', 'text', 'never', { hint: '引擎不提供也不接受这类值' }),
      f('nativePlace', '籍贯（省 / 市）', 'cascade', 'confirm', { hint: '写法随表单，填表时确认' }),
      f('originPlace', '生源地', 'text', 'auto', { aliases: ['生源所在地'] }),
      f('householdRegistration', '户口所在地', 'text', 'auto'),
      f('currentCity', '现居住城市', 'text', 'auto', { aliases: ['现居住地', '现居城市'] }),
      f('mailingAddress', '通讯地址', 'textarea', 'auto'),
      f('phone', '手机号码', 'tel', 'auto', { recommended: true, validate: err(/^1[3-9]\d{9}$/, '应为 11 位数字，以 1 开头') }),
      f('email', '邮箱', 'email', 'auto', { recommended: true, validate: err(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不完整') }),
      f('wechat', '微信', 'text', 'auto', { aliases: ['微信号'] }),
      f('github', 'GitHub', 'text', 'auto'),
      f('orcid', 'ORCID', 'text', 'auto'),
      f('emergencyContactName', '紧急联系人', 'text', 'confirm', { hint: '第三方个人信息，逐项确认后再填' }),
      f('emergencyContactPhone', '紧急联系人电话', 'tel', 'confirm', {
        validate: err(/^\+?[\d\-\s()]{6,25}$/, '应为电话号码（可带区号与分隔符）'),
        hint: '与联系人分开存 —— 合并成一个字符串时，只想取电话的表单格没法填',
      }),
      f('failedCourses', '挂科门数', 'text', 'auto', { hint: '表单常问，没有就写 0' }),
      f('hobbies', '个人爱好', 'text', 'auto', { hint: '本硕博表单常单独问一格，分隔符随表单，用顿号最常见' }),
    ],
  },
  {
    key: 'education',
    label: '教育经历',
    short: '教育经历',
    repeatable: true,
    fields: [
      f('school', '学校名称', 'text', 'auto'),
      f('period', '就读时间', 'daterange', 'auto', { validate: err(RANGE_RE, DATERANGE_MESSAGE) }),
      f('studyType', '学习形式', 'select', 'auto', { options: ['全日制', '非全日制', '海外留学生'], aliases: ['受教育类型'] }),
      f('degree', '学历', 'select', 'auto', { options: ['本科', '硕士研究生', '博士研究生'], aliases: ['最高学历'] }),
      f('degreeAwarded', '已获学位', 'text', 'confirm', { hint: '在读/转博都是"无"，如实填' }),
      f('programType', '培养类型', 'text', 'auto', { hint: '如：学术型博士、专业型硕士、<示例班>' }),
      f('department', '学院', 'text', 'auto', { aliases: ['院系', '所在学院'] }),
      f('major', '专业名称', 'text', 'auto'),
      f('researchDirection', '研究方向', 'text', 'auto'),
      f('supervisor', '导师', 'text', 'auto'),
      f('studentId', '学号', 'text', 'auto'),
      f('gpa', '成绩（GPA / 排名）', 'text', 'auto', { aliases: ['GPA / 排名', 'GPA/排名', 'GPA / 成绩排名', '成绩'] }),
      f('unifiedAdmission', '是否统招', 'select', 'auto', { options: ['是', '否'] }),
      f('overseasStudy', '是否海外留学经历', 'select', 'auto', { options: ['是', '否'], hint: '访问学生也算，按表单口径填' }),
    ],
  },
  {
    key: 'positions',
    label: '在校职务',
    short: '在校职务',
    repeatable: true,
    fields: [
      f('title', '职务名称', 'text', 'auto'),
      f('period', '时间', 'daterange', 'auto', { validate: err(RANGE_RE, DATERANGE_MESSAGE) }),
      f('description', '职责描述', 'textarea', 'auto'),
    ],
  },
  {
    key: 'activities',
    label: '社团与组织活动',
    short: '社团活动',
    repeatable: true,
    fields: [
      f('role', '角色', 'text', 'auto'),
      f('organization', '组织', 'text', 'auto'),
      f('content', '内容', 'textarea', 'auto'),
    ],
  },
  {
    key: 'experience',
    label: '实习 / 工作经历',
    short: '实习 / 工作',
    repeatable: true,
    fields: [
      f('company', '公司', 'text', 'auto'),
      f('period', '时间', 'daterange', 'auto', { validate: err(RANGE_RE, DATERANGE_MESSAGE) }),
      f('title', '职位', 'text', 'auto'),
      f('duties', '职责与成果', 'textarea', 'auto'),
    ],
  },
  {
    key: 'projects',
    label: '科研 / 项目经历',
    short: '科研 / 项目',
    repeatable: true,
    fields: [
      f('name', '项目名称', 'text', 'auto'),
      f('period', '时间', 'daterange', 'auto', { validate: err(RANGE_RE, DATERANGE_MESSAGE) }),
      f('affiliation', '单位 / 合作方', 'text', 'auto'),
      f('role', '主要负责', 'text', 'auto'),
      f('description', '描述', 'textarea', 'auto', { hint: '分条写，一条一行' }),
      f('outcome', '成果', 'textarea', 'auto', { hint: '对应论文 / 代码仓库' }),
    ],
  },
  {
    key: 'publications',
    label: '论文与成果',
    short: '论文成果',
    repeatable: true,
    fields: [
      f('title', '标题', 'text', 'auto', { aliases: ['论文名称', '论文标题'] }),
      f('venue', '期刊 / 会议', 'text', 'auto', { aliases: ['期刊', '发表期刊'] }),
      f('authorPosition', '作者位次', 'text', 'auto'),
      f('citation', '年卷页', 'text', 'auto'),
      f('status', '状态', 'select', 'confirm', { options: ['已发表', '审稿中', '准备中'] }),
    ],
  },
  {
    key: 'awards',
    label: '获奖',
    short: '获奖',
    repeatable: true,
    fields: [
      f('award', '奖项', 'text', 'auto', { aliases: ['获奖名称', '名称'] }),
      f('period', '时间', 'text', 'auto'),
      f('level', '级别', 'text', 'auto'),
    ],
  },
  {
    key: 'skills',
    label: '技术能力',
    short: '技术能力',
    repeatable: true,
    fields: [
      f('category', '类别', 'text', 'auto', { aliases: ['技能类别', '分类'] }),
      f('content', '内容', 'textarea', 'auto'),
    ],
  },
  {
    key: 'certificates',
    label: '证书与语言',
    short: '证书语言',
    repeatable: false,
    fields: [
      f('cet6', '六级成绩', 'text', 'auto', { hint: '总分，括注各项' }),
      f('cet4Passed', '是否通过四级', 'select', 'auto', { options: ['是', '否'] }),
      f('languageAbility', '语言能力', 'text', 'auto', { hint: '语种 + 掌握程度，如：英语 / 熟练' }),
      f('otherCertificates', '其它证书', 'textarea', 'auto'),
    ],
  },
  {
    key: 'intent',
    label: '求职意向',
    short: '求职意向',
    repeatable: false,
    fields: [
      f('graduateStatus', '应届 / 往届', 'select', 'confirm', { options: ['应届', '往届'], overridable: true }),
      f('targetRole', '意向岗位', 'text', 'confirm', { overridable: true }),
      f('targetDirections', '目标方向', 'text', 'confirm', { overridable: true }),
      f('targetCities', '意向城市', 'text', 'confirm', { overridable: true }),
      f('targetIndustries', '意向行业', 'text', 'confirm', { overridable: true }),
      f('expectedSalary', '期望薪资', 'text', 'confirm', { hint: '无来源就留空，不猜', overridable: true }),
      f('availableFrom', '可到岗时间', 'text', 'confirm', { overridable: true }),
      f('transferPreference', '调剂意愿', 'text', 'confirm', { hint: '是否接受地点 / 岗位调剂', overridable: true }),
    ],
  },
  {
    key: 'selfEvaluation',
    label: '自我评价',
    short: '自我评价',
    repeatable: false,
    fields: [
      f('text', '全文', 'textarea', 'confirm', { hint: '逐字照自己的原稿，不要在这里改写', overridable: true }),
    ],
  },
  {
    key: 'answers',
    label: '常见长文本答案',
    short: '长文本',
    repeatable: true,
    importStyle: 'qa',
    fields: [
      // 刻意不给 overridable：这一区段自带 scope（适用公司 / 岗位），
      // 按岗位分口径就在这里多写一条。放进版本会出现"基准里新加的通用答案某些版本看不到"的静默漏。
      f('scope', '适用公司 / 岗位', 'text', 'note', { hint: '留空 = 通用。按岗位换说法就写在这里，不用建版本' }),
      f('question', '题目', 'text', 'note'),
      f('answer', '答案', 'textarea', 'confirm'),
    ],
    seed: [
      { scope: '', question: '自我介绍（300 字内）', answer: '' },
      { scope: '', question: '为什么选择这家公司', answer: '' },
      { scope: '', question: '职业规划', answer: '' },
    ],
  },
  {
    key: 'attachments',
    label: '附件清单',
    short: '附件',
    repeatable: true,
    fields: [
      f('purpose', '用途', 'text', 'note', { hint: '表单上通常按这个选文件' }),
      f('file', '路径', 'path', 'path'),
    ],
  },

];

// 标签的去格式：用户自己那份档案里会用 markdown 强调（`**来源**：`），
// 也会顺手换写法（`微信号` / `微信`）—— 两者都要能对上，否则导入静默丢字段。
export function cleanLabel(s) {
  return String(s || '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

// 比对时再去掉全部空白：模板里写「国籍/地区」，本文件写「国籍 / 地区」，指的是同一个字段。
export function normalizeLabel(s) {
  return cleanLabel(s).replace(/\s+/g, '');
}

const FLAT = [];
for (const section of SECTIONS) {
  for (const field of section.fields) {
    FLAT.push({
      ...field,
      section: section.key,
      sectionLabel: section.label,
      repeatable: !!section.repeatable,
      flat: section.repeatable ? `${section.key}[].${field.key}` : `${section.key}.${field.key}`,
    });
  }
}

export function flatFields() {
  return FLAT;
}

export function sectionOf(key) {
  return SECTIONS.find((s) => s.key === key) || null;
}

// 按区段编号定位（模板是 `## 3. 科研 / 项目经历` 这种形状）。
export function sectionByIndex(n) {
  return SECTIONS[n - 1] || null;
}

export function fieldOf(sectionKey, label) {
  const section = sectionOf(sectionKey);
  if (!section) return null;
  const want = normalizeLabel(label);
  return (
    section.fields.find(
      (field) =>
        normalizeLabel(field.label) === want ||
        (field.aliases || []).some((alias) => normalizeLabel(alias) === want)
    ) || null
  );
}

export function emptyValues() {
  const values = {};
  for (const section of SECTIONS) {
    if (section.repeatable) {
      values[section.key] = (section.seed || []).map((item) => ({ ...item }));
    } else {
      for (const field of section.fields) values[`${section.key}.${field.key}`] = '';
    }
  }
  return values;
}

// 「投放版本」被允许覆盖的字段白名单。这是硬边界：
// 白名单外的键出现在版本文件里，--check 与 PUT 都直接报错。
export const OVERRIDABLE_KEYS = new Set(FLAT.filter((x) => x.overridable && !x.repeatable).map((x) => x.flat));

export function isOverridable(key) {
  return OVERRIDABLE_KEYS.has(key);
}

export function isEmptyValue(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// 计入"完整度"的分类 = 用户真正要提供的东西。
//   never 不计：留空才是它的正确状态，算进分母等于永远扣分。
//   note 不计：那是给人看的说明，而且 answers 预置的三个题目会让完整度一开始就不是 0，
//             用户第一眼就失去判断。
export const SCORED = new Set(['auto', 'confirm', 'path']);

export function isScored(field) {
  return SCORED.has(field.autofill);
}

// 给浏览器的 schema：正则不能过 JSON，转成 source/flags。
export function exportSchema() {
  return {
    version: SCHEMA_VERSION,
    categories: Object.fromEntries(Object.entries(AUTOFILL).map(([k, v]) => [k, { label: v.label, inMap: v.inMap }])),
    sections: SECTIONS.map((section) => ({
      key: section.key,
      label: section.label,
      short: section.short,
      repeatable: !!section.repeatable,
      importStyle: section.importStyle || null,
      seed: section.seed || null,
      fields: section.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        autofill: field.autofill,
        options: field.options,
        hint: field.hint,
        recommended: field.recommended,
        overridable: field.overridable,
        pattern: field.validate
          ? { source: field.validate.pattern.source, flags: field.validate.pattern.flags, message: field.validate.message, level: field.validate.level }
          : null,
      })),
    })),
  };
}

// 遍历"当前实际存在"的字段槽：固定区段的每个字段 + 可重复区段的每个已有段。
function eachSlot(values, visit) {
  for (const section of SECTIONS) {
    if (section.repeatable) {
      const arr = Array.isArray(values[section.key]) ? values[section.key] : [];
      arr.forEach((item, index) => {
        for (const field of section.fields) {
          visit({ field, section, value: item ? item[field.key] : '', index });
        }
      });
    } else {
      for (const field of section.fields) {
        visit({ field, section, value: values[`${section.key}.${field.key}`], index: null });
      }
    }
  }
}

// 校验：只回标签，不回值 —— CLI 的 stdout 可能被贴进对话或日志。
export function validateValues(values) {
  const errors = [];
  const warnings = [];
  eachSlot(values, ({ field, section, value, index }) => {
    const where = index === null ? section.label : `${section.label}[${index + 1}]`;
    const label = `${where} · ${field.label}`;
    // 段内字段要带段号，否则同名字段（education[0].school / education[1].school）在界面上会共用一条错误
    const key = index === null ? `${section.key}.${field.key}` : `${section.key}[${index}].${field.key}`;
    if (isEmptyValue(value)) {
      if (field.recommended) warnings.push({ level: 'warn', key, label, message: '建议填。留空比猜值安全，留空不会报错' });
      return;
    }
    const v = String(value).trim();
    if (field.validate && !field.validate.pattern.test(v)) {
      errors.push({ level: 'error', key, label, message: field.validate.message });
    }
    if (field.autofill === 'never') {
      warnings.push({ level: 'warn', key, label, message: '引擎不会使用此值，也不会随映射表导出' });
    }
    // 「会进映射」这件事已经有唯一表述：AUTOFILL[...].inMap。别再引入第二个同义词。
    if (AUTOFILL[field.autofill].inMap && ANNOTATION_RE.test(v)) {
      warnings.push({ level: 'warn', key, label, message: '值里带着批注（** 或「待…确认」）。这种字会被原样填进表单，填表前要清掉' });
    }
    if (field.options && field.options.length > 1 && !field.options.includes(v)) {
      warnings.push({
        level: 'warn',
        key,
        label,
        message: `值不等于常见选项（${field.options.join(' / ')}）。多带了括号说明的话，填表时可能对不上`,
      });
    }
  });
  return { errors, warnings };
}

// 校验版本覆盖集：键必须在白名单内、值必须是字符串、不能覆盖可重复区段。
export function validateOverrides(overrides) {
  const errors = [];
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!OVERRIDABLE_KEYS.has(key)) {
      errors.push({ level: 'error', key, label: key, message: '这个字段不允许被版本覆盖（只有口径类字段可以）' });
      continue;
    }
    if (typeof value !== 'string') {
      errors.push({ level: 'error', key, label: key, message: '覆盖值必须是字符串' });
    }
  }
  return errors;
}

// 基准 ⊕ 覆盖。版本只存差异，通用事实永远只来自基准。
export function mergeValues(base, overrides) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (OVERRIDABLE_KEYS.has(key)) merged[key] = value;
  }
  return merged;
}

// 计数：分母只含 SCORED 的分类（见 isScored 的两条理由）。
export function counts(values) {
  const byAutofill = {};
  for (const key of Object.keys(AUTOFILL)) byAutofill[key] = { slots: 0, filled: 0 };
  const segments = {};
  let slots = 0;
  let filled = 0;

  eachSlot(values, ({ field, section, value }) => {
    const bucket = byAutofill[field.autofill];
    bucket.slots += 1;
    if (!isEmptyValue(value)) bucket.filled += 1;
    if (isScored(field)) {
      slots += 1;
      if (!isEmptyValue(value)) filled += 1;
    }
  });
  for (const section of SECTIONS) {
    if (section.repeatable) segments[section.key] = Array.isArray(values[section.key]) ? values[section.key].length : 0;
  }
  return { slots, filled, byAutofill, segments };
}

// 待用户手动处理的清单（界面右栏 + 映射表尾部都用它）。
export function manualList(values) {
  const out = [];
  eachSlot(values, ({ field, section, value, index }) => {
    const where = index === null ? section.label : `${section.label}[${index + 1}]`;
    const label = `${where} · ${field.label}`;
    const key = index === null ? `${section.key}.${field.key}` : `${section.key}[${index}].${field.key}`;
    if (field.autofill === 'never') out.push({ key, label, reason: '引擎不提供也不接受' });
    else if (field.autofill === 'confirm' && isEmptyValue(value)) out.push({ key, label, reason: '需逐项确认，留空' });
  });
  return out;
}

// 给浏览器的高亮/红字用：把校验结果按 section[].field 形状索引。
export function indexIssues(list) {
  const map = {};
  for (const issue of list) map[issue.key] = issue;
  return map;
}
