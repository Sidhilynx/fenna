# Run the desktop app on a COPY of a deck with a scripted session (see
# OPENDECK_SCRIPT in apps/desktop/src/main/main.cjs). The copy keeps the
# real deck untouched.
#   scripts/ui-run.ps1 -Steps steps.json [-Deck examples/sample-deck] [-Slide 2] [-Size 1440x900] [-NoBuild]
param(
  [Parameter(Mandatory = $true)][string]$Steps,
  [string]$Deck = "examples/sample-deck",
  [string]$Slide = "",
  [string]$Size = "1440x900",
  [switch]$NoBuild
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if (-not $NoBuild) { npx vite build --config apps/desktop/vite.config.ts --logLevel error }
$copy = Join-Path $env:TEMP "opendeck-ui-run"
if (Test-Path $copy) { Remove-Item -Recurse -Force $copy }
Copy-Item -Recurse $Deck $copy
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:OPENDECK_DECK = $copy
$env:OPENDECK_SCRIPT = (Resolve-Path $Steps).Path
$env:OPENDECK_SHOT_SIZE = $Size
if ($Slide) { $env:OPENDECK_SLIDE = $Slide } else { Remove-Item Env:OPENDECK_SLIDE -ErrorAction SilentlyContinue }
& "$repo\node_modules\electron\dist\electron.exe" "$repo\apps\desktop" 2>&1 | Where-Object { $_ -match "eval:|Error|error" }
Write-Output "deck copy: $copy"
