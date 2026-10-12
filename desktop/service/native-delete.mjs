import { execFile } from 'node:child_process';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexBinary } from './agents.mjs';
import { claudeTranscript } from './native-events.mjs';
import { codexHome, codexTranscript } from './codex-history.mjs';
import { processSpawnOptions } from './platform.mjs';

// Deletes the copy of a conversation that its CLI keeps on this computer: the
// transcript, the folders named after the session and its prompts in the CLI's
// shared history. What the provider already received stays on its servers.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function remove(target) {
  if (!await stat(target).catch(() => null)) return 0;
  await rm(target, { recursive: true, force: true });
  return 1;
}

// Only the lines of this conversation leave the history; lines this code
// cannot read stay as they are.
async function dropHistory(file, belongs) {
  const text = await readFile(file, 'utf8').catch(() => null);
  const removed = [], kept = [], lines = [];
  for (const line of text === null ? [] : text.split('\n')) {
    let record = null;
    try { record = JSON.parse(line); } catch { /* Not a history record. */ }
    if (record && belongs(record)) removed.push(record);
    else { lines.push(line); if (record) kept.push(record); }
  }
  if (removed.length) await writeFile(file, lines.join('\n'));
  return { removed, kept };
}

async function deleteClaude(session) {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), id = session.nativeId;
  const transcript = await claudeTranscript(session.cwd, id);
  let files = 0;
  // Each of these is named after this one session ID.
  for (const target of [transcript, transcript.slice(0, -'.jsonl'.length), path.join(root, 'file-history', id), path.join(root, 'session-env', id), path.join(root, 'uploads', id)]) files += await remove(target);
  const { removed, kept } = await dropHistory(path.join(root, 'history.jsonl'), record => record.sessionId === id);
  // A long paste is stored apart from its history line. One that another conversation still uses stays.
  const pastes = records => records.flatMap(record => Object.values(record.pastedContents || {}).map(paste => paste?.contentHash)).filter(hash => /^[a-f0-9]{8,64}$/i.test(hash || ''));
  const shared = new Set(pastes(kept));
  for (const hash of new Set(pastes(removed))) if (!shared.has(hash)) files += await remove(path.join(root, 'paste-cache', `${hash}.txt`));
  return { files, prompts: removed.length };
}

function codexDelete(id) {
  const binary = codexBinary();
  return new Promise((resolve, reject) => execFile(binary.file, [...binary.args, 'delete', '--force', id], { ...processSpawnOptions(), timeout: 30000 }, error => error ? reject(error) : resolve()));
}

async function deleteCodex(session, runCodex) {
  const id = session.nativeId, home = codexHome();
  const transcript = await codexTranscript(id, { home });
  // Codex removes the session from its own stores. A CLI without the command leaves the transcript to this code.
  await runCodex(id).catch(() => {});
  if (transcript) await rm(transcript, { force: true });
  // "codex delete" keeps the prompts in the shared history.
  const { removed } = await dropHistory(path.join(home, 'history.jsonl'), record => record.session_id === id);
  return { files: transcript ? 1 : 0, prompts: removed.length };
}

export async function deleteNativeConversation(session, { runCodex = codexDelete } = {}) {
  if (!['claude', 'codex'].includes(session?.agent)) throw Object.assign(new Error('Only Claude and Codex conversations can be deleted from here.'), { status: 400 });
  // The ID becomes part of file paths, so nothing but a session UUID is accepted.
  if (!uuid.test(session.nativeId || '')) throw Object.assign(new Error('This chat has no CLI conversation that can be deleted from here.'), { status: 400 });
  return { agent: session.agent, ...await (session.agent === 'claude' ? deleteClaude(session) : deleteCodex(session, runCodex)) };
}
