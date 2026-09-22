#!/usr/bin/env node
// 个人档案的 CLI 与本地界面服务。
//
//   node scripts/profile.mjs --init        # 建空的 private/profile.json
//   node scripts/profile.mjs --import      # 从 private/profile.md 一次性迁移
//   node scripts/profile.mjs --check       # 校验（有 error 则退出码 1）
//   node scripts/profile.mjs --render      # 打出给对话用的映射表
//   node scripts/profile.mjs --ui          # 起本地界面 http://127.0.0.1:8787
//
// 通用参数：--root <dir>（默认当前目录）、--force、--port <n>
//
// 三条硬细节（命名失败见 docs/plans/06-profile-ui.md §三）：
//   1. 服务只绑 127.0.0.1；2. 校验 Host 头，非回环一律 403；3. 不发任何 CORS 头。
// 另有两条：
//   4. stdout 不回显任何字段值 —— 值一旦进了终端回滚缓冲或对话，档案就出了 private/。
//   5. 所有写入路径必须落在 <root>/private/ 内。

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportSchema, validateValues } from '../tools/profile.schema.mjs';
import {
  buildMapping,
  checkPathWarnings,
  checkPaths,
  counts,
  importMarkdown,
  readValues,
  resolvePaths,
  summarize,
  writeText,
  writeValues,
} from '../tools/profile-io.mjs';

