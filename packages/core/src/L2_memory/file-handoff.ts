import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * V20 Task 8: 文件交接机制 — 各角色通过文件传递产物，减少上下文 token
 *
 * 文件路径约定：.aza/handoffs/<stage>-brief.json / <stage>-report.json / <stage>-review.json
 */
export class FileHandoff {
  constructor(private handoffDir: string) {
    // handoffDir = .aza/handoffs/
  }

  /** 写入任务简报（上游产物） */
  async writeTaskBrief(stage: string, data: unknown): Promise<string> {
    const filePath = path.join(this.handoffDir, `${stage}-brief.json`);
    await this.backupBeforeWrite(filePath);
    await this.writeJson(filePath, data);
    return filePath;
  }

  /** 写入报告（Maker 产物） */
  async writeReport(stage: string, data: unknown): Promise<string> {
    const filePath = path.join(this.handoffDir, `${stage}-report.json`);
    await this.backupBeforeWrite(filePath);
    await this.writeJson(filePath, data);
    return filePath;
  }

  /** 写入审查包（Checker 输入） */
  async writeReviewPackage(stage: string, data: unknown): Promise<string> {
    const filePath = path.join(this.handoffDir, `${stage}-review.json`);
    await this.backupBeforeWrite(filePath);
    await this.writeJson(filePath, data);
    return filePath;
  }

  /** 读取上游产物（Checker 启动时调） */
  async readHandoff(stage: string): Promise<unknown | null> {
    // 尝试读取 report.json（优先）
    const reportPath = path.join(this.handoffDir, `${stage}-report.json`);
    if (await this.validateJson(reportPath)) {
      try {
        const content = await fs.readFile(reportPath, 'utf8');
        return JSON.parse(content);
      } catch {
        // 损坏，回退到 brief.json
      }
    }

    // 回退到 brief.json
    const briefPath = path.join(this.handoffDir, `${stage}-brief.json`);
    if (await this.validateJson(briefPath)) {
      try {
        const content = await fs.readFile(briefPath, 'utf8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    }

    return null;
  }

  /** 写入前备份（防损坏） */
  async backupBeforeWrite(filePath: string): Promise<void> {
    try {
      if (await fs.access(filePath).then(() => true).catch(() => false)) {
        const backupPath = `${filePath}.bak`;
        await fs.copyFile(filePath, backupPath);
      }
    } catch {
      // best-effort
    }
  }

  /** JSON 完整性校验 */
  async validateJson(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }

  /** 私有：写入 JSON */
  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(this.handoffDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

/**
 * V20 增强：基于角色的结构化交接记录。
 *
 * 与 {@link FileHandoff}（按 stage 命名）不同，HandoffRecord
 * 通过 `from_role → to_role` 的命名空间来区分多条交接，
 * 适用于角色密集的子任务编排。
 */
export interface HandoffRecord {
  from_role: string;
  to_role: string;
  artifact: string;
  timestamp: string;
  data: unknown;
}

/**
 * 将交接记录写入 `<azaDir>/handoffs/<from>_to_<to>_<ts>.json`。
 * 目录不存在时自动创建。
 *
 * @returns 实际写入的文件绝对路径。
 */
export async function writeHandoff(
  azaDir: string,
  record: HandoffRecord,
): Promise<string> {
  try {
    const dir = path.join(azaDir, 'handoffs');
    await fs.mkdir(dir, { recursive: true });
    const filename = `${record.from_role}_to_${record.to_role}_${Date.now()}.json`;
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, JSON.stringify(record, null, 2), 'utf8');
    return filepath;
  } catch {
    // best-effort：失败时仍返回预期路径，调用方可自行决定如何处理
    return path.join(azaDir, 'handoffs', `${record.from_role}_to_${record.to_role}_${Date.now()}.json`);
  }
}

/**
 * 按文件名读取单条交接记录。文件不存在或 JSON 损坏时返回 `null`。
 */
export async function readHandoff(azaDir: string, filename: string): Promise<HandoffRecord | null> {
  try {
    const filepath = path.join(azaDir, 'handoffs', filename);
    const content = await fs.readFile(filepath, 'utf8');
    const parsed = JSON.parse(content) as HandoffRecord;
    if (!parsed || typeof parsed.from_role !== 'string' || typeof parsed.to_role !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 列出所有交接记录。可按 `toRole` 过滤（接收方角色）。
 * 目录不存在时返回空数组。
 */
export async function listHandoffs(azaDir: string, toRole?: string): Promise<HandoffRecord[]> {
  try {
    const dir = path.join(azaDir, 'handoffs');
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const records: HandoffRecord[] = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
      const r = await readHandoff(azaDir, f);
      if (r && (!toRole || r.to_role === toRole)) records.push(r);
    }
    return records;
  } catch {
    return [];
  }
}
