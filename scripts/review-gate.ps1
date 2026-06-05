# review-gate.ps1 — 门下省审核关卡
# 用法: powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
# 返回: 0 = PASS, 1 = FAIL

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

$failures = @()

Write-Host "=== 门下省审核 ===" -ForegroundColor Cyan

# 1. 编码检查
Write-Host "`n[1/4] 编码检查..." -ForegroundColor Yellow
try {
    node scripts/check-encoding.mjs 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { $failures += "编码检查失败" }
} catch {
    $failures += "编码检查脚本执行异常: $_"
}

# 2. 后端测试
Write-Host "`n[2/4] 后端测试..." -ForegroundColor Yellow
Push-Location backend
try {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $testOutput = npm test 2>&1
    $testOutput | Write-Host
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { $failures += "后端测试失败" }
} catch {
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { $failures += "后端测试执行异常: $_" }
}
Pop-Location

# 3. 前端构建
Write-Host "`n[3/4] 前端构建..." -ForegroundColor Yellow
Push-Location frontend
try {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $buildOutput = npm run build 2>&1
    $buildOutput | Write-Host
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { $failures += "前端构建失败" }
} catch {
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { $failures += "前端构建执行异常: $_" }
}
Pop-Location

# 4. Git 状态检查
Write-Host "`n[4/4] Git 状态检查..." -ForegroundColor Yellow
$gitStatus = git status --short 2>&1
if ($gitStatus) {
    Write-Host "变更文件:" -ForegroundColor Gray
    $gitStatus | Write-Host
}

# 输出结果
Write-Host "`n=== 审核结果 ===" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
    Write-Host "PASS ✅" -ForegroundColor Green
    Pop-Location
    exit 0
} else {
    Write-Host "FAIL ❌" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  - $f" -ForegroundColor Red
    }
    Pop-Location
    exit 1
}
