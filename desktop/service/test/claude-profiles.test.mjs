import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pty from 'node-pty';
import { claudeConfigDir, claudeEnvironment } from '../claude-profiles.mjs';
import { inventory } from '../agents.mjs';
import { ClaudeUsage } from '../claude-usage.mjs';
import { Sessions } from '../sessions.mjs';
import { claudeTranscript, nativeActivity } from '../native-events.mjs';
import { deleteNativeConversation } from '../native-delete.mjs';
import { ConversationTranscripts } from '../mobile-transcript.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const temp = () => mkdtemp(path.join(os.tmpdir(), 'mrmak-profiles-'));

test('Claude 2 uses the same CLI with separate auth; the original environment and profile stay intact', async () => {
  const stateDir = await temp(), primary = path.join(stateDir, 'original');
  const env = { PATH: 'commands', CLAUDE_CONFIG_DIR: primary, ANTHROPIC_API_KEY: 'fixture', ANTHROPIC_AUTH_TOKEN: 'fixture', CLAUDE_CODE_OAUTH_TOKEN: 'fixture', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_PROJECT_DIR_NAME: 'old-project', MRMAK_MCP_FIXTURE: 'keep' };
  const before = { ...env };
  assert.equal(claudeEnvironment('claude', stateDir, env), env);
  assert.equal(claudeConfigDir('claude', { env }), primary);
  const second = claudeEnvironment('claude2', stateDir, env);
  assert.equal(second.CLAUDE_CONFIG_DIR, path.join(stateDir, 'claude-2'));
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_PROJECT_DIR_NAME']) assert.equal(second[key], undefined);
  assert.equal(second.MRMAK_MCP_FIXTURE, 'keep');
  assert.equal(second.PATH, env.PATH);
  assert.deepEqual(env, before);
  const agents = inventory(), original = agents.find(item => item.id === 'claude'), blue = agents.find(item => item.id === 'claude2');
  assert.equal(blue.command, original.command);
  assert.equal(blue.available, original.available);
  assert.notEqual(blue.color, original.color);
});

test('launch and resume retain the second profile, effort, native ID, hooks and usage file', async t => {
  if (!inventory().find(item => item.id === 'claude')?.available) return t.skip('Claude CLI is not installed');
  const repo = await temp(), stateDir = path.join(repo, 'state');
  const usage = new ClaudeUsage(repo, stateDir, { home: repo, env: {}, agent: 'claude2' });
  const sessions = await new Sessions(repo, stateDir, { claude2Usage: usage }).init();
  const spawn = pty.spawn, launches = [];
  pty.spawn = (file, args, options) => {
    launches.push({ file, args, options });
    // Sessions subscribe to exit more than once (graceful stop, resume) and dispose the extra listeners.
    const exits = new Set();
    return { write() {}, resize() {}, onData() { return { dispose() {} }; }, onExit(callback) { exits.add(callback); return { dispose: () => exits.delete(callback) }; }, kill() { const callbacks = [...exits]; exits.clear(); for (const callback of callbacks) callback({ exitCode: 0 }); } };
  };
  try {
    const chat = await sessions.create({ agent: 'claude2', name: 'Second Account', bypass: false });
    assert.match(chat.nativeId, /^[a-f0-9-]{36}$/);
    assert.equal(chat.effort, 'xhigh');
    assert.equal(launches[0].options.env.CLAUDE_CONFIG_DIR, path.join(stateDir, 'claude-2'));
    assert.ok(launches[0].options.env.MRMAK_CLAUDE_REQUESTS.endsWith(`${chat.id}.jsonl`));
    const settings = JSON.parse(await readFile(usage.settingsFile, 'utf8'));
    assert.ok(settings.hooks.PermissionRequest);
    assert.ok(settings.statusLine.command.includes('claude2-usage.json'));
    const transcript = await claudeTranscript(repo, chat.nativeId, path.join(stateDir, 'claude-2'));
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(transcript, '{}\n');
    sessions.get(chat.id).process.kill();
    await sessions.resume(chat.id);
    // A native claude.exe starts directly; a script shim goes through an encoded PowerShell command.
    const command = launches[1].args.includes('-EncodedCommand') ? Buffer.from(launches[1].args.at(-1), 'base64').toString('utf16le') : launches[1].args.join(' ');
    assert.ok(command.includes('--resume'));
    assert.ok(command.includes(chat.nativeId));
    assert.ok(command.includes('--effort'));
    assert.ok(!command.includes('--dangerously-skip-permissions'));
    assert.equal(launches[1].options.env.CLAUDE_CONFIG_DIR, launches[0].options.env.CLAUDE_CONFIG_DIR);
    assert.equal((await sessions.nativeBoundary(sessions.get(chat.id), chat.nativeId)).file, transcript);
    const persisted = JSON.parse(await readFile(path.join(stateDir, 'sessions.json'), 'utf8'));
    assert.equal(persisted[0].agent, 'claude2');
  } finally { await sessions.close(); pty.spawn = spawn; }
});

test('the second account reads and deletes only its own transcript even when IDs match', async () => {
  const repo = await temp(), stateDir = path.join(repo, 'state'), primary = path.join(repo, 'primary');
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = primary;
  try {
    const firstFile = await claudeTranscript(repo, id);
    const secondFile = await claudeTranscript(repo, id, claudeConfigDir('claude2', { stateDir }));
    const record = text => JSON.stringify({ type: 'assistant', message: { id: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text }] } }) + '\n';
    for (const [file, text] of [[firstFile, 'Original account'], [secondFile, 'Second account']]) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, record(text)); }
    const transcripts = new ConversationTranscripts(stateDir), session = { id: 'blue', agent: 'claude2', cwd: repo, nativeId: id };
    assert.equal((await transcripts.read(session)).messages[0].text, 'Second account');
    assert.equal(nativeActivity(JSON.parse(record('Done.')), 'claude2').kind, 'turn-completed');
    assert.deepEqual(await deleteNativeConversation(session, { stateDir }), { agent: 'claude2', files: 1, prompts: 0 });
    await assert.rejects(stat(secondFile), { code: 'ENOENT' });
    assert.equal(await readFile(firstFile, 'utf8'), record('Original account'));
    assert.equal((await transcripts.read({ ...session, id: 'original', agent: 'claude' })).messages[0].text, 'Original account');
  } finally { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; }
});

test('usage and user status lines stay separate for both accounts', async () => {
  const repo = await temp(), stateDir = path.join(repo, 'state'), home = path.join(repo, 'home');
  const original = new ClaudeUsage(repo, stateDir, { home, env: {} });
  const second = new ClaudeUsage(repo, stateDir, { home, env: {}, agent: 'claude2' });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'original-line' } }));
  assert.equal(original.customStatusLine(), true);
  assert.equal(second.customStatusLine(), false);
  assert.equal(second.prepare(repo, {}), path.join(stateDir, 'claude2-statusline-settings.json'));
  const resetsAt = Date.now() / 1000 + 3600;
  for (const [usage, usedPercentage] of [[original, 12], [second, 73]]) await writeFile(usage.file, JSON.stringify({ fiveHour: { usedPercentage, resetsAt } }));
  assert.equal((await original.read()).fiveHour.usedPercentage, 12);
  assert.equal((await second.read()).fiveHour.usedPercentage, 73);
});
