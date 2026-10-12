// What an agent chat is waiting for from its user: an answer to a question or a
// permission. Codex records its questions as it asks them. Claude Code writes a
// tool call only after the answer, so its prompts come from the permission hook,
// which also runs for the question tool. Terminal output is never read to guess them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requestHookScript = fileURLToPath(new URL('./claude-request-hook.mjs', import.meta.url));
export const requestsVariable = 'MRMAK_CLAUDE_REQUESTS';

// Tools that ask the user a question. Codex's background form leaves the agent
// working, and a later user message answers it.
const questions = {
  claude: { AskUserQuestion: { waiting: 'question' } },
  codex: { request_user_input: { waiting: 'question' }, request_user_input_async: { waiting: 'question', background: true } },
};
export const questionOf = (agent, tool) => questions[agent]?.[tool] || null;

// A final answer that ends with a question mark, ignoring closing quotes,
// brackets and Markdown emphasis. This one is a guess by punctuation.
export const endsWithQuestion = text => /[?？؟][\s*_`"'»”’)\]]*$/u.test(String(text || ''));

// Enter, a digit, Escape, Shift+Tab or Ctrl+C typed into the chat answers an open permission prompt.
export const answersPrompt = data => /^(?:\r|\x1b|\x1b\[Z|\x03|[1-9])$/.test(data);

// Applies one native event to the chat's open requests and returns what the
// chat still waits for. A Codex question is closed by its own output. Claude's
// prompt carries no ID: any tool result or the end of the turn closes it. An
// approved command writes its result only when it finishes, so the confirming
// key closes a permission as well.
export function trackRequests(session, event) {
  const pending = session.requests ||= new Map();
  const background = [...pending.values()].some(item => item.background);
  if (event.fresh || event.kind === 'turn-completed' || event.kind === 'turn-interrupted') pending.clear();
  for (const id of event.answers || []) if (!pending.get(id)?.background) pending.delete(id);
  if (event.answers || event.key && pending.get('prompt')?.waiting === 'permission') pending.delete('prompt');
  if (event.reply) for (const [id, item] of pending) if (item.background) pending.delete(id);
  for (const { id, ...request } of event.calls || []) pending.set(id, request);
  if (event.prompt) {
    const request = questionOf('claude', event.prompt) || { waiting: 'permission' };
    // A permission the user answered before its hook line was read is already closed.
    if (request.waiting === 'question' || !(session.promptKeyAt >= event.at)) pending.set('prompt', request);
  }
  const open = [...pending.values()], blocking = open.filter(item => !item.background);
  // An answer that ends the turn with a question, or with a background question still open, keeps the mark.
  const asked = event.kind === 'turn-completed' && (event.question || background);
  return { blocked: blocking.length > 0, waitingFor: (blocking.at(-1) || open.at(-1))?.waiting || (asked ? 'question' : null) };
}

// A stopped chat keeps only the question its last answer ended with.
export function dropRequests(session) {
  if (session.requests?.size) session.waitingFor = null;
  session.requests = null;
}

const slashes = value => value.replaceAll('\\', '/');
// Git Bash and PowerShell both run this form, like the status line command.
export const requestHookCommand = (script = requestHookScript) => script.includes("'") ? null : `node '${slashes(script)}'`;
export const requestHooks = command => ({ PermissionRequest: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] });

// Points the permission hook of one Claude chat at an empty file of its own, so
// a prompt from an earlier launch is never replayed.
export function openRequests(stateDir, chatId, env) {
  const file = path.join(stateDir, 'claude-requests', `${chatId}.jsonl`);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
    env[requestsVariable] = file;
    return file;
  } catch { return null; }
}

export function watchRequests(file, onPrompt) {
  let offset = 0, partial = '', closed = false, reading = false;
  const tick = async () => {
    if (closed || reading) return;
    reading = true;
    try {
      const { size } = await stat(file);
      if (size < offset) { offset = 0; partial = ''; }
      if (size === offset) return;
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        const lines = (partial + buffer.toString('utf8', 0, bytesRead)).split('\n');
        partial = lines.pop() || '';
        for (const line of lines) {
          try { const { tool, at } = JSON.parse(line); if (!closed && typeof tool === 'string') onPrompt(tool, Number(at) || 0); } catch { /* A partial line is ignored. */ }
        }
      } finally { await handle.close(); }
    } catch { /* The hook has not written yet. */ }
    finally { reading = false; }
  };
  const timer = setInterval(tick, 250); timer.unref();
  return () => { closed = true; clearInterval(timer); rm(file, { force: true }).catch(() => {}); };
}
