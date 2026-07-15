export type StrikeReason =
  | 'assumed_without_verification'
  | 'modified_unrelated_code'
  | 'skipped_tests'
  | 'skipped_security'
  | 'committed_broken_code'
  | 'ignored_spec'
  | 'duplicate_error'
  | 'deadlock_detected'
  | 'red_flag'
  | 'stage_violation'
  | 'recursion_violation'
  // T32 — 4-tier failure classification (ralphy + ruflo)
  | 'auth_error'
  | 'rate_limit_hit'
  | 'transient_failure'
  | 'permanent_failure'
  // T32 — TDD Iron Law violation
  | 'tdd_iron_law_violation';

export type RootCauseCategory = 'syntax_error' | 'test_failure' | 'gate_failure' | 'timeout' | 'config_error' | 'unknown';

/**
 * V21: 8 类根因分类标识 — 用于 3-strike 系统的细粒度根因识别
 */
export type RootCauseCategoryId =
  | 'contract_misread'
  | 'insufficient_context'
  | 'output_format_mismatch'
  | 'tool_misuse'
  | 'state_pollution'
  | 'infinite_loop'
  | 'timeout'
  | 'external_dependency_failure'
  | 'unknown';

/**
 * V21: 8 类根因识别规则表 — 通过 message 文本匹配自动归类
 */
export const ROOT_CAUSE_RULES: Record<Exclude<RootCauseCategoryId, 'unknown'>, { pattern: RegExp; description: string }> = {
  contract_misread: {
    pattern: /(未读|忽略|跳过|missed)\s*(contract|合同|契约|约束|spec|接口)/i,
    description: '宿主 AI 未读或忽略显式 contract 约束',
  },
  insufficient_context: {
    pattern: /(上下文|context|缺少|不够|缺信息)/i,
    description: '上下文不充分导致决策错误',
  },
  output_format_mismatch: {
    pattern: /(格式|format|schema|json|结构)\s*(错误|不符|不对|wrong|mismatch)/i,
    description: '输出格式不符合 schema',
  },
  tool_misuse: {
    pattern: /(工具|tool|API|调用).*(错误|失败|不可用|wrong|fail)/i,
    description: '工具/API 误用',
  },
  state_pollution: {
    pattern: /(状态|state|污染|残留|residual|leak)/i,
    description: '状态污染/残留',
  },
  infinite_loop: {
    pattern: /(死循环|无限|infinite|循环.*不结束|循环.*中断)/i,
    description: '死循环/无限循环',
  },
  timeout: {
    pattern: /(超时|timeout|耗时过长|too long)/i,
    description: '操作超时',
  },
  external_dependency_failure: {
    pattern: /(依赖|网络|api|外部)\s*(失败|不可用|超时|fail|down|中断)/i,
    description: '外部依赖失败',
  },
};

/**
 * V21: 根据错误消息文本识别 8 类根因。
 * 遍历 ROOT_CAUSE_RULES 表，第一条匹配即返回；无匹配返回 'unknown'。
 */
export function identifyRootCause(message: string): RootCauseCategoryId {
  for (const [category, rule] of Object.entries(ROOT_CAUSE_RULES)) {
    if (rule.pattern.test(message)) return category as RootCauseCategoryId;
  }
  return 'unknown';
}

export interface StrikeRecord {
  reason: StrikeReason;
  detail: string;
  timestamp: string;
  iteration: number;
  rootCause?: RootCauseCategory;
}

export class StrikeSystem {
  private strikes: StrikeRecord[] = [];
  private maxStrikes: number;
  private onResumeNeeded?: (reason: string, strikes: StrikeRecord[]) => void;

  constructor(maxStrikes: number = 3, onResumeNeeded?: (reason: string, strikes: StrikeRecord[]) => void) {
    this.maxStrikes = maxStrikes;
    this.onResumeNeeded = onResumeNeeded;
  }

  record(reason: StrikeReason, detail: string, iteration: number, rootCause?: RootCauseCategory): StrikeRecord {
    const record: StrikeRecord = {
      reason,
      detail,
      timestamp: new Date().toISOString(),
      iteration,
      rootCause: rootCause ?? this.classifyRootCause(reason, detail),
    };
    this.strikes.push(record);
    // V12: Trigger RESUME write when max strikes reached
    if (this.isHardStop() && this.onResumeNeeded) {
      this.onResumeNeeded(`3-Strike triggered: ${this.strikes.length} strikes`, this.strikes);
    }
    return record;
  }

  getStrikes(): StrikeRecord[] {
    return [...this.strikes];
  }

  getStrikeCount(): number {
    return this.strikes.length;
  }

  isHardStop(): boolean {
    return this.strikes.length >= this.maxStrikes;
  }

  hasDuplicateError(reason: StrikeReason): boolean {
    const recent = this.strikes.slice(-3);
    return recent.filter(s => s.reason === reason).length >= 2;
  }

  clear(): void {
    this.strikes = [];
  }

  /**
   * V20 Task 13: 启发式根因分类
   */
  classifyRootCause(reason: StrikeReason, detail: string): RootCauseCategory {
    const detailLower = detail.toLowerCase();

    // 语法错误
    if (detailLower.includes('syntax') || detailLower.includes('parse error') || detailLower.includes('unexpected token')) {
      return 'syntax_error';
    }

    // 测试失败
    if (detailLower.includes('test') || detailLower.includes('assertion') || detailLower.includes('expect')) {
      return 'test_failure';
    }

    // 闸门失败
    if (detailLower.includes('gate') || detailLower.includes('check') || detailLower.includes('validation')) {
      return 'gate_failure';
    }

    // 超时
    if (detailLower.includes('timeout') || detailLower.includes('timed out')) {
      return 'timeout';
    }

    // 配置错误
    if (detailLower.includes('config') || detailLower.includes('missing') || detailLower.includes('not found')) {
      return 'config_error';
    }

    // 根据 reason 推断
    if (reason === 'skipped_tests') return 'test_failure';
    if (reason === 'committed_broken_code') return 'syntax_error';
    if (reason === 'ignored_spec') return 'gate_failure';
    if (reason === 'deadlock_detected') return 'timeout';

    return 'unknown';
  }

  /**
   * V20 Task 13: 返回最频繁根因
   */
  getRootCause(): { cause: RootCauseCategory; count: number } | null {
    if (this.strikes.length === 0) return null;

    const counts = new Map<RootCauseCategory, number>();
    for (const strike of this.strikes) {
      const cause = strike.rootCause ?? 'unknown';
      counts.set(cause, (counts.get(cause) ?? 0) + 1);
    }

    let maxCause: RootCauseCategory = 'unknown';
    let maxCount = 0;
    for (const [cause, count] of counts.entries()) {
      if (count > maxCount) {
        maxCause = cause;
        maxCount = count;
      }
    }

    return { cause: maxCause, count: maxCount };
  }

  /**
   * V20 Task 13: 获取 strike 历史（兼容别名）
   */
  getStrikeHistory(): StrikeRecord[] {
    return this.getStrikes();
  }
}
