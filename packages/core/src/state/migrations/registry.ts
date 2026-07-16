/**
 * R10 第7轮 (D7)：迁移注册表 — 集中声明可用 schema 迁移。
 *
 * 原先 `state-manager.migrateState()` 通过动态 import 探测迁移文件，
 * 无法在调用前回答「支持哪些版本迁移」「是否需要迁移」等问题。
 * 本注册表集中声明每个迁移的 from/to 版本与 transformer，
 * 供 `validateVersion()` / `loadWithMigration()` 等查询使用。
 *
 * 添加新迁移时：
 *   1. 新建 `migrations/v{N}-to-v{N+1}.ts`，导出默认 transformer
 *   2. 在本文件 `MIGRATIONS` 数组追加一项
 *   3. 在 state-manager.ts 提升 `CURRENT_STATE_VERSION`
 */

export interface MigrationDescriptor {
  /** 源 schema 版本（整数，对应 STATE.yaml.schema_version） */
  from: number;
  /** 目标 schema 版本 */
  to: number;
  /** 迁移文件相对路径（供动态 import 使用） */
  modulePath: string;
  /** 该迁移做了什么（人类可读说明，便于审计） */
  description: string;
}

/**
 * 当前已注册的迁移清单。
 *
 * 顺序按 from 升序排列。`migrateState()` 会按需链式应用。
 */
export const MIGRATIONS: readonly MigrationDescriptor[] = [
  {
    from: 1,
    to: 2,
    modulePath: './v1-to-v2',
    description: 'Add schema_version=2 and pipeline.completion_gate.required_phases=[]',
  },
] as const;

/**
 * 返回当前已知的最高 schema 版本。
 * 等价于 `state-manager.CURRENT_STATE_VERSION`，但无需实例化 StateManager。
 */
export function getLatestSchemaVersion(): number {
  let max = 1;
  for (const m of MIGRATIONS) {
    if (m.to > max) max = m.to;
  }
  return max;
}

/**
 * 判断从 `fromVersion` 到 `toVersion` 是否存在完整迁移链。
 *
 * 用于 `validateVersion()` 提前判断「能否自动迁移」，
 * 避免 `migrateState()` 在运行时才发现链路断裂。
 */
export function hasMigrationPath(fromVersion: number, toVersion: number): boolean {
  if (fromVersion >= toVersion) return true; // no-op
  let current = fromVersion;
  while (current < toVersion) {
    const next = MIGRATIONS.find((m) => m.from === current);
    if (!next) return false;
    current = next.to;
  }
  return true;
}

/**
 * 返回从 `fromVersion` 到 `toVersion` 所需的迁移步骤清单。
 * 若链路不完整，返回空数组（调用方应改用 `hasMigrationPath` 预判）。
 */
export function getMigrationPath(
  fromVersion: number,
  toVersion: number,
): readonly MigrationDescriptor[] {
  if (fromVersion >= toVersion) return [];
  const steps: MigrationDescriptor[] = [];
  let current = fromVersion;
  while (current < toVersion) {
    const next = MIGRATIONS.find((m) => m.from === current);
    if (!next) return [];
    steps.push(next);
    current = next.to;
  }
  return steps;
}
