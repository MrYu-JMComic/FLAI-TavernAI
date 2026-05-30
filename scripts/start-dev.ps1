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

Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','set PORT=3001 && set CLIENT_ORIGIN=http://127.0.0.1:5173,http://localhost:5173 && npm.cmd run dev' -WorkingDirectory "$repoRoot\backend" -WindowStyle Hidden
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--host','127.0.0.1','--port','5173' -WorkingDirectory "$repoRoot\frontend" -WindowStyle Hidden

Write-Host ''
Write-Host 'Frontend : http://127.0.0.1:5173/#/'
Write-Host 'Backend  : http://127.0.0.1:3001/api/health'
