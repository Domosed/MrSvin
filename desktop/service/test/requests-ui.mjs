// Isolated fake chats in every waiting state. No agent is started and no production session is touched.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/requests-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} } });
const stub = { write() {}, resize() {}, kill() {} };
const fixtures = [
  { id: 'plain', name: 'Plain work', agent: 'claude', activity: 'working' },
  { id: 'permission', name: 'Permission', agent: 'claude', activity: 'waiting', waitingFor: 'permission' },
  { id: 'question', name: 'Question', agent: 'claude', activity: 'waiting', waitingFor: 'question' },
  { id: 'background', name: 'Background question', agent: 'codex', activity: 'working', waitingFor: 'question' },
  { id: 'asked', name: 'Answer with a question', agent: 'claude', activity: 'idle', unread: true, completionVersion: 1, waitingFor: 'question' },
  { id: 'unread', name: 'Unread answer', agent: 'codex', activity: 'idle', unread: true, completionVersion: 1 },
  { id: 'attention', name: 'API error', agent: 'claude', activity: 'waiting' },
];
for (const [tabOrder, fixture] of fixtures.entries()) {
  const session = service.sessions.make({ cwd: repo, status: 'running', open: true, tabOrder, cols: 80, rows: 30, createdAt: new Date().toISOString(), ...fixture });
  service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
  session.process = stub;
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 420 }, deviceScaleFactor: 2 })).newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.locator('.xterm-screen').waitFor();
  const tab = id => page.locator(`[data-chat-tab="${id}"]`);
  const look = async id => {
    const logo = tab(id).locator('.session-logo'), mark = logo.locator('.session-waiting');
    return { mark: await mark.count() ? await mark.textContent() : null, unread: await logo.locator('.session-unread').count(), working: (await logo.getAttribute('class')).includes('is-working'), label: (await tab(id).getByRole('tab').getAttribute('aria-label')).split(' · ').slice(1).join(' · ') };
  };
  assert.deepEqual(await look('plain'), { mark: null, unread: 0, working: true, label: 'Working' });
  assert.deepEqual(await look('permission'), { mark: '!', unread: 0, working: false, label: 'Waiting for your permission' });
  assert.deepEqual(await look('question'), { mark: '?', unread: 0, working: false, label: 'Waiting for your answer' });
  // A background question leaves the agent working: the glow stays under the mark.
  assert.deepEqual(await look('background'), { mark: '?', unread: 0, working: true, label: 'Working · asks a question' });
  // The mark takes the place of the red unread dot.
  assert.deepEqual(await look('asked'), { mark: '?', unread: 0, working: false, label: 'Waiting for your answer' });
  assert.deepEqual(await look('unread'), { mark: null, unread: 1, working: false, label: 'Finished · unread result' });
  assert.deepEqual(await look('attention'), { mark: '!', unread: 0, working: false, label: 'Needs attention · check terminal' });
  const style = await tab('permission').locator('.session-waiting').evaluate(node => { const computed = getComputedStyle(node), box = node.getBoundingClientRect(); return { background: computed.backgroundColor, color: computed.color, width: box.width, height: box.height, italic: computed.fontStyle }; });
  assert.deepEqual(style, { background: 'rgb(255, 197, 61)', color: 'rgb(34, 26, 0)', width: 12, height: 12, italic: 'normal' });
  if (process.env.MRMAK_TEST_SHOT) await page.locator('.chat-tabs').screenshot({ path: process.env.MRMAK_TEST_SHOT });

  // The marks follow the service: the confirming key and the answer remove them at once.
  service.sessions.input('permission', '\r');
  await tab('permission').locator('.session-waiting').waitFor({ state: 'detached' });
  assert.deepEqual(await look('permission'), { mark: null, unread: 0, working: true, label: 'Working' });
  service.sessions.nativeEvent(service.sessions.get('question'), { kind: 'turn-started', answers: ['call-1'] });
  await tab('question').locator('.session-waiting').waitFor({ state: 'detached' });
  service.sessions.nativeEvent(service.sessions.get('plain'), { kind: 'request', prompt: 'Bash', at: Date.now() });
  await tab('plain').locator('.session-waiting').waitFor();
  assert.equal((await look('plain')).mark, '!');
  // Opening the chat acknowledges its answer, and the question it ended with goes with the unread dot.
  await tab('asked').getByRole('tab').click();
  await tab('asked').locator('.session-waiting').waitFor({ state: 'detached' });
  assert.deepEqual(await look('asked'), { mark: null, unread: 0, working: false, label: 'Ready' });
  // Looking at a chat does not answer an open request.
  await tab('background').getByRole('tab').click();
  await page.waitForTimeout(400);
  assert.equal((await look('background')).mark, '?');
  assert.deepEqual(errors, []);
  console.log('Request marks UI passed: "!" for a permission and an error, "?" for a question, a background question and an answer that ends with one; the marks replace the unread dot and follow the service.');
} finally {
  await browser?.close();
  for (const session of service.sessions.items.values()) session.process = null;
  await service.close();
}
