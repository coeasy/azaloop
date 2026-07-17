/**
 * AzaMeta Action Context — 统一 meta sub_action handler 上下文接口。
 *
 * 借鉴 spec-kit「action registry」+ aza-loop-actions 模式：
 * 所有 meta sub_action handler 接收 `MetaActionContext`，
 * 通过 `args.sub_action` 决定具体行为，返回 `unknown` payload
 * （meta 不强约束 LoopResponse，因为部分子命令是 side-effect only）。
 */
export interface MetaActionContext {
  /** 完整参数对象（含 sub_action） */
  args: Record<string, unknown>;
  /** 工作区根路径 */
  workspace: string;
  /** .aza 目录绝对路径 */
  azaDir: string;
  /** 原始 action 名称（来自上层 dispatch） */
  action?: string;
}

/**
 * MetaAction handler 函数签名。
 *
 * 与 aza-loop-actions 不同，meta handlers 返回 `unknown`（不强制 LoopResponse）
 * 因为部分子命令（如 dlp_scan）只关心 passed/findings，next_action 不重要。
 */
export type MetaActionHandler = (ctx: MetaActionContext) => unknown | Promise<unknown>;

/**
 * 构造 MetaActionContext 的 helper。
 */
export function buildMetaContext(
  args: Record<string, unknown>,
  workspace?: string,
  action?: string,
): MetaActionContext {
  const root = workspace || (args.workspace_path as string) || process.cwd();
  return {
    args,
    workspace: root,
    azaDir: root.endsWith('/') || root.endsWith('\\')
      ? `${root}.aza`
      : `${root}/.aza`,
    action,
  };
}
