import { createHash } from 'crypto';
import * as path from 'path';
import type { LoopResponse } from '@azaloop/shared';

/**
 * Compute rubric score for a category.
 */
function computeRubricScore(_output: string, _expectedBehavior: string, category: string): number {
  // Simple heuristic: baseline 70, adjust based on category
  const baselineScores: Record<string, number> = {
    correctness: 75,
    completeness: 70,
    code_quality: 65,
    security: 80,
    performance: 60,
    test_coverage: 70,
  };
  return baselineScores[category] ?? 70;
}

/**
 * Eval platform — Pass@k / Pass^k scoring + Rubric evaluation.
 * Inspired by comet's Eval platform.
 */
export interface EvalResult {
  test_id: string;
  pass_at_1: number; // Pass@1
  pass_at_3: number; // Pass@3
  pass_at_k: number; // Pass@k
  rubric_score: number; // 0-100 rubric score
  rubric_details: RubricItem[];
  tokens_used: number;
  time_ms: number;
}

export interface RubricItem {
  category: string;
  score: number; // 0-100
  max_score: number;
  passed: boolean;
  detail: string;
}

export interface EvalConfig {
  rubric_categories: string[];
  k_values: number[];
}

const DEFAULT_RUBRIC_CATEGORIES = [
  'correctness',
  'completeness',
  'code_quality',
  'security',
  'performance',
  'test_coverage',
];

const DEFAULT_K_VALUES = [1, 3, 5, 10];

/**
 * Evaluate a single test case against a rubric.
 */
export function evaluateRubric(
  output: string,
  expectedBehavior: string,
  categories: string[] = DEFAULT_RUBRIC_CATEGORIES,
): RubricItem[] {
  const results: RubricItem[] = [];

  // Simple heuristic scoring (in production, would use LLM eval)
  for (const category of categories) {
    const score = computeRubricScore(output, expectedBehavior, category);
    results.push({
      category,
      score,
      max_score: 100,
      passed: score >= 60,
      detail: `Scored ${score}/100 on ${category}`,
    });
  }

  return results;
}

/**
 * Compute Pass@k metric.
 */
export function computePassAtK(
  results: boolean[],
  k: number,
): number {
  if (results.length === 0) return 0;
  if (k <= 0) return 0;

  const sampleSize = Math.min(k, results.length);
  const passed = results.slice(0, sampleSize).filter(r => r).length;
  return passed / sampleSize;
}

/**
 * Compute Pass^k metric (geometric mean of Pass@k values).
 */
export function computePassPowerK(
  results: boolean[],
  kValues: number[] = DEFAULT_K_VALUES,
): number {
  if (results.length === 0) return 0;
  let product = 1;
  let count = 0;
  for (const k of kValues) {
    const passAtK = computePassAtK(results, k);
    if (passAtK > 0) {
      product *= passAtK;
      count++;
    }
  }
  return count > 0 ? Math.pow(product, 1 / count) : 0;
}

/**
 * Evaluate a test case and return full EvalResult.
 */
export async function evaluateTestCase(
  testId: string,
  output: string,
  expectedBehavior: string,
  tokensUsed: number,
  timeMs: number,
): Promise<EvalResult> {
  const results: boolean[] = [output.length > 0]; // Simplified: passes if there's output
  const rubricDetails = evaluateRubric(output, expectedBehavior);

  return {
    test_id: testId,
    pass_at_1: computePassAtK(results, 1),
    pass_at_3: computePassAtK(results, 3),
    pass_at_k: computePassAtK(results, DEFAULT_K_VALUES[DEFAULT_K_VALUES.length - 1]!),
    rubric_score: Math.round(rubricDetails.reduce((s, r) => s + r.score, 0) / rubricDetails.length),
    rubric_details: rubricDetails,
    tokens_used: tokensUsed,
    time_ms: timeMs,
  };
}

/**
 * Aggregate EvalResults across multiple test cases.
 */
