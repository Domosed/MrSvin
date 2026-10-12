// Status line command for Claude chats started by Mr. Mak. Claude Code passes
// session data on stdin; its rate_limits fields are recorded for the Usage panel
// and summarized in one short row. It must never interrupt the CLI.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const file = process.argv[2];
const limit = value => {
  const usedPercentage = Number(value?.used_percentage), resetsAt = Number(value?.resets_at);
  return value && Number.isFinite(usedPercentage) && Number.isFinite(resetsAt) ? { usedPercentage, resetsAt } : null;
};

function record(usage) {
  let previous = null;
  try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* First record. */ }
  const same = previous && ['fiveHour', 'sevenDay', 'spendLimit'].every(name => JSON.stringify(previous[name] ?? null) === JSON.stringify(usage[name]));
  // Every Claude chat reports the same account limits; skip redundant writes.
  if (same && Date.now() - Date.parse(previous.updatedAt) < 60000) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(5).toString('hex')}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...usage, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  try { renameSync(temp, file); } catch { try { unlinkSync(temp); } catch { /* Already gone. */ } }
}

setTimeout(() => process.exit(0), 5000).unref();
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const limits = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.rate_limits;
  const usage = { fiveHour: limit(limits?.five_hour), sevenDay: limit(limits?.seven_day), spendLimit: limit(limits?.spend_limit) };
  const parts = [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['spend', usage.spendLimit]].filter(([, value]) => value).map(([label, value]) => `${label} ${Math.round(value.usedPercentage)}%`);
  if (parts.length) {
    if (file) { try { record(usage); } catch { /* The next update retries. */ } }
    process.stdout.write(`\x1b[2m${parts.join(' · ')}\x1b[0m\n`);
  }
} catch { /* Claude Code shows an empty status line. */ }
