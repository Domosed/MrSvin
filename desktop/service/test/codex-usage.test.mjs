import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexUsage, threadStart } from '../codex-usage.mjs';

const fixture = () => mkdtemp(path.join(os.tmpdir(), 'mrmak-codex-usage-'));
const record = (at, limits) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', primary: null, secondary: null, plan_type: 'plus', ...limits } } }) + '\n';
const windows = (primary, secondary, resetsAt) => ({ primary: { used_percent: primary, window_minutes: 300, resets_at: resetsAt }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: resetsAt + 6 * 86400 } });
async function rollout(home, name, content, at = Date.now()) {
  const date = new Date(at);
  const folder = path.join(home, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `rollout-${name}.jsonl`);
  await writeFile(file, JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'session_meta', payload: { id: name } }) + '\n' + content);
  return file;
}

test('Codex usage is the newest recorded limit across recent session files', async () => {
  const home = await fixture();
  const usage = new CodexUsage(home);
  assert.deepEqual(await usage.read(), { available: false, fiveHour: null, sevenDay: null, spendLimit: null, updatedAt: null });
  const now = Date.now(), resetsAt = Math.floor(now / 1000) + 3600;
  await rollout(home, 'older', record(now - 3 * 86400000, windows(80, 40, resetsAt - 86400)), now - 3 * 86400000);
  // Tool output and a separate quota follow the last Codex limit record.
  const file = await rollout(home, 'newer', record(now - 120000, windows(10, 4, resetsAt)) + record(now - 60000, windows(37.4, 6, resetsAt))
    + JSON.stringify({ timestamp: new Date(now - 50000).toISOString(), type: 'response_item', payload: { output: 'x'.repeat(400 * 1024) } }) + '\n'
    + record(now - 40000, { limit_id: 'premium' }) + record(now - 30000, { limit_id: 'other', ...windows(99, 99, resetsAt) }) + '{"timestamp":"', now - 30000);
  assert.deepEqual(await usage.read(now), {
    available: true, updatedAt: new Date(now - 60000).toISOString(), spendLimit: null,
    fiveHour: { usedPercentage: 37.4, resetsAt, reset: false },
    sevenDay: { usedPercentage: 6, resetsAt: resetsAt + 6 * 86400, reset: false },
  });
  // An unchanged file is not read again; an appended reply is.
  const cached = usage.cache.get(file);
  await usage.read(now);
  assert.equal(usage.cache.get(file), cached);
  await appendFile(file, '\n' + record(now, windows(41, 7, resetsAt)));
  assert.equal((await usage.read(now)).fiveHour.usedPercentage, 41);
});

test('an open chat resumed from an older Codex thread reports the current limits', async () => {
  const home = await fixture(), now = Date.now(), resetsAt = Math.floor(now / 1000) + 3600, started = now - 11 * 86400000;
  // A UUIDv7 thread ID begins with its start time.
  const id = `${started.toString(16).padStart(12, '0').replace(/^(.{8})(.{4})$/, '$1-$2')}-7891-804e-64441332094f`;
  assert.equal(threadStart(id), started);
  assert.ok(Number.isNaN(threadStart('0b9c2d7e-4f1a-4c3b-9e2d-1a2b3c4d5e6f')));
  await rollout(home, 'recent', record(now - 3600000, windows(20, 5, resetsAt)), now - 3600000);
  await rollout(home, id, record(now - 60000, windows(70, 11, resetsAt)), started);
  const usage = new CodexUsage(home);
  assert.equal((await usage.read(now)).fiveHour.usedPercentage, 20);
  usage.threads = () => [id];
  assert.equal((await usage.read(now)).fiveHour.usedPercentage, 70);
});

test('Codex windows are recognised by length and marked once they reset', async () => {
  const home = await fixture();
  const now = Date.now(), resetsAt = Math.floor(now / 1000) - 60;
  // A plan with a weekly limit only reports it as the primary window.
  await rollout(home, 'weekly', record(now - 7200000, { primary: { used_percent: 15, window_minutes: 10080, resets_at: resetsAt + 86400 } }), now - 7200000);
  const usage = new CodexUsage(home);
  assert.deepEqual(await usage.read(now), { available: true, fiveHour: null, sevenDay: { usedPercentage: 15, resetsAt: resetsAt + 86400, reset: false }, spendLimit: null, updatedAt: new Date(now - 7200000).toISOString() });
  await rollout(home, 'spent', record(now - 3600000, windows(99, 15, resetsAt)), now - 3600000);
  const result = await usage.read(now);
  assert.deepEqual(result.fiveHour, { usedPercentage: 0, resetsAt: null, reset: true, previous: { usedPercentage: 99, resetsAt } });
  assert.equal(result.sevenDay.reset, false);
});
