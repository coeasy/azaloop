import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigLoader } from '@azaloop/core';

export interface UpgradeOptions {
  from?: string;
  root?: string;
}

export async function upgradeCommand(options: UpgradeOptions = {}): Promise<void> {
  const root = options.root || process.cwd();
  const from = options.from || 'v8';

  console.log(`\n  Upgrading from ${from} to v4...`);

  const azaDir = path.join(root, '.aza');
  const oldDirs = {
    v8: path.join(root, '.aza-v8'),
    v9: path.join(root, '.aza-v9'),
  };

  // Check for old version indicators
  let foundOld = false;
  for (const [ver, dir] of Object.entries(oldDirs)) {
    try {
      await fs.access(dir);
      console.log(`  ✓ Found ${ver} project at ${dir}`);
      foundOld = true;
    } catch {
      // Directory doesn't exist
    }
  }

  if (!foundOld) {
    console.log(`  No old version (v8/v9) project detected, skipping migration.`);
  }

  // Ensure .aza directory exists
  await fs.mkdir(azaDir, { recursive: true });

  // Generate STATE.yaml
  const defaultState = {
    pipeline: {
      current_stage: 'open',
      stages: {
        open: { status: 'pending' },
        design: { status: 'pending' },
        build: { status: 'pending' },
        verify: { status: 'pending' },
        archive: { status: 'pending' },
      },
    },
    loop: {
      iteration: 0,
      progress: '0%',
      client: 'unknown',
      model: 'unknown',
      max_iterations: 50,
    },
    memory: { semantic_keys: [] },
    security_findings: [],
    strikes: 0,
    updated_at: new Date().toISOString(),
  };

  const yaml = require('js-yaml');
  await fs.writeFile(
    path.join(azaDir, 'STATE.yaml'),
    yaml.dump(defaultState, { indent: 2 }),
    'utf8'
  );
  console.log('  ✓ Created .aza/STATE.yaml');

  // Create azaloop.yaml if it doesn't exist
  const configLoader = new ConfigLoader(root);
  try {
    await configLoader.load();
    console.log('  ✓ azaloop.yaml already exists');
  } catch {
    await configLoader.save(configLoader.getDefaultConfig());
    console.log('  ✓ Created azaloop.yaml');
  }

  console.log(`\n  ✓ Upgrade complete! Run 'aza init' to configure your client.\n`);
}
