import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Sessions } from '../sessions.mjs';
import { nativeActivity } from '../native-events.mjs';
import { answersPrompt, endsWithQuestion, openRequests, requestHookScript, requestsVariable, watchRequests } from '../requests.mjs';
import { childEnvironment } from '../agents.mjs';
import { sleep } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
async function fixture(agent = 'claude') {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'requests-test-'));
  const sessions = await new Sessions(repo, path.join(repo, '.mrmak')).init();
  const item = sessions.make({ id: 'chat-a', name: 'Request Review', agent, open: false, status: 'running', createdAt: new Date().toISOString(), cols: 80, rows: 25 });
  sessions.items.set(item.id, item);
  const record = value => { const event = nativeActivity(value, agent); if (event) sessions.nativeEvent(item, event); };
  return { repo, sessions, item, record };
}
const state = item => [item.activity, item.waitingFor, item.unread];
const assistant = (...content) => ({ type: 'assistant', message: { id: 'msg', stop_reason: 'tool_use', content } });
const toolUse = (id, name) => ({ type: 'tool_use', id, name, input: {} });
const results = (...ids) => ({ type: 'user', message: { content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) } });
const answer = (id, text) => ({ type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const codex = payload => ({ type: 'response_item', payload });
const hook = (file, input) => spawnSync(process.execPath, [requestHookScript], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000, env: { ...process.env, [requestsVariable]: file } });

test('a final answer is a question only when it ends with a question mark', () => {
  for (const text of ['Which one?', 'Какой вариант выбрать?', '**Продолжать?**', 'Сделать так («как раньше»)?', 'Really？ ', 'Run it (`npm test`)?\n']) assert.equal(endsWithQuestion(text), true, text);
  for (const text of ['Done.', 'Why? Because it failed.', 'Which one?\n- first\n- second', '', undefined]) assert.equal(endsWithQuestion(text), false, String(text));
  assert.equal(nativeActivity(answer('m1', 'Продолжать?'), 'claude').question, true);
  assert.equal(nativeActivity(answer('m2', 'Готово.'), 'claude').question, false);
  assert.equal(nativeActivity({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't', last_agent_message: 'Ship it?' } }, 'codex').question, true);
  assert.equal(nativeActivity({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't' } }, 'codex').question, false);
});

