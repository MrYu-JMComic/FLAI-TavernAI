$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$GitCandidates = @(
    "git",
    "$env:USERPROFILE\AppData\Local\Programs\Git\cmd\git.exe",
    "$env:ProgramFiles\Git\cmd\git.exe"
)
$Npm = "C:\Program Files\nodejs\npm.cmd"

function Resolve-CommandPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }

        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

$Git = Resolve-CommandPath $GitCandidates

Write-Host "FLAI TavernAI workstation check"
Write-Host "Root: $Root"

if ($Git) {
    Write-Host "Git: $Git"
    try {
        & $Git -C $Root status --short
    } catch {
        Write-Host "Git status unavailable: $($_.Exception.Message)"
    }
} else {
    Write-Host "Git: not found"
}

if (Test-Path -LiteralPath $Npm) {
    Write-Host "npm: $Npm"
} else {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        throw "npm was not found. Install Node.js 24+ or add npm to PATH."
    }
    $Npm = $npmCommand.Source
    Write-Host "npm: $Npm"
}

Write-Host "Backend tests"
& $Npm --prefix (Join-Path $Root "backend") test

Write-Host "Frontend build"
& $Npm --prefix (Join-Path $Root "frontend") run build

Write-Host "Workstation check complete"
