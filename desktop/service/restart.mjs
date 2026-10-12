import { isWindows, startThroughExplorer } from './platform.mjs';

// Asks the running app to quit as its tray menu does, waits until it is gone,
// then starts it again. The app restores every open chat on start.
export const restartScript = pid => `$app = Get-Process -Id ${pid} -ErrorAction Stop; $exe = $app.Path; & $exe --quit; if ($app.WaitForExit(60000)) { Start-Sleep -Milliseconds 700; Start-Process -FilePath $exe }`;

export async function restartDesktopApp(pid = Number(process.env.MRMAK_PARENT_PID)) {
  if (!isWindows || !Number.isInteger(pid) || pid <= 0) throw new Error('Restart from Chats works in the installed Windows app. Quit from the tray menu and start the app again.');
  // The helper must outlive the app, so it cannot be a child of this service.
  await startThroughExplorer('powershell.exe', `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(restartScript(pid), 'utf16le').toString('base64')}`, { hidden: true });
  return { restarting: true };
}
