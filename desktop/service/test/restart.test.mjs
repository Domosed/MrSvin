import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { restartDesktopApp, restartScript } from '../restart.mjs';

// These tests never start the real helper: the service gets a stub, and
// restartDesktopApp is only called with process IDs it must reject.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function fixture(options = {}) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'restart-test-'));
  await mkdir(path.join(repo, 'workspace'), { recursive: true }); await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>UI</html>');
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} }, ...options });
  const restart = () => fetch(service.origin + '/api/restart', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  return { repo, service, restart };
}

test('the helper asks the app to quit and waits for it before starting it again', async () => {
  const script = restartScript(4321);
  assert.match(script, /^\$app = Get-Process -Id 4321 -ErrorAction Stop;/);
  assert.ok(script.indexOf('--quit') < script.indexOf('WaitForExit') && script.indexOf('WaitForExit') < script.indexOf('Start-Process'));
  for (const pid of [0, -5, 1.5, NaN, undefined, '4321; calc']) await assert.rejects(restartDesktopApp(pid), /installed Windows app/);
});

test('a restart saves every open chat before the app is asked to quit', async () => {
  const saved = [];
  const { repo, service, restart } = await fixture({ restartApp: async () => {
    saved.push(JSON.parse(await readFile(path.join(repo, '.mrmak', 'sessions.json'), 'utf8')).map(item => item.name));
    return { restarting: true };
  } });
  try {
    const session = service.sessions.make({ id: 'saved', name: 'Saved chat', agent: 'codex', cwd: repo, status: 'running', open: true, nativeId: '11111111-1111-4111-8111-111111111111', cols: 80, rows: 30 });
    service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
    await new Promise(resolve => session.terminal.write('last line before restart', resolve));
    const response = await restart();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { restarting: true, saved: 1 });
    assert.deepEqual(saved, [['Saved chat']]);
    assert.match(await readFile(path.join(repo, '.mrmak', 'screen-saved.json'), 'utf8'), /last line before restart/);
  } finally { await service.close(); }
});

test('a service started without the desktop app cannot restart anything', async () => {
  const { service, restart } = await fixture();
  try {
    const response = await restart();
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /installed desktop app/);
  } finally { await service.close(); }
});
