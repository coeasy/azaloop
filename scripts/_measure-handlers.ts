import * as fs from 'node:fs';
const content = fs.readFileSync('packages/mcp-server/src/unified-handlers.ts', 'utf8').split('\n');
const handlers: Array<{ name: string; lines: number; start: number }> = [];
let current: string | null = null;
let start = 0;
for (let i = 0; i < content.length; i++) {
  const line = content[i] ?? '';
  const m = line.match(/^export (async )?function handle(\w+)\(/);
  if (m) {
    if (current) handlers.push({ name: current, lines: i - start, start });
    current = m[2] ?? 'unknown';
    start = i;
  }
}
if (current) handlers.push({ name: current, lines: content.length - start, start });
handlers.sort((a, b) => b.lines - a.lines);
console.log('unified-handlers.ts handlers (sorted by lines):');
for (const h of handlers.slice(0, 15)) {
  console.log(`  handle${h.name}: ${h.lines} lines`);
}
console.log(`Total: ${handlers.length} handlers, file = ${content.length} lines`);

// loop-controller.ts functions
const lc = fs.readFileSync('packages/core/src/L7_loop/loop-controller.ts', 'utf8').split('\n');
const lcFns: Array<{ name: string; lines: number }> = [];
let lcCurrent: string | null = null;
let lcStart = 0;
for (let i = 0; i < lc.length; i++) {
  const line = lc[i] ?? '';
  const m = line.match(/^  (async )?(\w+)\s*[<(]/);
  if (m && line.includes('(') && !line.includes('//') && !line.includes('/*')) {
    if (lcCurrent) lcFns.push({ name: lcCurrent, lines: i - lcStart });
    lcCurrent = m[2] ?? 'unknown';
    lcStart = i;
  }
}
if (lcCurrent) lcFns.push({ name: lcCurrent, lines: lc.length - lcStart });
lcFns.sort((a, b) => b.lines - a.lines);
console.log('\nloop-controller.ts methods (top 15):');
for (const f of lcFns.slice(0, 15)) {
  console.log(`  ${f.name}: ${f.lines} lines`);
}
console.log(`Total: ${lcFns.length} methods, file = ${lc.length} lines`);
