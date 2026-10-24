// Permission and session hook for Claude chats started by Mr. Mak. Claude Code
// runs it when it is about to ask for a permission or show a question, and when
// a session starts, which /clear does with a new session ID. It notes the
// tool's name or the session ID and the time for the chat and stays silent: no
// decision, no output (SessionStart output would enter the model's context),
// and the tool input is not kept.
import { appendFileSync } from 'node:fs';

setTimeout(() => process.exit(0), 5000).unref();
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const file = process.env.MRMAK_CLAUDE_REQUESTS;
  if (file && input?.hook_event_name === 'PermissionRequest') appendFileSync(file, JSON.stringify({ tool: String(input.tool_name || '').slice(0, 120), at: Date.now() }) + '\n');
  if (file && input?.hook_event_name === 'SessionStart' && /^[a-f0-9-]{36}$/i.test(input.session_id || '')) appendFileSync(file, JSON.stringify({ session: input.session_id, at: Date.now() }) + '\n');
} catch { /* The CLI shows its prompt whatever happens here. */ }
