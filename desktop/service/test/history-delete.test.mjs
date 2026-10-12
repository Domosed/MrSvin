import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { deleteNativeConversation } from '../native-delete.mjs';

// Every deleted path lives in a temporary folder: the CLI homes are redirected
// before anything is removed, the service gets a stub, and Codex is never started.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exists = file => stat(file).then(() => true, () => false);
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const id = '11111111-2222-4333-8444-555555555555', other = '99999999-8888-4777-8666-555555555555';
async function withEnv(name, value, run) {
  const saved = process.env[name]; process.env[name] = value;
  try { await run(); } finally { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; }
}
async function fixture(options = {}) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'history-delete-test-'));
  await mkdir(path.join(repo, 'workspace'), { recursive: true }); await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>UI</html>');
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} }, ...options });
  const remove = (chat, data) => fetch(`${service.origin}/api/sessions/${chat}/delete`, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  for (const [chat, agent, nativeId] of [['one', 'claude', id], ['two', 'codex', other]]) {
    const session = service.sessions.make({ id: chat, name: `Chat ${chat}`, agent, cwd: repo, status: 'stopped', open: false, nativeId, cols: 80, rows: 30 });
    service.sessions.items.set(chat, session); await service.sessions.hydrate(session);
    await new Promise(resolve => session.terminal.write('my password is hunter2', resolve));
  }
  await service.sessions.persist();
  return { repo, service, remove, state: file => path.join(repo, '.mrmak', file) };
}

test('deleting a Claude conversation removes its transcript, session folders, prompts and unshared pastes only', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-claude-home-')), cwd = path.join(home, 'Project One');
  const project = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  for (const folder of [path.join(project, id, 'subagents'), path.join(home, 'file-history', id), path.join(home, 'session-env', id), path.join(home, 'file-history', other), path.join(home, 'paste-cache')]) await mkdir(folder, { recursive: true });
  await writeFile(path.join(project, `${id}.jsonl`), '{"text":"my password is hunter2"}\n'); await writeFile(path.join(project, `${other}.jsonl`), '{}\n');
  await writeFile(path.join(project, id, 'subagents', 'agent.jsonl'), '{}\n'); await writeFile(path.join(home, 'file-history', id, 'snapshot'), 'hunter2');
  await writeFile(path.join(home, 'paste-cache', 'aaaaaaaaaaaaaaaa.txt'), 'hunter2'); await writeFile(path.join(home, 'paste-cache', 'bbbbbbbbbbbbbbbb.txt'), 'shared paste');
  const kept = { display: 'unrelated', pastedContents: { 1: { id: 1, type: 'text', contentHash: 'bbbbbbbbbbbbbbbb' } }, sessionId: other };
  await writeFile(path.join(home, 'history.jsonl'), jsonl([
    { display: 'my password is hunter2', pastedContents: { 1: { id: 1, type: 'text', contentHash: 'aaaaaaaaaaaaaaaa' }, 2: { id: 2, type: 'text', contentHash: 'bbbbbbbbbbbbbbbb' } }, sessionId: id },
    kept, { display: 'second prompt', pastedContents: {}, sessionId: id }]));
  await withEnv('CLAUDE_CONFIG_DIR', home, async () => {
    assert.deepEqual(await deleteNativeConversation({ agent: 'claude', cwd, nativeId: id }), { agent: 'claude', files: 5, prompts: 2 });
    for (const gone of [path.join(project, `${id}.jsonl`), path.join(project, id), path.join(home, 'file-history', id), path.join(home, 'session-env', id), path.join(home, 'paste-cache', 'aaaaaaaaaaaaaaaa.txt')]) assert.equal(await exists(gone), false, gone);
    for (const left of [path.join(project, `${other}.jsonl`), path.join(home, 'file-history', other), path.join(home, 'paste-cache', 'bbbbbbbbbbbbbbbb.txt')]) assert.equal(await exists(left), true, left);
    assert.equal(await readFile(path.join(home, 'history.jsonl'), 'utf8'), jsonl([kept]));
    // A second request finds nothing left and changes nothing.
    assert.deepEqual(await deleteNativeConversation({ agent: 'claude', cwd, nativeId: id }), { agent: 'claude', files: 0, prompts: 0 });
  });
});

test('deleting a Codex conversation also clears its prompts, with or without the CLI command', async () => {
  for (const runCodex of [async () => { throw new Error('unrecognized subcommand'); }, async () => {}]) {
    const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-codex-home-')), folder = path.join(home, 'sessions', '2026', '10', '08');
    await mkdir(folder, { recursive: true });
    const rollout = path.join(folder, `rollout-2026-10-08T10-00-00-${id}.jsonl`), kept = { session_id: other, ts: 2, text: 'keep' };
    await writeFile(rollout, jsonl([{ type: 'session_meta', payload: { id, cwd: home, source: 'cli', originator: 'codex_cli_rs' } }]));
    await writeFile(path.join(home, 'history.jsonl'), jsonl([{ session_id: id, ts: 1, text: 'my password is hunter2' }, kept]));
    await withEnv('CODEX_HOME', home, async () => {
      assert.deepEqual(await deleteNativeConversation({ agent: 'codex', cwd: home, nativeId: id }, { runCodex }), { agent: 'codex', files: 1, prompts: 1 });
      assert.equal(await exists(rollout), false);
      assert.equal(await readFile(path.join(home, 'history.jsonl'), 'utf8'), jsonl([kept]));
    });
  }
});

test('an ID that is not a session UUID never reaches the file system', async () => {
  for (const nativeId of ['..\\..\\Documents', '../../etc', `${id}/../..`, 'ses_abc', '', null]) await assert.rejects(deleteNativeConversation({ agent: 'claude', cwd: os.tmpdir(), nativeId }), { status: 400 });
  await assert.rejects(deleteNativeConversation({ agent: 'opencode', cwd: os.tmpdir(), nativeId: id }), { status: 400 });
});

test('History delete removes the entry and its saved screen, and the CLI copy only on request', async () => {
  const calls = [];
  const { repo, service, remove, state } = await fixture({ deleteNative: async target => { calls.push(target); return { agent: target.agent, files: 1, prompts: 0 }; } });
  try {
    assert.match(await readFile(state('screen-one.json'), 'utf8'), /hunter2/);
    let response = await remove('one', { native: true });
    assert.deepEqual(await response.json(), { deleted: true, native: { agent: 'claude', files: 1, prompts: 0 } });
    assert.deepEqual(calls, [{ agent: 'claude', cwd: repo, nativeId: id }]);
    assert.equal(await exists(state('screen-one.json')), false);
    response = await remove('two', {});
    assert.deepEqual(await response.json(), { deleted: true, native: null });
    assert.equal(calls.length, 1);
    assert.equal(await exists(state('screen-two.json')), false);
    assert.deepEqual(JSON.parse(await readFile(state('sessions.json'), 'utf8')), []);
    assert.equal((await remove('one', {})).status, 404);
  } finally { await service.close(); }
});

test('a service started without the desktop app keeps the chat when the CLI copy is requested', async () => {
  const { service, remove, state } = await fixture();
  try {
    const response = await remove('one', { native: true });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /installed desktop app/);
    assert.equal(service.sessions.list().length, 2);
    assert.equal(await exists(state('screen-one.json')), true);
  } finally { await service.close(); }
});
