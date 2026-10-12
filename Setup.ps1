[CmdletBinding()]
param([ValidateSet('Check', 'Preview', 'Desktop')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
Push-Location -LiteralPath $taskRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'workspace/workspace.json'))) {
    throw 'Open Setup.ps1 from the complete repository folder.'
  }
  $taskNode = Get-Command node -ErrorAction SilentlyContinue
  $taskNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $taskCargo = Get-Command cargo -ErrorAction SilentlyContinue
  $taskCodex = Get-Command codex -ErrorAction SilentlyContinue
  $taskClaude = Get-Command claude -ErrorAction SilentlyContinue
  $taskOpenCode = Get-Command opencode -ErrorAction SilentlyContinue
  Write-Host 'MrSvin Workspace setup'
  Write-Host ('Node: ' + [bool]$taskNode + ' | npm: ' + [bool]$taskNpm + ' | Rust (desktop source build only): ' + [bool]$taskCargo)
  Write-Host ('Codex CLI: ' + [bool]$taskCodex + ' | Claude Code CLI: ' + [bool]$taskClaude + ' | OpenCode: ' + [bool]$taskOpenCode)
  if (-not $taskCodex -and -not $taskClaude -and -not $taskOpenCode) {
    throw 'Install and configure Codex CLI, Claude Code CLI or OpenCode before setting up this Workspace. See docs/getting-started.md.'
  }
  if ($Mode -eq 'Check') {
    Write-Host 'This is a source fork. Desktop builds require Rust and the C++ build tools. See docs/getting-started.md.'
    Write-Host 'Source preview: .\Setup.ps1 -Mode Preview'
    Write-Host 'Source desktop build: .\Setup.ps1 -Mode Desktop'
    exit 0
  }
  if (-not $taskNode -or -not $taskNpm) { throw 'Install Node.js 22.20 or newer, then reopen PowerShell.' }
  & node -e "const p=process.versions.node.split('.').map(Number);if(p[0]<22||(p[0]===22&&p[1]<20))process.exit(1)"
  if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.20 or newer is required.' }
  if ($Mode -eq 'Desktop' -and -not $taskCargo) { throw 'Install stable Rust and the Visual Studio C++ build tools. See docs/getting-started.md.' }
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  if ($Mode -eq 'Preview') {
    Write-Host 'Opening the report preview. Full terminal and voice features use the desktop app.'
    & npm.cmd run dev
  } else {
    & npm.cmd run desktop:build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed. Keep the output and ask your setup agent to inspect it.' }
    $taskBundle = Join-Path $taskRoot 'src-tauri/target/release/bundle/nsis'
    Write-Host ('Installer ready in ' + $taskBundle)
    Write-Host 'Run the installer, then double-click Start MrSvin.cmd.'
  }
} finally { Pop-Location }
