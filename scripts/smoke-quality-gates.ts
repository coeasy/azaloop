import { lintGate } from '../packages/core/src/quality/gates/gate1-lint.ts';
import { testGate } from '../packages/core/src/quality/gates/gate2-test.ts';

async function main() {
  const root = process.cwd();
  const g1 = await lintGate(root);
  const g2 = await testGate(root);
  console.log(
    JSON.stringify(
      {
        g1: { passed: g1.passed, ms: g1.duration_ms, issues: g1.issues.slice(0, 2) },
        g2: { passed: g2.passed, ms: g2.duration_ms, issues: g2.issues.slice(0, 5) },
      },
      null,
      2,
    ),
  );
  process.exit(g1.passed && g2.passed ? 0 : 1);
}

main();
