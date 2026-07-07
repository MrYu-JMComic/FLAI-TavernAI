#Requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',

  [string]$NodeVersion = '',

  [switch]$SkipNpmInstall,

  [switch]$SkipElectronInstall,

  [switch]$NoPackage,

  [switch]$Portable,

  [switch]$SkipReviewGate,

  [switch]$KeepBuildScratch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = Split-Path $PSScriptRoot -Parent
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'
$desktopDir = Join-Path $repoRoot 'packaging\windows'
$stageRoot = Join-Path $repoRoot 'dist\windows-app'
$backendStage = Join-Path $stageRoot 'backend'
$frontendStage = Join-Path $stageRoot 'frontend'
$sharedStage = Join-Path $stageRoot 'shared'
$nodeStage = Join-Path $stageRoot 'node'
$releaseDir = Join-Path $repoRoot 'dist\windows-exe'
$cacheRoot = Join-Path $repoRoot '.runtime-check\windows-packaging'

function Get-NpmCommand {
  $npmCmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($npmCmd) {
    return $npmCmd.Source
  }
  return (Get-Command 'npm' -ErrorAction Stop).Source
}

function Get-PowerShellCommand {
  $powerShellCmd = Get-Command 'powershell.exe' -ErrorAction SilentlyContinue
  if ($powerShellCmd) {
    return $powerShellCmd.Source
  }
  return (Get-Command 'powershell' -ErrorAction Stop).Source
}

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Assert-Node24 {
  $versionText = (& node -p "process.versions.node").Trim()
  $major = [int]($versionText.Split('.')[0])
  if ($major -lt 24) {
    throw "Node 24 or newer is required. Current node reports $versionText."
  }
  Write-Host "Using local Node $versionText for build commands." -ForegroundColor Green
}

function Invoke-PrePackageReviewGate {
  if ($SkipReviewGate) {
    Write-Host 'Skipped pre-package review gate because -SkipReviewGate was supplied.' -ForegroundColor Yellow
    return
  }

  Write-Host 'Running pre-package review gate...' -ForegroundColor Cyan
  $powerShell = Get-PowerShellCommand
  Invoke-CheckedCommand -FilePath $powerShell -Arguments @(
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    (Join-Path $repoRoot 'scripts\review-gate.ps1')
  ) -WorkingDirectory $repoRoot
}

function Reset-Directory {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Assert-ReleaseOutputIsWritable {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $runningProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $exePath = $_.ExecutablePath
      $exePath -and $exePath.StartsWith($resolvedPath, [System.StringComparison]::OrdinalIgnoreCase)
    }

  if ($runningProcesses) {
    $processText = ($runningProcesses | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', '
    throw "Close the existing packaged FLAI TavernAI app before packaging again. Locked output: $resolvedPath. Running: $processText"
  }
}

function Copy-DirectoryContents {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeNames = @()
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($ExcludeNames -contains $_.Name) {
      return
    }
    $target = Join-Path $Destination $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
  }
}

function Resolve-NodeRuntimeVersion {
  param(
    [string]$RequestedVersion,
    [string]$RuntimeArch
  )

  if ($RequestedVersion.Trim()) {
    return $RequestedVersion.Trim().TrimStart('v')
  }

  $fileToken = "win-$RuntimeArch-zip"
  Write-Host "Resolving latest Node 24 runtime with $fileToken from nodejs.org..." -ForegroundColor Cyan
  $releaseIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  foreach ($release in $releaseIndex) {
    if ($release.version -like 'v24.*' -and $release.files -contains $fileToken) {
      return $release.version.TrimStart('v')
    }
  }

  throw "Could not find a Node 24 release with $fileToken in the nodejs.org release index."
}

