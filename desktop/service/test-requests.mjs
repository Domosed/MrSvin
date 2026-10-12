// Explicit smoke test of the "?" and "!" marks against the installed, signed-in
// Claude Code CLI: one permission prompt in a chat with the default mode and one
// question in a chat that bypasses permissions. It writes a single file inside
// a temporary folder and deletes its own conversations afterwards.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './server.mjs';
import { deleteNativeConversation } from './native-delete.mjs';
import { sleep } from './util.mjs';

if (!process.argv.includes('--use-subscription')) throw new Error('Pass --use-subscription to run two small Claude turns.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Start the CLI the way the desktop app does, not as a child of another Claude session.
for (const key of Object.keys(process.env)) if (/^CLAUDE(_|CODE)/.test(key) && key !== 'CLAUDE_CONFIG_DIR') delete process.env[key];
process.env.ANTHROPIC_MODEL ||= 'sonnet';
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'requests-smoke-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
const target = path.join(repo, 'hello.txt');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} } });
const started = Date.now(), timeline = [], chats = [], result = {};
const mark = item => `${item.activity}/${item.waitingFor || '-'}${item.unread ? '/unread' : ''}`;
service.sessions.on('session', item => { if (timeline.at(-1)?.state !== `${item.name}: ${mark(item)}`) timeline.push({ at: ((Date.now() - started) / 1000).toFixed(1), state: `${item.name}: ${mark(item)}` }); });

async function open(name, bypass) {
  const chat = await service.sessions.create({ agent: 'claude', name, bypass, effort: 'medium', cwd: root });
  chats.push(chat);
  const item = () => service.sessions.get(chat.id);
  const screen = async () => (await service.sessions.read(chat.id)).screen;
  const until = async (check, seconds, what) => {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(200)) if (await check()) return;
    throw new Error(`${what} (state ${mark(item())}). Screen:\n${(await screen()).split('\n').slice(-25).join('\n')}`);
  };
  const say = text => { item().lastInputAt = null; service.sessions.input(chat.id, text, { coordinator: true, submit: true }); };
  await until(async () => /\? for shortcuts|shift\+tab to cycle/.test(await screen()), 90, 'Claude did not reach its prompt');
  await sleep(1500);
  return { chat, item, screen, until, say, key: data => service.sessions.input(chat.id, data) };
}

try {
  const asking = await open('Permission check', false);
  result.settings = Object.keys(JSON.parse(await readFile(path.join(repo, '.mrmak', 'claude-statusline-settings.json'), 'utf8')));
  // Auto mode and accept-edits would approve the write without a prompt: cycle to the default mode.
  const mode = async () => /(auto mode|accept edits|plan mode|bypass permissions) on/.exec(await asking.screen())?.[1] || 'default';
  for (let press = 0; press < 6 && await mode() !== 'default'; press++) { asking.key('\x1b[Z'); await sleep(700); }
  if (await mode() !== 'default') throw new Error('The chat did not reach the default permission mode');
  asking.say(`This is a check of the permission prompt. Use the Write tool once to create the file ${target} with the single word hi. Do not use any other tool. Then reply with exactly MRMAK_WRITE_OK.`);
  await asking.until(() => asking.item().waitingFor === 'permission', 150, 'No permission mark appeared');
  result.permission = mark(asking.item());
  // The same key the owner would press: Enter accepts the highlighted "Yes".
  asking.key('\r');
  result.afterKey = mark(asking.item());
  await asking.until(() => asking.item().unread && asking.item().activity === 'idle', 150, 'The turn did not complete after the permission');
  result.fileWritten = (await readFile(target, 'utf8').catch(() => '')).trim();
  result.afterWrite = mark(asking.item());

  const question = await open('Question check', true);
  question.say('This is a check of the question dialog. Call the AskUserQuestion tool once with one question, "Which color?", and two options, Red and Blue. After the answer reply with exactly MRMAK_ASK_OK.');
  await question.until(() => question.item().waitingFor === 'question', 150, 'No question mark appeared');
  result.question = mark(question.item());
  result.dialogVisible = (await question.screen()).includes('Which color?');
  question.key('\r');
  await question.until(() => question.item().waitingFor !== 'question', 30, 'The question mark stayed after the answer');
  result.afterAnswer = mark(question.item());
  await question.until(() => question.item().unread && question.item().activity === 'idle', 150, 'The turn did not complete after the answer');
  result.end = mark(question.item());
  if (result.permission !== 'waiting/permission' || result.afterKey !== 'working/-' || result.fileWritten !== 'hi' || result.question !== 'waiting/question') process.exitCode = 1;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  console.log(JSON.stringify({ ...result, timeline: timeline.map(step => `${step.at}s ${step.state}`) }, null, 2));
  const natives = chats.map(chat => service.sessions.get(chat.id).nativeId).filter(Boolean);
  await service.close();
  for (const nativeId of natives) await deleteNativeConversation({ agent: 'claude', cwd: root, nativeId }).catch(error => console.error('Conversation not deleted:', error.message));
  await rm(repo, { recursive: true, force: true }).catch(() => {});
  // After one successful run on Windows Node stayed alive with no child process left. The checks are done; do not wait.
  setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
}
