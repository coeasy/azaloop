import * as fs from 'fs/promises';
import * as path from 'path';

export interface Heartbeat {
  session_id: string;
  client: string;
  model: string;
  started_at: string;
  last_active_at: string;
  iteration: number;
  current_story?: string;
}

export interface HeartbeatStatus {
  exists: boolean;
  is_stale: boolean;
  stale_duration_ms: number;
  heartbeat: Heartbeat | null;
}

export class HeartbeatManager {
  private heartbeatPath: string;
  private staleThresholdMs: number;

  constructor(azaDir: string, staleThresholdMs: number = 300000) { // 5 minutes default
    this.heartbeatPath = path.join(azaDir, 'HEARTBEAT.yaml');
    this.staleThresholdMs = staleThresholdMs;
  }

  async write(heartbeat: Heartbeat): Promise<void> {
    const yaml = stringifyHeartbeat(heartbeat);
    await fs.writeFile(this.heartbeatPath, yaml, 'utf8');
  }

  async read(): Promise<Heartbeat | null> {
    try {
      const content = await fs.readFile(this.heartbeatPath, 'utf8');
      return parseHeartbeat(content);
    } catch {
      return null;
    }
  }

  async touch(updates: Partial<Heartbeat>): Promise<void> {
    const current = await this.read();
    if (!current) return;
    await this.write({ ...current, ...updates, last_active_at: new Date().toISOString() });
  }

  /**
   * 检查心跳是否过期
   */
  async isStale(): Promise<boolean> {
    const status = await this.getStatus();
    return status.is_stale;
  }

  /**
   * 获取心跳状态详情
   */
  async getStatus(): Promise<HeartbeatStatus> {
    const heartbeat = await this.read();
    
    if (!heartbeat) {
      return {
        exists: false,
        is_stale: true,
        stale_duration_ms: 0,
        heartbeat: null,
      };
    }

    const lastActive = new Date(heartbeat.last_active_at).getTime();
    const now = Date.now();
    const staleDurationMs = now - lastActive;

    return {
      exists: true,
      is_stale: staleDurationMs > this.staleThresholdMs,
      stale_duration_ms: staleDurationMs,
      heartbeat,
    };
  }

  /**
   * 清除过期的心跳（用于清理孤儿会话）
   */
  async clearIfStale(): Promise<boolean> {
    const status = await this.getStatus();
    if (status.is_stale && status.heartbeat) {
      await this.clear();
      return true;
    }
    return false;
  }

  /**
   * 清除心跳文件
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.heartbeatPath);
    } catch {
      // File doesn't exist
    }
  }

  getPath(): string {
    return this.heartbeatPath;
  }
}

function stringifyHeartbeat(h: Heartbeat): string {
  const lines = [
    `session_id: ${h.session_id}`,
    `client: ${h.client}`,
    `model: ${h.model}`,
    `started_at: ${h.started_at}`,
    `last_active_at: ${h.last_active_at}`,
    `iteration: ${h.iteration}`,
  ];
  if (h.current_story) {
    lines.push(`current_story: ${h.current_story}`);
  }
  return lines.join('\n') + '\n';
}

function parseHeartbeat(content: string): Heartbeat {
  const lines = content.trim().split('\n');
  const data: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(': ');
    if (idx !== -1) {
      data[line.slice(0, idx).trim()] = line.slice(idx + 2).trim();
    }
  }
  return {
    session_id: data['session_id'] || '',
    client: data['client'] || '',
    model: data['model'] || '',
    started_at: data['started_at'] || '',
    last_active_at: data['last_active_at'] || '',
    iteration: parseInt(data['iteration'] || '0', 10),
    current_story: data['current_story'],
  };
}
