import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { alternateBrowser, openInAlternateBrowser, webLink, windowsArgument } from '../links.mjs';

test('only web links reach the alternate browser, with query and fragment intact', () => {
  for (const text of ['https://example.com/page?x=1&y=two#part', 'http://localhost:3000/docs', 'https://higgsfield.ai/plugins/blender?fpr=stefan84']) assert.equal(webLink(text), text);
  for (const text of ['javascript:alert(1)', 'file:///C:/Windows/notepad.exe', 'data:text/html,test', 'mailto:test@example.com', 'ms-settings:defaultapps', '-new-window', '', null, ['https://example.com/']]) {
    assert.throws(() => webLink(text), { status: 400 });
  }
});

test('a link stays one argument on the Windows command line', () => {
  assert.equal(windowsArgument('https://example.com/a b?c=1&d=%20e'), '"https://example.com/a b?c=1&d=%20e"');
  assert.equal(windowsArgument('https://example.com/?folder=C:\\'), '"https://example.com/?folder=C:\\\\"');
  assert.equal(windowsArgument('a\\"b'), '"a\\\\\\"b"');
});

test('a configured browser replaces Floorp, and a missing one is reported before anything starts', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-browser-'));
  const browser = path.join(folder, process.platform === 'win32' ? 'browser.exe' : 'browser');
  const missing = path.join(folder, 'missing.exe');
  await writeFile(browser, '');
  assert.equal(alternateBrowser(` ${browser} `), browser);
  assert.equal(alternateBrowser(missing, { PATH: '' }), null);
  await assert.rejects(openInAlternateBrowser('https://example.com/', missing), { status: 404 });
  await assert.rejects(openInAlternateBrowser('file:///C:/Windows/notepad.exe', browser), { status: 400 });
});