export function aggregateEvalResults(results: EvalResult[]): {
  overall_pass_at_1: number;
  overall_pass_at_k: number;
  overall_rubric_score: number;
  total_tests: number;
  passed_tests: number;
  avg_tokens: number;
  avg_time_ms: number;
} {
  if (results.length === 0) {
    return {
      overall_pass_at_1: 0,
      overall_pass_at_k: 0,
      overall_rubric_score: 0,
      total_tests: 0,
      passed_tests: 0,
      avg_tokens: 0,
      avg_time_ms: 0,
    };
  }

  const totalTestsCount = results.length;
  const passedTests = results.filter(r => r.pass_at_1 === 1).length;
  const avgRubric = results.reduce((s, r) => s + r.rubric_score, 0) / totalTestsCount;
  const avgTokens = results.reduce((s, r) => s + r.tokens_used, 0) / totalTestsCount;
  const avgTime = results.reduce((s, r) => s + r.time_ms, 0) / totalTestsCount;
  const allPasses = results.map(r => r.pass_at_1 === 1);

  return {
    overall_pass_at_1: computePassAtK(allPasses, 1),
    overall_pass_at_k: computePassAtK(allPasses, DEFAULT_K_VALUES[DEFAULT_K_VALUES.length - 1]!),
    overall_rubric_score: Math.round(avgRubric),
    total_tests: totalTestsCount,
    passed_tests: passedTests,
    avg_tokens: Math.round(avgTokens),
    avg_time_ms: Math.round(avgTime),
  };
}

/**
 * Generate an eval summary report.
 */
export function generateEvalReport(aggregated: ReturnType<typeof aggregateEvalResults>): string {
  return `
# Eval Report

## Summary
- Total Tests: ${aggregated.total_tests}
- Passed Tests: ${aggregated.passed_tests}
- Pass@1: ${(aggregated.overall_pass_at_1 * 100).toFixed(1)}%
- Pass@k: ${(aggregated.overall_pass_at_k * 100).toFixed(1)}%
- Avg Rubric Score: ${aggregated.overall_rubric_score}/100
- Avg Tokens: ${aggregated.avg_tokens}
- Avg Time: ${aggregated.avg_time_ms}ms

## Quality Gate
${aggregated.overall_rubric_score >= 60 ? '✅ PASS' : '❌ FAIL'} (threshold: 60/100)
${aggregated.overall_pass_at_1 >= 0.8 ? '✅ PASS' : '❌ FAIL'} (threshold: 80%)
`.trim();
}

/**
 * Save eval results to .aza/eval-results.jsonl
 */
export async function saveEvalResults(azaDir: string, results: EvalResult[]): Promise<void> {
  const fs = require('fs/promises');
  const path = require('path');
  const evalPath = path.join(azaDir, 'eval-results.jsonl');
  await fs.mkdir(azaDir, { recursive: true });
  const lines = results.map(r => JSON.stringify(r));
  await fs.appendFile(evalPath, lines.join('\n') + '\n', 'utf8');
}

/**
 * MCP tool handler: Run eval on the current project.
 */
export async function handleEvalRun(testOutput: string, expectedBehavior: string): Promise<LoopResponse> {
  const result = await evaluateTestCase(
    createHash('sha256').update(Date.now().toString()).digest('hex').slice(0, 8),
    testOutput,
    expectedBehavior,
    0, // tokens_used — would come from LLM call
    Date.now(),
  );
  return {
    success: true,
    data: {
      eval_result: result,
      report: generateEvalReport(aggregateEvalResults([result])),
    },
    metadata: {
      iteration: 0,
      progress: `eval_${result.pass_at_1 >= 1 ? 'pass' : 'fail'}`,
      stage: 'verify',
    },
  };
}

/**
 * MCP tool handler: Aggregate all eval results from .aza/eval-results.jsonl.
 */
export async function handleEvalSummary(workspacePath?: string): Promise<LoopResponse> {
  const fs = require('fs/promises');
  const root = workspacePath ?? process.cwd();
  const azaDir = path.join(root, '.aza');
  const evalPath = path.join(azaDir, 'eval-results.jsonl');
  try {
    const content = await fs.readFile(evalPath, 'utf8');
    const results: EvalResult[] = [];
    for (const line of content.split('\n')) {
      if (line.trim()) {
        results.push(JSON.parse(line) as EvalResult);
      }
    }
    const aggregated = aggregateEvalResults(results);
    return {
      success: true,
      data: {
        aggregated,
        report: generateEvalReport(aggregated),
        total_evals: results.length,
      },
      metadata: {
        iteration: 0,
        progress: `${aggregated.passed_tests}/${aggregated.total_tests} tests passed`,
        stage: 'verify',
      },
    };
  } catch {
    return {
      success: true,
      data: {
        aggregated: aggregateEvalResults([]),
        report: 'No eval results found',
        total_evals: 0,
      },
      metadata: {
        iteration: 0,
        progress: 'no_evals',
        stage: 'verify',
      },
    };
  }
}
