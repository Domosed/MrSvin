import { open, stat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { claudeConfigDir, nativeAgent } from './claude-profiles.mjs';
import { StringDecoder } from 'node:string_decoder';
import { endsWithQuestion, questionOf } from './requests.mjs';

export function completedTurn(record, agent) {
  agent = nativeAgent(agent);
  if (agent === 'codex' && record.type === 'event_msg' && record.payload?.type === 'task_complete') return { kind: 'turn-completed', id: record.payload.turn_id, text: 'The agent finished its turn. Review the result.', preview: String(record.payload.last_agent_message || '').slice(-350), question: endsWithQuestion(record.payload.last_agent_message) };
  // Claude writes thinking and text as separate records with the same message ID
  // and stop reason. Only the actual final answer creates a completion notice.
  if (agent === 'claude' && !record.isSidechain && record.type === 'assistant' && record.message?.stop_reason === 'end_turn' && record.message.content?.some(item => item.type === 'text')) return { kind: 'turn-completed', id: record.message.id, text: 'The agent finished its turn. Review the result.', preview: record.message.content.filter(item => item.type === 'text').map(item => item.text).join('\n').slice(-350), question: endsWithQuestion(record.message.content.findLast(item => item.type === 'text').text) };
  if (agent === 'claude' && !record.isSidechain && record.type === 'system' && record.subtype === 'api_error') return { kind: 'attention', text: 'The agent reported an API error.' };
  return null;
}

// User records that start no turn: a local command (/clear, /effort, /model …), its
// output, a ! shell command, and the summary written by a compaction, which
// Claude Code also runs on its own while the chat is idle.
const localCommand = /^\s*<(?:command-name|command-message|local-command-(?:stdout|stderr|caveat)|bash-(?:input|stdout|stderr))>/;
const startsNoTurn = record => record.isCompactSummary || record.isVisibleInTranscriptOnly || typeof record.message?.content === 'string' && localCommand.test(record.message.content);

export function nativeActivity(record, agent) {
  agent = nativeAgent(agent);
  const completed = completedTurn(record, agent);
  if (completed) return completed;
  if (agent === 'codex' && record.type === 'event_msg') {
    if (record.payload?.type === 'task_started') return { kind: 'turn-started', fresh: true };
    if (record.payload?.type === 'turn_aborted') return { kind: 'turn-interrupted' };
  }
  if (agent === 'codex' && record.type === 'response_item') {
    const item = record.payload || {}, request = item.type === 'function_call' && questionOf(agent, item.name);
    // A question holds the turn until its output arrives. The background form is
    // accepted at once and answered by a later user message.
    if (request) return { kind: 'turn-started', calls: [{ id: item.call_id, ...request }] };
    if (item.type === 'function_call_output') return { kind: 'request', answers: [item.call_id] };
    if (item.type === 'message' && item.role === 'user') return { kind: 'request', reply: true };
  }
  if (agent === 'claude' && !record.isSidechain) {
    if (record.type === 'user' && !record.isMeta && !startsNoTurn(record)) {
      const content = record.message?.content;
      const interrupted = value => typeof value === 'string' && value.startsWith('[Request interrupted by user');
      if (interrupted(content) || Array.isArray(content) && content.some(item => item.type === 'text' && interrupted(item.text))) return { kind: 'turn-interrupted' };
      // Tool results also confirm ongoing work; file snapshots and metadata do not.
      // A result answers an open prompt, and any other record is a new prompt of the user.
      const results = Array.isArray(content) ? content.filter(item => item.type === 'tool_result') : [];
      if (content) return results.length ? { kind: 'turn-started', answers: results.map(item => item.tool_use_id).filter(Boolean) } : { kind: 'turn-started', fresh: true };
    }
    if (record.type === 'assistant' && record.message?.stop_reason !== 'end_turn') return { kind: 'turn-started' };
  }
  return null;
}

// Only read records appended after this managed session starts. These files belong
// to the native CLI; MR-MAK never modifies them or replaces the user's hooks.
export function tailNativeFile(file, agent, onEvent, from = 0) {
  let offset = from, partial = '', closed = false, reading = false, decoder = new StringDecoder('utf8');
  const tick = async () => {
    if (closed || reading) return;
    reading = true;
    try {
      const info = await stat(file);
      if (info.size < offset) { offset = 0; partial = ''; decoder = new StringDecoder('utf8'); }
      if (info.size === offset) return;
      if (info.size - offset > 4 * 1024 * 1024) { offset = info.size - 4 * 1024 * 1024; partial = ''; decoder = new StringDecoder('utf8'); }
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(info.size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        const lines = (partial + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        partial = lines.pop() || '';
        for (const line of lines) {
          try { const event = nativeActivity(JSON.parse(line), agent); if (event && !closed) onEvent(event); } catch { /* Partial records are ignored, never guessed. */ }
        }
      } finally { await handle.close(); }
    } catch { /* CLI may not have created its transcript yet. */ }
    finally { reading = false; }
  };
  const timer = setInterval(tick, 400); timer.unref(); tick();
  return () => { closed = true; clearInterval(timer); };
}

export async function claudeTranscript(cwd, nativeId, configDir = claudeConfigDir()) {
  const root = path.join(configDir, 'projects');
  const folders = await readdir(root).catch(() => []);
  // Claude names the folder after getcwd(). Chats saved before working folders
  // were stored resolved may hold a symlinked or differently normalised spelling.
  const spellings = [cwd];
  if (process.platform !== 'win32') spellings.push(await realpath(cwd).catch(() => cwd));
  for (const spelling of spellings) {
    const escaped = spelling.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const folder = folders.find(item => item.toLowerCase() === escaped);
    if (folder) return path.join(root, folder, `${nativeId}.jsonl`);
  }
  return path.join(root, spellings.at(-1).replace(/[^a-zA-Z0-9]/g, '-'), `${nativeId}.jsonl`);
}

export { codexTranscript } from './codex-history.mjs';
