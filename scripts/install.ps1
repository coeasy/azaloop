<#
.SYNOPSIS
  AzaLoop One-Click Installer for Windows (Portable Package)
.DESCRIPTION
  Installs AzaLoop from the portable package without requiring Node.js or npm.
  Creates a standalone installation in %USERPROFILE%\.azaloop and adds it to PATH.
.EXAMPLE
  .\install.ps1                    # Install AzaLoop
  .\install.ps1 -Project           # Install and init current project
  .\install.ps1 -Client cursor     # Install for a specific client
  .\install.ps1 -Portable          # Extract to current directory (no PATH)
#>

param(
  [string]$Client = "",
  [switch]$Project,
  [switch]$Portable,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$BANNER = @"

  ╔══════════════════════════════════════════╗
  ║        AzaLoop Portable Installer        ║
  ║  One-click setup — no Node.js required   ║
  ╚══════════════════════════════════════════╝

"@

Write-Host $BANNER

# Get script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$TARGET_DIR = "$env:USERPROFILE\.azaloop"

if ($Portable) {
  $TARGET_DIR = $SCRIPT_DIR
  Write-Host "  Portable mode — installing to: $TARGET_DIR"
} else {
  Write-Host "  Installing to: $TARGET_DIR"
}

# Step 1: Create target directory
Write-Host "`n  [1/4] Creating installation directory..."
if (-not (Test-Path $TARGET_DIR)) {
  New-Item -ItemType Directory -Path $TARGET_DIR -Force | Out-Null
}

# Step 2: Copy files
Write-Host "  [2/4] Copying AzaLoop files..."

Copy-Item "$SCRIPT_DIR\aza.exe" "$TARGET_DIR\" -Force
Copy-Item "$SCRIPT_DIR\azaloop-mcp.exe" "$TARGET_DIR\" -Force
Write-Host "    ✓ Executables"

if (Test-Path "$SCRIPT_DIR\cli-bundle.js") {
  Copy-Item "$SCRIPT_DIR\cli-bundle.js" "$TARGET_DIR\" -Force
  Write-Host "    ✓ CLI bundle"
}
if (Test-Path "$SCRIPT_DIR\mcp-bundle.js") {
  Copy-Item "$SCRIPT_DIR\mcp-bundle.js" "$TARGET_DIR\" -Force
  Write-Host "    ✓ MCP bundle"
}

if (Test-Path "$SCRIPT_DIR\templates") {
  Copy-Item "$SCRIPT_DIR\templates" "$TARGET_DIR\" -Recurse -Force
  Write-Host "    ✓ Templates (25+ clients)"
}

if (Test-Path "$SCRIPT_DIR\docs") {
  Copy-Item "$SCRIPT_DIR\docs" "$TARGET_DIR\" -Recurse -Force
  Write-Host "    ✓ Documentation"
}

foreach ($f in @("LICENSE", "README.md", "README.en.md", "WELCOME.md")) {
  if (Test-Path "$SCRIPT_DIR\$f") {
    Copy-Item "$SCRIPT_DIR\$f" "$TARGET_DIR\" -Force
  }
}

# Step 3: Add to PATH (User + current session)
if (-not $Portable) {
  Write-Host "`n  [3/4] Adding to PATH..."
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$TARGET_DIR*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$TARGET_DIR", "User")
    Write-Host "    ✓ Added to user PATH"
  } else {
    Write-Host "    ✓ Already in user PATH"
  }
  # Make `aza` available in THIS shell without restart
  if ($env:Path -notlike "*$TARGET_DIR*") {
    $env:Path = "$TARGET_DIR;$env:Path"
    Write-Host "    ✓ Current session PATH updated (aza available now)"
  }
}

# Step 4: Initialize project
if ($Project) {
  Write-Host "`n  [4/4] Initializing project..."
  $clientArg = if ($Client) { "--client $Client" } else { "" }
  & "$TARGET_DIR\aza.exe" init $clientArg 2>&1
} else {
  Write-Host "`n  [4/4] Skipping project init (use -Project to init)"
}

# Done
Write-Host @"

  ✅ AzaLoop installed successfully!

  Commands available:
    aza init          — Initialize current project
    aza setup         — Interactive setup wizard
    aza status        — Show project status
    aza health        — Verify MCP server
    aza loop          — Advance to next action
    aza continue      — Resume from last session
    aza upgrade       — Upgrade from v8/v9

  Documentation:
    $TARGET_DIR\docs\CLIENT-INSTALLATION.md
    $TARGET_DIR\docs\clients\

  Quick start:
    cd your-project
    aza init
    # Open in your AI coding assistant and type your requirements

"@
