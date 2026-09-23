// jobmatch 纯逻辑回归。
//
// 覆盖"确定性"那一层：文本归一化、门槛线索抽取、闸门判定、结论与排序。
// 带 ★ 的断言各自对应一个真实踩过的失败，不是凑覆盖率。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText,
  splitTerms,
  detectDegree,
  detectYears,
  detectMajorClause,
  isCampusJob,
  validateJobs,
} from '../jobmatch/schema.mjs';
import { termsFromProfile, screenAll, screenJob, factsFromProfile, decide } from '../jobmatch/filter.mjs';
import { GATE, VERDICT } from '../jobmatch/schema.mjs';

const PROFILE = {
  education: [
    {
      degree: '博士研究生',
      major: '物理学（示例班）',
      researchDirection: '示例研究方向（半导体缺陷与掺杂的第一性原理建模、示例技术二）',
    },
  ],
  skills: [{ category: '编程 / 工具', content: 'VASP、Python 示例技术二、Slurm 集群运维' }],
  intent: { targetCities: '深圳 东莞', targetRole: '半导体计算 / 仿真算法', targetIndustries: '半导体 / 计算材料' },
  experience: [],
};

const job = (o = {}) => ({
  id: 'j1',
  title: '仿真算法工程师',
  city: '深圳',
  jd: '1、负责器件仿真；2、熟练使用 VASP 与第一性原理计算。',
  ...o,
});

test('normalizeText 统一全角、大小写与分隔符', () => {
  assert.equal(normalizeText('ＶＡＳＰ、Python（DFT）'), 'vasppythondft');
  assert.equal(normalizeText('深圳 / 东莞'), '深圳东莞');
});

test('splitTerms 括号内外分别成词', () => {
  // ★ 不拆括号时，"示例研究方向（半导体缺陷…）"整串进词典，JD 里永远匹配不到 ——
  //   实测词典只剩 2 个词，所有岗位命中数为 0。
  const terms = splitTerms('示例研究方向（半导体缺陷与掺杂的第一性原理建模、示例技术二）');
  assert.ok(terms.includes('示例研究方向'), `实际：${JSON.stringify(terms)}`);
  assert.ok(terms.some((t) => t.includes('示例技术二')));
  assert.ok(!terms.some((t) => t.includes('（')), '括号字符必须清掉');
});

test('detectDegree 取 JD 里最高的一个', () => {
  assert.equal(detectDegree('本科及以上学历，硕士优先').level, 3);
  assert.equal(detectDegree('博士优先').level, 4);
  assert.equal(detectDegree('有相关经验即可'), null);
});

test('detectYears 与校招识别', () => {
  assert.equal(detectYears('3年以上相关经验'), 3);
  assert.equal(detectYears('负责器件仿真'), null);
  assert.ok(isCampusJob('2027届应届毕业生'));
});

test('detectMajorClause 认两种写法', () => {
  const a = detectMajorClause('专业要求：微电子、集成电路、电子工程等相关专业优先');
  assert.ok(a && a.terms.includes('微电子'), JSON.stringify(a));
  const b = detectMajorClause('1、2027届本科及以上，物理学、材料学等相关专业优先；');
  assert.ok(b && b.terms.includes('物理学'), JSON.stringify(b));
  assert.ok(!b.terms.some((t) => /学历|届/.test(t)), '学历/届别不能算进专业候选');
});

test('detectMajorClause 不被句子里的"专业"二字误触发', () => {
  // ★ 真实踩过：HRBP 岗 JD 里有"应用专业方法或工具"，旧正则把它当成专业要求，
  //   判成"专业不符"直接淘汰。前置式必须带显式标签或冒号。
  assert.equal(detectMajorClause('应用专业方法或工具，协助业务团队'), null);
});

test('档案没写意向城市时地点门槛是 unknown，不是通过', () => {
  const facts = factsFromProfile({ ...PROFILE, intent: { targetCities: '' } });
  const r = screenJob(job({ city: '成都' }), facts, []);
  const city = r.gates.find((g) => g.key === 'city');
  assert.equal(city.result, GATE.UNKNOWN);
  assert.match(city.note, /不替你猜/);
});

