# review-gate.ps1 — 门下省审核关卡
# 用法: powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
# 返回: 0 = PASS, 1 = FAIL

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$reviewLogDir = Join-Path $projectRoot ".runtime-check"
$reviewLogFile = Join-Path $reviewLogDir ("review-gate-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $reviewLogDir | Out-Null
Set-Content -LiteralPath $reviewLogFile -Value "FLAI TavernAI review gate log" -Encoding utf8
Push-Location $projectRoot
try {

$failures = @()

function Write-ReviewLog {
    param (
        [string]$Line
    )

    Add-Content -LiteralPath $reviewLogFile -Value $Line -Encoding utf8
}

function Write-ReviewOutput {
    param (
        [string]$Line,
        [ConsoleColor]$ForegroundColor = [ConsoleColor]::White
    )

    Write-Host $Line -ForegroundColor $ForegroundColor
    Write-ReviewLog $Line
}

function Invoke-CapturedNativeCommand {
    param (
        [string]$File,
        [string]$WorkingDirectory = "",
        [string[]]$Arguments
    )

    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
    }

    $exitCode = 1
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Get-Command $File -ErrorAction Stop | Out-Null
        $output = & $File @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        if ($null -eq $LASTEXITCODE) {
            $exitCode = 0
        } else {
            $exitCode = $LASTEXITCODE
        }
    } finally {
        $ErrorActionPreference = $prevEAP
        if ($WorkingDirectory) {
            Pop-Location
        }
    }

    Write-ReviewLog "[$File $($Arguments -join ' ')] exit=$exitCode"
    foreach ($line in @($output)) {
        Write-ReviewLog $line
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Invoke-LoggedNativeCommand {
    param (
        [string]$File,
        [string]$WorkingDirectory = "",
        [string[]]$Arguments
    )

    $result = Invoke-CapturedNativeCommand -File $File -WorkingDirectory $WorkingDirectory -Arguments $Arguments
    if ($result.Output) {
        foreach ($line in $result.Output) {
            Write-ReviewOutput $line
        }
    }
    return $result.ExitCode
}

Write-ReviewOutput "Log: $reviewLogFile"
Write-ReviewOutput "=== 门下省审核 ===" -ForegroundColor Cyan

# 1. 编码检查
Write-ReviewOutput "`n[1/6] 编码检查..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/check-encoding.mjs")) -ne 0) {
        $failures += "编码检查失败"
    }
} catch {
    $failures += "编码检查脚本执行异常: $_"
}

# 2. 未引用组件诊断（非阻断）
Write-ReviewOutput "`n[2/6] 未引用 Vue 组件诊断..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/find-unreferenced-vue-components.mjs")) -ne 0) {
        Write-ReviewOutput "未引用组件诊断脚本返回非零状态，已作为非阻断提示处理。" -ForegroundColor DarkYellow
    }
} catch {
    Write-ReviewOutput "未引用组件诊断脚本执行异常，已作为非阻断提示处理: $_" -ForegroundColor DarkYellow
}

# 3. Vue 控件可访问性诊断（非阻断）
Write-ReviewOutput "`n[3/6] Vue 控件可访问性诊断..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/find-inaccessible-vue-controls.mjs")) -ne 0) {
        Write-ReviewOutput "Vue 控件可访问性诊断脚本返回非零状态，已作为非阻断提示处理。" -ForegroundColor DarkYellow
    }
} catch {
    Write-ReviewOutput "Vue 控件可访问性诊断脚本执行异常，已作为非阻断提示处理: $_" -ForegroundColor DarkYellow
}

# 4. 后端测试
Write-ReviewOutput "`n[4/6] 后端测试..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "npm" -WorkingDirectory "backend" -Arguments @("test")) -ne 0) {
        $failures += "后端测试失败"
    }
} catch {
    $failures += "后端测试执行异常: $_"
}

# 5. 前端构建
Write-ReviewOutput "`n[5/6] 前端构建..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "npm" -WorkingDirectory "frontend" -Arguments @("run", "build")) -ne 0) {
        $failures += "前端构建失败"
    }
} catch {
    $failures += "前端构建执行异常: $_"
}

# 6. Git 状态检查
Write-ReviewOutput "`n[6/6] Git 状态检查..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "git" -Arguments @("diff", "--check")) -ne 0) {
        $failures += "Git working tree diff whitespace check failed"
    }

    if ((Invoke-LoggedNativeCommand -File "git" -Arguments @("diff", "--cached", "--check")) -ne 0) {
        $failures += "Git staged diff whitespace check failed"
    }

    $gitStatusResult = Invoke-CapturedNativeCommand -File "git" -Arguments @("status", "--short")
    if ($gitStatusResult.ExitCode -ne 0) {
        $failures += "Git status check failed"
    } elseif ($gitStatusResult.Output) {
        Write-ReviewOutput "变更文件:" -ForegroundColor Gray
        foreach ($line in $gitStatusResult.Output) {
            Write-ReviewOutput $line
        }
    }
} catch {
    $failures += "Git status checks failed: $_"
}

# 输出结果
Write-ReviewOutput "`n=== 审核结果 ===" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
    Write-ReviewOutput "PASS ✅" -ForegroundColor Green
    exit 0
} else {
    Write-ReviewOutput "FAIL ❌" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-ReviewOutput "  - $f" -ForegroundColor Red
    }
    exit 1
}
} finally {
    Pop-Location
}
