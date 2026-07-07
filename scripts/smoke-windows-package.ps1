#Requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',

  [string]$NodeVersion = '',

  [switch]$SkipNpmInstall,

  [switch]$SkipStage,

  [switch]$SkipReviewGate,

  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = Split-Path $PSScriptRoot -Parent
$stageRoot = Join-Path $repoRoot 'dist\windows-app'
$backendStage = Join-Path $stageRoot 'backend'
$frontendStage = Join-Path $stageRoot 'frontend'
$sharedStage = Join-Path $stageRoot 'shared'
$nodeStage = Join-Path $stageRoot 'node'
$smokeRoot = Join-Path $repoRoot '.runtime-check\windows-package-smoke'

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

function Invoke-StagingBuild {
  if ($SkipStage) {
    Write-Host 'Reusing existing dist\windows-app staging directory.' -ForegroundColor Yellow
    return
  }

  $arguments = @(
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    (Join-Path $repoRoot 'scripts\package-windows.ps1'),
    '-NoPackage',
    '-Arch',
    $Arch
  )
  if ($NodeVersion.Trim()) {
    $arguments += @('-NodeVersion', $NodeVersion.Trim())
  }
  if ($SkipNpmInstall) {
    $arguments += '-SkipNpmInstall'
  }
  if ($SkipReviewGate) {
    $arguments += '-SkipReviewGate'
  }

  Invoke-CheckedCommand -FilePath (Get-PowerShellCommand) -Arguments $arguments -WorkingDirectory $repoRoot
}

function Assert-RequiredPath {
  param(
    [string]$Path,
    [string]$Message
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Message Missing: $Path"
  }
}

function Assert-StagedRuntime {
  Assert-RequiredPath -Path (Join-Path $backendStage 'src\server.js') -Message 'Staged backend entry is missing.'
  Assert-RequiredPath -Path (Join-Path $backendStage 'node_modules') -Message 'Staged backend dependencies are missing.'
  Assert-RequiredPath -Path (Join-Path $backendStage '.flai-runtime-source.json') -Message 'Staged backend runtime marker is missing.'
  Assert-RequiredPath -Path (Join-Path $frontendStage 'index.html') -Message 'Staged frontend index is missing.'
  Assert-RequiredPath -Path (Join-Path $sharedStage 'providerCapabilities.js') -Message 'Staged shared provider capability contract is missing.'
  Assert-RequiredPath -Path (Get-StagedNodeExe) -Message 'Staged Node runtime is missing.'
}

function Get-StagedNodeExe {
  $windowsNode = Join-Path $nodeStage 'node.exe'
  if (Test-Path -LiteralPath $windowsNode) {
    return $windowsNode
  }
  return Join-Path $nodeStage 'bin\node'
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
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Recurse -Force
  }
}

function New-SmokeRuntime {
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
  $runRoot = Join-Path $smokeRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
  $runtimeBackend = Join-Path $runRoot 'backend'
  $runtimeShared = Join-Path $runRoot 'shared'

  Copy-DirectoryContents -Source $backendStage -Destination $runtimeBackend -ExcludeNames @(
    'data',
    'uploads',
    'logs',
    '.env',
    'dev-server.err.log',
    'dev-server.out.log'
  )
  Copy-DirectoryContents -Source $sharedStage -Destination $runtimeShared
  New-Item -ItemType Directory -Path (Join-Path $runRoot 'logs') -Force | Out-Null

  return [ordered]@{
    root = $runRoot
    backend = $runtimeBackend
    shared = $runtimeShared
    stdout = Join-Path $runRoot 'logs\backend.out.log'
    stderr = Join-Path $runRoot 'logs\backend.err.log'
    database = Join-Path $runRoot 'flai-smoke.sqlite'
  }
}

function Get-AvailableTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Set-TemporaryEnvironment {
  param(
    [hashtable]$PreviousValues,
    [string]$Name,
    [string]$Value
  )

  $existing = Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  if ($existing) {
    $PreviousValues[$Name] = $existing.Value
  } else {
    $PreviousValues[$Name] = $null
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-Environment {
  param([hashtable]$PreviousValues)

  foreach ($entry in $PreviousValues.GetEnumerator()) {
    if ($null -eq $entry.Value) {
      Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
    }
  }
}

function Start-SmokeBackend {
  param(
    [string]$NodeExe,
    [object]$Runtime,
    [int]$Port
  )

  $previousEnvironment = @{}
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'NODE_ENV' -Value 'desktop-smoke'
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'PORT' -Value ([string]$Port)
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'CLIENT_ORIGIN' -Value "http://127.0.0.1:$Port"
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'ALLOW_PRIVATE_NETWORK_ORIGINS' -Value 'false'
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'FLAI_DESKTOP' -Value '1'
  Set-TemporaryEnvironment -PreviousValues $previousEnvironment -Name 'FLAI_DB_PATH' -Value ([string]$Runtime.database)

  try {
    $entry = Join-Path $Runtime.backend 'src\server.js'
    return Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @($entry) `
      -WorkingDirectory $Runtime.backend `
      -RedirectStandardOutput $Runtime.stdout `
      -RedirectStandardError $Runtime.stderr `
      -WindowStyle Hidden `
      -PassThru
  } finally {
    Restore-Environment -PreviousValues $previousEnvironment
  }
}

function Wait-ForRuntimeHealth {
  param(
    [string]$Uri,
    [System.Diagnostics.Process]$Process,
    [int]$Timeout
  )

  $deadline = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) {
      throw "Packaged backend exited before health check succeeded. ExitCode=$($Process.ExitCode)."
    }

    try {
      $health = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
      if (
        $health.ok -eq $true -and
        $health.runtime.packaged -eq $true -and
        $health.checks.database.ok -eq $true -and
        $health.checks.storage.ok -eq $true -and
        $health.checks.bundle.present -eq $true
      ) {
        return $health
      }
    } catch {
      Start-Sleep -Milliseconds 500
      continue
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Packaged backend did not return a healthy /api/health response within $Timeout seconds."
}

function Stop-SmokeBackend {
  param([System.Diagnostics.Process]$Process)

  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit(5000) | Out-Null
  }
}

Invoke-StagingBuild
Assert-StagedRuntime

$runtime = New-SmokeRuntime
$port = Get-AvailableTcpPort
$healthUri = "http://127.0.0.1:$port/api/health"
$backendProcess = $null

try {
  $backendProcess = Start-SmokeBackend -NodeExe (Get-StagedNodeExe) -Runtime $runtime -Port $port
  $health = Wait-ForRuntimeHealth -Uri $healthUri -Process $backendProcess -Timeout $TimeoutSeconds
  Write-Host "Windows package smoke passed: $($health.service) $($health.version) on port $port." -ForegroundColor Green
  Write-Host "Smoke logs: $($runtime.root)" -ForegroundColor Green
} finally {
  Stop-SmokeBackend -Process $backendProcess
}
