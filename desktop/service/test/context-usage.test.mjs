import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { statusLineScript } from '../claude-usage.mjs';
import { claudeTranscript } from '../native-events.mjs';
import { ContextUsage, emptyClaudeInput, parseContextUsage, tokenCount, transcriptContext } from '../context-usage.mjs';

const temp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
const report = `## Context Usage

**Model:** claude-opus-5-5
**Tokens:** 75.9k / 1m (8%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 9.3k | 0.9% |
| System tools | 23.2k | 2.3% |
| MCP tools | 14.2k | 1.4% |
| MCP tools (deferred) | 40.1k | 4.0% |
| Messages | 22.6k | 2.3% |
| Free space | 890.5k | 89.0% |
| Autocompact buffer | 33k | 3.3% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__docs__read | docs | 164 |
| mcp__docs__create | docs | 254 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| Project | C:/project/CLAUDE.md | 497 |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| plan | Project | ~50 |
`;

test('token figures and the /context report are read like Claude Code writes them', () => {
  assert.deepEqual(['3.9k', '1m', '~50', '466.7k', '1,234', 'n/a'].map(tokenCount), [3900, 1000000, 50, 466700, 1234, null]);
  const parsed = parseContextUsage(report);
  assert.equal(parsed.model, 'claude-opus-5-5');
  assert.deepEqual([parsed.used, parsed.window, parsed.percent], [75900, 1000000, 8]);
  assert.equal(parsed.categories.length, 7);
  assert.deepEqual(parsed.categories[3], { name: 'MCP tools (deferred)', tokens: 40100, percent: 4, deferred: true });
  assert.deepEqual(parsed.lists.map(list => [list.title, list.items.length]), [['MCP Tools', 2], ['Memory Files', 1], ['Skills', 1]]);
  assert.deepEqual(parsed.lists[0].items[1], { name: 'mcp__docs__create', detail: 'docs', tokens: 254 });
  assert.deepEqual(parsed.lists[2].items[0], { name: 'plan', detail: 'Project', tokens: 50 });
  assert.equal(parseContextUsage('Some reply that mentions ## Context Usage'), null);
});

