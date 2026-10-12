import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { UsageAlerts, usageWindows } from '../usage.mjs';

test('a limit that was at least 80% used is announced once after it resets', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'mrmak-usage-alerts-'));
  const now = Date.now(), resetsAt = Math.floor(now / 1000) + 600;
  const saved = { Claude: { fiveHour: { usedPercentage: 91.6, resetsAt }, sevenDay: { usedPercentage: 79, resetsAt } }, Codex: { fiveHour: { usedPercentage: 99, resetsAt } } };
  const sources = Object.fromEntries(Object.keys(saved).map(agent => [agent, { read: async at => usageWindows(saved[agent], at) }]));
  const notifications = [];
  const alerts = new UsageAlerts(stateDir, sources, (title, text) => notifications.push([title, text]));
  await alerts.check(now);
  assert.deepEqual(notifications, []);
  const later = (resetsAt + 5) * 1000;
  await alerts.check(later); await alerts.check(later + 30000);
  assert.deepEqual(notifications, [['Claude usage', 'Claude 5-hour session limit has reset. It was 92% used.'], ['Codex usage', 'Codex 5-hour session limit has reset. It was 99% used.']]);
  // A restart does not repeat the announcement; the next spent window is announced again.
  assert.deepEqual(JSON.parse(await readFile(path.join(stateDir, 'usage-alerts.json'), 'utf8')), { 'Claude.fiveHour': resetsAt, 'Codex.fiveHour': resetsAt });
  const restarted = new UsageAlerts(stateDir, sources, (title, text) => notifications.push([title, text]));
  await restarted.check(later + 60000);
  assert.equal(notifications.length, 2);
  saved.Claude = { fiveHour: { usedPercentage: 85, resetsAt: resetsAt + 18000 } };
  await restarted.check((resetsAt + 18001) * 1000);
  assert.deepEqual(notifications.slice(2), [['Claude usage', 'Claude 5-hour session limit has reset. It was 85% used.']]);
});
