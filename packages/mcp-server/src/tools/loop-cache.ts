/**
 * R12 P6 Plus11 (P1 主链路拆分第11轮) — 统一 Mtime-aware Cache 管理器。
 *
 * 借鉴 comet「file-watcher cache invalidation」+ spec-kit「mtime-based refresh」：
 * 把 aza-loop.ts 中 3 个 build* 函数（buildController / buildDriver / buildScheduler）
 * 重复的 cache + mtime 失效模式抽到统一 CacheStore。
 *
 * 统一行为：
 * 1. 跨客户端隔离键：client::root（避免同一进程内多客户端共享状态）
 * 2. Mtime 失效：STATE.yaml mtime 变化时自动 drop cache（跨 session/客户端写入）
 * 3. 失败级联：主 cache 失效时清空相关 caches（e.g. controller 失效时 driver/scheduler 也失效）
 * 4. 工厂回调：buildFn 闭包持有实际创建逻辑，cache miss 时调用
 *
 * 借鉴 ruflo「3-tier cache」：
 *   - controllerCache (root state)
 *   - driverCache (controller 派生)
 *   - schedulerCache (controller 派生)
 * 三者强一致：任一失效都触发级联。
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * 跨客户端隔离键：client::root，避免同一进程内多客户端共享同一份内存循环状态。
 */
export function cacheKey(root: string, client?: string): string {
  return client ? `${client}::${root}` : root;
}

/**
 * 读取 STATE.yaml mtime（0 表示文件不存在）。
 */
export function stateYamlMtime(root: string): number {
  try {
    return fs.statSync(path.join(root, '.aza', 'STATE.yaml')).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * CacheStore 配置：定义 cache 名称 + 工厂函数 + 级联失效列表。
 */
export interface CacheEntryConfig<T> {
  /** cache 名称（用于日志/调试） */
  name: string;
  /** cache 实例 Map（外部持有，便于兼容性） */
  cache: Map<string, T>;
  /** 工厂函数：cache miss 时调用 */
  build: () => T;
  /**
   * 级联失效：mtime 变化时同时清空这些 cache 的同一 key。
   * 例如 controller 失效时也清空 driver/scheduler，确保三 cache 强一致。
   */
  cascadeCaches?: Array<Map<string, unknown>>;
  /** 命中后是否需要做后置初始化 */
  onHit?: (instance: T) => void;
}

/**
 * 通用 cache 获取函数：检查 cache + mtime 失效 + 工厂构造 + 缓存。
 *
 * @param key 缓存键（含 client 隔离）
 * @param mtime 当前 STATE.yaml mtime
 * @param stateMtimeCache 上次已知的 mtime Map
 * @param config cache 配置
 * @returns 缓存或新构造的实例
 */
export function getOrBuild<T>(
  key: string,
  mtime: number,
  stateMtimeCache: Map<string, number>,
  config: CacheEntryConfig<T>,
): T {
  const cached = config.cache.get(key);
  if (cached) {
    const prev = stateMtimeCache.get(key) ?? 0;
    if (prev && mtime && mtime !== prev) {
      // Disk changed outside this process (other client/session) — drop cache + cascade
      config.cache.delete(key);
      if (config.cascadeCaches) {
        for (const cascade of config.cascadeCaches) {
          cascade.delete(key);
        }
      }
      stateMtimeCache.set(key, mtime);
    } else {
      stateMtimeCache.set(key, mtime);
      if (config.onHit) config.onHit(cached);
      return cached;
    }
  }
  const instance = config.build();
  config.cache.set(key, instance);
  stateMtimeCache.set(key, mtime);
  return instance;
}

/**
 * 级联失效：删除一个 key 在多个 cache 中的所有记录。
 *
 * 用于：controller 失效时，同时清空 driver / scheduler cache。
 */
export function invalidateAcross<T>(key: string, caches: Array<Map<string, T>>): void {
  for (const cache of caches) {
    cache.delete(key);
  }
}

/**
 * 清空指定 root 的所有 cache（保留其他 root）。
 */
export function clearRootCaches(
  root: string,
  caches: Array<Map<string, any>>,
): void {
  for (const cache of caches) {
    for (const key of [...cache.keys()]) {
      if (key === root || key.endsWith(`::${root}`)) {
        cache.delete(key);
      }
    }
  }
}

/**
 * 清空所有 cache（reset all）。
 */
export function clearAllCaches(caches: Array<Map<string, any>>): void {
  for (const cache of caches) {
    cache.clear();
  }
}
