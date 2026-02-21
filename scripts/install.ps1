#Requires -Version 5.1
<#
.SYNOPSIS
    OpenClaw one-command installer for Windows
.DESCRIPTION
    curl -fsSL https://get.openclaw.dev/install.ps1 | pwsh -Command -
    or:
    irm https://get.openclaw.dev/install.ps1 | iex
#>
[CmdletBinding()]
param(
    [string]$Version = "latest",
    [switch]$Demo,
    [switch]$Enterprise,
    [switch]$SkipNode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MIN_NODE_MAJOR = 20

# ── Formatting helpers ─────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "  v $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  x $msg" -ForegroundColor Red; exit 1 }

function Write-Banner {
    $banner = @"

   ___                   ____ _
  / _ \ _ __   ___ _ __ / ___| | __ ___      __
 | | | | '_ \ / _ \ '_ \ |   | |/ _` \ \ /\ / /
 | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /
  \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/
       |_|

"@
    Write-Host $banner -ForegroundColor Cyan
    Write-Host "  🦞  Your own personal AI assistant. Any OS. Any platform." -ForegroundColor White
    Write-Host "  https://github.com/openclaw/openclaw" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Node.js detection ──────────────────────────────────────────────────────
function Get-NodeVersion {
    try {
        $v = (node --version 2>$null).TrimStart('v')
        return $v
    } catch { return $null }
}

function Install-Node {
    Write-Info "Installing Node.js..."

    # Try winget first (Windows 11 / updated Win10)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Installing via winget..."
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>$null
        if (Get-NodeVersion) {
            Write-Success "Node.js $(Get-NodeVersion) installed via winget"
            return
        }
    }

    # Try scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Info "Installing via scoop..."
        scoop install nodejs-lts 2>$null
        if (Get-NodeVersion) {
            Write-Success "Node.js $(Get-NodeVersion) installed via scoop"
            return
        }
    }

    # Try chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "Installing via chocolatey..."
        choco install nodejs-lts -y 2>$null
        if (Get-NodeVersion) {
            Write-Success "Node.js $(Get-NodeVersion) installed via chocolatey"
            return
        }
    }

    # Direct download as last resort
    $arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/latest-v22.x/node-v22.0.0-win-$arch.zip"
    Write-Info "Downloading Node.js installer..."
    $tempZip = Join-Path $env:TEMP "node-lts.zip"
    $tempDir = Join-Path $env:TEMP "node-lts"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/latest-lts/SHASUMS256.txt" -OutFile (Join-Path $env:TEMP "node-sha.txt") -UseBasicParsing 2>$null

    Write-Fail "Automatic Node.js installation failed. Please install Node.js v$MIN_NODE_MAJOR+ from https://nodejs.org then re-run this script."
}

function Assert-Node {
    if ($SkipNode) { return }

    $ver = Get-NodeVersion
    if ($ver) {
        $major = [int]($ver.Split('.')[0])
        if ($major -ge $MIN_NODE_MAJOR) {
            Write-Success "Node.js $ver found"
            return
        }
        Write-Warn "Node.js $ver is too old (need v$MIN_NODE_MAJOR+)"
    } else {
        Write-Info "Node.js not found"
    }
    Install-Node
}

# ── Install OpenClaw ───────────────────────────────────────────────────────
function Install-OpenClaw {
    $pkg = if ($Version -eq "latest") { "openclaw" } else { "openclaw@$Version" }
    Write-Info "Installing $pkg..."
    npm install -g $pkg --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "npm install failed. Try running PowerShell as Administrator and re-running."
    }
    $installedVer = (openclaw --version 2>$null) ?? "unknown"
    Write-Success "openclaw $installedVer installed"
}

# ── Write default config ───────────────────────────────────────────────────
function Initialize-Config {
    $configDir = Join-Path $env:APPDATA "openclaw"
    $configFile = Join-Path $configDir "config.yaml"

    if (Test-Path $configFile) {
        Write-Info "Existing config found at $configFile"
        return
    }

    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    if ($Enterprise) {
        @"
# OpenClaw Enterprise Configuration
enterprise:
  enabled: true
  secrets:
    backend: file
  iam:
    enabled: true
    jwt:
      algorithm: RS256
  audit:
    enabled: true
  monitoring:
    enabled: true

gateway:
  bind: loopback
  auth:
    mode: jwt
  port: 3284
"@ | Set-Content $configFile -Encoding UTF8
    } else {
        @"
# OpenClaw Configuration
gateway:
  bind: loopback
  auth:
    mode: none
  port: 3284
"@ | Set-Content $configFile -Encoding UTF8
    }
    Write-Success "Config written to $configFile"
}

# ── Success summary ────────────────────────────────────────────────────────
function Write-Summary {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "    🦞  OpenClaw is ready!" -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Get started:" -ForegroundColor White
    Write-Host ""
    Write-Host "    openclaw start        # start the gateway" -ForegroundColor Cyan
    Write-Host "    openclaw onboard      # interactive setup" -ForegroundColor Cyan
    Write-Host "    openclaw demo         # see it in action" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  https://github.com/openclaw/openclaw" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Main ───────────────────────────────────────────────────────────────────
Write-Banner
Assert-Node
Install-OpenClaw
Initialize-Config
Write-Summary

if ($Demo) {
    Write-Info "Running demo..."
    openclaw demo --quick 2>$null
}
