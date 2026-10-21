import path from 'node:path';
import { stat } from 'node:fs/promises';
import { readJson } from './util.mjs';
import { claudeTranscript } from './native-events.mjs';
import { codexSegments } from './codex-history.mjs';
import { transcriptText } from './mobile-transcript.mjs';
import { claudeConfigDir, isClaude } from './claude-profiles.mjs';
import { terminalPrompt } from './terminal-prompt.mjs';

// How full each chat's context window is. Claude Code reports the live window to
// its status line (claude-statusline.mjs) and writes its /context report into
// the transcript; Codex records token_count events in its session file.
const conflict = message => Object.assign(new Error(message), { status: 409 });

// Token figures in /context tables: "3.9k", "1m", "~50", "466.7k".
export function tokenCount(text) {
  const match = /^~?\s*([\d.,]+)\s*([km])?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  const value = Number(match[1].replaceAll(',', '')) * ({ k: 1e3, m: 1e6 }[match[2]?.toLowerCase()] || 1);
  return Number.isFinite(value) ? Math.round(value) : null;
}

// The Markdown report /context writes into the transcript: a total, the usage by
// category and tables of MCP tools, memory files, skills and agents.
export function parseContextUsage(text) {
  if (typeof text !== 'string' || !text.startsWith('## Context Usage')) return null;
  const sections = [];
  let section = null;
  for (const line of text.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) { section = { title: heading[1], columns: null, rows: [] }; sections.push(section); continue; }
    if (!section || !line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    if (!section.columns) section.columns = cells; else if (section.rows.length < 300) section.rows.push(cells);
  }
  const total = /\*\*Tokens:\*\*\s*([^/\n]+?)\s*\/\s*([^\s(]+)\s*(?:\((\d+(?:\.\d+)?)%\))?/.exec(text);
  const table = sections.find(item => /usage by category/i.test(item.title));
  const categories = (table?.rows || []).filter(([name]) => name).map(([name, tokens, percent]) => ({
    name, tokens: tokenCount(tokens), percent: percent && Number.isFinite(Number.parseFloat(percent)) ? Number.parseFloat(percent) : null, deferred: /\(deferred\)/i.test(name),
  }));
  const lists = sections.filter(item => item !== table && item.columns && item.rows.length).map(item => {
    const tokens = item.columns.findIndex(column => /^tokens$/i.test(column));
    return { title: item.title, items: item.rows.map(cells => ({
      name: cells[0], detail: cells.slice(1, tokens < 0 ? undefined : tokens).filter(Boolean).join(' · ') || null, tokens: tokens < 0 ? null : tokenCount(cells[tokens]),
    })) };
  });
  return {
    model: /\*\*Model:\*\*\s*(.+?)\s*$/m.exec(text)?.[1] || null,
    used: total ? tokenCount(total[1]) : null, window: total ? tokenCount(total[2]) : null, percent: total?.[3] ? Number(total[3]) : null,
    categories, lists,
  };
}

// The newest /context report and the newest window estimate in a transcript.
export function transcriptContext(records, agent) {
  let breakdown = null, estimate = null;
  for (const record of records) {
    if (isClaude(agent) && !record.isSidechain) {
      const content = record.message?.content;
      if (record.type === 'user' && record.isMeta && typeof content === 'string' && content.startsWith('## Context Usage')) {
        const parsed = parseContextUsage(content);
        if (parsed) breakdown = { ...parsed, at: record.timestamp || null };
      }
      // Every reply carries the tokens of the request that produced it.
      const usage = record.type === 'assistant' && !String(record.message?.model || '').startsWith('<') ? record.message?.usage : null;
      if (usage) estimate = { used: ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0), model: record.message.model || null, at: record.timestamp || null };
      if (record.type === 'system' && record.subtype === 'compact_boundary') estimate = { used: null, compacted: true, at: record.timestamp || null };
    }
    const info = agent === 'codex' && record.type === 'event_msg' && record.payload?.type === 'token_count' ? record.payload.info : null;
    if (info?.last_token_usage && Number(info.model_context_window) > 0) estimate = { used: Number(info.last_token_usage.total_tokens) || 0, window: Number(info.model_context_window), at: record.timestamp || null };
  }
  return { breakdown, estimate };
}

