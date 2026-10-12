// Permission hook for Claude chats started by Mr. Mak. Claude Code runs it when
// it is about to ask for a permission or show a question. It notes the tool's
// name and the time for the chat's mark and stays silent: no decision, no
// output, and the tool input is not kept.
import { appendFileSync } from 'node:fs';

setTimeout(() => process.exit(0), 5000).unref();
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const file = process.env.MRMAK_CLAUDE_REQUESTS;
  if (file && input?.hook_event_name === 'PermissionRequest') appendFileSync(file, JSON.stringify({ tool: String(input.tool_name || '').slice(0, 120), at: Date.now() }) + '\n');
} catch { /* The CLI shows its prompt whatever happens here. */ }
