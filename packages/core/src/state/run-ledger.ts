import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * A single entry in the append-only run ledger JSONL file.
 * Borrowed from planning-with-files's run ledger pattern.
 */
export interface RunLedgerEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Tool that was called */
  tool: string;
  /** Action performed */
  action: string;
  /** Stage context */
  stage?: string;
  /** Iteration number */
  iteration?: number;
  /** Token cost estimate */
  tokens?: number;
  /** Human-readable summary */
  summary: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** SHA-256 attestation hash of the entry (for integrity) */
  sha?: string;
}

/**
 * RunLedger — append-only JSONL log of every tool call in the loop.
 *
 * Borrows from planning-with-files's run ledger pattern. Every tool
 * invocation is recorded with timestamp, token cost, and outcome.
 * The ledger is append-only — entries are never modified or deleted.
 *
 * Output files:
 * - `run-ledger.jsonl` — raw append-only log
 * - `STATUS.md` — current pipeline status summary
 * - `TASKS.md` — task progress summary
 * - `BUDGET.md` — token budget consumption report
 */
export class RunLedger {
  private azaDir: string;
  private entries: RunLedgerEntry[] = [];

  constructor(azaDir: string) {
    this.azaDir = azaDir;
  }

  /**
   * Append a tool call entry to the ledger.
   */
  async append(entry: Omit<RunLedgerEntry, 'timestamp' | 'sha'>): Promise<RunLedgerEntry> {
    const { createHash } = await import('crypto');
    const fullEntry: RunLedgerEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    // Compute SHA-256 attestation for integrity verification
    const hash = createHash('sha256')
      .update(JSON.stringify(fullEntry))
      .digest('hex')
      .slice(0, 16);
    fullEntry.sha = hash;

    this.entries.push(fullEntry);
    await this.writeEntry(fullEntry);
    return fullEntry;
  }

