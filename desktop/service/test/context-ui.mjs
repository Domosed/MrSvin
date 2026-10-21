// Isolated fake Claude 2 chat with a transcript and a status-line record. No agent is started.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { claudeTranscript } from '../native-events.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/context-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} } });
const stateDir = path.join(repo, '.mrmak'), nativeId = randomUUID();
const report = at => JSON.stringify({ type: 'user', isMeta: true, timestamp: at, message: { content: [
  '## Context Usage', '', '**Model:** claude-opus-5-5  ', '**Tokens:** 75.9k / 1m (8%)', '', '### Estimated usage by category', '',
  '| Category | Tokens | Percentage |', '|---|---|---|',
  '| System prompt | 9.3k | 0.9% |', '| System tools | 23.2k | 2.3% |', '| MCP tools | 14.2k | 1.4% |', '| Skills | 6.2k | 0.6% |', '| Messages | 22.6k | 2.3% |',
  '| MCP tools (deferred) | 40.1k | 4.0% |', '| Free space | 890.5k | 89.0% |', '| Autocompact buffer | 33k | 3.3% |', '',
  '### MCP Tools', '', '| Tool | Server | Tokens |', '|---|---|---|', '| mcp__docs__read | docs | 164 |', '| mcp__docs__create | docs | 254 |',
].join('\n') } }) + '\n';
const transcript = await claudeTranscript(repo, nativeId, path.join(stateDir, 'claude-2'));
await mkdir(path.dirname(transcript), { recursive: true });
await writeFile(transcript, JSON.stringify({ type: 'assistant', timestamp: '2026-10-21T10:00:00Z', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 75900 } } }) + '\n' + report('2026-10-21T10:01:00Z'));
await mkdir(path.join(stateDir, 'claude2-context'), { recursive: true });
await writeFile(path.join(stateDir, 'claude2-context', `${nativeId}.json`), JSON.stringify({ window: 1000000, used: 75910, usedPercentage: 8, updatedAt: new Date().toISOString() }));

const written = [];
const session = service.sessions.make({ id: 'blue', name: 'Context Check', agent: 'claude2', cwd: repo, nativeId, status: 'running', open: true, tabOrder: 0, cols: 90, rows: 24, createdAt: new Date().toISOString(), activity: 'idle' });
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
session.process = { write: data => written.push(data), resize() {}, kill() {} };
session.terminal.write(`Ready\r\n${'─'.repeat(60)}\r\n❯\r\n${'─'.repeat(60)}\r\n`);
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 })).newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  const chip = page.locator('.context-chip');
  await chip.waitFor();
  assert.equal((await chip.innerText()).replace(/\s+/g, ' ').trim(), '8 % 75.9k / 1M');
  await chip.click();
  const panel = page.getByRole('region', { name: 'Контекст' });
  await panel.waitFor();
  assert.match(await panel.locator('.context-total').innerText(), /Использовано: 8 %\s+75\.9k \/ 1M/);
  const rows = await panel.locator('.context-categories li').evaluateAll(items => items.map(item => item.innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows, ['System tools 23.2k 2,3 %', 'Messages 22.6k 2,3 %', 'MCP tools 14.2k 1,4 %', 'System prompt 9.3k 0,9 %', 'Skills 6.2k 0,6 %', 'Autocompact buffer 33k 3,3 %', 'Free space 890.5k 89,0 %', 'MCP tools (deferred) 40.1k —']);
  await panel.getByText('Инструменты MCP').click();
  await panel.getByText('mcp__docs__create').waitFor();
  if (process.env.MRMAK_TEST_SHOT) await page.screenshot({ path: process.env.MRMAK_TEST_SHOT });

  // Refresh sends /context to the idle chat and waits for the report it records.
  const earlier = await panel.locator('footer').innerText();
  await panel.getByRole('button', { name: /Обновить/ }).click();
  await page.waitForFunction(() => document.querySelector('.context-refresh')?.textContent?.includes('Обновляю'));
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.ok(written.join('').includes('\x1b[200~/context\x1b[201~'), 'the command is pasted into the terminal');
  await appendFile(transcript, report(new Date().toISOString()));
  await page.waitForFunction(() => document.querySelector('.context-refresh')?.textContent?.includes('Обновить'));
  assert.notEqual(await panel.locator('footer').innerText(), earlier, 'the footer shows the new report time');
  assert.equal(await panel.getByRole('alert').count(), 0);

  // A draft in the input box is never submitted.
  session.terminal.write(`\x1b[2J\x1b[HReady\r\n${'─'.repeat(60)}\r\n❯ unsent draft\r\n${'─'.repeat(60)}\r\n`);
  const before = written.length;
  await panel.getByRole('button', { name: /Обновить/ }).click();
  await panel.getByRole('alert').waitFor();
  assert.match(await panel.getByRole('alert').innerText(), /поле ввода/);
  assert.equal(written.length, before);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('Context UI passed: header meter, sorted categories with deferred tools last, MCP list, /context refresh and the draft guard.');
} finally {
  await browser?.close();
  session.process = null;
  await service.close();
}
