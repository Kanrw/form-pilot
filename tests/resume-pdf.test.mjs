// ATS 简历 PDF 的内容组装与端到端可解析性（node:test）。
//
// 只用合成数据：真实档案内容不许进 tests/（AGENTS.md 隐私边界）。
// 渲染测试需要本机有 CJK 字体，没有就跳过 —— 字体可用性是环境属性，不是代码属性。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

import { emptyValues } from '../tools/profile.schema.mjs';
import { resolvePaths } from '../tools/profile-io.mjs';
import { buildBlocks, pickFont, renderPdf } from '../scripts/resume-pdf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function syntheticValues() {
  const values = emptyValues();
  values['basic.name'] = '张测试';
  values['basic.englishName'] = 'Test Zhang';
  values['basic.gender'] = '男';
  values['basic.phone'] = '13800000000';
  values['basic.email'] = 'test@example.com';
  values['basic.currentCity'] = '示例市';
  values['basic.nationality'] = '中国';
  values['basic.hobbies'] = '<示例爱好>';
  // never 类与紧急联系人：只用来断言它们不进 PDF
  values['basic.idNumber'] = '110101199001011234';
  values['basic.emergencyContactName'] = '某个紧急联系人';
  values['intent.targetRole'] = '示例岗位';
  values['intent.expectedSalary'] = '面议';
  values.education = [
    {
      school: '示例大学',
      period: '2020-09-01 -- 2024-06-30',
      degree: '本科',
      programType: '示例英才班',
      department: '示例学院',
      major: '示例专业',
      gpa: '3.9 / 4.0',
    },
  ];
  values.projects = [
    {
      name: '示例项目',
      period: '2022-01-01 -- 2022-12-31',
      affiliation: '示例大学',
      role: '独立完成',
      description: '1. 第一条描述\n2. 第二条描述',
      outcome: '1. 示例成果一条',
    },
  ];
  values.skills = [{ category: '编程', content: '示例语言' }];
  values['certificates.cet6'] = '000（听力 0 / 阅读 0 / 写作翻译 0）';
  values['selfEvaluation.text'] = '这是自我评价的示例文本，用来验证整段完整输出不截断。';
  return values;
}

function tempPaths() {
  return resolvePaths(mkdtempSync(join(tmpdir(), 'form-pilot-resume-')));
}

// ── 内容组装 ─────────────────────────────────────────────────────────────────

test('buildBlocks：页眉、区段标题与带标签字段齐全', () => {
  const blocks = buildBlocks(syntheticValues());
  const titles = blocks.filter((b) => b.kind === 'section').map((b) => b.title);
  for (const title of ['求职意向', '教育经历', '科研 / 项目经历', '技术能力', '证书与语言', '自我评价', '基本信息']) {
    assert.ok(titles.includes(title), `缺区段：${title}`);
  }
  const nameBlock = blocks.find((b) => b.kind === 'name');
  assert.equal(nameBlock.text, '张测试（Test Zhang）');
  const allText = JSON.stringify(blocks);
  for (const needle of ['13800000000', 'test@example.com', '示例大学', '示例专业', '第一条描述', '第二条描述', '示例成果一条', '示例岗位']) {
    assert.ok(allText.includes(needle), `缺内容：${needle}`);
  }
});

test('buildBlocks：never 类、紧急联系人、附件、长文本答案不进简历', () => {
  const values = syntheticValues();
  values.answers = [{ scope: '', question: '自我介绍', answer: '答案正文不应出现' }];
  values.attachments = [{ purpose: '证件照', file: '/tmp/portrait.jpeg' }];
  const allText = JSON.stringify(buildBlocks(values));
  assert.ok(!allText.includes('110101199001011234'), 'never 类字段（证件号码）出现在简历里');
  assert.ok(!allText.includes('紧急联系人'), '紧急联系人出现在简历里');
  assert.ok(!allText.includes('答案正文不应出现'), '长文本答案出现在简历里');
  assert.ok(!allText.includes('portrait.jpeg'), '附件路径出现在简历里');
});

test('buildBlocks：姓名全空直接报错，不产空简历', () => {
  const values = emptyValues();
  assert.throws(() => buildBlocks(values), /姓名/);
});

test('buildBlocks：空区段不产生标题', () => {
  const values = syntheticValues();
  values.experience = [];
  const titles = buildBlocks(values).filter((b) => b.kind === 'section').map((b) => b.title);
  assert.ok(!titles.includes('实习 / 工作经历'));
});

// ── 端到端：PDF 生成后能被通用抽取器读回 ─────────────────────────────────────

test('renderPdf：文本可完整抽出，never 类值不泄露', async (t) => {
  let fontPath;
  try {
    fontPath = pickFont();
  } catch {
    return t.skip('本机没有可用的中文字体');
  }
  const paths = tempPaths();
  const outPath = join(paths.privateDir, 'resume', 'resume-ats.pdf');
  await renderPdf(buildBlocks(syntheticValues()), { fontPath, outPath, paths });
  assert.ok(existsSync(outPath), 'PDF 未落盘');

  const parser = new PDFParse({ data: new Uint8Array(readFileSync(outPath)) });
  const { text } = await parser.getText();
  await parser.destroy();
  const flat = text.replace(/\s+/g, ''); // 换行/分栏空白不算丢字：去掉全部空白后比对
  for (const needle of ['张测试', '13800000000', '示例大学', '示例专业', '第一条描述', '第二条描述', '示例成果一条', '这是自我评价的示例文本']) {
    assert.ok(flat.includes(needle), `抽出的文本缺：${needle}`);
  }
  assert.ok(!flat.includes('110101199001011234'), '证件号码出现在 PDF 文本里');
  assert.ok(!flat.includes('某个紧急联系人'), '紧急联系人出现在 PDF 文本里');
});

test('renderPdf：拒绝把 PDF 写到 private/ 之外', async (t) => {
  let fontPath;
  try {
    fontPath = pickFont();
  } catch {
    return t.skip('本机没有可用的中文字体');
  }
  const paths = tempPaths();
  await assert.rejects(
    renderPdf(buildBlocks(syntheticValues()), { fontPath, outPath: join(paths.root, 'resume-ats.pdf'), paths }),
    /拒绝写入/
  );
});
