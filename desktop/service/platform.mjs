import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export const platform = process.platform;
export const isWindows = platform === 'win32';
export const isLinux = platform === 'linux';
export const isMacOS = platform === 'darwin';

export function shellLabel() {
  return isWindows ? 'PowerShell' : 'Shell';
}

export function shellCommand(env = process.env) {
  if (isWindows) return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] };
  const shell = env.SHELL || (isMacOS ? '/bin/zsh' : '/bin/sh');
  return { file: shell, args: [] };
}

export function commandSearchRoots(env = process.env, home = os.homedir()) {
  const roots = [];
  if (isWindows && env.APPDATA) roots.push(path.join(env.APPDATA, 'npm'));
  roots.push(path.join(home, '.opencode', 'bin'), path.join(home, '.kimi-code', 'bin'), path.join(home, '.local', 'bin'));
  return roots;
}

export function commandExtensions() {
  return isWindows ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
}

export function resolveCommand(name, env = process.env, home = os.homedir()) {
  if (path.isAbsolute(name) && existsSync(name)) return name;
  for (const folder of [...String(env.PATH || env.Path || '').split(path.delimiter), ...commandSearchRoots(env, home)]) {
    for (const ext of commandExtensions()) {
      const candidate = path.join(folder, name.toLowerCase().endsWith(ext) && ext ? name : name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function ptyOptions({ cwd, env, cols, rows }) {
  const options = { name: 'xterm-256color', cwd, env, cols, rows };
  if (isWindows) return { ...options, useConpty: true, useConptyDll: true };
  return options;
}

export function processSpawnOptions() {
  return isWindows ? { windowsHide: true } : {};
}

export function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function invalidFilename(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\x00-\x1f]/.test(name)) return true;
  if (name === '.' || name === '..' || /[/\\]/.test(name)) return true;
  if (!isWindows) return false;
  return /[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

export async function terminateProcessTree(pid, { force = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (isWindows) {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], processSpawnOptions(), () => resolve()));
    return;
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* already stopped */ } }
}

export function revealCommand(file) {
  if (isWindows) return { file: 'explorer.exe', args: [file] };
  if (isMacOS) return { file: 'open', args: [file] };
  return { file: 'xdg-open', args: [file] };
}

export function browserCommand(url) {
  if (isWindows) return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (isMacOS) return { file: 'open', args: [url] };
  return { file: 'xdg-open', args: [url] };
}

export function notificationCommand(title, text) {
  if (isMacOS) return { file: 'osascript', args: ['-e', `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`] };
  if (!isWindows) return { file: 'notify-send', args: ['--app-name=MrSvin Workspace', title, text] };
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const toast = `<toast><visual><binding template="ToastGeneric"><text>${escape(title)}</text><text>${escape(text)}</text></binding></visual></toast>`;
  // The Start menu shortcut registers this identity, so the toast carries the app's name and icon.
  const script = `$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]; $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]; $xml = [Windows.Data.Xml.Dom.XmlDocument]::new(); $xml.LoadXml('${toast.replaceAll("'", "''")}'); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('com.mrsvin.workspace.windows.chats').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;
  return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

// The service lives in the app's process job, which ends every child when the
// app quits. Explorer starts a program outside that job, so it keeps running.
const explorerLaunch = Buffer.from(`$ErrorActionPreference = 'Stop'; $desktop = [Activator]::CreateInstance([Type]::GetTypeFromCLSID('9BA05972-F6A8-11CF-A442-00A0C90A8F39')).FindWindowSW(0, $null, 8, [ref]0, 1); $desktop.Document.Application.ShellExecute($env:MRMAK_SHELL_FILE, $env:MRMAK_SHELL_ARGUMENTS, '', 'open', [int]$env:MRMAK_SHELL_SHOW)`, 'utf16le').toString('base64');

export function startThroughExplorer(file, argumentLine, { hidden = false } = {}) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', explorerLaunch], { ...processSpawnOptions(), timeout: 10000, env: { ...process.env, MRMAK_SHELL_FILE: file, MRMAK_SHELL_ARGUMENTS: argumentLine, MRMAK_SHELL_SHOW: hidden ? '0' : '1' } }, error => error ? reject(new Error('Windows could not start the program.')) : resolve()));
}