  /**
   * Read all entries from the ledger file.
   */
  async load(): Promise<RunLedgerEntry[]> {
    try {
      const raw = await fs.readFile(this.getLedgerPath(), 'utf8');
      this.entries = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as RunLedgerEntry;
          if (parsed && parsed.timestamp && parsed.tool) {
            this.entries.push(parsed);
          }
        } catch { /* skip malformed */ }
      }
      return this.entries;
    } catch {
      this.entries = [];
      return [];
    }
  }

  /**
   * Get all loaded entries.
   */
  getEntries(): RunLedgerEntry[] {
    return [...this.entries];
  }

  /**
   * V20 / R10 第2轮 (D1)：返回最近 n 条 entries。
   *
   * 用于 DLP 链式检测、上下文窗口注入等场景——只关心"最近发生了什么"。
   * 基于内存中已加载的 entries，不会触发文件 I/O。当 n <= 0 返回空数组。
   * 若 entries 不足 n 条，返回全部已加载条目。
   */
  getRecentEntries(n: number): RunLedgerEntry[] {
    if (n <= 0) return [];
    return this.entries.slice(-n);
  }

  /**
   * Generate STATUS.md — current pipeline status summary.
   */
  async writeStatusMd(currentStage: string, iteration: number, progress: string): Promise<string> {
    const lines = [
      '# AzaLoop Status',
      '',
      `> Auto-generated at ${new Date().toISOString()}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Stage | ${currentStage} |`,
      `| Iteration | ${iteration} |`,
      `| Progress | ${progress} |`,
      `| Total Entries | ${this.entries.length} |`,
      '',
      '## Recent Activity',
      '',
      ...this.entries.slice(-10).map(e =>
        `- [${e.timestamp}] ${e.tool} (${e.action}) — ${e.success ? '✓' : '✗'} ${e.summary}`
      ),
      '',
    ];
    const content = lines.join('\n');
    const filePath = path.join(this.azaDir, 'STATUS.md');
    await fs.mkdir(this.azaDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Generate TASKS.md — task progress summary.
   */
  async writeTasksMd(stages: Record<string, { status: string }>): Promise<string> {
    const lines = [
      '# AzaLoop Tasks',
      '',
      `> Auto-generated at ${new Date().toISOString()}`,
      '',
      '| Stage | Status |',
      '|-------|--------|',
    ];
    for (const [stage, info] of Object.entries(stages)) {
      lines.push(`| ${stage} | ${info.status} |`);
    }
    lines.push('', '## Tool Call Summary', '');
    const toolCounts = new Map<string, number>();
    for (const e of this.entries) {
      toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
    }
    for (const [tool, count] of toolCounts) {
      lines.push(`- **${tool}**: ${count} calls`);
    }
    lines.push('');
    const content = lines.join('\n');
    const filePath = path.join(this.azaDir, 'TASKS.md');
    await fs.mkdir(this.azaDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Generate BUDGET.md — token budget consumption report.
   */
  async writeBudgetMd(tokenBudget: number): Promise<string> {
    const totalTokens = this.entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
    const lines = [
      '# AzaLoop Budget',
      '',
      `> Auto-generated at ${new Date().toISOString()}`,
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Token Budget | ${tokenBudget} |`,
      `| Tokens Consumed | ${totalTokens} |`,
      `| Remaining | ${Math.max(0, tokenBudget - totalTokens)} |`,
      `| Utilization | ${tokenBudget > 0 ? Math.round((totalTokens / tokenBudget) * 100) : 0}% |`,
      `| Total Tool Calls | ${this.entries.length} |`,
      '',
      '## Per-Tool Breakdown',
      '',
    ];
    const toolTokens = new Map<string, { tokens: number; calls: number }>();
    for (const e of this.entries) {
      const existing = toolTokens.get(e.tool) ?? { tokens: 0, calls: 0 };
      toolTokens.set(e.tool, {
        tokens: existing.tokens + (e.tokens ?? 0),
        calls: existing.calls + 1,
      });
    }
    lines.push('| Tool | Tokens | Calls | Avg Tokens/Call |');
    lines.push('|------|--------|-------|-----------------|');
    for (const [tool, data] of toolTokens) {
      lines.push(`| ${tool} | ${data.tokens} | ${data.calls} | ${data.calls > 0 ? Math.round(data.tokens / data.calls) : 0} |`);
    }
    lines.push('');
    const content = lines.join('\n');
    const filePath = path.join(this.azaDir, 'BUDGET.md');
    await fs.mkdir(this.azaDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Get the path to the ledger JSONL file.
   */
  getLedgerPath(): string {
    return path.join(this.azaDir, 'run-ledger.jsonl');
  }

  private async writeEntry(entry: RunLedgerEntry): Promise<void> {
    await fs.mkdir(this.azaDir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.getLedgerPath(), line, 'utf8');
  }

  /**
   * V20 Task 9: 返回最近的成功状态（用于压缩后恢复）
   */
  getRecoveryPoint(): RunLedgerEntry | null {
    const successEntries = this.entries.filter(e => e.success);
    return successEntries.length > 0 ? successEntries[successEntries.length - 1] ?? null : null;
  }

  /**
   * V20 Task 9: 压缩后生成摘要：从指定 iteration 到现在的精简描述
   */
  summarizeSince(iteration: number): string {
    const since = this.entries.filter(e => (e.iteration ?? 0) >= iteration);
    if (since.length === 0) return '(no activity since recovery point)';
    const tools = new Map<string, number>();
    let fails = 0;
    for (const e of since) {
      tools.set(e.tool, (tools.get(e.tool) ?? 0) + 1);
      if (!e.success) fails++;
    }
    const toolSummary = [...tools.entries()].map(([t, c]) => `${t}×${c}`).join(', ');
    return `Since iter ${iteration}: ${since.length} calls (${toolSummary}), ${fails} failed`;
  }

  /**
   * V20 Task 9: Token 用量统计
   */
  getTokenUsage(): { total: number; perTool: Record<string, number> } {
    const perTool: Record<string, number> = {};
    let total = 0;
    for (const e of this.entries) {
      const t = e.tokens ?? 0;
      total += t;
      perTool[e.tool] = (perTool[e.tool] ?? 0) + t;
    }
    return { total, perTool };
  }
}
