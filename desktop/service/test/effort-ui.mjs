// New chat offers the model and reasoning effort for Codex and Claude chats and remembers
// the last choice. The launch is stubbed: no CLI or account is started.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
import { inventory } from '../agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/effort-ui-'));
await mkdir(path.join(repo, 'workspace')); await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const agent = ['claude', 'codex'].find(id => inventory().some(item => item.id === id && item.available));
if (!agent) { console.log('Effort UI skipped: neither Codex nor Claude is installed.'); process.exit(0); }
let service, browser;
const launched = [], errors = [];
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    launched.push({ agent: session.agent, effort: session.effort, model: session.model });
    let onExit;
    session.status = 'running'; session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { session.process = null; onExit?.(); } };
    service.sessions.changed(session);
  };
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  const label = agent === 'codex' ? 'Codex' : 'Claude';
  const open = async () => { await page.getByRole('button', { name: 'New chat', exact: true }).click(); await page.locator('.agent-choice').filter({ hasText: new RegExp(`^${label}`) }).first().click(); };
  const effort = page.getByRole('group', { name: 'Reasoning effort' });
  const model = page.getByRole('combobox', { name: 'Model' });

  await open();
  await expect(effort.getByRole('button', { name: 'XHigh' })).toHaveAttribute('aria-pressed', 'true');
  await effort.getByRole('button', { name: 'High', exact: true }).click();
  // The first listed model after Default; Codex lists its own cache, Claude its aliases.
  await expect(model).toHaveValue('');
  const chosen = await model.locator('option').nth(1).getAttribute('value');
  await model.selectOption(chosen);
  if (process.env.MRMAK_TEST_SHOT) await page.locator('.desk-dialog').screenshot({ path: process.env.MRMAK_TEST_SHOT });
  await page.getByRole('button', { name: /Open chat/ }).click();
  await expect.poll(() => launched.length).toBe(1);
  assert.deepEqual(launched[0], { agent, effort: 'high', model: chosen });
  // The next New chat starts from the last choice; a shell has no effort.
  await open();
  await expect(effort.getByRole('button', { name: 'High', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(model).toHaveValue(chosen);
  await page.locator('.agent-choice').filter({ hasText: /Local terminal/ }).click();
  await expect(effort).toHaveCount(0);
  await expect(model).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(`Effort UI passed: ${label} starts with the chosen effort and model, both choices are remembered, and a shell has neither.`);
} finally {
  await browser?.close();
  await service?.close();
}
