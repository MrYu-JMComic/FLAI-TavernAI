$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$killPids = [System.Collections.Generic.HashSet[int]]::new()

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $cl = $_.CommandLine
    ($cl -match 'D:\\Cat\\FLAI-TavernAI') -and
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

$localIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -ne '127.0.0.1' -and
    $_.IPAddress -notlike '169.254*' -and
    $_.IPAddress -notlike '198.18.*'
  } |
  Select-Object -ExpandProperty IPAddress

$clientOrigins = @('http://127.0.0.1:5173', 'http://localhost:5173')
foreach ($ip in $localIps) {
  $clientOrigins += "http://${ip}:5173"
}
$clientOriginValue = $clientOrigins -join ','

Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title FLAI Backend :3001 && set PORT=3001 && set CLIENT_ORIGIN=$clientOriginValue && npm.cmd run dev" -WorkingDirectory "$repoRoot\backend"

$backendReady = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 1
    if ($health.ok) {
      $backendReady = $true
      break
    }
  } catch {
    # Keep waiting; the backend window is visible if startup fails.
  }
}

if (-not $backendReady) {
  Write-Host 'ERROR: backend did not become ready on http://127.0.0.1:3001/api/health within 20 seconds.' -ForegroundColor Red
  Write-Host 'Check the visible "FLAI Backend :3001" window for the backend error log.' -ForegroundColor Yellow
  exit 1
}

Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title FLAI Frontend :5173 LAN && npm.cmd run dev -- --host 0.0.0.0 --port 5173' -WorkingDirectory "$repoRoot\frontend"

Write-Host ''
Write-Host 'Frontend : http://127.0.0.1:5173/#/'
Write-Host 'Backend  : http://127.0.0.1:3001/api/health'
foreach ($ip in $localIps) {
  Write-Host "LAN      : http://${ip}:5173/#/"
}
