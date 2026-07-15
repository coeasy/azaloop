import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * FilePersistor — 统一文件落盘器 (V17 重构)
 *
 * 职责：
 * 1. 统一管理所有关键产物的持久化（PRD、Contract、STATE.yaml、RESUME.md、代码文件等）
 * 2. 提供原子写入保证（写入失败时回滚）
 * 3. 自动 checksum 验证（防止文件损坏）
 * 4. 失败重试机制（可配置重试次数）
 * 5. 落盘日志记录（写入 audit.jsonl）
 *
 * 使用场景：
 * - LoopController.syncStateToFile() 调用 persistAll()
 * - PRD 生成后调用 persistPRD()
 * - Contract 生成后调用 persistContract()
 */

export interface PersistResult {
  success: boolean;
  filePath: string;
  checksum?: string;
  error?: string;
  retryCount: number;
}

export interface PersistOptions {
  /** 是否启用 checksum 验证（默认 true） */
  enableChecksum?: boolean;
  /** 失败重试次数（默认 3） */
  maxRetries?: number;
  /** 是否写入 audit 日志（默认 true） */
  enableAudit?: boolean;
  /** 是否原子写入（默认 true，先写临时文件再重命名） */
  atomicWrite?: boolean;
}

export class FilePersistor {
  private azaDir: string;
  private auditLogPath: string;
  private defaultOptions: Required<PersistOptions>;

  constructor(azaDir: string, options: PersistOptions = {}) {
    this.azaDir = azaDir;
    this.auditLogPath = path.join(azaDir, 'audit.jsonl');
    this.defaultOptions = {
      enableChecksum: options.enableChecksum ?? true,
      maxRetries: options.maxRetries ?? 3,
      enableAudit: options.enableAudit ?? true,
      atomicWrite: options.atomicWrite ?? true,
    };
  }

  /**
   * 统一持久化所有关键产物
   *
   * @param artifacts - 产物映射 { prd?: object, contract?: string, state?: object, resume?: string }
   * @returns 每个产物的持久化结果
   */
  async persistAll(artifacts: {
    prd?: unknown;
    contract?: string;
    state?: unknown;
    resume?: string;
  }): Promise<Record<string, PersistResult>> {
    const results: Record<string, PersistResult> = {};

    // 并行持久化所有产物
    const tasks: Promise<void>[] = [];

    if (artifacts.prd !== undefined) {
      tasks.push(
        this.persistPRD(artifacts.prd).then((r) => {
          results.prd = r;
        })
      );
    }

    if (artifacts.contract !== undefined) {
      tasks.push(
        this.persistContract(artifacts.contract).then((r) => {
          results.contract = r;
        })
      );
    }

    if (artifacts.state !== undefined) {
      tasks.push(
        this.persistState(artifacts.state).then((r) => {
          results.state = r;
        })
      );
    }

    if (artifacts.resume !== undefined) {
      tasks.push(
        this.persistResume(artifacts.resume).then((r) => {
          results.resume = r;
        })
      );
    }

    await Promise.all(tasks);
    return results;
  }

  /**
   * 持久化 PRD（prd.json）
   */
  async persistPRD(prd: unknown): Promise<PersistResult> {
    const filePath = path.join(this.azaDir, 'prd.json');
    const content = JSON.stringify(prd, null, 2);
    return this.writeFileWithRetry(filePath, content, 'prd');
  }

  /**
   * 持久化 Contract（contract.md）
   */
  async persistContract(contract: string): Promise<PersistResult> {
    const filePath = path.join(this.azaDir, 'contract.md');
    return this.writeFileWithRetry(filePath, contract, 'contract');
  }

  /**
   * 持久化 STATE.yaml
   */
  async persistState(state: unknown): Promise<PersistResult> {
    const filePath = path.join(this.azaDir, 'STATE.yaml');
    // 使用 js-yaml 序列化
    const yaml = await import('js-yaml');
    const content = yaml.dump(state, { indent: 2 });
    return this.writeFileWithRetry(filePath, content, 'state');
  }

