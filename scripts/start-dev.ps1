$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$killPids = [System.Collections.Generic.HashSet[int]]::new()
$repoRootPattern = [regex]::Escape($repoRoot)

function Find-AvailablePort {
  param(
    [int]$StartPort,
    [int]$MaxAttempts = 20
  )

  for ($offset = 0; $offset -lt $MaxAttempts; $offset++) {
    $candidate = $StartPort + $offset
    $listener = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $listener) {
      return $candidate
    }
  }

  throw "No available TCP port found in range $StartPort-$($StartPort + $MaxAttempts - 1)."
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $cl = $_.CommandLine
    ($cl -match $repoRootPattern) -and
    ($cl -match 'vite[/\\]bin[/\\]vite\.js' -or $cl -match 'src[/\\]server\.js')
  } |
  ForEach-Object { [void]$killPids.Add($_.ProcessId) }

@(3001, 5173, 5181, 4173) | ForEach-Object {
  $port = $_
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -eq 'node') {
        $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cl -match 'vite[/\\]bin[/\\]vite\.js' -or $cl -match 'src[/\\]server\.js') {
          [void]$killPids.Add($proc.Id)
        }
      }
    }
}

$killPids | ForEach-Object {
  Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped PID $_"
}

if (-not (Test-Path "$repoRoot\backend\node_modules")) {
  Write-Host "ERROR: backend/node_modules is missing. Run 'npm.cmd ci' in the backend directory first." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path "$repoRoot\frontend\node_modules")) {
  Write-Host "ERROR: frontend/node_modules is missing. Run 'npm.cmd ci' in the frontend directory first." -ForegroundColor Red
  exit 1
}

$backendPort = Find-AvailablePort -StartPort 3001
$frontendPort = Find-AvailablePort -StartPort 5173

$localIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -ne '127.0.0.1' -and
    $_.IPAddress -notlike '169.254*' -and
    $_.IPAddress -notlike '198.18.*'
  } |
  Select-Object -ExpandProperty IPAddress

$clientOrigins = @("http://127.0.0.1:$frontendPort", "http://localhost:$frontendPort")
foreach ($ip in $localIps) {
  $clientOrigins += "http://${ip}:$frontendPort"
}
$clientOriginValue = $clientOrigins -join ','

if ($backendPort -ne 3001) {
  Write-Host "Port 3001 is already in use; using backend port $backendPort." -ForegroundColor Yellow
}
if ($frontendPort -ne 5173) {
  Write-Host "Port 5173 is already in use; using frontend port $frontendPort." -ForegroundColor Yellow
}

Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title FLAI Backend :$backendPort && set PORT=$backendPort && set CLIENT_ORIGIN=$clientOriginValue && set ALLOW_PRIVATE_PROVIDER_NETWORK_DEV=true && npm.cmd run dev" -WorkingDirectory "$repoRoot\backend"

$backendReady = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/api/health/ready" -TimeoutSec 1
    if ($health.ok -eq $true) {
      $backendReady = $true
      break
    }
  } catch {
    # Keep waiting; the backend window is visible if startup fails.
  }
}

if (-not $backendReady) {
  Write-Host "WARNING: backend did not become ready on http://127.0.0.1:$backendPort/api/health/ready within 20 seconds." -ForegroundColor Yellow
  Write-Host ('Check the visible "FLAI Backend :' + $backendPort + '" window for the backend error log.') -ForegroundColor Yellow
}

Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title FLAI Frontend :$frontendPort LAN && set VITE_API_PROXY_TARGET=http://127.0.0.1:$backendPort && npm.cmd run dev -- --host 0.0.0.0 --port $frontendPort" -WorkingDirectory "$repoRoot\frontend"

$frontendReady = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $frontendResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$frontendPort/" -TimeoutSec 1
    if ($frontendResponse.StatusCode -ge 200 -and $frontendResponse.StatusCode -lt 500) {
      $frontendReady = $true
      break
    }
  } catch {
    # Keep waiting; the frontend window is visible if startup fails.
  }
}

if (-not $frontendReady) {
  Write-Host "ERROR: frontend did not become ready on http://127.0.0.1:$frontendPort within 10 seconds." -ForegroundColor Red
  Write-Host ('Check the visible "FLAI Frontend :' + $frontendPort + ' LAN" window for the frontend error log.') -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host "Frontend : http://127.0.0.1:$frontendPort/#/"
Write-Host "Backend  : http://127.0.0.1:$backendPort/api/health/ready"
foreach ($ip in $localIps) {
  Write-Host "LAN      : http://${ip}:$frontendPort/#/"
}
