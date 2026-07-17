// Find large files
import * as fs from 'node:fs';
import * as path from 'node:path';

function walk(dir: string, results: { file: string; lines: number }[]) {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      walk(full, results);
    } else if (e.isFile() && (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n').length;
        if (lines >= 400) {
          results.push({ file: full, lines });
        }
      } catch {}
    }
  }
}

const root = process.cwd();
const results: { file: string; lines: number }[] = [];
['packages', 'scripts', 'mcp-server', 'cli'].forEach((p) => walk(path.join(root, p), results));
results.sort((a, b) => b.lines - a.lines);
console.log(`Found ${results.length} files with >= 400 lines:`);
for (const r of results) {
  console.log(`  ${r.lines.toString().padStart(4)} lines - ${path.relative(root, r.file)}`);
}
