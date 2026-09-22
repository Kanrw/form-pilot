#!/usr/bin/env node
// 桥接健康检查。
//
// 为什么独立成脚本而不是让 inject.mjs 报错：
// `running:false`（缺 daemon）与 `extension_connected:false`（缺浏览器/扩展）
// 是两种不同故障、两种不同修法，而一次失败的 HTTP 请求无法区分它们。
//
// 用法：node scripts/status.mjs
// 输出：{ok, running, extension_connected, version, extension_version, update_available, hint?}
// 退出码：ok ? 0 : 1

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const BIN = process.env.KIMI_WEBBRIDGE_BIN || `${homedir()}/.kimi-webbridge/bin/kimi-webbridge`;

function out(obj, code) {
  console.log(JSON.stringify(obj));
  process.exit(code);
}

// stdio：桥会把"有新版本可升级"的提示打到 stderr，默认继承会插到我们的 JSON 前面。
// 只收 stdout，丢弃 stderr —— 脚本的 stdout 必须只有一行可解析的 JSON。
let raw;
try {
  raw = execFileSync(BIN, ['status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  out({ ok: false, running: false, extension_connected: false, err: 'bridge-cli-failed', detail: String(e.message).slice(0, 200) }, 1);
}

// `status` 会先打一行 JSON，再打升级提示行 —— 只取 JSON 那行。
const line = raw.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'));
if (!line) out({ ok: false, running: false, extension_connected: false, err: 'unparsable-status-output', detail: raw.trim().slice(0, 200) }, 1);

let s;
try {
  s = JSON.parse(line);
} catch {
  out({ ok: false, running: false, extension_connected: false, err: 'bad-status-json', detail: line.slice(0, 200) }, 1);
}

const res = {
  ok: !!(s.running && s.extension_connected),
  running: !!s.running,
  extension_connected: !!s.extension_connected,
  version: s.version || null,
  extension_version: s.extension_version || null,
  update_available: s.update_available && s.update_available.latest ? s.update_available.latest : null,
};
if (!res.running) res.hint = 'daemon 未运行：~/.kimi-webbridge/bin/kimi-webbridge start';
else if (!res.extension_connected) res.hint = '扩展未连上：打开浏览器，确认 Kimi WebBridge 扩展已启用';
out(res, res.ok ? 0 : 1);
