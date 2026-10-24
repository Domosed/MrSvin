import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('paths an answer mentions are checked and shown in their folder, relative to the chat folder', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await realpath(await mkdtemp(path.join(root, '.cache', 'path-reveal-')));
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
  const project = path.join(repo, 'project'), file = path.join(project, 'models', 'Hero.blend');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'blend');
  const shown = [];
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), native: event => { if (event.type === 'reveal') shown.push(event.path); } });
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const chat = service.sessions.make({ id: 'paths', name: 'Paths', agent: 'codex', cwd: project, open: false, status: 'stopped', createdAt: new Date().toISOString(), cols: 80, rows: 24 });
    service.sessions.items.set(chat.id, chat);
    const { found } = await (await request('/paths/check', { sessionId: 'paths', paths: [file, 'models/Hero.blend', 'models', 'models/missing.blend', 'line\nbreak', 42] })).json();
    assert.deepEqual(found, { [file]: 'file', 'models/Hero.blend': 'file', models: 'folder' });
    // Explorer gets the file to select; a path that is gone opens its nearest existing folder.
    assert.equal((await request('/reveal', { sessionId: 'paths', path: 'models/Hero.blend' })).status, 200);
    assert.equal((await request('/reveal', { sessionId: 'paths', path: 'models/gone/missing.blend' })).status, 200);
    assert.equal((await request('/reveal', { path: 'line\nbreak' })).ok, false);
    assert.deepEqual(shown, [file, path.dirname(file)]);
  } finally { await service.close(); }
});
