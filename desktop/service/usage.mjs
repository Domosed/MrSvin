import path from 'node:path';
import { readJson, saveJson } from './util.mjs';

const windows = { fiveHour: '5-hour session', sevenDay: 'weekly', spendLimit: 'spend' };

// Claude and Codex limits are both recorded as { usedPercentage, resetsAt } per window.
export function usageWindows(saved, now) {
  const usage = {};
  for (const name of Object.keys(windows)) {
    const usedPercentage = Number(saved?.[name]?.usedPercentage), resetsAt = Number(saved?.[name]?.resetsAt);
    if (!saved?.[name] || !Number.isFinite(usedPercentage) || !Number.isFinite(resetsAt)) usage[name] = null;
    // The CLI reports the new window with its next reply.
    else if (resetsAt * 1000 <= now) usage[name] = { usedPercentage: 0, resetsAt: null, reset: true, previous: { usedPercentage, resetsAt } };
    // A spend limit may exceed 100%.
    else usage[name] = { usedPercentage: Math.max(0, name === 'spendLimit' ? usedPercentage : Math.min(100, usedPercentage)), resetsAt, reset: false };
  }
  return { available: Object.values(usage).some(Boolean), ...usage, updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null };
}

// Announces, once per window, that a limit which was at least 80% used has reset.
export class UsageAlerts {
  constructor(stateDir, sources, notify) {
    Object.assign(this, { file: path.join(stateDir, 'usage-alerts.json'), sources, notify });
  }

  async check(now = Date.now()) {
    this.announced ||= await readJson(this.file, {});
    let changed = false;
    for (const [agent, source] of Object.entries(this.sources)) {
      const usage = await source.read(now).catch(() => ({}));
      for (const [name, label] of Object.entries(windows)) {
        const previous = usage[name]?.previous, id = `${agent}.${name}`;
        if (!previous || previous.usedPercentage < 80 || this.announced[id] === previous.resetsAt) continue;
        this.announced[id] = previous.resetsAt; changed = true;
        this.notify(`${agent} usage`, `${agent} ${label} limit has reset. It was ${Math.round(previous.usedPercentage)}% used.`);
      }
    }
    if (changed) await saveJson(this.file, this.announced);
  }

  start() {
    const check = () => { this.check().catch(() => { /* The next check retries. */ }); };
    this.timer = setInterval(check, 30000); this.timer.unref(); check();
  }
  stop() { clearInterval(this.timer); }
}
