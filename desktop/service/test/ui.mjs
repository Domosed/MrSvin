// Run after npm run build. Isolated browser, repository and fake PTYs; no agent
// login, live conversation, Windows shortcut or production setting is touched.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { clipboardPermissions, launchBrowser } from './browser.mjs';
// Desktop key conventions: Cmd on macOS, Ctrl elsewhere (src/desktop/platform.ts).
const mac = process.platform === 'darwin';
const copyKey = mac ? 'Meta+c' : 'Control+c';
import { inventory } from '../agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/workspace-ui-'));
for (const dir of ['workspace/test', 'knowledge', 'processes', '.claude/skills/example', '.agents/skills/example', 'inbox', 'projects']) await mkdir(path.join(repo, dir), { recursive: true });
await writeFile(path.join(repo, '.claude/skills/example/SKILL.md'), '# Example skill\n\n**Read me**\n');
const documentPath = path.join(repo, 'knowledge/notes.md');
await writeFile(documentPath, '# A useful document\n\n| Name | State |\n| --- | --- |\n| Example | Ready |\n\n**Bold text**\n');
const steps = Array.from({ length: 12 }, (_, index) => ({ name: `Step ${index + 1} - complete English title`, path: `step${index}.html` }));
for (const [index, step] of steps.entries()) await writeFile(path.join(repo, 'workspace/test', step.path), `<h1>Document ${index + 1}</h1><p>Readable content.</p>`);
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', folder: 'test', title: 'Workspace test', category: 'test', created: '2026-09-15', status: 'active', steps }] }));
await cp(path.join(root, 'public/assets'), path.join(root, 'dist/assets'), { recursive: true });
const mcpHome = path.join(repo, 'fake-home'); await mkdir(path.join(mcpHome, '.codex'), { recursive: true });
await writeFile(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { 'fixture-tools': { url: 'https://fixture.example/mcp', headers: { Authorization: 'private-ui-fixture-token' } } } }));
await writeFile(path.join(repo, '.claude/settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: true }));
await writeFile(path.join(mcpHome, '.codex/config.toml'), '[mcp_servers."global-tools"]\nurl="https://global.example/mcp"\n');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: mcpHome, env: {}, probe: async () => ({ status: 'available', toolCount: 7 }) }, claudeUsageOptions: { home: mcpHome, env: {} }, codexHome: path.join(mcpHome, '.codex') });
const writes = new Map();
for (const agent of ['codex', 'claude', 'opencode', 'kimi', 'shell']) {
  const session = service.sessions.make({ id: agent, name: `${agent} fixture`, agent, cwd: repo, status: 'running', open: true, pinned: false, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(agent, session); await service.sessions.hydrate(session);
  const received = []; writes.set(agent, received);
  session.process = { write: data => received.push(data), resize() {}, kill() {} };
  await new Promise(resolve => session.terminal.write(Array.from({ length: 400 }, (_, i) => `Fixture line ${String(i + 1).padStart(3, '0')} - readable terminal output\r\n`).join('') + '\x1b[?1000h\x1b[?1006h', resolve));
}
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 900, height: 800 }, permissions: clipboardPermissions });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace + '#/test/0');
  for (let index = 0; index < 12; index++) { await page.getByRole('tab').nth(index).click(); await page.frameLocator('iframe.report-frame').getByRole('heading', { name: `Document ${index + 1}`, exact: true }).waitFor(); }
  let releaseReport;
  const delayedReport = new Promise(resolve => { releaseReport = resolve; });
  await page.route('**/workspace/test/step0.html*', async route => { if (route.request().method() === 'GET') await delayedReport; await route.continue(); });
  await page.getByRole('tab').nth(0).click();
  try {
    await page.getByRole('status').filter({ hasText: 'Opening report' }).waitFor();
    assert.equal(await page.locator('iframe.report-frame').evaluate(element => getComputedStyle(element).visibility), 'hidden');
    assert.equal(await page.locator('.report-document').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(16, 17, 21)');
  } finally { releaseReport(); }
  await page.locator('.report-document[aria-busy=false]').waitFor();
  assert.equal(await page.frameLocator('iframe.report-frame').locator('body').evaluate(element => getComputedStyle(element).scrollbarColor), 'rgb(81, 76, 89) rgb(17, 18, 23)');
  await page.unroute('**/workspace/test/step0.html*');
  await page.route('**/workspace/test/step1.html', route => route.request().method() === 'HEAD' ? route.fulfill({ status: 404 }) : route.continue());
  await page.getByRole('tab').nth(1).click();
  await page.getByText('Page unavailable (404).', { exact: true }).waitFor();
  await page.unroute('**/workspace/test/step1.html');
  await page.getByRole('tab').nth(2).click();
  await page.locator('.report-document[aria-busy=false]').waitFor();
  await page.getByRole('button', { name: 'Toggle files', exact: true }).click();
  await page.getByRole('treeitem', { name: /^knowledge$/ }).click();
  await page.getByRole('treeitem', { name: /^notes.md/ }).click();
  await page.getByRole('heading', { name: 'A useful document' }).waitFor(); assert.equal(await page.locator('.mak-markdown table').count(), 1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit notes.md' }).fill('# Edited document\n\nUnicode: русский 🐽\n');
  await page.getByRole('textbox', { name: 'Edit notes.md' }).press('Control+s');
  await page.getByText('Saved', { exact: true }).waitFor(); assert.match(await readFile(documentPath, 'utf8'), /русский 🐽/);
  await writeFile(documentPath, '# Changed by another agent\n');
  await page.getByRole('textbox', { name: 'Edit notes.md' }).fill('# My unsaved draft\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(/This file changed on disk/).waitFor(); assert.match(await readFile(documentPath, 'utf8'), /another agent/);
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await page.getByRole('treeitem', { name: /^notes.md/ }).click();
  await page.getByRole('heading', { name: 'My unsaved draft' }).waitFor();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('heading', { name: 'Changed by another agent' }).waitFor();
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await page.getByRole('button', { name: 'Toggle skills', exact: true }).click();
  await page.getByRole('treeitem', { name: /^example$/ }).click(); await page.getByRole('treeitem', { name: /^SKILL.md/ }).click();
  await page.getByRole('heading', { name: 'Example skill' }).waitFor();
  await page.getByRole('button', { name: 'Toggle mcp', exact: true }).click();
  await page.getByRole('heading', { name: 'fixture-tools', exact: true }).waitFor();
  assert.equal((await page.locator('.mcp-panel').innerText()).includes('private-ui-fixture-token'), false);
  await page.getByRole('button', { name: 'Check fixture-tools for Claude', exact: true }).click();
  await page.locator('[data-mcp-id="claude:fixture-tools"]').getByText('7 tools', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Filter MCP by agent' }).selectOption('codex');
  await page.getByRole('heading', { name: 'global-tools', exact: true }).waitFor();
  assert.equal(await page.locator('.mcp-server').count(), 1);
  await page.getByRole('combobox', { name: 'Filter MCP by scope' }).selectOption('project');
  await page.getByText('No MCP servers match these filters.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close MCP', exact: true }).click();
  await page.goto(service.urls.chats);
  const usageAgents = inventory().filter(item => ['claude', 'codex'].includes(item.id) && item.available).map(item => item.id);
  if (usageAgents.length) await page.getByRole('button', { name: 'Usage', exact: true }).click();
  if (usageAgents.includes('claude')) {
    await page.getByRole('group', { name: 'Claude usage', exact: true }).getByText(/Usage appears after Claude replies/).waitFor();
    const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600 + 14 * 60 + 10;
    await writeFile(path.join(repo, '.mrmak/claude-usage.json'), JSON.stringify({ fiveHour: { usedPercentage: 42, resetsAt }, sevenDay: { usedPercentage: 91, resetsAt: resetsAt + 3 * 86400 }, spendLimit: null, updatedAt: new Date().toISOString() }));
    await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
    const session = page.getByRole('group', { name: 'Claude usage', exact: true }).getByRole('progressbar', { name: 'Current session · 5 h', exact: true });
    await session.waitFor(); assert.equal(await session.getAttribute('aria-valuenow'), '42');
    await page.getByText('Resets in 2 h 14 min', { exact: true }).waitFor();
    assert.equal(await page.locator('.usage-meter.warn').count(), 1);
  }
  if (usageAgents.includes('codex')) {
    const codex = page.getByRole('group', { name: 'Codex usage', exact: true });
    await codex.getByText(/Usage appears after Codex replies/).waitFor();
    const resetsAt = Math.floor(Date.now() / 1000) + 3 * 86400;
    const day = new Date(), folder = path.join(mcpHome, '.codex/sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'rollout-usage-fixture.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 97, window_minutes: 300, resets_at: resetsAt }, secondary: { used_percent: 15, window_minutes: 10080, resets_at: resetsAt } } } }));
    await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
    const session = codex.getByRole('progressbar', { name: 'Current session · 5 h', exact: true });
    await session.waitFor(); assert.equal(await session.getAttribute('aria-valuenow'), '97');
    assert.equal(await codex.getByRole('progressbar', { name: 'Weekly', exact: true }).getAttribute('aria-valuenow'), '15');
    // Codex itself shows what is left, so its meters give both figures.
    assert.deepEqual(await codex.locator('.usage-meter-label strong').allTextContents(), ['97% used · 3% left', '15% used · 85% left']);
    assert.equal(await codex.locator('.usage-meter.high').count(), 1);
  }
  if (usageAgents.length) { await page.keyboard.press('Escape'); await page.locator('.usage-panel').waitFor({ state: 'detached' }); }
  async function setTerminalFontSize(size) {
    await page.getByTitle('Chat options', { exact: true }).click();
    const control = page.locator('.font-control');
    const current = Number(await control.locator('span').last().innerText());
    const button = control.getByRole('button', { name: size > current ? '+' : '−', exact: true });
    for (let count = 0; count < Math.abs(size - current); count++) await button.click();
    await page.getByTitle('Chat options', { exact: true }).click();
  }
  // Check the actual terminal rows, not just the host box: FitAddon can size
  // a grid into parent padding and silently clip the CLI's bottom status row.
  for (const [width, height, fontSize] of [[535, 720, 13], [535, 497, 17], [900, 800, 13], [640, 480, 22]]) {
    await page.setViewportSize({ width, height });
    await setTerminalFontSize(fontSize);
    await page.waitForFunction(size => {
      const rows = document.querySelector('.xterm-rows');
      return rows && getComputedStyle(rows).fontSize === `${size}px`;
    }, fontSize);
    await page.waitForFunction(() => {
      const last = document.querySelector('.xterm-rows > :last-child')?.getBoundingClientRect();
      const host = document.querySelector('.terminal-host')?.getBoundingClientRect();
      const status = document.querySelector('.chat-status')?.getBoundingClientRect();
      return last && host && status && last.bottom <= host.bottom + .5 && last.bottom <= status.top - 4 && last.right <= host.right + .5;
    }, null, { timeout: 3000 });
  }
  await page.setViewportSize({ width: 900, height: 800 });
  await setTerminalFontSize(13);
  for (const agent of ['codex', 'claude', 'opencode', 'kimi', 'shell']) {
    await page.locator(`[data-chat-tab="${agent}"] [role="tab"]`).click();
    const screen = page.locator('.terminal-area .xterm-screen'); await screen.waitFor();
    await page.locator('.xterm-rows').filter({ hasText: 'Fixture line' }).waitFor();
    if (agent !== 'shell') {
      await screen.hover(); const before = await page.locator('.xterm-rows').innerText(); await page.mouse.wheel(0, -420);
      await page.waitForFunction(previous => (document.querySelector('.xterm-rows'))?.innerText !== previous, before);
      assert.notEqual(await page.locator('.xterm-rows').innerText(), before, 'Agent wheel scroll must move history even with mouse reporting enabled');
      await page.evaluate(() => navigator.clipboard.writeText('clipboard sentinel'));
      await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press(copyKey);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard sentinel');
      // Shift (Option on macOS) overrides terminal mouse tracking so a row can be selected.
      const selectKey = mac ? 'Alt' : 'Shift';
      await page.keyboard.down(selectKey); await screen.click({ position: { x: 120, y: 30 }, clickCount: 3 }); await page.keyboard.up(selectKey);
      await page.keyboard.press(copyKey);
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Fixture line/);
      assert.ok(writes.get(agent).every(data => !data.includes('\x03')), `${agent}: the copy shortcut must never reach PTY`);
      if (mac) {
        // macOS: Cmd+C copies; Ctrl+C is the CLI's own interrupt, as in Terminal.app.
        await page.keyboard.press('Control+c');
        for (let i = 0; i < 20 && !writes.get(agent).includes('\x03'); i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(writes.get(agent).includes('\x03'), `${agent}: Ctrl+C reaches the CLI on macOS`);
      }
    } else {
      await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Control+c');
      for (let i = 0; i < 20 && !writes.get(agent).includes('\x03'); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(writes.get(agent).includes('\x03'), 'The local shell retains Ctrl+C interrupt');
    }
  }
  assert.deepEqual(errors, []);
  console.log('UI passed: 12 clickable wrapping tabs; Markdown preview/edit/save/conflict/draft; local Skills; MCP filtering, checks and hidden credentials; Claude and Codex usage panel; terminal bottom row visible across four window/font sizes; Codex/Claude/OpenCode/Kimi copy and scroll; PowerShell interrupt.');
} finally {
  await browser?.close();
  for (const session of service.sessions.items.values()) session.process = null;
  await service.close();
}
