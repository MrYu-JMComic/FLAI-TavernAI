# review-gate.ps1 — 门下省审核关卡
# 用法: powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
# 返回: 0 = PASS, 1 = FAIL

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {

$failures = @()

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
        $result.Output | Write-Host
    }
    return $result.ExitCode
}

Write-Host "=== 门下省审核 ===" -ForegroundColor Cyan

# 1. 编码检查
Write-Host "`n[1/6] 编码检查..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/check-encoding.mjs")) -ne 0) {
        $failures += "编码检查失败"
    }
} catch {
    $failures += "编码检查脚本执行异常: $_"
}

# 2. 未引用组件诊断（非阻断）
Write-Host "`n[2/6] 未引用 Vue 组件诊断..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/find-unreferenced-vue-components.mjs")) -ne 0) {
        Write-Host "未引用组件诊断脚本返回非零状态，已作为非阻断提示处理。" -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "未引用组件诊断脚本执行异常，已作为非阻断提示处理: $_" -ForegroundColor DarkYellow
}

# 3. Vue 控件可访问性诊断（非阻断）
Write-Host "`n[3/6] Vue 控件可访问性诊断..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "node" -Arguments @("scripts/find-inaccessible-vue-controls.mjs")) -ne 0) {
        Write-Host "Vue 控件可访问性诊断脚本返回非零状态，已作为非阻断提示处理。" -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "Vue 控件可访问性诊断脚本执行异常，已作为非阻断提示处理: $_" -ForegroundColor DarkYellow
}

# 4. 后端测试
Write-Host "`n[4/6] 后端测试..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "npm" -WorkingDirectory "backend" -Arguments @("test")) -ne 0) {
        $failures += "后端测试失败"
    }
} catch {
    $failures += "后端测试执行异常: $_"
}

# 5. 前端构建
Write-Host "`n[5/6] 前端构建..." -ForegroundColor Yellow
try {
    if ((Invoke-LoggedNativeCommand -File "npm" -WorkingDirectory "frontend" -Arguments @("run", "build")) -ne 0) {
        $failures += "前端构建失败"
    }
} catch {
    $failures += "前端构建执行异常: $_"
}

# 6. Git 状态检查
Write-Host "`n[6/6] Git 状态检查..." -ForegroundColor Yellow
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
        Write-Host "变更文件:" -ForegroundColor Gray
        $gitStatusResult.Output | Write-Host
    }
} catch {
    $failures += "Git status checks failed: $_"
}

# 输出结果
Write-Host "`n=== 审核结果 ===" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
    Write-Host "PASS ✅" -ForegroundColor Green
    exit 0
} else {
    Write-Host "FAIL ❌" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  - $f" -ForegroundColor Red
    }
    exit 1
}
} finally {
    Pop-Location
}
