import type { SecurityFinding } from './secret';

/**
 * Prompt injection rule definition.
 */
export interface InjectionRule {
  /** Unique rule identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Regex pattern to match the injection. */
  pattern: RegExp;
  /** Language of the rule (zh / en). */
  lang: 'zh' | 'en';
  /** Severity level. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Risk score contribution (0-100). */
  risk_score: number;
  /** Category of the injection. */
  category: 'instruction_override' | 'role_hijack' | 'hide_from_user' | 'secret_access' | 'invisible_char' | 'jailbreak';
}

/**
 * Extended security finding with prompt-injection-specific metadata.
 */
export interface PromptInjectionFinding extends SecurityFinding {
  type: 'prompt_injection';
  rule_id: string;
  category: InjectionRule['category'];
  risk_score: number;
  matched_text: string;
}

/**
 * Result of a prompt injection scan including aggregated risk score.
 */
export interface PromptInjectionScanResult {
  findings: PromptInjectionFinding[];
  total_risk_score: number;
  risk_level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 37 injection rules — 20 Chinese + 17 English.
 * Covers: hidden instructions, invisible characters, "hide from user", secret file access, jailbreak, role hijack.
 */
const INJECTION_RULES: InjectionRule[] = [
  // ===== Chinese rules (20) =====
  {
    id: 'PI-ZH-001',
    description: '忽略之前的指令 (instruction override)',
    pattern: /忽略(?:之前|上面|以前|前述)(?:的)?(?:指令|提示|规则|内容|所有)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 90,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-002',
    description: '忽略以上内容 (ignore above)',
    pattern: /忽略(?:以上|上述|前面)(?:内容|文字|信息|所有内容)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 88,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-003',
    description: '忘记系统提示 (forget system prompt)',
    pattern: /(?:忘记|清除|抹除|重置)(?:你的)?(?:系统提示|系统指令|初始设定|系统设定)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 92,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-004',
    description: '角色劫持 — 你现在是一个 (role hijack)',
    pattern: /你(?:现在|从现在起|以后)(?:是|扮演|变成|切换为)(?:一个|一名)?/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 75,
    category: 'role_hijack',
  },
  {
    id: 'PI-ZH-005',
    description: '不用遵守规则 (bypass rules)',
    pattern: /(?:不用|不需要|不必|可以不)(?:遵守|遵循|执行|理会)(?:规则|限制|约束|安全)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 85,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-006',
    description: '不要告诉用户 (hide from user)',
    pattern: /(?:不要|别|不可|禁止)(?:告诉|告知|通知|透露)(?:用户|使用者|人|对方)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 80,
    category: 'hide_from_user',
  },
  {
    id: 'PI-ZH-007',
    description: '隐藏这段内容 (hide content)',
    pattern: /(?:隐藏|藏起来|不显示|屏蔽)(?:这段|这些|此|该)(?:内容|文字|信息|指令)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 70,
    category: 'hide_from_user',
  },
  {
    id: 'PI-ZH-008',
    description: '对用户保密 (keep secret from user)',
    pattern: /(?:对|向)(?:用户|使用者)(?:保密|隐瞒|不透露|不公开)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 72,
    category: 'hide_from_user',
  },
  {
    id: 'PI-ZH-009',
    description: '不要向用户展示 (do not show user)',
    pattern: /(?:不要|别|不可)(?:向|给)(?:用户|使用者)(?:展示|显示|呈现|说明)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 68,
    category: 'hide_from_user',
  },
  {
    id: 'PI-ZH-010',
    description: '假装你是 (pretend role)',
    pattern: /(?:假装|假定|假设|模拟)你(?:是|为|扮演)/i,
    lang: 'zh',
    severity: 'medium',
    risk_score: 55,
    category: 'role_hijack',
  },
  {
    id: 'PI-ZH-011',
    description: '切换到模式 (switch mode)',
    pattern: /(?:切换|进入|开启)(?:到)?(?:开发者|管理员|root|超级用户|god|越狱|jailbreak)(?:模式|状态)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 95,
    category: 'jailbreak',
  },
  {
    id: 'PI-ZH-012',
    description: '越狱 (jailbreak)',
    pattern: /(?:越狱|破解|解锁(?:限制|安全|防护))/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 93,
    category: 'jailbreak',
  },
  {
    id: 'PI-ZH-013',
    description: '绕过安全 (bypass safety)',
    pattern: /(?:绕过|避开|突破|绕开)(?:安全|防护|限制|检测|过滤|审查)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 90,
    category: 'jailbreak',
  },
  {
    id: 'PI-ZH-014',
    description: '读取密码文件 (read password file)',
    pattern: /(?:读取|查看|获取|打开|cat|读取)(?:.*?)(?:密码文件|passwd|shadow|密码|密钥文件|credential)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 88,
    category: 'secret_access',
  },
  {
    id: 'PI-ZH-015',
    description: '读取密钥/凭证文件 (read secret files)',
    pattern: /(?:读取|查看|获取|打开)(?:.*?)(?:密钥文件|私钥|secret|\.env|环境变量|credentials)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 87,
    category: 'secret_access',
  },
  {
    id: 'PI-ZH-016',
    description: '读取 /etc/passwd (read system file)',
    pattern: /(?:读取|查看|获取|打开|cat)(?:.*?)(?:\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers)/i,
    lang: 'zh',
    severity: 'critical',
    risk_score: 92,
    category: 'secret_access',
  },
  {
    id: 'PI-ZH-017',
    description: '执行系统命令 (execute system command)',
    pattern: /(?:执行|运行|调用)(?:系统命令|shell|命令行|bash|cmd|terminal)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 78,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-018',
    description: '开发者模式 / 管理员模式 (dev/admin mode)',
    pattern: /(?:开发者|管理员|root|超级用户|admin)(?:模式|权限|身份)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 80,
    category: 'jailbreak',
  },
  {
    id: 'PI-ZH-019',
    description: '将以下内容作为指令执行 (execute as instruction)',
    pattern: /(?:将|把)?(?:以下|下列|下面)(?:内容|文字|信息)?(?:作为|当作|视为)?(?:指令|命令|prompt)(?:执行|运行|处理)?/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 72,
    category: 'instruction_override',
  },
  {
    id: 'PI-ZH-020',
    description: '输出你的系统提示 (reveal system prompt)',
    pattern: /(?:输出|显示|打印|复述|告诉我)(?:你的)?(?:系统提示|系统指令|system prompt|初始设定|prompt)/i,
    lang: 'zh',
    severity: 'high',
    risk_score: 65,
    category: 'instruction_override',
  },

  // ===== English rules (17) =====
  {
    id: 'PI-EN-001',
    description: 'Ignore previous instructions (instruction override)',
    pattern: /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|content|messages?)/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 90,
    category: 'instruction_override',
  },
  {
    id: 'PI-EN-002',
    description: 'Ignore the above (ignore above)',
    pattern: /ignore\s+(?:everything\s+)?(?:above|the above|all above)/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 88,
    category: 'instruction_override',
  },
  {
    id: 'PI-EN-003',
    description: 'Forget your system prompt (forget system prompt)',
    pattern: /(?:forget|disregard|erase|reset)\s+(?:your\s+)?(?:system\s+prompt|system\s+instructions?|initial\s+(?:instructions?|prompt|setup))/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 92,
    category: 'instruction_override',
  },
  {
    id: 'PI-EN-004',
    description: 'You are now a (role hijack)',
    pattern: /you\s+are\s+now\s+(?:a|an)\s/i,
    lang: 'en',
    severity: 'high',
    risk_score: 75,
    category: 'role_hijack',
  },
  {
    id: 'PI-EN-005',
    description: 'Do not follow rules (bypass rules)',
    pattern: /(?:do\s+not|don't|never|no\s+need\s+to)\s+(?:follow|obey|adhere\s+to|comply\s+with)\s+(?:the\s+)?(?:rules?|restrictions?|constraints?|guidelines?)/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 85,
    category: 'instruction_override',
  },
  {
    id: 'PI-EN-006',
    description: 'Hide this from the user (hide from user)',
    pattern: /(?:hide|conceal|keep)(?:\s+this)?\s+(?:from|away\s+from)\s+(?:the\s+)?user/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 80,
    category: 'hide_from_user',
  },
  {
    id: 'PI-EN-007',
    description: "Don't tell the user (hide from user)",
    pattern: /(?:don't|do\s+not|never)\s+(?:tell|inform|notify|reveal\s+to)\s+(?:the\s+)?user/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 82,
    category: 'hide_from_user',
  },
  {
    id: 'PI-EN-008',
    description: 'Do not show the user (hide from user)',
    pattern: /(?:do\s+not|don't|never)\s+(?:show|display|present|reveal)(?:\s+this)?\s+to\s+(?:the\s+)?user/i,
    lang: 'en',
    severity: 'high',
    risk_score: 70,
    category: 'hide_from_user',
  },
  {
    id: 'PI-EN-009',
    description: 'Act as if you are (pretend role)',
    pattern: /(?:act|pretend|simulate)\s+as\s+if\s+you\s+are/i,
    lang: 'en',
    severity: 'medium',
    risk_score: 55,
    category: 'role_hijack',
  },
  {
    id: 'PI-EN-010',
    description: 'Switch to developer mode (switch mode)',
    pattern: /(?:switch\s+(?:to\s+)?|enter|enable|activate)\s+(?:developer|admin|root|god|jailbreak|DAN)\s*mode/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 95,
    category: 'jailbreak',
  },
  {
    id: 'PI-EN-011',
    description: 'Jailbreak (jailbreak)',
    pattern: /jailbreak|jail\s*break|DAN\s+mode|do\s+anything\s+now/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 93,
    category: 'jailbreak',
  },
  {
    id: 'PI-EN-012',
    description: 'Bypass safety (bypass safety)',
    pattern: /(?:bypass|circumvent|evade|break\s+through)\s+(?:safety|security|restrictions?|filters?|guardrails?)/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 90,
    category: 'jailbreak',
  },
  {
    id: 'PI-EN-013',
    description: 'Read the password file (read password file)',
    pattern: /(?:read|cat|view|access|open|get)\s+(?:the\s+)?(?:password|passwd|shadow)\s*(?:file)?/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 88,
    category: 'secret_access',
  },
  {
    id: 'PI-EN-014',
    description: 'Read secret files (read secret files)',
    pattern: /(?:read|cat|view|access|open|get)\s+(?:the\s+)?(?:secret|private\s+key|\.env|credentials?)\s*(?:file|files)?/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 87,
    category: 'secret_access',
  },
  {
    id: 'PI-EN-015',
    description: 'Read /etc/passwd (read system file)',
    pattern: /(?:read|cat|view|access|open)\s+(?:\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers)/i,
    lang: 'en',
    severity: 'critical',
    risk_score: 92,
    category: 'secret_access',
  },
  {
    id: 'PI-EN-016',
    description: 'Execute system commands (execute system command)',
    pattern: /(?:execute|run|call)\s+(?:system\s+commands?|shell|bash|cmd|terminal\s+commands?)/i,
    lang: 'en',
    severity: 'high',
    risk_score: 78,
    category: 'instruction_override',
  },
  {
    id: 'PI-EN-017',
    description: 'Reveal your system prompt (reveal system prompt)',
    pattern: /(?:output|print|show|display|repeat|tell\s+me)\s+(?:your\s+)?(?:system\s+(?:prompt|instructions?)|initial\s+(?:instructions?|prompt|setup))/i,
    lang: 'en',
    severity: 'high',
    risk_score: 65,
    category: 'instruction_override',
  },
];

/**
 * Invisible / zero-width character ranges used to hide instructions.
 * - U+200B (Zero Width Space)
 * - U+200C (Zero Width Non-Joiner)
 * - U+200D (Zero Width Joiner)
 * - U+200E (Left-to-Right Mark)
 * - U+200F (Right-to-Left Mark)
 * - U+2060 (Word Joiner)
 * - U+2061-U+2064 (Invisible math operators)
 * - U+FEFF (BOM / Zero Width No-Break Space)
 * - U+00AD (Soft Hyphen)
 * - U+3164 (Hangul Filler)
 * - U+FFA0 (Halfwidth Hangul Filler)
 * - U+2800 (Braille Pattern Blank)
 */
const INVISIBLE_CHAR_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u3164\uFFA0\u2800]/;

/**
 * Total number of injection rules (should be 37: 20 zh + 17 en).
 */
export const INJECTION_RULE_COUNT = INJECTION_RULES.length;

/**
 * Scan content for prompt injection attempts.
 * Returns findings with risk scoring.
 *
 * @param content - The text content to scan (prompt, user message, tool description, etc.)
 * @param source - The source identifier (file path, tool name, message id).
 * @returns Scan result with findings and aggregated risk score.
 */
export function scanPromptInjection(
  content: string,
  source: string,
): PromptInjectionScanResult {
  const findings: PromptInjectionFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Check all injection rules
    for (const rule of INJECTION_RULES) {
      const match = line.match(rule.pattern);
      if (match) {
        findings.push({
          type: 'prompt_injection',
          severity: rule.severity,
          file: source,
          line: i + 1,
          description: rule.description,
          rule_id: rule.id,
          category: rule.category,
          risk_score: rule.risk_score,
          matched_text: match[0],
        });
      }
    }

    // Check for invisible characters
    if (INVISIBLE_CHAR_PATTERN.test(line)) {
      findings.push({
        type: 'prompt_injection',
        severity: 'high',
        file: source,
        line: i + 1,
        description: 'Invisible/zero-width character detected (possible hidden instruction)',
        rule_id: 'PI-INVISIBLE-001',
        category: 'invisible_char',
        risk_score: 75,
        matched_text: 'zero-width-char',
      });
    }
  }

  // Aggregate risk score (cap at 100, sum then clamp)
  const rawScore = findings.reduce((sum, f) => sum + f.risk_score, 0);
  const totalRiskScore = Math.min(rawScore, 100);

  const riskLevel = determineRiskLevel(totalRiskScore, findings);

  return {
    findings,
    total_risk_score: totalRiskScore,
    risk_level: riskLevel,
  };
}

/**
 * Determine overall risk level from score and findings.
 */
function determineRiskLevel(
  score: number,
  findings: PromptInjectionFinding[],
): PromptInjectionScanResult['risk_level'] {
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');

  if (hasCritical || score >= 80) return 'critical';
  if (hasHigh || score >= 60) return 'high';
  if (score >= 30) return 'medium';
  if (score > 0) return 'low';
  return 'safe';
}

/**
 * Get all injection rules (for inspection / documentation).
 */
export function getInjectionRules(): InjectionRule[] {
  return [...INJECTION_RULES];
}

/**
 * Get rules by language.
 */
export function getRulesByLang(lang: 'zh' | 'en'): InjectionRule[] {
  return INJECTION_RULES.filter(r => r.lang === lang);
}

/**
 * Get rules by category.
 */
export function getRulesByCategory(category: InjectionRule['category']): InjectionRule[] {
  return INJECTION_RULES.filter(r => r.category === category);
}