test('transcripts give the newest report and window estimate, and /compact clears the estimate', () => {
  const claude = [
    { type: 'assistant', timestamp: '2026-10-21T10:00:00Z', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 50000, output_tokens: 900 } } },
    { type: 'user', isMeta: true, timestamp: '2026-10-21T10:01:00Z', message: { content: report } },
    { type: 'assistant', isSidechain: true, timestamp: '2026-10-21T10:02:00Z', message: { model: 'claude-opus-5-5', usage: { input_tokens: 999999 } } },
    { type: 'assistant', timestamp: '2026-10-21T10:03:00Z', message: { model: '<synthetic>', usage: { input_tokens: 0 } } },
  ];
  const { breakdown, estimate } = transcriptContext(claude, 'claude2');
  assert.equal(breakdown.at, '2026-10-21T10:01:00Z');
  assert.deepEqual(estimate, { used: 52010, model: 'claude-opus-5-5', at: '2026-10-21T10:00:00Z' });
  const compacted = transcriptContext([...claude, { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-21T10:05:00Z' }], 'claude');
  assert.deepEqual(compacted.estimate, { used: null, compacted: true, at: '2026-10-21T10:05:00Z' });

  const codex = [
    { type: 'event_msg', timestamp: 'a', payload: { type: 'token_count', info: null } },
    { type: 'event_msg', timestamp: 'b', payload: { type: 'token_count', info: { model_context_window: 475000, last_token_usage: { input_tokens: 182314, cached_input_tokens: 178944, output_tokens: 679, total_tokens: 182993 } } } },
  ];
  assert.deepEqual(transcriptContext(codex, 'codex'), { breakdown: null, estimate: { used: 182993, window: 475000, at: 'b' } });
});

test('only an empty Claude input box counts as empty', () => {
  const rule = '─'.repeat(60), box = line => ['⏺ Done.', '', rule, line, rule, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n');
  assert.equal(emptyClaudeInput(box('❯')), true);
  assert.equal(emptyClaudeInput(box('❯\u00a0')), true);
  assert.equal(emptyClaudeInput(box('❯ half-typed message')), false);
  assert.equal(emptyClaudeInput(['⏺ Done.', rule, '❯ first line', '  second line', rule].join('\n')), false);
  assert.equal(emptyClaudeInput('❯'), false);
});

test('the status line records each chat window once per change, beside its usage file', async () => {
  const folder = await temp('claude-context-line-'), file = path.join(folder, 'state', 'claude2-usage.json'), id = randomUUID();
  const run = input => spawnSync(process.execPath, [statusLineScript, file], { input: JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
  const window = { context_window_size: 1000000, used_percentage: 8, current_usage: { input_tokens: 10, cache_creation_input_tokens: 900, cache_read_input_tokens: 75000, output_tokens: 300 } };
  assert.equal(run({ session_id: id, model: { id: 'claude-opus-5-5' }, context_window: window }).status, 0);
  const target = path.join(folder, 'state', 'claude2-context', `${id}.json`), saved = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual({ ...saved, updatedAt: undefined }, { window: 1000000, used: 75910, usedPercentage: 8, model: 'claude-opus-5-5', updatedAt: undefined });
  run({ session_id: id, model: { id: 'claude-opus-5-5' }, context_window: window });
  assert.equal(JSON.parse(await readFile(target, 'utf8')).updatedAt, saved.updatedAt);
  // After /compact Claude Code reports no current usage until the next reply.
  run({ session_id: id, model: { id: 'claude-opus-5-5' }, context_window: { context_window_size: 1000000, used_percentage: null, current_usage: null } });
  assert.deepEqual([JSON.parse(await readFile(target, 'utf8')).used, JSON.parse(await readFile(target, 'utf8')).usedPercentage], [null, null]);
  assert.equal(run({ session_id: '../escape', context_window: window }).status, 0);
  await assert.rejects(stat(path.join(folder, 'state', 'escape.json')));
  const other = path.join(folder, 'other.json');
  assert.equal(spawnSync(process.execPath, [statusLineScript, other], { input: JSON.stringify({ session_id: id, context_window: window }), encoding: 'utf8', timeout: 10000 }).status, 0);
  await assert.rejects(stat(other));
});

test('a chat total prefers the newer of the status line and the transcript, and refresh guards the input', async () => {
  const stateDir = await temp('claude-context-state-'), cwd = await temp('claude-context-cwd-'), nativeId = randomUUID(), folder = path.join(stateDir, 'claude2-context');
  const transcript = await claudeTranscript(cwd, nativeId, path.join(stateDir, 'claude-2'));
  await mkdir(path.dirname(transcript), { recursive: true });
  await writeFile(transcript, [
    { type: 'assistant', timestamp: '2026-10-21T10:00:00Z', message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 49995 } } },
    { type: 'user', isMeta: true, timestamp: '2026-10-21T10:01:00Z', message: { content: report } },
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  const rule = '─'.repeat(40);
  let screen = ['Ready', rule, '❯', rule].join('\n');
  const inputs = [], session = { id: 'chat', agent: 'claude2', cwd, nativeId, process: {}, activity: 'idle' };
  const sessions = { get: () => session, read: async () => ({ screen }), input: (id, data, options) => inputs.push([id, data, options]) };
  const usage = new ContextUsage({ sessions, stateDir, folders: { claude2: folder } });

  // Without a status-line record the window comes from the last /context report.
  let result = await usage.read(session);
  assert.deepEqual(result.total, { used: 50000, window: 1000000, percent: 5, source: 'transcript', at: '2026-10-21T10:00:00Z', compacted: false });
  assert.equal(result.breakdown.categories.length, 7);
  assert.equal(result.refreshable, true);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${nativeId}.json`), JSON.stringify({ window: 1000000, used: 75910, usedPercentage: 8, updatedAt: '2026-10-21T10:02:00Z' }));
  result = await usage.read(session);
  assert.deepEqual(result.total, { used: 75910, window: 1000000, percent: 8, at: '2026-10-21T10:02:00Z', compacted: false, source: 'status-line' });
  assert.deepEqual(await usage.read({ ...session, agent: 'shell' }), { supported: false, total: null, breakdown: null, refreshable: false });

  session.activity = 'working';
  await assert.rejects(usage.refresh('chat'), error => error.status === 409);
  session.activity = 'idle';
  screen = ['Ready', rule, '❯ unsent draft', rule].join('\n');
  await assert.rejects(usage.refresh('chat'), /поле ввода/);
  screen = ['Allow this command?', '❯ 1. Yes', '  2. No'].join('\n');
  await assert.rejects(usage.refresh('chat'), /ответьте/);
  assert.equal(inputs.length, 0);
  screen = ['Ready', rule, '❯', rule].join('\n');
  assert.equal((await usage.refresh('chat')).requested, true);
  assert.deepEqual(inputs, [['chat', '/context', { coordinator: true, submit: true }]]);
  await assert.rejects(usage.refresh.call(new ContextUsage({ sessions: { get: () => ({ ...session, agent: 'codex' }) } }), 'chat'), /Claude Code/);
});