test('a Claude question holds the turn until a tool result arrives; keys only move inside the dialog', async () => {
  const { sessions, item, record } = await fixture();
  item.process = { write() {}, resize() {}, kill() {} };
  const prompt = tool => sessions.nativeEvent(item, { kind: 'request', prompt: tool, at: Date.now() + 5 });
  try {
    record({ type: 'user', message: { content: 'Plan the change.' } });
    assert.deepEqual(state(item), ['working', null, false]);
    // Claude Code writes the tool call only after the answer, so the hook is the signal.
    assert.deepEqual(nativeActivity(assistant(toolUse('ask-1', 'AskUserQuestion')), 'claude'), { kind: 'turn-started' });
    prompt('AskUserQuestion');
    assert.deepEqual(state(item), ['waiting', 'question', false]);
    assert.equal(item.attention, true);
    // A dialog with several questions takes several Enter presses.
    for (const data of ['\x1b[B', '\r', '2']) sessions.input(item.id, data);
    assert.deepEqual(state(item), ['waiting', 'question', false]);
    record(assistant(toolUse('ask-1', 'AskUserQuestion')));
    assert.deepEqual(state(item), ['waiting', 'question', false]);
    record(results('ask-1'));
    assert.deepEqual(state(item), ['working', null, false]);
    prompt('ExitPlanMode');
    assert.deepEqual(state(item), ['waiting', 'permission', false]);
    record({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
    assert.deepEqual(state(item), ['idle', null, false]);
    // A subagent's records are not this chat's turn.
    record({ ...results('side'), isSidechain: true });
    assert.deepEqual(state(item), ['idle', null, false]);
  } finally { item.process = null; await sessions.close(); }
});

test('a permission prompt is closed by the confirming key, a tool result or the end of the turn', async () => {
  const { sessions, item, record } = await fixture();
  const written = [];
  item.process = { write: data => written.push(data), resize() {}, kill() {} };
  const prompt = (tool, at = Date.now() + 5) => sessions.nativeEvent(item, { kind: 'request', prompt: tool, at });
  try {
    record({ type: 'user', message: { content: 'Build it.' } });
    prompt('Bash');
    assert.deepEqual(state(item), ['waiting', 'permission', false]);
    assert.equal(item.attention, true);
    // Arrow keys and terminal replies move nothing; Enter answers the prompt.
    for (const data of ['\x1b[B', '\x1b[12;40R', '\t']) sessions.input(item.id, data);
    assert.deepEqual(state(item), ['waiting', 'permission', false]);
    sessions.input(item.id, '\r');
    assert.deepEqual(state(item), ['working', null, false]);
    assert.deepEqual(written, ['\x1b[B', '\x1b[12;40R', '\t', '\r']);
    // The hook line of a prompt answered a moment ago is read late and changes nothing.
    prompt('Bash', Date.now() - 200);
    assert.deepEqual(state(item), ['working', null, false]);
    prompt('Write');
    assert.equal(item.waitingFor, 'permission');
    // The coordinator never answers prompts, so its text closes nothing.
    item.lastInputAt = null;
    sessions.input(item.id, '1', { coordinator: true });
    assert.equal(item.waitingFor, 'permission');
    record(results('bash-1'));
    assert.deepEqual(state(item), ['working', null, false]);
    prompt('mcp__mixar__execute_bpy_script');
    assert.deepEqual(state(item), ['waiting', 'permission', false]);
    record(answer('m1', 'Done.'));
    assert.deepEqual(state(item), ['idle', null, true]);
    for (const key of ['\r', '\x1b', '\x1b[Z', '\x03', '1', '3']) assert.equal(answersPrompt(key), true);
    for (const key of ['\x1b[A', 'y', '12', 'text\r', '0', '']) assert.equal(answersPrompt(key), false);
  } finally { item.process = null; await sessions.close(); }
});

test('Codex questions: the blocking form waits for its output, the background form for a user message', async () => {
  const { sessions, item, record } = await fixture('codex');
  try {
    record({ type: 'event_msg', payload: { type: 'task_started' } });
    record(codex({ type: 'function_call', name: 'exec', call_id: 'c0' }));
    record(codex({ type: 'function_call_output', call_id: 'c0' }));
    assert.deepEqual(state(item), ['working', null, false]);
    record(codex({ type: 'function_call', name: 'request_user_input', call_id: 'c1' }));
    assert.deepEqual(state(item), ['waiting', 'question', false]);
    record(codex({ type: 'function_call_output', call_id: 'c1' }));
    assert.deepEqual(state(item), ['working', null, false]);
    // The background form is accepted at once and the agent keeps working.
    record(codex({ type: 'function_call', name: 'request_user_input_async', call_id: 'c2' }));
    record(codex({ type: 'function_call_output', call_id: 'c2' }));
    assert.deepEqual(state(item), ['working', 'question', false]);
    record(codex({ type: 'message', role: 'user', content: [] }));
    assert.deepEqual(state(item), ['working', null, false]);
    // A background question that outlives the turn stays on the finished chat.
    record(codex({ type: 'function_call', name: 'request_user_input_async', call_id: 'c3' }));
    record({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'Waiting for the choice.' } });
    assert.deepEqual(state(item), ['idle', 'question', true]);
    record({ type: 'event_msg', payload: { type: 'task_started' } });
    assert.deepEqual(state(item), ['working', null, true]);
    // A context message before any turn starts nothing.
    record({ type: 'event_msg', payload: { type: 'turn_aborted' } });
    record(codex({ type: 'message', role: 'user', content: [] }));
    assert.equal(item.activity, 'idle');
  } finally { await sessions.close(); }
});

test('a question at the end of an answer replaces the unread mark and survives a restart until it is seen', async () => {
  const { repo, sessions, item, record } = await fixture();
  let restored;
  try {
    record({ type: 'user', message: { content: 'Review this.' } });
    record(answer('m1', 'Сделать ещё проверку?'));
    assert.deepEqual(state(item), ['idle', 'question', true]);
    await sessions.close();
    restored = await new Sessions(repo, path.join(repo, '.mrmak')).init();
    const saved = restored.get(item.id);
    assert.deepEqual(state(saved), ['idle', 'question', true]);
    restored.seen(saved.id, saved.completionVersion);
    assert.deepEqual(state(saved), ['idle', null, false]);
    // An open request is not cleared by looking at the chat.
    saved.status = 'running';
    restored.nativeEvent(saved, nativeActivity(answer('m2', 'Ready.'), 'claude'));
    restored.nativeEvent(saved, { kind: 'request', prompt: 'AskUserQuestion', at: Date.now() });
    restored.seen(saved.id, saved.completionVersion);
    assert.deepEqual(state(saved), ['waiting', 'question', false]);
    // A new prompt ends the question of the previous answer.
    restored.nativeEvent(saved, nativeActivity(results('ask-2'), 'claude'));
    restored.nativeEvent(saved, nativeActivity(answer('m3', 'Which file?'), 'claude'));
    restored.nativeEvent(saved, nativeActivity({ type: 'user', message: { content: 'The first one.' } }, 'claude'));
    assert.deepEqual(state(saved), ['working', null, true]);
  } finally { await restored?.close(); await sessions.close(); }
});

test('the hook records only the tool name, and only for a chat that asked for it', async () => {
  const folder = await temp('claude-requests-');
  const env = {};
  const file = openRequests(folder, 'chat-a', env);
  assert.equal(env[requestsVariable], file);
  assert.equal(await readFile(file, 'utf8'), '');
  const seen = [], before = Date.now();
  const stop = watchRequests(file, (tool, at) => seen.push({ tool, recent: at >= before && at <= Date.now() }));
  const lines = async () => (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  try {
    const result = hook(file, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'echo SECRET-TOKEN' } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.deepEqual((await lines()).map(line => Object.keys(line)), [['tool', 'at']]);
    assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false);
    for (const input of [{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'not json']) assert.equal(hook(file, input).status, 0);
    hook(file, { hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' });
    for (let attempt = 0; attempt < 60 && seen.length < 2; attempt++) await sleep(50);
    assert.deepEqual(seen, [{ tool: 'Bash', recent: true }, { tool: 'AskUserQuestion', recent: true }]);
    // Without the variable nothing is written anywhere.
    const outside = spawnSync(process.execPath, [requestHookScript], { input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }), encoding: 'utf8', timeout: 10000, env: { ...process.env, [requestsVariable]: '' }, cwd: folder });
    assert.equal(outside.status, 0);
    assert.deepEqual((await lines()).map(line => line.tool), ['Bash', 'AskUserQuestion']);
  } finally { stop(); }
  for (let attempt = 0; attempt < 40 && await stat(file).catch(() => null); attempt++) await sleep(25);
  await assert.rejects(stat(file));
  // A chat started by this service never inherits another chat's file.
  process.env[requestsVariable] = file;
  try { assert.equal(childEnvironment()[requestsVariable], undefined); } finally { delete process.env[requestsVariable]; }
});
