import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentModels, codexModels, validModel } from '../models.mjs';

test('New chat lists Codex models from its cache and Claude aliases', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrsvin-models-'));
  assert.deepEqual(codexModels(home), []);
  await writeFile(path.join(home, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list' },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
    { slug: 'bad model"', display_name: 'Unsafe', visibility: 'list' },
  ] }));
  assert.deepEqual(codexModels(home), [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }]);
  assert.deepEqual(agentModels('claude2').map(item => item.id), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepEqual(agentModels('kimi'), []);
  for (const value of ['opus', 'claude-opus-5-5', 'gpt-5.6-sol', 'claude-sonnet-5-5[1m]']) assert.ok(validModel(value), value);
  for (const value of ['', '-x', 'a b', 'a;b', 'x'.repeat(81), null]) assert.ok(!validModel(value), String(value));
});