// Claude Code's input box sits between the last two horizontal rules; "❯" alone means it is empty.
export function emptyClaudeInput(screen) {
  const lines = String(screen || '').split('\n'), rules = [];
  lines.forEach((line, index) => { if (/^\s*─{20,}\s*$/.test(line)) rules.push(index); });
  if (rules.length < 2) return false;
  const inside = lines.slice(rules.at(-2) + 1, rules.at(-1)).filter(line => line.trim());
  return inside.length === 1 && /^\s*[❯>]\s*$/.test(inside[0]);
}

const percentOf = (used, window) => used != null && window > 0 ? Math.round(used / window * 1000) / 10 : null;
const newer = (a, b) => (Date.parse(a?.at) || 0) >= (Date.parse(b?.at) || 0);

export class ContextUsage {
  constructor({ sessions, stateDir, folders }) {
    Object.assign(this, { sessions, stateDir, folders });
    this.cache = new Map();
  }

  async transcript(session) {
    const files = isClaude(session.agent) ? [await claudeTranscript(session.cwd, session.nativeId, claudeConfigDir(session.agent, this))] : await codexSegments(session.nativeId);
    const info = files.length ? await stat(files.at(-1)).catch(() => null) : null;
    if (!info) return { breakdown: null, estimate: null };
    const key = `${files.join('|')}:${info.size}:${info.mtimeMs}`, cached = this.cache.get(session.id);
    if (cached?.key === key) return cached.value;
    const { text } = await transcriptText(files);
    const value = transcriptContext(text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }), session.agent);
    // Only the newest part of a long transcript is read; keep a report it has pushed out.
    if (!value.breakdown && cached?.first === files[0]) value.breakdown = cached.value.breakdown;
    this.cache.set(session.id, { key, first: files[0], value });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async read(session) {
    if (!isClaude(session.agent) && session.agent !== 'codex') return { supported: false, total: null, breakdown: null, refreshable: false };
    const claude = isClaude(session.agent);
    const refreshable = claude && !!session.process && session.activity === 'idle';
    if (!session.nativeId) return { supported: true, total: null, breakdown: null, refreshable };
    const { breakdown, estimate } = await this.transcript(session).catch(() => ({ breakdown: null, estimate: null }));
    if (!claude) return { supported: true, total: estimate && { used: estimate.used, window: estimate.window, percent: percentOf(estimate.used, estimate.window), source: 'codex', at: estimate.at }, breakdown: null, refreshable: false };
    const folder = this.folders?.[session.agent], recorded = folder ? await readJson(path.join(folder, `${session.nativeId}.json`), null) : null;
    const live = recorded && { used: recorded.used, window: recorded.window, percent: recorded.usedPercentage ?? percentOf(recorded.used, recorded.window), at: recorded.updatedAt, compacted: recorded.used == null };
    const window = live?.window || breakdown?.window || null;
    let total = null;
    if (live && (!estimate || newer(live, estimate))) total = { ...live, source: 'status-line' };
    else if (estimate) total = { used: estimate.used, window, percent: percentOf(estimate.used, window), source: 'transcript', at: estimate.at, compacted: !!estimate.compacted };
    return { supported: true, total, breakdown, refreshable };
  }

  // /context is a local Claude Code command: it costs no tokens and records its report in the transcript.
  async refresh(id) {
    const session = this.sessions.get(id);
    if (!isClaude(session.agent)) throw new Error('Разбивку по категориям показывает только Claude Code.');
    if (!session.process) throw new Error('Чат остановлен. Переподключите его, чтобы обновить контекст.');
    if (session.activity !== 'idle') throw conflict('Дождитесь, пока агент закончит ход.');
    const { screen } = await this.sessions.read(id, 80);
    if (terminalPrompt(screen)) throw conflict('Сначала ответьте на вопрос в чате.');
    if (!emptyClaudeInput(screen)) throw conflict('В поле ввода чата есть текст. Отправьте или очистите его, затем обновите.');
    this.sessions.input(id, '/context', { coordinator: true, submit: true });
    return { requested: true, at: new Date().toISOString() };
  }
}
