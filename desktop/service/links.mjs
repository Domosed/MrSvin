import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMacOS, isWindows, resolveCommand, startThroughExplorer } from './platform.mjs';

// Ctrl+click opens a web link in a second browser: MRMAK_ALT_BROWSER from .env,
// or Floorp when it is installed. A plain click stays with the system default.
export function webLink(text) {
  let url = null;
  try { url = new URL(text); } catch { /* Rejected below. */ }
  if (typeof text !== 'string' || !url || !['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Object.assign(new Error('Only HTTP and HTTPS links can be opened.'), { status: 400 });
  return url.href;
}

export function alternateBrowser(configured = '', env = process.env) {
  const name = String(configured || '').trim();
  if (name) return resolveCommand(name, env);
  const roots = isWindows ? [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean) : isMacOS ? ['/Applications'] : [];
  const installed = roots.flatMap(root => isWindows ? [path.join(root, 'Ablaze Floorp', 'floorp.exe'), path.join(root, 'Floorp', 'floorp.exe')] : [path.join(root, 'Floorp.app', 'Contents', 'MacOS', 'floorp')]);
  return installed.find(existsSync) || resolveCommand('floorp', env);
}

// Explorer receives the arguments as one command line. A serialized URL holds
// no quotes, and a trailing backslash must not escape the closing one.
export const windowsArgument = value => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&')}"`;

export async function openInAlternateBrowser(text, configured) {
  const url = webLink(text), browser = alternateBrowser(configured);
  if (!browser) throw Object.assign(new Error(String(configured || '').trim() ? 'The browser set in MRMAK_ALT_BROWSER was not found.' : 'Floorp was not found. Set MRMAK_ALT_BROWSER in .env to choose a browser.'), { status: 404 });
  // A browser started by the service itself would close together with the app.
  if (isWindows) await startThroughExplorer(browser, windowsArgument(url));
  else await new Promise((resolve, reject) => {
    const child = spawn(browser, [url], { detached: true, stdio: 'ignore' });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { opened: true, browser: path.basename(browser) };
}
