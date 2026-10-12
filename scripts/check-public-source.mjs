// Check publishable source only. Generated files and runtime state remain local.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const packageInfo = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
const provenance = JSON.parse(await read('SOURCE.json'));
assert.equal(packageInfo.name, 'mrsvin-workspace');
assert.equal(lock.name, packageInfo.name);
assert.equal(lock.packages[''].name, packageInfo.name);
assert.equal(config.identifier, 'com.mrsvin.workspace');
assert.equal(config.productName, 'MrSvin Workspace');
assert.equal(config.version, packageInfo.version);
assert.equal(provenance.sourceVersion, packageInfo.version);
assert.equal(provenance.privateWorkspaceImported, false);
assert.equal(provenance.privateRuntimeImported, false);
assert.match(await read('src-tauri/Cargo.toml'), /name = "mrsvin-workspace"/);
assert.match(await read('src-tauri/Cargo.lock'), /name = "mrsvin-workspace"/);
assert.match(await read('desktop/service/platform.mjs'), /com\.mrsvin\.workspace\.windows\.chats/);
assert.match(await read('Start MrSvin.cmd'), /MrSvin Workspace\\mrsvin-workspace\.exe/);
assert.equal(existsSync(path.join(root, 'Start Mr. Mak.cmd')), false);
assert.match(await read('LICENSE'), /Apache License/);
assert.match(await read('LICENSE.upstream-MIT'), /Copyright \(c\) 2026 Mr\. Mak Workspace contributors/);
assert.deepEqual(JSON.parse(await read('.mcp.json')), { mcpServers: {} });
assert.doesNotMatch(await read('.env.example'), /^\w+=(?!\s*$)\S+/m);
const { entities } = JSON.parse(await read('workspace/workspace.json'));
assert.equal(entities.length, 4);
assert.ok(entities.every(entity => entity.sample === true));
assert.deepEqual(entities.map(entity => entity.id).sort(), ['arachne-character', 'creative-mcp', 'make-workspace-yours', 'my-dream-game'].sort());
const publicFolders = new Set(entities.map(entity => entity.folder));
for (const entry of await readdir(path.join(root, 'workspace'), { withFileTypes: true })) {
  if (entry.isDirectory()) assert.ok(entry.name === '_shared' || publicFolders.has(entry.name), `Unexpected Workspace folder: ${entry.name}`);
}

const excluded = new Set(['.git', 'node_modules', 'dist', '.cache', '.mrmak', '.mrsvin', '.work', 'target', 'gen', '__pycache__', 'graft']);
const textTypes = /\.(?:md|mjs|js|ts|tsx|json|toml|rs|ps1|cmd|yml|yaml|html|css|txt)$/i;
let files = 0;
async function scan(relative = '') {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { await scan(name); continue; }
    if (!entry.isFile()) continue;
    assert.ok(!/^(?:\.env|auth\.json|credentials\.json|tokens?\.json|settings\.local\.json)$/i.test(entry.name), `Private file: ${name}`);
    assert.ok(!/\.(?:exe|msi|dmg|AppImage)$/i.test(entry.name), `Compiled application: ${name}`);
    if (textTypes.test(entry.name)) {
      const content = await read(name);
      for (const profile of [process.env.USERPROFILE, process.env.HOME].filter(value => value && value.length > 10)) {
        assert.ok(!content.includes(profile), `Local account path: ${name}`);
      }
      assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, `Private key: ${name}`);
    }
    files++;
  }
}
await scan();
console.log(`Public source passed: ${files} files, four upstream samples, empty connections/key examples, independent MrSvin identity, retained licenses and no imported private workspace/runtime.`);
