import path from 'node:path';
import os from 'node:os';

export const isClaude = agent => agent === 'claude' || agent === 'claude2';
export const nativeAgent = agent => isClaude(agent) ? 'claude' : agent;

// Resolve the same profile for launching, observing, resuming and deleting a chat.
// Keep the existing Claude profile exactly where the user configured it.
export function claudeConfigDir(agent = 'claude', { stateDir, env = process.env, home = os.homedir() } = {}) {
  if (agent !== 'claude2') return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  if (!stateDir) throw new Error('Claude 2 requires the workspace state directory.');
  return path.resolve(stateDir, 'claude-2');
}

export function claudeEnvironment(agent, stateDir, env) {
  if (agent !== 'claude2') return env;
  const isolated = { ...env };
  // An inherited token or provider would override the second subscription login.
  for (const key of Object.keys(isolated)) {
    if (/^(ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL|CUSTOM_HEADERS|PROFILE|CONFIG_DIR|FEDERATION_.*|IDENTITY_.*|ORGANIZATION_ID)|CLAUDE_CODE_(?:OAUTH_TOKEN.*|API_KEY_FD|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY|PROVIDER_MANAGED_BY_HOST|PROJECT_DIR_NAME))$/i.test(key)) delete isolated[key];
  }
  isolated.CLAUDE_CONFIG_DIR = claudeConfigDir(agent, { stateDir });
  return isolated;
}
