import * as fs from 'fs/promises';
import * as path from 'path';
import type { RunLedgerEntry } from '../state/run-ledger';

export interface ChainReport {
  detected: boolean;
  pattern: 'data_exfiltration' | 'privilege_escalation' | 'supply_chain' | null;
  entries: RunLedgerEntry[];
  reason: string;
}

export type DlpChainSeverity = 'P0' | 'P1' | 'P2' | 'info';

export interface DlpEventChainReport {
  isChain: boolean;
  chainType?: string;
  severity: DlpChainSeverity;
  description: string;
  evidence: string[];
}

export class DlpChainDetector {
  /**
   * V20 Task 11: 检测 3 类跨步骤攻击模式
   */
  detectChain(entries: RunLedgerEntry[]): ChainReport {
    if (entries.length < 2) {
      return { detected: false, pattern: null, entries: [], reason: '' };
    }

    // 模式 A：步骤 A 写敏感文件 + 步骤 B 读取并发送 = 数据外泄
    const sensitiveWrites = entries.filter(e => 
      e.success && 
      (e.action.includes('write') || e.action.includes('create')) &&
      (e.summary.includes('.env') || e.summary.includes('credential') || e.summary.includes('secret'))
    );
    const networkRequests = entries.filter(e => 
      e.success && 
      (e.action.includes('fetch') || e.action.includes('http') || e.action.includes('request'))
    );
    
    if (sensitiveWrites.length > 0 && networkRequests.length > 0) {
      const writeIdx = entries.indexOf(sensitiveWrites[0]!);
      const networkIdx = entries.indexOf(networkRequests[0]!);
      if (writeIdx < networkIdx) {
        return {
          detected: true,
          pattern: 'data_exfiltration',
          entries: [sensitiveWrites[0]!, networkRequests[0]!],
          reason: 'Sensitive file write followed by network request — potential data exfiltration',
        };
      }
    }

    // 模式 B：步骤 A 修改 guard + 步骤 B 绕过 = 权限提升
    const guardMods = entries.filter(e => 
      e.success && 
      e.summary.includes('guard') && 
      (e.action.includes('modify') || e.action.includes('update'))
    );
    const bypassAttempts = entries.filter(e => 
      !e.success && 
      (e.summary.includes('bypass') || e.summary.includes('skip'))
    );
    
    if (guardMods.length > 0 && bypassAttempts.length > 0) {
      return {
        detected: true,
        pattern: 'privilege_escalation',
        entries: [guardMods[0]!, bypassAttempts[0]!],
        reason: 'Guard modification followed by bypass attempt — potential privilege escalation',
      };
    }

    // 模式 C：步骤 A 添加依赖 + 步骤 B 引入漏洞 = 供应链攻击
    const depAdds = entries.filter(e => 
      e.success && 
      (e.action.includes('install') || e.action.includes('add')) &&
      e.summary.includes('dependency')
    );
    const vulnIntros = entries.filter(e => 
      e.success && 
      (e.summary.includes('vulnerability') || e.summary.includes('CVE'))
    );
    
    if (depAdds.length > 0 && vulnIntros.length > 0) {
      const depIdx = entries.indexOf(depAdds[0]!);
      const vulnIdx = entries.indexOf(vulnIntros[0]!);
      if (depIdx < vulnIdx) {
        return {
          detected: true,
          pattern: 'supply_chain',
          entries: [depAdds[0]!, vulnIntros[0]!],
          reason: 'Dependency addition followed by vulnerability introduction — potential supply chain attack',
        };
      }
    }

    return { detected: false, pattern: null, entries: [], reason: '' };
  }

  /**
   * V20 Task 11: 获取最近 N 条 entries 的链报告
   */
  getChainReport(entries: RunLedgerEntry[], recentCount: number = 20): ChainReport {
    const recent = entries.slice(-recentCount);
    return this.detectChain(recent);
  }

