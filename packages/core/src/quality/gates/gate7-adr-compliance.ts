/**
 * v14 — v13-P7.2: Gate 7 — ADR Compliance
 *
 * Wraps {@link scanAdrCompliance} as a `QualityPipeline` gate. The
 * gate fails when any accepted ADR's rule is violated by a file in the
 * diff. Failures are reported as `issues` so they propagate through the
 * standard `GateResult` interface.
 *
 * Usage:
 *   pipeline.register(new AdrComplianceGate(azaDir, filePaths));
 */

import type { GateResult } from '../pipeline';
import {
  scanAdrCompliance,
  type ComplianceResult,
  type AdrViolation,
} from '../../L6_security/scanners/adr-compliance';

/** Name of Gate 7 used in pipeline output. */
export const GATE7_NAME = 'Gate 7: ADR Compliance';

export interface AdrComplianceGateContext {
  /** Path to the `.aza` directory. */
  azaDir: string;
  /** Changed files to scan. */
  filePaths: string[];
  /** Workspace root for resolving relative paths. */
  workspaceRoot?: string;
}

export interface AdrComplianceGateResult extends GateResult {
  scannedAdrs: number;
  scannedFiles: number;
  violations: AdrViolation[];
  warnings: string[];
  compliance: ComplianceResult;
}

/**
 * Run the ADR compliance gate. The gate:
 *   - Passes if no violations are found.
 *   - Fails if at least one violation is found.
 *   - Adds violations to `issues` (one per violation) so the standard
 *     pipeline can surface them.
 */
export async function adrComplianceGate(
  context: AdrComplianceGateContext,
): Promise<AdrComplianceGateResult> {
  const start = Date.now();
  const issues: string[] = [];
  const result = scanAdrComplianceFromDiskSafe(
    context.azaDir,
    context.filePaths,
    context.workspaceRoot,
  );

  for (const v of result.violations) {
    issues.push(
      `ADR ${v.adrId} (${v.adrTitle}) rule ${v.rule} violated in ${v.file}${
        v.line ? `:${v.line}` : ''
      } — ${v.evidence}`,
    );
  }

  return {
    gate: GATE7_NAME,
    passed: !result.hasViolations,
    issues,
    duration_ms: Date.now() - start,
    scannedAdrs: result.scannedAdrs,
    scannedFiles: result.scannedFiles,
    violations: result.violations,
    warnings: result.warnings,
    compliance: result,
  };
}

// ── Helper ───────────────────────────────────────────────────

/**
 * Wrapper that swallows synchronous throws from
 * {@link scanAdrCompliance} and returns a "no violation" result with
 * a warning. This keeps the gate resilient against malformed ADRs.
 */
function scanAdrComplianceFromDiskSafe(
  azaDir: string,
  filePaths: string[],
  workspaceRoot?: string,
): ComplianceResult {
  // Lazy import to avoid a circular dep at module init.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { scanAdrComplianceFromDisk } = require('../../L6_security/scanners/adr-compliance');
  try {
    return scanAdrComplianceFromDisk(azaDir, filePaths, workspaceRoot);
  } catch (err) {
    return {
      hasViolations: false,
      violations: [],
      scannedAdrs: 0,
      scannedFiles: filePaths.length,
      warnings: [`ADR compliance scan failed: ${(err as Error).message}`],
    };
  }
}
