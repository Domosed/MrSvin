// Isolated fake chats and a stub in place of the CLI deletion. No production chat or CLI home is touched.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/history-delete-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
const cliDeletes = [];
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} }, deleteNative: async target => { cliDeletes.push(target.agent); return { agent: target.agent, files: 1, prompts: 1 }; } });
for (const [id, name, agent, nativeId] of [['secret', 'Secret chat', 'claude', '11111111-2222-4333-8444-555555555555'], ['plain', 'Plain chat', 'codex', '99999999-8888-4777-8666-555555555555'], ['shell', 'Shell chat', 'shell', null]]) {
  const session = service.sessions.make({ id, name, agent, cwd: repo, status: 'stopped', open: false, nativeId, hasConversation: !!nativeId, createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', cols: 80, rows: 30 });
  service.sessions.items.set(id, session);
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await (await browser.newContext({ viewport: { width: 520, height: 760 } })).newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.getByTitle('History · Ctrl+Shift+H').click();
  const rows = page.locator('.history-item'), row = name => rows.filter({ hasText: name });
  await rows.nth(2).waitFor();
  // The delete button stands beside the pin without covering it.
  const trash = await page.getByRole('button', { name: 'Delete Secret chat', exact: true }).boundingBox(), pin = await page.getByRole('button', { name: 'Pin Secret chat', exact: true }).boundingBox();
  assert.ok(trash.x + trash.width <= pin.x + 1, 'Delete and pin do not overlap');
  // Nothing is deleted without the confirmation, and Cancel leaves the chat alone.
  await page.getByRole('button', { name: 'Delete Secret chat', exact: true }).click();
  const confirm = page.getByRole('group', { name: 'Delete Secret chat', exact: true });
  await confirm.getByText('What the provider already received stays on its servers.').waitFor();
  const box = confirm.getByRole('checkbox');
  assert.equal(await box.isChecked(), false, 'The CLI copy is kept unless asked');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal(service.sessions.list().length, 3);
  // With the box ticked the CLI copy is deleted too.
  await page.getByRole('button', { name: 'Delete Secret chat', exact: true }).click();
  await box.check();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await row('Secret chat').waitFor({ state: 'detached' });
  assert.deepEqual(cliDeletes, ['claude']);
  // Without the box only the History entry goes.
  await page.getByRole('button', { name: 'Delete Plain chat', exact: true }).click();
  await page.getByRole('group', { name: 'Delete Plain chat', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await row('Plain chat').waitFor({ state: 'detached' });
  assert.deepEqual(cliDeletes, ['claude']);
  // A local shell has no CLI conversation and no provider.
  await page.getByRole('button', { name: 'Delete Shell chat', exact: true }).click();
  const shell = page.getByRole('group', { name: 'Delete Shell chat', exact: true });
  await shell.getByRole('button', { name: 'Delete', exact: true }).waitFor();
  assert.equal(await shell.getByRole('checkbox').count(), 0);
  assert.equal(await shell.getByText('provider').count(), 0);
  assert.deepEqual(service.sessions.list().map(item => item.name), ['Shell chat']);
  assert.deepEqual(errors, []);
  console.log('History delete UI passed: confirmation, Cancel, CLI copy only when ticked, rows removed live, shell chats without CLI options.');
} finally {
  await browser?.close(); await service.close();
}
