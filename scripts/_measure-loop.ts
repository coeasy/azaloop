import * as fs from 'node:fs';

const file = 'packages/core/src/L7_loop/loop-controller.ts';
const content = fs.readFileSync(file, 'utf8').split('\n');
const methods: Array<{ name: string; lines: number; start: number }> = [];
let cur: string | null = null;
let start = 0;
let braceDepth = 0;
for (let i = 0; i < content.length; i++) {
  const line = content[i] ?? '';
  // 匹配以空格开头的 method 声明
  const m = line.match(/^  (async )?(\w+)\s*[<(]/);
  if (m && line.includes('(') && !line.includes('//') && !line.includes('/*')) {
    // 推断 name 和 start
    if (cur) methods.push({ name: cur, lines: i - start, start });
    cur = m[2] ?? 'unknown';
    start = i;
  }
}
if (cur) methods.push({ name: cur, lines: content.length - start, start });
methods.sort((a, b) => b.lines - a.lines);
console.log(`loop-controller.ts 精确方法 (top 15):`);
for (const m of methods.slice(0, 15)) {
  console.log(`  ${m.name} (start=${m.start + 1}): ${m.lines} lines`);
}
console.log(`Total: ${methods.length} methods, file = ${content.length} lines`);
