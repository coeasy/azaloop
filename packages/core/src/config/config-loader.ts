import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AzaloopConfigSchema, type AzaloopConfig } from '@azaloop/shared';

export class ConfigLoader {
  private configPath: string;

  constructor(rootDir: string) {
    this.configPath = path.join(rootDir, 'azaloop.yaml');
  }

  async load(): Promise<AzaloopConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const parsed = yaml.load(content);
      return AzaloopConfigSchema.parse(parsed);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return this.getDefaultConfig();
      }
      throw err;
    }
  }

  async save(config: AzaloopConfig): Promise<void> {
    const content = yaml.dump(config, { indent: 2, lineWidth: 120 });
    await fs.writeFile(this.configPath, content, 'utf8');
  }

  getDefaultConfig(): AzaloopConfig {
    return AzaloopConfigSchema.parse({
      version: '4.0',
      project: {
        name: path.basename(process.cwd()),
        root: '.',
      },
      loop: {
        max_iterations: 50,
        max_stage_iterations: 20,
        outer_enabled: true,
        deadlock_threshold: 3,
        hard_stop_on_security: true,
      },
      memory: {
        enabled: true,
        episodic_max: 100,
        compression_threshold: 50,
      },
      autonomy: {
        level: 'L2',
        auto_approve_prd: false,
      },
      quality: {
        gates: {
          lint: true,
          test: true,
          regression: true,
          security: true,
          acceptance: true,
        },
      },
    });
  }

  /**
   * Synchronous config resolution that ACTUALLY reads `azaloop.yaml` on disk
   * (unlike `getDefaultConfig`, which always returns the hard-coded fallback).
   *
   * R11: 之前所有入口都调用 `getDefaultConfig()`，导致 `azaloop.yaml` 中的
   * `loop` 配置（含 max_stage_iterations / outer_enabled）完全不生效、被默认值
   * 覆盖。这里改为同步读取并解析 yaml；文件缺失或解析失败时安全回退到默认。
   * 注意：此同步版本仅用于非 async 上下文（CLI/MCP 同步构造控制器）。
   */
  loadSync(): AzaloopConfig {
    try {
      const content = fssync.readFileSync(this.configPath, 'utf8');
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') {
        return AzaloopConfigSchema.parse(parsed);
      }
    } catch {
      /* missing file or parse error → fall through to default */
    }
    return this.getDefaultConfig();
  }
}