  /**
   * 链式检测：检查一组事件是否构成 DLP 链（事件级抽象）。
   * 与 detectChain(RunLedgerEntry[]) 互补：后者基于 ledger 步骤，
   * 本方法基于类型化的原子事件。
   */
  async detectEventChain(
    events: Array<{ type: string; payload: string; timestamp: number }>,
  ): Promise<DlpEventChainReport> {
    const patterns: Array<{
      chainType: string;
      types: string[];
      severity: 'P0' | 'P1' | 'P2';
      description: string;
    }> = [
      {
        chainType: 'data_exfiltration',
        types: ['read_sensitive', 'encode', 'network_call'],
        severity: 'P0',
        description: '敏感数据读取 → 编码 → 外传链',
      },
      {
        chainType: 'credential_leak',
        types: ['read_secret', 'log_write', 'file_create'],
        severity: 'P0',
        description: '凭证读取 → 日志写入 → 文件创建链',
      },
      {
        chainType: 'prompt_injection',
        types: ['user_input', 'tool_invoke', 'output_stream'],
        severity: 'P1',
        description: '用户输入 → 工具调用 → 输出流向链',
      },
      {
        chainType: 'mcp_poisoning',
        types: ['mcp_call', 'state_modify', 'external_send'],
        severity: 'P1',
        description: 'MCP 调用 → 状态修改 → 外发链',
      },
    ];

    const types = events.map(e => e.type);
    for (const pattern of patterns) {
      if (pattern.types.every(t => types.includes(t))) {
        const matched = events.filter(e => pattern.types.includes(e.type));
        const evidence = matched.map(
          e => `[${e.timestamp}] ${e.type}: ${e.payload.slice(0, 100)}`,
        );
        return {
          isChain: true,
          chainType: pattern.chainType,
          severity: pattern.severity,
          description: pattern.description,
          evidence,
        };
      }
    }
    return {
      isChain: false,
      severity: 'info',
      description: 'no DLP chain detected',
      evidence: [],
    };
  }

  /**
   * 检查单条文件路径是否包含敏感数据模式。
   * 读取失败（如文件不存在、无权限）时按 best-effort 返回 safe。
   */
  async scanFile(filePath: string): Promise<{ sensitive: boolean; patterns: string[] }> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const sensitivePatterns: Array<{ name: string; regex: RegExp }> = [
        { name: 'aws_key', regex: /AKIA[0-9A-Z]{16}/g },
        {
          name: 'private_key',
          regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
        },
        {
          name: 'api_token',
          regex: /[a-zA-Z0-9_-]{32,}\.(amazonaws|googleapis|azure)\.com/g,
        },
        {
          name: 'password_inline',
          regex: /(password|passwd|pwd)\s*[:=]\s*['"]\S+['"]/gi,
        },
        {
          name: 'jwt_token',
          regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
        },
      ];
      const found: string[] = [];
      for (const p of sensitivePatterns) {
        if (p.regex.test(content)) found.push(p.name);
        p.regex.lastIndex = 0; // reset lastIndex due to /g flag
      }
      return { sensitive: found.length > 0, patterns: found };
    } catch {
      return { sensitive: false, patterns: [] };
    }
  }

  /**
   * 扫描整个目录（best-effort，递归层级 1，子目录跳过）。
   */
  async scanDir(
    dir: string,
    options: { maxFiles?: number; extensions?: string[] } = {},
  ): Promise<Array<{ file: string; sensitive: boolean; patterns: string[] }>> {
    const results: Array<{ file: string; sensitive: boolean; patterns: string[] }> = [];
    const maxFiles = options.maxFiles ?? 100;
    const exts = options.extensions ?? [
      '.ts',
      '.js',
      '.json',
      '.md',
      '.env',
      '.yaml',
      '.yml',
    ];
    try {
      const files = await fs.readdir(dir);
      let count = 0;
      for (const f of files) {
        if (count >= maxFiles) break;
        if (!exts.some(ext => f.endsWith(ext))) continue;
        const fp = path.join(dir, f);
        const stat = await fs.stat(fp);
        if (stat.isDirectory()) continue;
        const r = await this.scanFile(fp);
        results.push({ file: fp, ...r });
        count++;
      }
    } catch {
      /* best-effort: directory unreadable returns empty */
    }
    return results;
  }
}
