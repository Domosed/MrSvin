import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ClaudeUsage, statusLineScript } from '../claude-usage.mjs';
import { requestHookScript } from '../requests.mjs';
import { createService } from '../server.mjs';
import { terminalCommand, inventory } from '../agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
const statusLine = (file, input) => spawnSync(process.execPath, [statusLineScript, file], { input: JSON.stringify(input), encoding: 'utf8', timeout: 10000 });

test('the status line records rate limits and prints a short summary', async () => {
  const folder = await temp('claude-statusline-');
  const file = path.join(folder, 'state', 'claude-usage.json');
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const result = statusLine(file, { model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 42.4, resets_at: resetsAt }, seven_day: { used_percentage: 23, resets_at: resetsAt + 86400 } } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /5h 42% · 7d 23%/);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.fiveHour, { usedPercentage: 42.4, resetsAt });
  assert.equal(saved.spendLimit, null);
  assert.ok(Date.parse(saved.updatedAt));

  const other = path.join(folder, 'other.json');
  for (const input of [{ model: { display_name: 'Opus' } }, 'not json']) {
    const empty = statusLine(other, input);
    assert.equal(empty.status, 0);
    assert.equal(empty.stdout, '');
  }
  await assert.rejects(stat(other));
});

test('usage reads saved limits and marks windows that have already reset', async () => {
  const home = await temp('claude-usage-home-');
  const stateDir = path.join(home, 'state');
  const usage = new ClaudeUsage(home, stateDir, { home, env: {} });
  assert.deepEqual(await usage.read(), { available: false, fiveHour: null, sevenDay: null, spendLimit: null, updatedAt: null, enabled: true, customStatusLine: false });
  const now = Date.now();
  await mkdir(stateDir, { recursive: true });
  await writeFile(usage.file, JSON.stringify({ fiveHour: { usedPercentage: 120, resetsAt: now / 1000 - 60 }, sevenDay: { usedPercentage: 23, resetsAt: now / 1000 + 600 }, spendLimit: { usedPercentage: 130, resetsAt: now / 1000 + 600 }, updatedAt: '2026-09-29T10:00:00.000Z' }));
  const result = await usage.read(now);
  assert.equal(result.available, true);
  assert.deepEqual(result.fiveHour, { usedPercentage: 0, resetsAt: null, reset: true, previous: { usedPercentage: 120, resetsAt: now / 1000 - 60 } });
  assert.deepEqual(result.sevenDay, { usedPercentage: 23, resetsAt: now / 1000 + 600, reset: false });
  assert.equal(result.spendLimit.usedPercentage, 130);
  assert.equal(result.updatedAt, '2026-09-29T10:00:00.000Z');
});

test('Claude chats get the usage status line unless the user configured their own, and always the permission hook', async () => {
  const home = await temp('claude-usage-launch-');
  const project = path.join(home, 'project');
  await mkdir(path.join(project, '.claude'), { recursive: true });
  const stateDir = path.join(home, 'state');
  const usage = new ClaudeUsage(project, stateDir, { home, env: {} });
  const env = { Path: '' };
  const settings = usage.prepare(project, env);
  assert.equal(settings, path.join(stateDir, 'claude-statusline-settings.json'));
  const { statusLine: configured, hooks } = JSON.parse(await readFile(settings, 'utf8'));
  const hook = [{ hooks: [{ type: 'command', command: `node '${requestHookScript.replaceAll('\\', '/')}'`, timeout: 10 }] }];
  assert.deepEqual(hooks, { PermissionRequest: hook, SessionStart: hook });
  assert.equal(configured.type, 'command');
  assert.equal(configured.command, `node '${statusLineScript.replaceAll('\\', '/')}' '${usage.file.replaceAll('\\', '/')}'`);
  assert.equal(configured.command.includes('\\'), false);
  // Without Node on PATH, the bundled runtime is appended for the status line.
  assert.equal(env.Path, path.dirname(process.execPath));
  assert.equal(env.PATH, undefined);

  await writeFile(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line' } }));
  // The user's status line stays. The hook reaches the chat through a second file, and the first one is not rewritten.
  const hooksOnly = usage.prepare(project, {});
  assert.equal(hooksOnly, path.join(stateDir, 'claude-hooks-settings.json'));
  assert.deepEqual(JSON.parse(await readFile(hooksOnly, 'utf8')), { hooks });
  assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')).statusLine, configured);
  assert.equal((await usage.read()).customStatusLine, true);

  const quoted = new ClaudeUsage(project, path.join(home, "it's"), { home, env: {} });
  assert.equal(quoted.prepare(home, {}), path.join(home, "it's", 'claude-hooks-settings.json'));
  assert.equal((await quoted.read()).enabled, false);

  if (inventory().find(item => item.id === 'claude')?.available) {
    const command = terminalCommand('claude', { settings });
    // A native claude.exe starts directly; a script shim goes through an encoded PowerShell command.
    if (command.args.includes('-EncodedCommand')) assert.ok(Buffer.from(command.args.at(-1), 'base64').toString('utf16le').includes(`--settings' '${settings}`));
    else assert.equal(command.args[command.args.indexOf('--settings') + 1], settings);
  }
});

test('usage is available only through the authenticated service', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'claude-usage-service-'));
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Mr. Mak UI</html>');
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
  const home = await temp('claude-usage-service-home-');
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), claudeUsageOptions: { home, env: {} }, codexHome: path.join(home, '.codex') });
  try {
    const route = service.origin + '/api/usage';
    assert.equal((await fetch(route)).status, 401);
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    assert.equal(statusLine(path.join(repo, '.mrmak', 'claude-usage.json'), { rate_limits: { five_hour: { used_percentage: 12, resets_at: resetsAt } } }).status, 0);
    const response = await fetch(route, { headers: { Authorization: `Bearer ${service.token}` } });
    assert.equal(response.status, 200);
    const { claude, codex } = await response.json();
    assert.equal(claude.available, true);
    assert.deepEqual(claude.fiveHour, { usedPercentage: 12, resetsAt, reset: false });
    assert.equal(codex.available, false);
  } finally { await service.close(); }
});