  /**
   * 持久化 RESUME.md
   */
  async persistResume(resume: string): Promise<PersistResult> {
    const filePath = path.join(this.azaDir, 'RESUME.md');
    return this.writeFileWithRetry(filePath, resume, 'resume');
  }

  /**
   * 持久化任意文本产物（如 prd.md、contract.md、competitive-research.md 等）到 .aza/
   * 统一走原子写入 + 校验和 + 重试，保证“文件全保存到对应项目文件夹”且“核心流程无错误”。
   */
  async persistText(fileName: string, content: string, artifactType: string): Promise<PersistResult> {
    const filePath = path.join(this.azaDir, fileName);
    return this.writeFileWithRetry(filePath, content, artifactType);
  }

  /**
   * 持久化 PRD 的 Markdown 渲染（prd.md）——与 persistPRD(prd.json) 配套。
   */
  async persistPrdMarkdown(markdown: string): Promise<PersistResult> {
    return this.persistText('prd.md', markdown, 'prd_md');
  }

  /**
   * 持久化执行契约（contract.md）
   */
  async persistContractText(markdown: string): Promise<PersistResult> {
    return this.persistText('contract.md', markdown, 'contract');
  }

  /**
   * 带重试的文件写入
   */
  private async writeFileWithRetry(
    filePath: string,
    content: string,
    artifactType: string,
  ): Promise<PersistResult> {
    let lastError: string | undefined;
    let retryCount = 0;

    for (let i = 0; i <= this.defaultOptions.maxRetries; i++) {
      try {
        const result = await this.writeFileAtomic(filePath, content);

        // 写入 audit 日志
        if (this.defaultOptions.enableAudit) {
          await this.writeAuditLog({
            type: 'file_persist',
            artifact: artifactType,
            filePath,
            checksum: result.checksum,
            success: true,
            retryCount: i,
          });
        }

        return {
          success: true,
          filePath,
          checksum: result.checksum,
          retryCount: i,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retryCount = i;

        // 等待后重试（指数退避）
        if (i < this.defaultOptions.maxRetries) {
          await this.sleep(Math.pow(2, i) * 100);
        }
      }
    }

    // 所有重试失败
    if (this.defaultOptions.enableAudit) {
      await this.writeAuditLog({
        type: 'file_persist_failed',
        artifact: artifactType,
        filePath,
        error: lastError,
        retryCount,
      }).catch(() => {
        // audit 写入失败不影响主流程
      });
    }

    // R8: 告警通道——确保失败被看到（不阻断主流程）
    this.alert(`File persist failed after ${retryCount + 1} attempts: ${artifactType} → ${filePath}`, {
      artifact: artifactType,
      filePath,
      lastError,
      retryCount,
    });

    return {
      success: false,
      filePath,
      error: lastError,
      retryCount,
    };
  }

  /**
   * 原子写入（先写临时文件，再重命名）
   */
  private async writeFileAtomic(
    filePath: string,
    content: string,
  ): Promise<{ checksum: string }> {
    const tempPath = `${filePath}.tmp`;
    const checksum = this.computeChecksum(content);

    // 确保目录存在
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (this.defaultOptions.atomicWrite) {
      // 原子写入：先写临时文件
      await fs.writeFile(tempPath, content, 'utf8');

      // 验证临时文件
      const tempContent = await fs.readFile(tempPath, 'utf8');
      const tempChecksum = this.computeChecksum(tempContent);
      if (tempChecksum !== checksum) {
        throw new Error(`Checksum mismatch after write: expected ${checksum}, got ${tempChecksum}`);
      }

      // 重命名为目标文件
      await fs.rename(tempPath, filePath);
    } else {
      // 直接写入
      await fs.writeFile(filePath, content, 'utf8');
    }

    // 写入 checksum 文件（如果启用）
    if (this.defaultOptions.enableChecksum) {
      const checksumPath = `${filePath}.checksum`;
      await fs.writeFile(checksumPath, checksum, 'utf8');
    }

    return { checksum };
  }

  /**
   * 计算文件 checksum（SHA256 前 16 位）
   */
  private computeChecksum(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * 验证文件完整性
   */
  async verifyFile(filePath: string): Promise<{ valid: boolean; checksum?: string; error?: string }> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const currentChecksum = this.computeChecksum(content);

      if (this.defaultOptions.enableChecksum) {
        const checksumPath = `${filePath}.checksum`;
        try {
          const savedChecksum = await fs.readFile(checksumPath, 'utf8');
          if (savedChecksum.trim() !== currentChecksum) {
            return {
              valid: false,
              checksum: currentChecksum,
              error: `Checksum mismatch: file may be corrupted`,
            };
          }
        } catch {
          // checksum 文件不存在，跳过验证
        }
      }

      return { valid: true, checksum: currentChecksum };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 写入 audit 日志（JSONL 格式）
   */
  private async writeAuditLog(entry: {
    type: string;
    artifact: string;
    filePath: string;
    checksum?: string;
    error?: string;
    success?: boolean;
    retryCount?: number;
  }): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
      await fs.appendFile(this.auditLogPath, JSON.stringify(logEntry) + '\n', 'utf8');
    } catch {
      // audit 写入失败不影响主流程
    }
  }