function Install-NodeRuntime {
  param(
    [string]$RuntimeVersion,
    [string]$RuntimeArch,
    [string]$Destination
  )

  $zipName = "node-v$RuntimeVersion-win-$RuntimeArch.zip"
  $zipUrl = "https://nodejs.org/dist/v$RuntimeVersion/$zipName"
  $nodeCacheDir = Join-Path $cacheRoot 'node'
  $zipPath = Join-Path $nodeCacheDir $zipName
  $extractRoot = Join-Path $nodeCacheDir "node-v$RuntimeVersion-win-$RuntimeArch"
  $extractedDir = Join-Path $extractRoot "node-v$RuntimeVersion-win-$RuntimeArch"

  New-Item -ItemType Directory -Path $nodeCacheDir -Force | Out-Null
  if (-not (Test-Path -LiteralPath $zipPath)) {
    Write-Host "Downloading $zipName..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  }

  if (-not (Test-Path -LiteralPath $extractedDir)) {
    Reset-Directory -Path $extractRoot
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  }

  Reset-Directory -Path $Destination
  Copy-DirectoryContents -Source $extractedDir -Destination $Destination
  Write-Host "Staged Node runtime v$RuntimeVersion ($RuntimeArch)." -ForegroundColor Green
}

function Write-RuntimeMarker {
  param([string]$Destination)

  $gitHead = ''
  try {
    $gitHead = (& git -C $repoRoot rev-parse --short HEAD 2>$null).Trim()
  } catch {
    $gitHead = ''
  }

  $marker = [ordered]@{
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    gitHead = $gitHead
    source = 'scripts/package-windows.ps1'
  } | ConvertTo-Json

  $markerPath = Join-Path $Destination '.flai-runtime-source.json'
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($markerPath, $marker, $utf8NoBom)
}

Assert-Node24
$npm = Get-NpmCommand

if (-not $SkipNpmInstall) {
  Invoke-CheckedCommand -FilePath $npm -Arguments @('ci') -WorkingDirectory $backendDir
  Invoke-CheckedCommand -FilePath $npm -Arguments @('ci') -WorkingDirectory $frontendDir
} else {
  if (-not (Test-Path -LiteralPath (Join-Path $backendDir 'node_modules'))) {
    throw 'backend/node_modules is missing. Re-run without -SkipNpmInstall.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules'))) {
    throw 'frontend/node_modules is missing. Re-run without -SkipNpmInstall.'
  }
}

Invoke-PrePackageReviewGate

Reset-Directory -Path $stageRoot
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Write-Host 'Building frontend assets for desktop packaging...' -ForegroundColor Cyan
$oldApiBase = $env:VITE_API_BASE_URL
try {
  $env:VITE_API_BASE_URL = ''
  Invoke-CheckedCommand -FilePath $npm -Arguments @('run', 'build', '--', '--outDir', $frontendStage, '--emptyOutDir') -WorkingDirectory $frontendDir
} finally {
  if ($null -eq $oldApiBase) {
    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:VITE_API_BASE_URL = $oldApiBase
  }
}

Write-Host 'Staging backend runtime files...' -ForegroundColor Cyan
Reset-Directory -Path $backendStage
Copy-DirectoryContents -Source $backendDir -Destination $backendStage -ExcludeNames @(
  'data',
  'uploads',
  'logs',
  '.env',
  'dev-server.err.log',
  'dev-server.out.log'
)
$backendTestsStage = Join-Path $backendStage 'src\tests'
if (Test-Path -LiteralPath $backendTestsStage) {
  Remove-Item -LiteralPath $backendTestsStage -Recurse -Force
}
Write-RuntimeMarker -Destination $backendStage

Write-Host 'Staging shared runtime files...' -ForegroundColor Cyan
Reset-Directory -Path $sharedStage
Copy-DirectoryContents -Source (Join-Path $repoRoot 'shared') -Destination $sharedStage
Write-RuntimeMarker -Destination $sharedStage

$runtimeVersion = Resolve-NodeRuntimeVersion -RequestedVersion $NodeVersion -RuntimeArch $Arch
Install-NodeRuntime -RuntimeVersion $runtimeVersion -RuntimeArch $Arch -Destination $nodeStage

if ($NoPackage) {
  Write-Host "Staging complete. Skipped EXE packaging because -NoPackage was supplied." -ForegroundColor Yellow
  exit 0
}

if (-not $SkipElectronInstall) {
  Invoke-CheckedCommand -FilePath $npm -Arguments @('install', '--package-lock=false', '--no-audit', '--no-fund') -WorkingDirectory $desktopDir
} elseif (-not (Test-Path -LiteralPath (Join-Path $desktopDir 'node_modules'))) {
  throw 'packaging/windows/node_modules is missing. Re-run without -SkipElectronInstall.'
}

$archArg = "--$Arch"
$distScript = 'dist:setup'
$packageKind = 'installer EXE'
if ($Portable) {
  $distScript = 'dist:portable'
  $packageKind = 'portable EXE'
}

Assert-ReleaseOutputIsWritable -Path $releaseDir
Reset-Directory -Path $releaseDir
Invoke-CheckedCommand -FilePath $npm -Arguments @('run', $distScript, '--', $archArg) -WorkingDirectory $desktopDir

if (-not $KeepBuildScratch) {
  Remove-Item -LiteralPath (Join-Path $releaseDir 'win-unpacked') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir '.icon-ico') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir 'builder-debug.yml') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir 'builder-effective-config.yaml') -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $releaseDir -Filter '*.blockmap' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Windows package artifacts ($packageKind):" -ForegroundColor Green
Get-ChildItem -LiteralPath $releaseDir -Filter '*.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 |
  ForEach-Object { Write-Host "  $($_.FullName)" }