test('学历与年限闸门', () => {
  const facts = factsFromProfile(PROFILE);
  const ok = screenJob(job({ jd: '本科及以上学历' }), facts, []).gates;
  assert.equal(ok.find((g) => g.key === 'degree').result, GATE.PASS);

  // 档案无工作经历 + JD 要 3 年 → 明确不满足
  const no = screenJob(job({ jd: '要求 3 年以上相关经验' }), facts, []).gates;
  assert.equal(no.find((g) => g.key === 'experience').result, GATE.FAIL);

  // 校招岗不按社招年限卡
  const campus = screenJob(job({ jd: '2027届应届生，3 年以上相关经验' }), facts, []).gates;
  assert.equal(campus.find((g) => g.key === 'experience').result, GATE.PASS);
});

test('任一硬门槛 fail 即暂不建议，不被命中数抵消', () => {
  const facts = factsFromProfile(PROFILE);
  const r = screenJob(
    job({ jd: '专业要求：微电子、集成电路等相关专业优先；熟练使用 VASP 与第一性原理计算' }),
    facts,
    termsFromProfile(PROFILE)
  );
  assert.equal(r.gates.find((g) => g.key === 'major').result, GATE.FAIL);
  assert.equal(r.verdict, VERDICT.SKIP, '专业不符就是不符，命中再多也不加权抵消');
});

test('词典来自档案，通用词与分类名被剔掉', () => {
  const terms = termsFromProfile({
    ...PROFILE,
    skills: [{ category: '编程 / 工具', content: '开发、经验、能力、VASP' }],
  });
  assert.ok(terms.includes('VASP'));
  assert.ok(!terms.includes('开发'), '通用词命中一切，等于没命中');
  assert.ok(!terms.includes('经验'));
  // ★ 真实踩过：类别列写着"编程 / 工具"，这两个词进了词典后，
  //   75 个岗位里有 38 个靠它们"命中"，全是假阳性。类别是分类名，不是技能。
  assert.ok(!terms.includes('工具'));
  assert.ok(!terms.includes('编程'));
});

test('screenAll 按结论分组排序，命中多的在前', () => {
  const jobs = [
    job({ id: 'a', title: '采购工程师', jd: '负责供应商管理' }),
    job({
      id: 'b',
      title: '仿真算法工程师',
      jd: '2027届应届，本科及以上学历，专业要求：物理学、材料学等相关专业；熟练使用 VASP 与第一性原理计算，1 年以上相关经验',
    }),
  ];
  const res = screenAll(jobs, PROFILE);
  assert.equal(res.rows[0].id, 'b');
  assert.equal(res.rows[0].verdict, VERDICT.APPLY, JSON.stringify(res.rows[0].gates));
  assert.ok(res.rows[0].hits.some((h) => h.term === 'VASP'));
  assert.equal(res.rows[res.rows.length - 1].id, 'a');
});

test('decide 的四档边界', () => {
  const pass = { result: GATE.PASS };
  assert.equal(decide([pass, pass, pass, pass], [{}, {}]), VERDICT.APPLY);
  assert.equal(decide([pass, { result: GATE.UNKNOWN }], [{}, {}]), VERDICT.SUPPLEMENT);
  assert.equal(decide([pass, pass], []), VERDICT.CAREFUL);
  assert.equal(decide([pass, { result: GATE.FAIL }], [{}, {}, {}]), VERDICT.SKIP);
});

test('validateJobs 挡住缺 JD 与 id 重复', () => {
  assert.equal(validateJobs([{ title: 'a', jd: 'x' }]).ok, true);
  assert.equal(validateJobs([{ title: 'a' }]).ok, false, '缺 JD 的岗位没法判门槛');
  assert.equal(validateJobs([{ id: '1', title: 'a', jd: 'x' }, { id: '1', title: 'b', jd: 'y' }]).ok, false);
});
