@echo off
setlocal
set "MRMAK_LAUNCH_ROOT=%~dp0"
if exist "%LOCALAPPDATA%\MrSvin Workspace\mrsvin-workspace.exe" (
  start "" "%LOCALAPPDATA%\MrSvin Workspace\mrsvin-workspace.exe" --repo "%MRMAK_LAUNCH_ROOT%."
  exit /b 0
)
if exist "%MRMAK_LAUNCH_ROOT%src-tauri\target\release\mrsvin-workspace.exe" (
  start "" "%MRMAK_LAUNCH_ROOT%src-tauri\target\release\mrsvin-workspace.exe" --repo "%MRMAK_LAUNCH_ROOT%."
  exit /b 0
)
echo Build MrSvin from source first; this repository contains no prebuilt installer.
echo Or build with: powershell -NoProfile -ExecutionPolicy Bypass -File Setup.ps1 -Mode Desktop
echo See docs\getting-started.md for agent-guided setup.
pause
