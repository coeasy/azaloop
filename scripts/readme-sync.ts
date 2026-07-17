/**
 * R10 第11轮 (P4 README 自动化) — 把 capability registry 的渲染结果
 * 注入 README.md 的固定锚点之间。
 *
 * 借鉴 spec-kit「manifest-driven documentation」：
 * README 不手写能力列表，从注册表生成，避免文档/代码漂移。
 *
 * 锚点：
 *   <!-- AZA_CAPABILITIES_START -->
 *   <!-- AZA_CAPABILITIES_END -->
 *
 * 逃逸闸：AZA_SKIP_README_UPDATE=1
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderCapabilitiesMarkdown } from '@azaloop/core';

const START_MARKER = '<!-- AZA_CAPABILITIES_START -->';
const END_MARKER = '<!-- AZA_CAPABILITIES_END -->';

function main() {
  if (process.env.AZA_SKIP_README_UPDATE === '1' || process.env.AZA_SKIP_README_UPDATE === 'true') {
    console.log('[readme-sync] skipped (AZA_SKIP_README_UPDATE=1)');
    return;
  }
  const root = process.cwd();
  const readmePath = path.join(root, 'README.md');
  if (!fs.existsSync(readmePath)) {
    console.error(`[readme-sync] FAIL: ${readmePath} missing`);
    process.exit(1);
  }
  const original = fs.readFileSync(readmePath, 'utf8');
  if (!original.includes(START_MARKER) || !original.includes(END_MARKER)) {
    console.error(`[readme-sync] FAIL: markers not found in ${readmePath}`);
    process.exit(1);
  }
  const capBlock = renderCapabilitiesMarkdown();
  const startIdx = original.indexOf(START_MARKER);
  const endIdx = original.indexOf(END_MARKER);
  const next = original.slice(0, startIdx + START_MARKER.length)
    + '\n\n' + capBlock
    + original.slice(endIdx);
  if (next === original) {
    console.log('[readme-sync] no changes (already in sync)');
    return;
  }
  fs.writeFileSync(readmePath, next, 'utf8');
  console.log(`[readme-sync] updated README.md (${capBlock.length} chars injected)`);
}

main();
