import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJson } from './util.mjs';
import { usageWindows } from './usage.mjs';
import { requestHookCommand, requestHooks } from './requests.mjs';

export const statusLineScript = fileURLToPath(new URL('./claude-statusline.mjs', import.meta.url));
const slashes = value => value.replaceAll('\\', '/');
const hasStatusLine = file => {
  try { return !!JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))?.statusLine; } catch { return false; }
};
const pathKey = env => Object.keys(env).find(name => name.toUpperCase() === 'PATH') || 'PATH';

// Claude subscription limits come from the rate_limits data Claude Code passes to
// its status line. Chats started here get a status line that records them.
export class ClaudeUsage {
  constructor(repo, stateDir, { home = os.homedir(), env = process.env, script = statusLineScript } = {}) {
    Object.assign(this, { repo, stateDir, home, env });
    this.file = path.join(stateDir, 'claude-usage.json');
    this.settingsFile = path.join(stateDir, 'claude-statusline-settings.json');
    // Each file keeps one content, so a chat in another folder never rewrites the file a running chat was started with.
    this.hooksFile = path.join(stateDir, 'claude-hooks-settings.json');
    // Git Bash and PowerShell both run this form: a bare command with single-quoted forward-slash paths.
    this.command = [script, this.file].some(value => value.includes("'")) ? null : `node '${slashes(script)}' '${slashes(this.file)}'`;
  }

  // Command-line settings outrank user settings, so never replace a status line the user configured.
  customStatusLine(cwd = this.repo) {
    const config = this.env.CLAUDE_CONFIG_DIR || path.join(this.home, '.claude');
    return [path.join(config, 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].some(hasStatusLine);
  }

  // Returns the --settings file for a Claude chat, or undefined to launch it unchanged.
  // It carries the usage status line and the hook that reports permission prompts
  // (requests.mjs). Hooks add to the user's own; a status line would replace theirs.
  prepare(cwd, env) {
    try {
      const hook = requestHookCommand(), statusLine = !!this.command && !this.customStatusLine(cwd);
      if (!statusLine && !hook) return undefined;
      const file = statusLine ? this.settingsFile : this.hooksFile;
      const settings = JSON.stringify({ ...(statusLine && { statusLine: { type: 'command', command: this.command, padding: 0 } }), ...(hook && { hooks: requestHooks(hook) }) }, null, 2) + '\n';
      let current = '';
      try { current = readFileSync(file, 'utf8'); } catch { /* Written below. */ }
      if (current !== settings) { mkdirSync(this.stateDir, { recursive: true }); writeFileSync(file, settings); }
      // The installed app bundles Node; make it reachable when Node is not on PATH.
      const key = pathKey(env);
      const folders = String(env[key] || '').split(path.delimiter);
      if (!folders.some(folder => folder && ['node.exe', 'node'].some(name => existsSync(path.join(folder, name))))) env[key] = [...folders.filter(Boolean), path.dirname(process.execPath)].join(path.delimiter);
      return file;
    } catch { return undefined; }
  }

  async read(now = Date.now()) {
    return { ...usageWindows(await readJson(this.file, null), now), enabled: !!this.command, customStatusLine: this.customStatusLine() };
  }
}
