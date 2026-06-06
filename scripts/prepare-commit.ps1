param(
    [switch]$Stage,
    [switch]$IncludeUntracked,
    [switch]$AllAllowed,
    [string[]]$Path = @(),
    [switch]$SkipEncodingCheck
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$GitCommand = Get-Command git -ErrorAction SilentlyContinue

if (-not $GitCommand) {
    throw "git was not found. Install Git or add it to PATH."
}

$Git = $GitCommand.Source

function Normalize-GitPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    $normalized = $Path.Trim()
    if ($normalized.StartsWith('"') -and $normalized.EndsWith('"') -and $normalized.Length -gt 1) {
        $normalized = $normalized.Substring(1, $normalized.Length - 2)
    }

    return ($normalized -replace "\\", "/")
}

function Get-UniquePaths {
    param([object[]]$Paths)

    $seen = [ordered]@{}
    foreach ($rawPath in $Paths) {
        foreach ($path in (([string]$rawPath) -split ",")) {
            $normalized = Normalize-GitPath $path
            if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                $seen[$normalized] = $true
            }
        }
    }

    return @($seen.Keys)
}

function Test-ProtectedPath {
    param([string]$Path)

    $normalized = Normalize-GitPath $Path

    if ($normalized -match '(^|/)\.env($|/)' ) { return $true }
    if (($normalized -match '(^|/)\.env\.') -and ($normalized -notmatch '(^|/)\.env\.example$')) { return $true }

    $protectedPatterns = @(
        '^backend/data($|/)',
        '^backend/uploads($|/)',
        '(^|/)node_modules($|/)',
        '(^|/)dist($|/)',
        '(^|/)coverage($|/)',
        '(^|/)\.vite($|/)',
        '^\.runtime-check($|/)',
        '^\.openclaw($|/)',
        '^automation/prompts/claude-prompt\.',
        '^automation/claude-prompt\.',
        '^claude-prompt\.txt$',
        '^ENVIRONMENT\.md$',
        '^HEARTBEAT\.md$',
        '^IDENTITY\.md$',
        '^SOUL\.md$',
        '^TOOLS\.md$',
        '^USER\.md$',
        '(^|/)logs($|/)',
        '\.log$',
        '\.(sqlite|sqlite3|db)(\.|-|$)',
        '\.(tmp|bak|orig)$'
    )

    foreach ($pattern in $protectedPatterns) {
        if ($normalized -match $pattern) {
            return $true
        }
    }

    return $false
}

function Write-PathList {
    param(
        [string]$Title,
        [string[]]$Paths
    )

    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    if (-not $Paths -or $Paths.Count -eq 0) {
        Write-Host "  (none)" -ForegroundColor DarkGray
        return
    }

    foreach ($path in $Paths) {
        Write-Host "  $path"
    }
}

function Test-PathInList {
    param(
        [string]$Path,
        [string[]]$Paths
    )

    $normalized = Normalize-GitPath $Path
    foreach ($candidate in $Paths) {
        if ((Normalize-GitPath $candidate) -eq $normalized) {
            return $true
        }
    }

    return $false
}

Push-Location $Root
try {
    if (-not $SkipEncodingCheck) {
        Write-Host "Running encoding check..." -ForegroundColor Yellow
        & node (Join-Path $Root "scripts/check-encoding.mjs")
        if ($LASTEXITCODE -ne 0) {
            throw "Encoding check failed."
        }
    }

    $unstagedTracked = Get-UniquePaths @(& $Git -C $Root diff --name-only)
    $stagedTracked = Get-UniquePaths @(& $Git -C $Root diff --cached --name-only)
    $untracked = Get-UniquePaths @(& $Git -C $Root ls-files --others --exclude-standard)
    $allCandidatePaths = Get-UniquePaths @($unstagedTracked + $stagedTracked + $untracked)
    $blockedPaths = @($allCandidatePaths | Where-Object { Test-ProtectedPath $_ })

    Write-Host ""
    Write-Host "Git status, including ignored local files:" -ForegroundColor Cyan
    $status = @(& $Git -C $Root status --short --ignored)
    if ($status.Count -eq 0) {
        Write-Host "  clean" -ForegroundColor Green
    } else {
        foreach ($line in $status) {
            Write-Host "  $line"
        }
    }

    Write-PathList "Tracked changes" $unstagedTracked
    Write-PathList "Already staged changes" $stagedTracked
    Write-PathList "Allowed untracked files" $untracked

    if ($blockedPaths.Count -gt 0) {
        Write-PathList "Blocked paths" $blockedPaths
        Write-Host ""
        Write-Host "Refusing to prepare a commit while protected paths are candidates." -ForegroundColor Red
        exit 1
    }

    if (-not $Stage) {
        Write-Host ""
        Write-Host "Dry run complete. Re-run with -Stage -Path <path> for reviewed paths." -ForegroundColor Green
        Write-Host "Use -AllAllowed only after reviewing every listed candidate." -ForegroundColor Green
        Write-Host "Use -IncludeUntracked only when listed untracked files belong in the commit." -ForegroundColor Green
        exit 0
    }

    $stageTargets = @()
    $requestedPaths = Get-UniquePaths $Path

    if ($requestedPaths.Count -gt 0) {
        foreach ($requestedPath in $requestedPaths) {
            if (Test-ProtectedPath $requestedPath) {
                Write-Host ""
                Write-Host "Refusing to stage protected path: $requestedPath" -ForegroundColor Red
                exit 1
            }

            if (Test-PathInList $requestedPath $unstagedTracked) {
                $stageTargets += $requestedPath
                continue
            }

            if (Test-PathInList $requestedPath $untracked) {
                if (-not $IncludeUntracked) {
                    Write-Host ""
                    Write-Host "Untracked path requires -IncludeUntracked: $requestedPath" -ForegroundColor Red
                    exit 1
                }

                $stageTargets += $requestedPath
                continue
            }

            if (Test-PathInList $requestedPath $stagedTracked) {
                Write-Host "Already staged: $requestedPath" -ForegroundColor DarkGray
                continue
            }

            Write-Host "No unstaged change found for requested path: $requestedPath" -ForegroundColor Yellow
        }
    } elseif ($AllAllowed) {
        $stageTargets = Get-UniquePaths $unstagedTracked
        if ($IncludeUntracked) {
            $stageTargets = Get-UniquePaths @($stageTargets + $untracked)
        }
    } else {
        Write-Host ""
        Write-Host "No paths were staged. Provide -Path <path> or use -AllAllowed after reviewing the dry run." -ForegroundColor Yellow
        exit 1
    }

    if ((-not $IncludeUntracked) -and $untracked.Count -gt 0) {
        Write-Host ""
        Write-Host "Untracked files were left unstaged. Add -IncludeUntracked to include them." -ForegroundColor Yellow
    }

    $stageTargets = Get-UniquePaths $stageTargets
    if ($stageTargets.Count -eq 0) {
        Write-Host ""
        Write-Host "No allowed paths to stage." -ForegroundColor Yellow
        exit 0
    }

    & $Git -C $Root add -- $stageTargets
    if ($LASTEXITCODE -ne 0) {
        throw "git add failed."
    }

    Write-PathList "Staged paths" $stageTargets
    Write-Host ""
    Write-Host "Commit preparation complete." -ForegroundColor Green
} finally {
    Pop-Location
}
