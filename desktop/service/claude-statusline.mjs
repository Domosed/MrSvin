// Status line command for Claude chats started by Mr. Mak. Claude Code passes
// session data on stdin; its rate_limits fields are recorded for the Usage panel
// and summarized in one short row, and each chat's context window is recorded
// for the context meter (context-usage.mjs). It must never interrupt the CLI.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const file = process.argv[2];
const limit = value => {
  const usedPercentage = Number(value?.used_percentage), resetsAt = Number(value?.resets_at);
  return value && Number.isFinite(usedPercentage) && Number.isFinite(resetsAt) ? { usedPercentage, resetsAt } : null;
};
const read = target => { try { return JSON.parse(readFileSync(target, 'utf8')); } catch { return null; } };

function save(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomBytes(5).toString('hex')}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  try { renameSync(temp, target); } catch { try { unlinkSync(temp); } catch { /* Already gone. */ } }
}

function record(usage) {
  const previous = read(file);
  const same = previous && ['fiveHour', 'sevenDay', 'spendLimit'].every(name => JSON.stringify(previous[name] ?? null) === JSON.stringify(usage[name]));
  // Every Claude chat reports the same account limits; skip redundant writes.
  if (same && Date.now() - Date.parse(previous.updatedAt) < 60000) return;
  save(file, usage);
}

// <state>/claude-usage.json keeps its chats' windows in <state>/claude-context/<session id>.json.
function recordContext(data) {
  const id = data?.session_id, window = data?.context_window, size = Number(window?.context_window_size);
  if (!/-usage\.json$/.test(file || '') || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || !(size > 0)) return;
  // The same input-only sum as used_percentage; current_usage is null after /compact until the next reply.
  const current = window.current_usage;
  const used = current ? ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((sum, key) => sum + (Number(current[key]) || 0), 0) : null;
  const percent = Number(window.used_percentage);
  const value = { window: size, used, usedPercentage: window.used_percentage != null && Number.isFinite(percent) ? percent : null, model: typeof data.model?.id === 'string' ? data.model.id : null };
  const target = path.join(file.replace(/-usage\.json$/, '-context'), `${id}.json`), previous = read(target);
  if (previous && Object.keys(value).every(key => previous[key] === value[key])) return;
  save(target, value);
}

setTimeout(() => process.exit(0), 5000).unref();
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  try { recordContext(data); } catch { /* The next update retries. */ }
  const limits = data?.rate_limits;
  const usage = { fiveHour: limit(limits?.five_hour), sevenDay: limit(limits?.seven_day), spendLimit: limit(limits?.spend_limit) };
  const parts = [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['spend', usage.spendLimit]].filter(([, value]) => value).map(([label, value]) => `${label} ${Math.round(value.usedPercentage)}%`);
  if (parts.length) {
    if (file) { try { record(usage); } catch { /* The next update retries. */ } }
    process.stdout.write(`\x1b[2m${parts.join(' · ')}\x1b[0m\n`);
  }
} catch { /* Claude Code shows an empty status line. */ }
