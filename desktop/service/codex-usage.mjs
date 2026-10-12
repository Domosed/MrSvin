import { open, stat } from 'node:fs/promises';
import { codexHome, recentFolders, transcriptFiles } from './codex-history.mjs';
import { usageWindows } from './usage.mjs';

function recorded(record) {
  const limits = record?.payload?.rate_limits;
  if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count' || !limits) return null;
  // Other limit IDs describe separate quotas, not the plan's Codex usage.
  if (limits.limit_id && limits.limit_id !== 'codex') return null;
  // Plans differ in which windows they have, so each is recognised by its length.
  const window = minutes => {
    const value = [limits.primary, limits.secondary].find(item => item?.window_minutes === minutes);
    return Number.isFinite(value?.used_percent) && Number.isFinite(value.resets_at) ? { usedPercentage: value.used_percent, resetsAt: value.resets_at } : null;
  };
  const at = Date.parse(record.timestamp), fiveHour = window(300), sevenDay = window(7 * 24 * 60);
  return Number.isFinite(at) && (fiveHour || sevenDay) ? { at, fiveHour, sevenDay, updatedAt: record.timestamp } : null;
}

// Replies are recorded often; a larger tail is read only when tool output follows the last one.
async function latestRecord(file, size) {
  const handle = await open(file, 'r');
  try {
    for (const tail of [64 * 1024, 512 * 1024, 4 * 1024 * 1024]) {
      const length = Math.min(size, tail), buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, size - length);
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index--) {
        if (!lines[index].includes('"rate_limits"')) continue;
        try { const found = recorded(JSON.parse(lines[index])); if (found) return found; } catch { /* A record cut by the tail or still being written. */ }
      }
      if (length === size) break;
    }
  } finally { await handle.close(); }
  return null;
}

// Codex subscription limits come from the rate_limits data the CLI saves with each
// reply in its session files. They are read here and never changed.
export class CodexUsage {
  constructor(home = codexHome()) {
    this.home = home;
    this.cache = new Map();
  }

  async read(now = Date.now()) {
    const cache = new Map();
    let latest = null;
    // A weekly window spans sessions started in the last eight days; each timestamp also covers the days next to it.
    for await (const file of transcriptFiles(recentFolders(this.home, [0, 3, 6].map(days => now - days * 86400000)), false)) {
      const size = (await stat(file).catch(() => null))?.size;
      if (size === undefined) continue;
      // Windows keeps the modification time of a file Codex still has open, so a changed size marks new records.
      const cached = this.cache.get(file)?.size === size ? this.cache.get(file) : { size, found: await latestRecord(file, size).catch(() => null) };
      cache.set(file, cached);
      // Every chat reports the same account limits, so the newest record of any file is current.
      if (cached.found && (!latest || cached.found.at > latest.at)) latest = cached.found;
    }
    this.cache = cache;
    return usageWindows(latest, now);
  }
}
