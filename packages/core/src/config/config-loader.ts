import * as fs from 'fs/promises';
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
        deadlock_threshold: 3,
        hard_stop_on_security: true,
      },
      memory: {
        enabled: true,
        episodic_max: 100,
        compression_threshold: 50,
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
}
