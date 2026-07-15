import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * aza pack — one-click local portable build + installers.
 * Delegates to scripts/build-portable.ts at the monorepo root.
 */
export async function packCommand(options: { root?: string; install?: boolean } = {}): Promise<void> {
  const candidates = [
    options.root ? path.resolve(options.root) : null,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ].filter(Boolean) as string[];

  let repoRoot: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'scripts', 'build-portable.ts'))) {
      repoRoot = c;
      break;
    }
  }

  if (!repoRoot) {
    console.error('\n  ✗ scripts/build-portable.ts not found. Run from the AzaLoop monorepo root.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  AzaLoop pack — building portable installers...\n');
  try {
    execSync('pnpm build:portable', {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    process.exitCode = 1;
    return;
  }

  const dist = path.join(repoRoot, 'dist', 'portable');
  const installer = path.join(dist, process.platform === 'win32' ? 'install.ps1' : 'install.sh');
  console.log(`\n  ✓ Portable build ready: ${dist}`);
  console.log(`  Installer: ${installer}`);

  if (options.install && fs.existsSync(installer)) {
    console.log('\n  Running local installer...\n');
    try {
      if (process.platform === 'win32') {
        execSync(`powershell -ExecutionPolicy Bypass -File "${installer}"`, {
          cwd: dist,
          stdio: 'inherit',
        });
      } else {
        execSync(`bash "${installer}"`, { cwd: dist, stdio: 'inherit' });
      }
      console.log('\n  ✓ Local install complete\n');
    } catch {
      console.error('\n  ✗ Installer failed — run it manually from dist/portable/\n');
      process.exitCode = 1;
    }
  } else {
    console.log(`
  Next:
    Windows:  cd dist\\portable && .\\install.ps1
    macOS/Linux: cd dist/portable && bash install.sh
`);
  }
}
