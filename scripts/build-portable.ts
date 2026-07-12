#!/usr/bin/env node
/**
 * AzaLoop Portable Build — Bundles CLI + MCP server into standalone executables.
 *
 * Uses Node.js SEA (Single Executable Applications) to create .exe / .bin files
 * that require no Node.js or npm installation.
 *
 * Output: dist/portable/
 *   ├── aza(.exe)          — CLI (aza init, aza setup, aza status)
 *   ├── azaloop-mcp(.exe)  — MCP server
 *   ├── templates/         — 25+ client templates
 *   ├── docs/              — Documentation
 *   └── install(.ps1|.sh)  — One-click install script
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist', 'portable');

const BANNER = `
  ╔══════════════════════════════════════════╗
  ║       AzaLoop Portable Builder           ║
  ╚══════════════════════════════════════════╝
`;

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function cleanDist() {
  console.log('  Cleaning dist/portable/ ...');
  await fs.rm(DIST, { recursive: true, force: true });
  await ensureDir(DIST);
}

async function bundleWithEsbuild(entry: string, outfile: string): Promise<void> {
  console.log(`  Bundling ${path.basename(entry)} → ${path.basename(outfile)} ...`);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    treeShaking: true,
    sourcemap: false,
    external: [],
    define: {
      'process.env.AZALOOP_BUNDLED': '"true"',
    },
    banner: {
      js: '#!/usr/bin/env node\n',
    },
  });
}

async function createSeaExecutable(jsFile: string, outputName: string): Promise<void> {
  const seaConfig = {
    main: jsFile,
    output: path.join(DIST, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
  };
  const seaConfigPath = path.join(DIST, 'sea-config.json');
  await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2));

  console.log(`  Creating SEA blob for ${outputName} ...`);
  execSync(
    `node --experimental-sea-config "${seaConfigPath}"`,
    { cwd: DIST, stdio: 'pipe' }
  );

  // Determine target binary name
  const isWin = process.platform === 'win32';
  const nodeBin = process.execPath;
  const outBin = path.join(DIST, isWin ? `${outputName}.exe` : outputName);

  // Copy Node.js binary
  console.log(`  Copying Node.js runtime → ${path.basename(outBin)} ...`);
  await fs.copyFile(nodeBin, outBin);

  // Inject SEA blob
  const postject = path.join(ROOT, 'node_modules', '.bin', 'postject');
  const postjectArgs = [
    `"${outBin}"`,
    'NODE_SEA_BLOB',
    `"${seaConfig.output}"`,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--macho-segment-name', 'NODE_SEA',
  ];

  try {
    console.log(`  Injecting SEA blob into ${path.basename(outBin)} ...`);
    execSync(
      `${postject} ${postjectArgs.join(' ')}`,
      { stdio: 'pipe', timeout: 30000 }
    );
    console.log(`  ✓ ${outputName} executable created`);
  } catch (e: any) {
    console.log(`  ⚠ SEA injection failed: ${e.message}`);
    console.log('  Falling back to portable JS bundle');
  }

  // Cleanup
  try { await fs.unlink(seaConfigPath); } catch {}
  try { await fs.unlink(seaConfig.output); } catch {}
}

async function copyAssets() {
  console.log('  Copying templates ...');
  const templatesDir = path.join(DIST, 'templates');
  await ensureDir(templatesDir);
  await fs.cp(path.join(ROOT, 'templates'), templatesDir, { recursive: true });

  console.log('  Copying docs ...');
  const docsDir = path.join(DIST, 'docs');
  await ensureDir(docsDir);
  const docFiles = [
    'CLIENT-INSTALLATION.md',
    'CLIENT-INSTALLATION.en.md',
    'README.md',
    'README.en.md',
    'WELCOME.md',
  ];
  for (const f of docFiles) {
    const src = path.join(ROOT, f);
    try {
      await fs.copyFile(src, path.join(docsDir, f));
    } catch {
      const src2 = path.join(ROOT, 'docs', f);
      try {
        await fs.copyFile(src2, path.join(docsDir, f));
      } catch {}
    }
  }
}

async function createInstallScripts() {
  // Windows install.ps1
  const ps1 = `# AzaLoop Portable Installer for Windows
# Run this script to install AzaLoop from the portable package.

$ErrorActionPreference = "Stop"
$BANNER = @"

  ╔══════════════════════════════════════════╗
  ║       AzaLoop Portable Installer         ║
  ╚══════════════════════════════════════════╝

"@
Write-Host $BANNER

# Get script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$TARGET_DIR = "$env:USERPROFILE\\.azaloop"

Write-Host "  [1/4] Detecting platform..."
Write-Host "    OS: Windows"
Write-Host "    Target: $TARGET_DIR"

Write-Host "`n  [2/4] Installing AzaLoop..."
if (-not (Test-Path $TARGET_DIR)) {
  New-Item -ItemType Directory -Path $TARGET_DIR -Force | Out-Null
}

# Copy executables and assets
Copy-Item "$SCRIPT_DIR\\aza.exe" "$TARGET_DIR\\" -Force -ErrorAction SilentlyContinue
Copy-Item "$SCRIPT_DIR\\azaloop-mcp.exe" "$TARGET_DIR\\" -Force -ErrorAction SilentlyContinue
Copy-Item "$SCRIPT_DIR\\templates" "$TARGET_DIR\\" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$SCRIPT_DIR\\docs" "$TARGET_DIR\\" -Recurse -Force -ErrorAction SilentlyContinue

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$TARGET_DIR*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$TARGET_DIR", "User")
  Write-Host "    ✓ Added to PATH"
}

Write-Host "`n  [3/4] Initializing project..."
& "$TARGET_DIR\\aza.exe" init

Write-Host @"

  [4/4] ✅ AzaLoop installed successfully!

  Open your AI coding assistant and type your requirements.
  AzaLoop will handle the rest.

  📖 Docs: $TARGET_DIR\\docs\\CLIENT-INSTALLATION.md
"@
`;
  const ps1Path = path.join(DIST, 'install.ps1');
  await fs.writeFile(ps1Path, ps1);

  // Shell install.sh
  const sh = `#!/usr/bin/env bash
set -euo pipefail

# AzaLoop Portable Installer for Linux/macOS

BANNER='
  ╔══════════════════════════════════════════╗
  ║       AzaLoop Portable Installer         ║
  ╚══════════════════════════════════════════╝
'

echo "$BANNER"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.azaloop"

echo "  [1/4] Detecting platform..."
echo "    OS: $(uname -s)"
echo "    Target: $TARGET_DIR"

echo ""
echo "  [2/4] Installing AzaLoop..."
mkdir -p "$TARGET_DIR"

cp "$SCRIPT_DIR/aza" "$TARGET_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/azaloop-mcp" "$TARGET_DIR/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/templates" "$TARGET_DIR/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/docs" "$TARGET_DIR/" 2>/dev/null || true
chmod +x "$TARGET_DIR/aza" "$TARGET_DIR/azaloop-mcp" 2>/dev/null || true

# Add to PATH
if [[ ":$PATH:" != *":$TARGET_DIR:"* ]]; then
  SHELL_CONFIG="$HOME/.bashrc"
  if [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
  fi
  echo "export PATH=\"\$PATH:$TARGET_DIR\"" >> "$SHELL_CONFIG"
  echo "    ✓ Added to PATH ($SHELL_CONFIG)"
  echo "    Run: source $SHELL_CONFIG"
fi

echo ""
echo "  [3/4] Initializing project..."
"$TARGET_DIR/aza" init

cat <<EOF

  [4/4] ✅ AzaLoop installed successfully!

  Open your AI coding assistant and type your requirements.
  AzaLoop will handle the rest.

  📖 Docs: \$TARGET_DIR/docs/CLIENT-INSTALLATION.md
EOF
`;
  const shPath = path.join(DIST, 'install.sh');
  await fs.writeFile(shPath, sh);
  try { execSync(`chmod +x "${shPath}"`, { stdio: 'pipe' }); } catch {}

  console.log('  ✓ install.ps1 + install.sh created');
}

async function createPortableZip() {
  console.log('  Creating portable.zip ...');
  const zipPath = path.join(ROOT, 'dist', 'azaloop-portable.zip');

  // Use built-in tar (PowerShell) on Windows
  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(
      `cd "${DIST}" && zip -r "${zipPath}" .`,
      { stdio: 'pipe' }
    );
  }
  console.log(`  ✓ ${zipPath}`);
}

async function main() {
  console.log(BANNER);
  console.log(`  Target: ${DIST}\n`);

  await cleanDist();

  // Step 1: Build core packages first
  console.log('  [1/5] Building packages...');
  execSync('pnpm build', { cwd: ROOT, stdio: 'pipe' });

  // Step 2: Bundle CLI with esbuild
  console.log('\n  [2/5] Bundling CLI...');
  const cliBundle = path.join(DIST, 'cli-bundle.js');
  await bundleWithEsbuild(
    path.join(ROOT, 'packages', 'cli', 'src', 'index.ts'),
    cliBundle
  );

  // Step 3: Bundle MCP server with esbuild
  console.log('\n  [3/5] Bundling MCP server...');
  const mcpBundle = path.join(DIST, 'mcp-bundle.js');
  await bundleWithEsbuild(
    path.join(ROOT, 'packages', 'mcp-server', 'src', 'server.ts'),
    mcpBundle
  );

  // Step 4: Create SEA executables
  console.log('\n  [4/5] Creating standalone executables...');
  await createSeaExecutable(cliBundle, 'aza');
  await createSeaExecutable(mcpBundle, 'azaloop-mcp');

  // If SEA failed, fall back to portable JS bundles
  const isWin = process.platform === 'win32';
  const azaExe = path.join(DIST, isWin ? 'aza.exe' : 'aza');
  const mcpExe = path.join(DIST, isWin ? 'azaloop-mcp.exe' : 'azaloop-mcp');
  if (!fs.stat(azaExe).catch(() => false)) {
    console.log('  Using portable JS bundles (no native executable)');
    await fs.copyFile(cliBundle, azaExe);
    await fs.copyFile(mcpBundle, mcpExe);
  }

  // Step 5: Copy assets and create installers
  console.log('\n  [5/5] Copying assets and creating installers...');
  await copyAssets();
  await createInstallScripts();
  await createPortableZip();

  // Cleanup bundles
  try { await fs.unlink(cliBundle); } catch {}
  try { await fs.unlink(mcpBundle); } catch {}

  // Summary
  const size = await getDirSize(DIST);
  console.log(`\n  ✅ Build complete!`);
  console.log(`  Output: ${DIST} (${size})`);
  console.log(`  Zip:    dist/azaloop-portable.zip`);
  console.log(`
  To install:
    Windows:  .\\install.ps1
    macOS:    bash install.sh
    Linux:    bash install.sh
  `);
}

async function getDirSize(dir: string): Promise<string> {
  let total = 0;
  const files = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  for (const f of files) {
    const fp = path.join(f.parentPath, f.name);
    try {
      const stat = await fs.stat(fp);
      if (stat.isFile()) total += stat.size;
    } catch {}
  }
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`;
  return `${(total / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(console.error);