  /**
   * 睡眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * R8: 批量校验所有 .aza/ 产物完整性
   * 遍历 prd.json / contract.md / STATE.yaml / RESUME.md 等，
   * 返回每文件的 valid/checksum 状态。
   */
  async verifyAll(): Promise<{
    healthy: boolean;
    artifacts: Array<{ name: string; filePath: string; valid: boolean; error?: string }>;
  }> {
    const files = ['prd.json', 'contract.md', 'STATE.yaml', 'RESUME.md', 'HEARTBEAT.yaml', 'competitive-research.md', 'prd.md'];
    const artifacts: Array<{ name: string; filePath: string; valid: boolean; error?: string }> = [];
    for (const name of files) {
      const filePath = path.join(this.azaDir, name);
      try {
        await fs.access(filePath);
        const result = await this.verifyFile(filePath);
        artifacts.push({ name, filePath, valid: result.valid, error: result.error });
      } catch {
        artifacts.push({ name, filePath, valid: true, error: 'missing' });
      }
    }
    return {
      healthy: artifacts.every((a) => a.valid || a.error === 'missing'),
      artifacts,
    };
  }

  /**
   * R8: 告警通道——落盘失败时调用注册的 alert handler
   * 不阻断主流程，但确保失败被看到
   */
  private alertHandlers: Array<(msg: string, ctx: Record<string, unknown>) => void> = [];

  onAlert(handler: (msg: string, ctx: Record<string, unknown>) => void): void {
    this.alertHandlers.push(handler);
  }

  /**
   * R8: 内部——发出告警（stderr + handlers）
   */
  private alert(message: string, ctx: Record<string, unknown> = {}): void {
    // 1) stderr（必发，避免 silent failure）
    try {
      process.stderr.write(`[azaloop:ALERT] ${message} ${JSON.stringify(ctx)}\n`);
    } catch {
      /* never throw */
    }
    // 2) HEARTBEAT.yaml 写告警字段（best-effort）
    try {
      const heartbeatPath = path.join(this.azaDir, 'HEARTBEAT.yaml');
      if (require('fs').existsSync(heartbeatPath)) {
        const cur = require('fs').readFileSync(heartbeatPath, 'utf8');
        require('fs').writeFileSync(
          heartbeatPath,
          cur + `\n# alert: ${message} @ ${new Date().toISOString()}\n`,
          'utf8',
        );
      }
    } catch {
      /* best-effort */
    }
    // 3) 注册的 handler
    for (const h of this.alertHandlers) {
      try {
        h(message, ctx);
      } catch {
        /* never throw */
      }
    }
  }
}
