// Explicit smoke test of /clear against the installed, signed-in Claude Code CLI:
// a chat started the way the desktop app starts it runs /clear and must follow
// the new conversation. No model turn is spent. Both conversations are deleted
// afterwards.
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './server.mjs';
import { claudeTranscript } from './native-events.mjs';
import { deleteNativeConversation } from './native-delete.mjs';
import { sleep } from './util.mjs';

if (!process.argv.includes('--use-cli')) throw new Error('Pass --use-cli to start the signed-in Claude Code once and run /clear (no model turn).');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Start the CLI the way the desktop app does, with the default Claude profile.
for (const key of Object.keys(process.env)) if (/^CLAUDE(_|CODE)/.test(key) || key.startsWith('MRMAK_')) delete process.env[key];
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'clear-smoke-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} } });
const natives = new Set(), result = {};
let chat;

try {
  chat = await service.sessions.create({ agent: 'claude', name: 'Clear check', effort: 'medium', cwd: root });
  const item = () => service.sessions.get(chat.id);
  const screen = async () => (await service.sessions.read(chat.id)).screen;
  const until = async (check, seconds, what) => {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(200)) if (await check()) return;
    throw new Error(`${what}. Screen:\n${(await screen()).split('\n').slice(-20).join('\n')}`);
  };
  await until(async () => /\? for shortcuts|shift\+tab to cycle/.test(await screen()), 90, 'Claude did not reach its prompt');
  await sleep(1500);
  result.before = item().nativeId; natives.add(result.before);
  service.sessions.input(chat.id, '/clear', { coordinator: true, submit: true });
  await until(() => item().nativeId !== result.before, 30, 'The chat kept its conversation after /clear');
  result.after = item().nativeId; natives.add(result.after);
  const transcript = await claudeTranscript(root, result.after);
  await until(() => stat(transcript).then(() => true, () => false), 20, 'The new conversation has no transcript');
  result.transcript = path.basename(transcript);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  console.log(JSON.stringify(result, null, 2));
  await service.close();
  for (const nativeId of natives) await deleteNativeConversation({ agent: 'claude', cwd: root, nativeId }).catch(error => console.error('Conversation not deleted:', error.message));
  await rm(repo, { recursive: true, force: true }).catch(() => {});
  setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
}
