// Real desktop UI and HTTP routes with a synthetic chat: folder buttons at the
// paths an answer mentions, clickable paths in the terminal, and the finished
// and waiting tones. No CLI is started and no sound device is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await realpath(await mkdtemp(path.join(root, '.cache/reveal-sound-ui-')));
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const model = path.join(repo, 'models', 'Hero.blend'), notes = path.join(repo, 'docs', 'notes.md');
await mkdir(path.dirname(model), { recursive: true }); await mkdir(path.dirname(notes), { recursive: true });
await writeFile(model, 'blend'); await writeFile(notes, '# Notes');
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify([{ id: 'paths', tabOrder: 0, name: 'Paths', agent: 'codex', cwd: repo, open: true, status: 'stopped', pinned: false, hasConversation: true, cols: 100, rows: 24, createdAt: '2026-10-24T08:00:00Z', updatedAt: '2026-10-24T08:00:00Z' }]));
let service, browser;
const shown = [], errors = [], written = [];
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} }, native: event => { if (event.type === 'reveal') shown.push(event.path); } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    session.process = { resize() {}, write(data) { written.push(data); }, kill() { session.process = null; } };
    service.sessions.changed(session);
  };
  const session = service.sessions.get('paths');
  await service.sessions.hydrate(session); service.sessions.launch(session);
  session.terminal.write(`Saved the model to ${model}\r\nA missing one: S:\\nowhere\\gone.txt\r\nBackup in models\\Hero.blend. Notes in docs/notes.md here, and/or not a path.\r\n`);
  service.mobile.transcripts.read = async () => ({ supported: true, messages: [
    { id: 'user-1', role: 'user', text: `My own path ${model} gets no button.`, at: '2026-10-24T08:00:00Z' },
    { id: 'reply-1', role: 'assistant', text: `Твой файл в ${model}. Notes: \`docs/notes.md:3\`, a [link](docs/notes.md), the folder \`models/\` and a missing \`docs/missing.md\`.\n\n\`\`\`\n${model}\n\`\`\``, at: '2026-10-24T08:00:10Z' },
  ], activity: [] });

  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  // A stand-in for Web Audio that records the tones.
  await context.addInitScript(() => {
    window.__tones = [];
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    window.AudioContext = class {
      state = 'running'; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: param(), connect: next => next }; }
      createOscillator() { const node = { type: '', frequency: param(), connect: next => next, start() { window.__tones.push(node.frequency.value); }, stop() {} }; return node; }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);

  // Answers get a folder button at each existing file or folder; the user's message and code blocks do not.
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  const reply = page.locator('.conversation-message.assistant');
  await expect(reply.locator('.path-reveal')).toHaveCount(4);
  await expect(page.locator('.conversation-message.user .path-reveal')).toHaveCount(0);
  await expect(page.locator('.conversation-message.user')).toContainText(model);
  await expect(reply.locator('pre .path-reveal')).toHaveCount(0);
  await reply.getByRole('button', { name: `Show file in Explorer: ${model}`, exact: true }).click();
  // The path keeps its backslashes, also before the dot of a folder such as .cache.
  await expect(reply.locator('p').first()).toContainText(model);
  await reply.getByRole('button', { name: 'Show folder in Explorer: models/', exact: true }).click();
  await expect.poll(() => shown.length).toBe(2);
  assert.deepEqual(shown, [model, path.dirname(model)]);
  if (process.env.MRMAK_TEST_SHOT) await page.screenshot({ path: process.env.MRMAK_TEST_SHOT });

  // A path in the terminal is a link that shows the file in its folder.
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const row = page.locator('.xterm-rows > div').filter({ hasText: 'Saved the model to' });
  await row.waitFor();
  const box = await row.boundingBox(), cell = box.width / 100, column = 'Saved the model to '.length + 4;
  await page.mouse.move(box.x + cell * column, box.y + box.height / 2);
  await page.mouse.move(box.x + cell * (column + 1), box.y + box.height / 2);
  await page.mouse.click(box.x + cell * (column + 1), box.y + box.height / 2);
  await expect.poll(() => shown.length).toBe(3);
  assert.equal(shown[2], model);
  // Existing paths, absolute or relative to the chat folder, get a folder icon on a free cell after them.
  const icons = page.locator('.terminal-path-icon');
  await expect(icons).toHaveCount(3);
  assert.deepEqual(await icons.evaluateAll(items => items.map(item => item.dataset.path)), [model, 'models\\Hero.blend', 'docs/notes.md']);
  // xterm keeps the icons on the screen, over their rows, and the text stays visible.
  const screen = await page.locator('.xterm-screen').boundingBox(), backup = await page.locator('.xterm-rows > div').filter({ hasText: 'Backup in' }).boundingBox();
  for (const box of await icons.evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()))) assert.ok(box.y >= screen.y && box.y + box.height <= screen.y + screen.height && box.x > screen.x + 50, JSON.stringify(box));
  const second = await icons.nth(1).boundingBox();
  assert.ok(Math.abs(second.y - backup.y) < 2, 'the icon is on the row of its path');
  await expect(page.locator('.xterm-rows')).toContainText('Notes in docs/notes.md here');
  // After the closing dot, on the free cell; at the end of a line, right after the path.
  assert.deepEqual(await icons.evaluateAll(items => items.map(item => Number(item.dataset.column))), [`Saved the model to ${model}`.length, 'Backup in models\\Hero.blend.'.length, 'Backup in models\\Hero.blend. Notes in docs/notes.md'.length]);
  await icons.nth(1).click();
  await icons.nth(2).click();
  await expect.poll(() => shown.length).toBe(5);
  assert.deepEqual(shown.slice(3), [model, notes]);
  if (process.env.MRMAK_TEST_SHOT_ICONS) await page.screenshot({ path: process.env.MRMAK_TEST_SHOT_ICONS });

  // A Codex side thread (/btw) gets buttons for its keys, sent as exact Windows keys.
  const output = data => { session.terminal.write(data); session.pendingOutput += data; service.sessions.flushOutput(session); };
  const keys = page.getByRole('toolbar', { name: 'Side thread keys' });
  await expect(keys).toHaveCount(0);
  output('\r\n\r\n  Side from main thread · main finished · ctrl+/ to switch · ctrl+c to close    ⚠ 1 warning · f2 to view');
  await expect(keys.getByRole('button')).toHaveText(['Switch threadCtrl+/', 'Close side threadCtrl+C', 'View warningsF2']);
  if (process.env.MRMAK_TEST_SHOT_KEYS) await page.screenshot({ path: process.env.MRMAK_TEST_SHOT_KEYS });
  written.length = 0;
  for (const name of ['Switch thread', 'Close side thread', 'View warnings']) await keys.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect.poll(() => written.length).toBe(3);
  assert.deepEqual(written, ['\x1b[191;53;31;1;8;1_\x1b[191;53;31;0;8;1_', '\x1b[67;46;3;1;8;1_\x1b[67;46;3;0;8;1_', '\x1bOQ']);
  // Typed Ctrl+/ reaches Codex as the same exact key, not as Ctrl+Shift+-.
  await page.keyboard.press('Control+Slash');
  await expect.poll(() => written.length).toBe(4);
  assert.equal(written[3], written[0]);
  output('\x1b[2J\x1b[HBack in the main thread');
  await expect(keys).toHaveCount(0);

  // A finished turn plays the falling pair; a question the rising pair, twice.
  const tones = () => page.evaluate(() => window.__tones.splice(0));
  await tones();
  service.sessions.nativeEvent(session, { kind: 'turn-completed', id: 'turn-1' });
  await expect.poll(() => page.evaluate(() => window.__tones.length)).toBe(4);
  assert.deepEqual(await tones(), [1046.5, 2093, 784, 1568]);
  await new Promise(resolve => setTimeout(resolve, 1600));
  service.sessions.nativeEvent(session, { kind: 'request', prompt: 'AskUserQuestion', at: Date.now() });
  await expect.poll(() => page.evaluate(() => window.__tones.length)).toBe(8);
  assert.deepEqual((await tones()).filter((_, index) => index % 2 === 0), [784, 1046.5, 784, 1046.5]);
  // Turned off in Settings, nothing plays.
  await (await fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chatSound: false }) })).json();
  await new Promise(resolve => setTimeout(resolve, 1600));
  service.sessions.nativeEvent(session, { kind: 'turn-completed', id: 'turn-2' });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.deepEqual(await tones(), []);
  assert.deepEqual(errors, []);
  console.log('Reveal and sound UI passed: folder buttons for existing paths in answers only, Explorer selection, terminal path links, finished and waiting tones, sound off.');
} finally {
  await browser?.close();
  await service?.close();
}
