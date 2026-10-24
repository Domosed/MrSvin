import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codexHome } from './codex-history.mjs';

// Agents New chat starts with a chosen model. No model keeps the CLI's own setting.
export const modelAgents = ['codex', 'claude', 'claude2'];
export const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(value);

// Claude Code aliases always resolve to the latest model of each family.
const claudeModels = [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([id, label]) => ({ id, label }));

// Codex records the models it offers in /model; hidden entries are internal.
export function codexModels(home = codexHome()) {
  try {
    const cache = JSON.parse(readFileSync(path.join(home, 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter(item => item.visibility === 'list' && validModel(item.slug)).map(item => ({ id: item.slug, label: item.display_name || item.slug }));
  } catch { return []; }
}

export function agentModels(agent) {
  if (agent === 'codex') return codexModels();
  return agent === 'claude' || agent === 'claude2' ? claudeModels : [];
}
