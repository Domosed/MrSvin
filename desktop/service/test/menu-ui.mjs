// Isolated fake chats and a stubbed restart. No production session or app is touched.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/menu-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
let restarts = 0;
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} }, restartApp: async () => { restarts++; return { restarting: true }; } });
const session = service.sessions.make({ id: 'menu', name: 'Menu fixture', agent: 'codex', cwd: repo, status: 'running', activity: 'working', open: true, nativeId: '22222222-2222-4222-8222-222222222222', cols: 80, rows: 30 });
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
session.process = { write() {}, resize() {}, kill() {} };
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await (await browser.newContext({ viewport: { width: 520, height: 700 } })).newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.locator('.xterm-screen').waitFor();
  const menu = page.getByRole('button', { name: 'Menu', exact: true }), actions = page.locator('.chats-header-actions');
  // The menu is the last control in the top-right corner and clears the voice dock.
  assert.equal(await actions.locator(':scope > :last-child').getAttribute('class'), 'app-menu');
  const edge = box => box.x + box.width, menuBox = await menu.boundingBox(), dock = await page.locator('.voice-dock.chats .voice-controls').boundingBox(), first = await actions.boundingBox();
  assert.ok(520 - edge(menuBox) <= 12, 'Menu sits in the right corner');
  assert.ok(edge(dock) <= first.x, 'The voice dock does not cover the header buttons');
  await menu.click();
  const item = page.getByRole('menuitem');
  assert.deepEqual(await item.allTextContents(), ['Save all chats and restart']);
  await page.keyboard.press('Escape');
  await item.waitFor({ state: 'detached' });
  await menu.click(); await item.click();
  await page.getByText('1 chat is still working.').waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(restarts, 0, 'Nothing restarts before the confirmation');
  await item.click();
  await page.getByRole('button', { name: 'Restart now', exact: true }).click();
  await page.getByRole('button', { name: 'Restarting…', exact: true }).waitFor();
  // The service saves the chats first, so the request reaches the stub a moment later.
  for (let attempt = 0; attempt < 100 && !restarts; attempt++) await page.waitForTimeout(50);
  await page.waitForTimeout(300);
  assert.equal(restarts, 1);
  assert.deepEqual(errors, []);
  console.log('Menu UI passed: corner menu clear of the voice dock, Escape, working-chat warning, cancel, and one confirmed restart request.');
} finally {
  await browser?.close(); session.process = null; await service.close();
}
