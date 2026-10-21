// Real UI with isolated state and fake CLIs. No login or model request is made.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache', 'claude-profiles-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), claudeUsageOptions: { home: repo, env: {} }, codexHome: path.join(repo, 'codex'), mcpOptions: { home: repo, env: {} } });
const launches = [];
service.sessions.launch = session => {
  launches.push({ id: session.id, agent: session.agent, cwd: session.cwd, nativeId: session.nativeId });
  session.status = 'running';
  // Closing the service waits for Claude chats to exit, so the fake process reports its exit.
  const exits = new Set();
  session.process = { write() {}, resize() {}, onExit(callback) { exits.add(callback); return { dispose: () => exits.delete(callback) }; }, kill() { session.process = null; for (const callback of [...exits]) callback({ exitCode: 0 }); exits.clear(); } };
  session.terminal.write(`Ready: ${session.agent}\r\n`);
  service.sessions.changed(session);
};
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.getByRole('button', { name: 'Open your first chat' }).click();
  const original = page.locator('.agent-choice').filter({ hasText: 'Claude Code' });
  const second = page.locator('.agent-choice').filter({ hasText: 'Claude 2' });
  assert.equal(await original.isEnabled(), true);
  assert.equal(await second.isEnabled(), true);
  assert.equal(await second.locator('svg').getAttribute('stroke'), '#68a8f5');
  assert.equal(await original.locator('svg').getAttribute('stroke'), 'currentColor');
  await second.click();
  await page.getByText('Отдельный профиль Claude.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(repo, 'second-profile-picker.png') });
  await page.getByPlaceholder('e.g. Dream Game · animations').fill('Blue Account');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.locator('.chat-tab').filter({ hasText: 'Blue Account' }).waitFor();
  assert.equal(launches[0].agent, 'claude2');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await original.click();
  await page.getByPlaceholder('e.g. Dream Game · animations').fill('Original Account');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.locator('.chat-tab').filter({ hasText: 'Original Account' }).waitFor();
  assert.equal(launches[1].agent, 'claude');
  assert.equal(launches[0].cwd, launches[1].cwd);
  assert.notEqual(launches[0].nativeId, launches[1].nativeId);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('.history-filters').getByRole('button', { name: 'Claude 2', exact: true }).click();
  assert.equal(await page.locator('.history-item').count(), 1);
  await page.locator('.history-open').filter({ hasText: 'Blue Account' }).waitFor();
  await page.getByRole('button', { name: 'Close history', exact: true }).click();
  const resetsAt = Date.now() / 1000 + 3600;
  for (const [agent, usedPercentage] of [['claude', 12], ['claude2', 73]]) await writeFile(path.join(repo, '.mrmak', `${agent}-usage.json`), JSON.stringify({ fiveHour: { usedPercentage, resetsAt } }));
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  for (const [label, used] of [['Claude', '12'], ['Claude 2', '73']]) {
    const meter = page.getByRole('group', { name: `${label} usage`, exact: true }).getByRole('progressbar').first();
    await meter.waitFor(); assert.equal(await meter.getAttribute('aria-valuenow'), used);
  }
  await page.screenshot({ path: path.join(repo, 'two-account-usage.png') });
  await page.getByRole('button', { name: 'Close usage', exact: true }).click();
  await page.setViewportSize({ width: 460, height: 740 });
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await second.click();
  await page.getByRole('button', { name: 'Open chat', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.getByRole('button', { name: 'Open chat', exact: true }).isVisible(), true);
  await page.screenshot({ path: path.join(repo, 'second-profile-narrow.png') });
  assert.deepEqual(errors, []);
  console.log(`Claude profiles UI passed: both choices, blue icon, simultaneous chats, separate History and usage, narrow dialog. Screenshots: ${repo}`);
} finally { await browser?.close(); await service.close(); }
