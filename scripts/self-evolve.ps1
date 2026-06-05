$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

param(
    [ValidateSet("report", "iterate")]
    [string]$Mode = "report"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ReportsDir = Join-Path $Root "automation\reports"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportPath = Join-Path $ReportsDir "$Timestamp-self-evolve.md"
$NpmGlobalBin = Join-Path $env:APPDATA "npm"
$OpenCode = Join-Path $Root "node_modules\.bin\opencode.cmd"
$OpenCodeConfigHome = Join-Path $Root ".opencode-config"

New-Item -ItemType Directory -Force -Path $ReportsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OpenCodeConfigHome "opencode") | Out-Null

$env:Path = "C:\Program Files\nodejs;$NpmGlobalBin;$env:Path"
$env:XDG_CONFIG_HOME = $OpenCodeConfigHome

if (-not (Test-Path -LiteralPath $OpenCode)) {
    $OpenCode = Join-Path $NpmGlobalBin "opencode.cmd"
}

if (-not (Test-Path -LiteralPath $OpenCode)) {
    throw "OpenCode was not found. Install it with npm install -g opencode-ai or run the OpenClaw+OpenCode setup first."
}

if ([string]::IsNullOrWhiteSpace($env:MIMO_TOKEN_PLAN_API_KEY)) {
    throw "MIMO_TOKEN_PLAN_API_KEY is not set."
}

$GitStatus = ""
$GitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($GitCommand) {
    try {
        $GitStatus = (& $GitCommand.Source -C $Root status --short 2>$null) -join "`n"
        if (-not [string]::IsNullOrWhiteSpace($GitStatus)) {
            $Mode = "report"
        }
    } catch {
        $Mode = "report"
    }
} else {
    $Mode = "report"
}

$ProjectOpenCodeConfig = Join-Path $Root "config\opencode.json"
if (Test-Path -LiteralPath $ProjectOpenCodeConfig) {
    Copy-Item -LiteralPath $ProjectOpenCodeConfig -Destination (Join-Path $OpenCodeConfigHome "opencode\opencode.json") -Force
}

$HealthPath = Join-Path $ReportsDir "$Timestamp-health.txt"
try {
    & (Join-Path $PSScriptRoot "check-workstation.ps1") *> $HealthPath
    $HealthStatus = "passed"
} catch {
    $_ | Out-String | Add-Content -LiteralPath $HealthPath
    $HealthStatus = "failed"
}

$BasePrompt = Get-Content -LiteralPath (Join-Path $Root "automation\prompts\opencode-self-evolve.prompt.md") -Raw
$ModeInstruction = if ($Mode -eq "iterate") {
    "Mode: iterate. You may make one small code or documentation change if it is safe, then run relevant validation."
} else {
    "Mode: report. Do not change project source code. Inspect the repository and write a concrete next-iteration plan."
}

$Prompt = @"
$BasePrompt

$ModeInstruction

Recent workstation check status: $HealthStatus
Recent workstation check log: $HealthPath

Git dirty summary:
$GitStatus

Write the final report to:
$ReportPath
"@

& $OpenCode run $Prompt

if (-not (Test-Path -LiteralPath $ReportPath)) {
    @"
# Self-Evolution Report

- Time: $Timestamp
- Mode: $Mode
- Health check: $HealthStatus
- Health log: $HealthPath

OpenCode finished without writing the expected report. Review its terminal output and run again.
"@ | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}

Write-Host "Report: $ReportPath"