const MAX_BODY = 1 << 20;
const EDITOR_FILES = ['profile-editor.html', 'profile-editor.css', 'profile-editor.js'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// ── 请求路由（纯函数，便于单测；不绑端口） ───────────────────────────────────

export function isLoopbackHost(host) {
  if (!host) return false;
  const name = String(host).replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

function jsonResponse(status, body) {
  return { status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

export function createContext({ root, toolsDir, schemaPath }) {
  const resolved = schemaPath || join(toolsDir, 'profile.schema.mjs');
  let mtime = 0;
  try {
    mtime = statSync(resolved).mtimeMs;
  } catch {
    mtime = 0;
  }
  return { root, toolsDir, paths: resolvePaths(root), schemaPath: resolved, schemaMtime: mtime };
}

// Node 的 ESM 只加载一次：改完 schema 不重启，界面会继续用旧规则校验，
// 报出来的错对不上文件内容，看起来像代码 bug。
function schemaIsStale(ctx) {
  try {
    return statSync(ctx.schemaPath).mtimeMs > ctx.schemaMtime;
  } catch {
    return false;
  }
}

export async function route(req, ctx) {
  const { paths, toolsDir } = ctx;

  // 命名失败：DNS rebinding —— 本机浏览器里任一网页把域名解析到 127.0.0.1 后读写档案。
  if (!isLoopbackHost(req.headers && req.headers.host)) {
    return jsonResponse(403, { error: 'host-not-allowed', hint: '只接受 127.0.0.1 / localhost' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return jsonResponse(400, { error: 'bad-url' });
  }

  const serve = (name) => {
    const file = join(toolsDir, name);
    if (!existsSync(file)) return jsonResponse(500, { error: 'missing-asset', file });
    return { status: 200, type: MIME[extname(file)] || 'application/octet-stream', body: readFileSync(file) };
  };

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serve(EDITOR_FILES[0]);

  if (req.method === 'GET' && pathname.startsWith('/tools/')) {
    const name = pathname.slice('/tools/'.length);
    // 白名单，不做目录遍历
    if (!EDITOR_FILES.includes(name)) return jsonResponse(404, { error: 'not-found' });
    return serve(name);
  }

  if (req.method === 'GET' && pathname === '/api/profile') {
    const { values, exists, unknownKeys } = readValues(paths);
    const { errors, warnings } = validateValues(values);
    const pathChecks = checkPaths(values);
    warnings.push(...checkPathWarnings(pathChecks));
    return jsonResponse(200, {
      schemaStale: schemaIsStale(ctx),
      filePath: paths.profilePath,
      legacyMd: paths.legacyMd,
      legacyMdExists: existsSync(paths.legacyMd),
      exists,
      schema: exportSchema(),
      values,
      unknownKeys,
      stats: summarize(values),
      errors,
      warnings,
      pathChecks,
    });
  }

  if (req.method === 'GET' && pathname === '/api/mapping') {
    const { values } = readValues(paths);
    return { status: 200, type: 'text/markdown; charset=utf-8', body: buildMapping(values, paths) };
  }

  if (req.method === 'PUT' && pathname === '/api/profile') {
    let payload;
    try {
      payload = JSON.parse(req.body || '{}');
    } catch {
      return jsonResponse(400, { ok: false, error: 'bad-json' });
    }
    const values = payload.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return jsonResponse(400, { ok: false, error: 'missing-values' });
    }
    const { errors, warnings } = validateValues(values);
    // 格式错就拒绝保存：错值一旦进档案，就会跟着表单提交出去。
    if (errors.length) return jsonResponse(400, { ok: false, savedAt: null, errors, warnings });

    const unknownKeys = payload.unknownKeys && typeof payload.unknownKeys === 'object' ? payload.unknownKeys : {};
    const written = writeValues(paths, values, { unknownKeys });
    const pathChecks = checkPaths(values);
    warnings.push(...checkPathWarnings(pathChecks));
    return jsonResponse(200, {
      ok: true,
      savedAt: new Date().toISOString(),
      filePath: written.path,
      backup: written.backedUp ? paths.backupPath : null,
      stats: summarize(values),
      errors: [],
      warnings,
      pathChecks,
    });
  }

  if (req.method === 'POST' && pathname === '/api/import') {
    let payload = {};
    try {
      payload = JSON.parse(req.body || '{}');
    } catch {
      return jsonResponse(400, { ok: false, error: 'bad-json' });
    }
    if (!existsSync(paths.legacyMd)) return jsonResponse(404, { ok: false, error: 'source-not-found', file: paths.legacyMd });

    // 已经填过内容就不静默覆盖：先让界面问一次，再带 force 回来。
    if (existsSync(paths.profilePath) && !payload.force) {
      const current = readValues(paths);
      if (counts(current.values).filled > 0) {
        return jsonResponse(409, { ok: false, error: 'exists', filled: counts(current.values).filled, hint: '导入会覆盖现有内容（覆盖前会自动备份）' });
      }
    }

    const { values, notes, missing, assumedDates, matched } = importMarkdown(readFileSync(paths.legacyMd, 'utf8'));
    const written = writeValues(paths, values, { backup: true });
    return jsonResponse(200, {
      ok: true,
      action: 'import',
      source: paths.legacyMd,
      file: written.path,
      backup: written.backedUp ? paths.backupPath : null,
      matchedFields: matched.length,
      missingInTemplate: missing,
      assumedDates,
      notes,
      stats: summarize(values),
    });
  }

  return jsonResponse(404, { error: 'not-found' });
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHandler(ctx) {
  return async (req, res) => {
    let result;
    try {
      const body = req.method === 'PUT' ? await readBody(req) : '';
      result = await route({ method: req.method, url: req.url, headers: req.headers, body }, ctx);
    } catch (e) {
      result = jsonResponse(500, { error: 'internal', message: e.message });
    }
    // 刻意不设任何 Access-Control-Allow-* —— 跨源网页因此过不了 preflight，也读不到响应。
    res.writeHead(result.status, { 'Content-Type': result.type, 'Cache-Control': 'no-store' });
    res.end(result.body);
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { flags, rest };
}

const USAGE = `用法：
  node scripts/profile.mjs --init            建空的 private/profile.json
  node scripts/profile.mjs --import [md]     从 private/profile.md 迁移（默认取该路径），写入前备份
  node scripts/profile.mjs --check           校验，有 error 时退出码 1
  node scripts/profile.mjs --render [--out]  打出映射表；给 --out 则写文件，不打印内容
  node scripts/profile.mjs --ui              起本地界面（http://127.0.0.1:8787）
参数：--root <dir>  --port <n>  --force`;

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

export function main(argv = process.argv.slice(2)) {
  // 任何异常都收成一条 JSON：路径守卫拦下来是预期行为，不该表现为一段堆栈 ——
  // 对非技术用户来说，堆栈和崩溃没有区别。
  try {
    return run(argv);
  } catch (e) {
    const guard = /拒绝写入/.test(e.message);
    out({ ok: false, error: guard ? 'path-guard' : 'failed', message: e.message });
    return 1;
  }
}

function run(argv) {
  const { flags } = parseArgs(argv);
  const root = flags.root && flags.root !== true ? flags.root : process.cwd();
  const paths = resolvePaths(root);
  const toolsDir = join(paths.root, 'tools');

  if (flags.init) {
    if (existsSync(paths.profilePath) && !flags.force) {
      out({ ok: false, error: 'exists', file: paths.profilePath, hint: '加 --force 覆盖（会先备份）' });
      return 1;
    }
    const { values } = readValues(paths);
    const written = writeValues(paths, values);
    out({ ok: true, action: 'init', file: written.path, summary: summarize(values) });
    return 0;
  }

  if (flags.import) {
    const source = flags.import === true ? paths.legacyMd : flags.import;
    if (!existsSync(source)) {
      out({ ok: false, error: 'source-not-found', file: source });
      return 1;
    }
    const { values, notes, missing, assumedDates, matched } = importMarkdown(readFileSync(source, 'utf8'));
    const written = writeValues(paths, values, { backup: true });
    // 只回计数、不回调值 —— 这条命令的输出可能被贴进对话。
    out({
      ok: true,
      action: 'import',
      source,
      file: written.path,
      backup: written.backedUp ? paths.backupPath : null,
      matchedFields: matched.length,
      missingInTemplate: missing,
      assumedDates,
      notes,
      summary: summarize(values),
    });
    return 0;
  }

  if (flags.check) {
    let read;
    try {
      read = readValues(paths);
    } catch (e) {
      out({ ok: false, error: 'unreadable', file: paths.profilePath, message: e.message });
      return 1;
    }
    const { values, exists, unknownKeys } = read;
    const { errors, warnings } = validateValues(values);
    const pathChecks = checkPaths(values);
    warnings.push(...checkPathWarnings(pathChecks));
    const notes = [];
    if (!exists && existsSync(paths.legacyMd)) notes.push(`还没有 ${paths.profilePath}，但 ${paths.legacyMd} 存在 —— 先跑 --import`);
    if (Object.keys(unknownKeys).length) notes.push(`有 ${Object.keys(unknownKeys).length} 个键当前 schema 不认识，会原样保留但不会被校验`);
    out({ ok: errors.length === 0, file: paths.profilePath, exists, summary: summarize(values), errors, warnings, notes });
    return errors.length ? 1 : 0;
  }

  if (flags.render) {
    const { values } = readValues(paths);
    const mapping = buildMapping(values, paths);
    const dest = flags.out && flags.out !== true ? String(flags.out) : '';
    if (dest) {
      const target = writeText(paths, dest, mapping);
      out({ ok: true, action: 'render', file: target, bytes: mapping.length });
    } else {
      process.stdout.write(mapping);
    }
    return 0;
  }

  if (flags.ui) {
    const port = Number(flags.port && flags.port !== true ? flags.port : 8787);
    const ctx = createContext({ root: paths.root, toolsDir });
    const server = createServer(createHandler(ctx));
    server.on('error', (e) => {
      out({ ok: false, error: e.code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed', message: e.message, port });
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      out({
        ok: true,
        action: 'ui',
        url: `http://127.0.0.1:${port}`,
        file: paths.profilePath,
        fileExists: existsSync(paths.profilePath),
        legacyMdExists: existsSync(paths.legacyMd),
        hint: existsSync(paths.profilePath) ? '改完点保存即写回上面这个文件' : '文件还不存在，第一次保存时会创建',
      });
    });
    const close = () => server.close(() => process.exit(0));
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
    return null; // 常驻
  }

  process.stderr.write(`${USAGE}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main();
  if (code !== null) process.exit(code);
}
