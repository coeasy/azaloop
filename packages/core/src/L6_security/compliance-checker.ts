import type { SecurityFinding } from './scanners/secret';

/**
 * China regulatory framework identifiers.
 */
export type ComplianceFramework =
  | 'cybersecurity_law'    // 网络安全法
  | 'pipl'                 // 个人信息保护法
  | 'dengbao_2'            // 等保2.0
  | 'data_cross_border'    // 数据出境
  | 'ai_labeling';         // AI标识

/**
 * Compliance level (Red/Yellow/Green scorecard).
 */
export type ComplianceLevel = 'red' | 'yellow' | 'green';

/**
 * A single compliance violation.
 */
export interface ComplianceViolation {
  /** Unique violation identifier. */
  id: string;
  /** Which regulatory framework is violated. */
  framework: ComplianceFramework;
  /** Framework display name (Chinese). */
  framework_name: string;
  /** Severity of the violation. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Description of the violation. */
  description: string;
  /** The offending content or pattern that triggered the violation. */
  evidence: string;
  /** Location (file, line, or source identifier). */
  location: string;
}

/**
 * A compliance suggestion (improvement recommendation).
 */
export interface ComplianceSuggestion {
  /** Unique suggestion identifier. */
  id: string;
  /** Related framework. */
  framework: ComplianceFramework;
  /** Framework display name (Chinese). */
  framework_name: string;
  /** The suggestion text. */
  suggestion: string;
  /** Priority of implementing this suggestion. */
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

/**
 * Result of a compliance check.
 */
export interface ComplianceResult {
  /** Overall compliance score (0-100, higher is better). */
  score: number;
  /** Compliance level (Red/Yellow/Green). */
  level: ComplianceLevel;
  /** List of detected violations. */
  violations: ComplianceViolation[];
  /** List of improvement suggestions. */
  suggestions: ComplianceSuggestion[];
  /** Per-framework breakdown. */
  frameworkBreakdown: Array<{
    framework: ComplianceFramework;
    framework_name: string;
    score: number;
    violations: number;
    passed: boolean;
  }>;
  /** Whether the check passed overall. */
  passed: boolean;
}

/**
 * Framework display names (Chinese).
 */
const FRAMEWORK_NAMES: Record<ComplianceFramework, string> = {
  cybersecurity_law: '网络安全法',
  pipl: '个人信息保护法 (PIPL)',
  dengbao_2: '等保2.0',
  data_cross_border: '数据出境',
  ai_labeling: 'AI标识',
};

/**
 * Overseas LLM API endpoints that trigger data cross-border concerns.
 */
const OVERSEAS_LLM_ENDPOINTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /api\.openai\.com/i, name: 'OpenAI API' },
  { pattern: /api\.anthropic\.com/i, name: 'Anthropic Claude API' },
  { pattern: /generativelanguage\.googleapis\.com/i, name: 'Google Gemini API' },
  { pattern: /api\.cohere\.com/i, name: 'Cohere API' },
  { pattern: /api\.mistral\.ai/i, name: 'Mistral AI API' },
  { pattern: /api\.together\.ai/i, name: 'Together AI API' },
  { pattern: /api\.groq\.com/i, name: 'Groq API' },
  { pattern: /api\.perplexity\.ai/i, name: 'Perplexity API' },
  { pattern: /api\.xai\.com/i, name: 'xAI Grok API' },
  { pattern: /api\.deepinfra\.com/i, name: 'DeepInfra API' },
  { pattern: /api\.fireworks\.ai/i, name: 'Fireworks AI API' },
  { pattern: /dashscope\.aliyuncs\.com/i, name: '通义千问 (DashScope)' }, // Domestic — no violation
];

/**
 * Domestic LLM alternatives (suggested replacements for overseas endpoints).
 */
const DOMESTIC_LLM_ALTERNATIVES: Array<{ name: string; endpoint: string; api_docs: string }> = [
  { name: '通义千问 (Qwen)', endpoint: 'dashscope.aliyuncs.com', api_docs: 'https://help.aliyun.com/zh/dashscope/' },
  { name: 'DeepSeek', endpoint: 'api.deepseek.com', api_docs: 'https://platform.deepseek.com/api-docs' },
  { name: 'Kimi (Moonshot AI)', endpoint: 'api.moonshot.cn', api_docs: 'https://platform.moonshot.cn/docs' },
  { name: '智谱 (GLM)', endpoint: 'open.bigmodel.cn', api_docs: 'https://open.bigmodel.cn/dev/api' },
];

/**
 * PII (personally identifiable information) patterns for PIPL compliance.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\b\d{15}(?:\d{2}[\dXx])?\b/, description: 'Chinese ID card number (身份证号)' },
  { pattern: /\b1[3-9]\d{9}\b/, description: 'Chinese mobile phone number (手机号)' },
  { pattern: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/i, description: 'Full ID card with birth date (完整身份证)' },
  { pattern: /\b[\u4e00-\u9fa5]{2,4}[\s,，:：](?:身份证|idcard|id_card)\b/i, description: 'Name + ID card label (姓名+身份证)' },
  { pattern: /\b(?:bank_?card|银行卡|卡号)\s*[:=]\s*\d{16,19}\b/i, description: 'Bank card number (银行卡号)' },
  { pattern: /\b(?:address|地址|住址)\s*[:=]\s*[\u4e00-\u9fa5]/i, description: 'Home address (家庭住址)' },
];

/**
 * AI content labeling patterns — detect AI-generated content without proper labeling.
 */
const AI_LABEL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:generated|created|written)\s+by\s+(?:AI|GPT|LLM|ChatGPT|Claude)/i, description: 'AI-generated content without label' },
  { pattern: /(?:这是|本内容)(?:由)?(?:AI|人工智能|大模型|GPT)(?:生成|创作)/i, description: 'Chinese AI-generated content marker' },
];

/**
 * Check for overseas LLM endpoints and suggest domestic alternatives.
 *
 * @param content - The content to scan (config, code, etc.).
 * @param source - Source identifier.
 * @returns Violations and suggestions related to overseas LLM usage.
 */
function checkOverseasLLM(
  content: string,
  source: string,
): { violations: ComplianceViolation[]; suggestions: ComplianceSuggestion[] } {
  const violations: ComplianceViolation[] = [];
  const suggestions: ComplianceSuggestion[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    for (const endpoint of OVERSEAS_LLM_ENDPOINTS) {
      if (endpoint.pattern.test(line)) {
        // Skip domestic endpoints (DashScope is in the list as known-good)
        if (endpoint.name.includes('通义千问')) continue;

        violations.push({
          id: `CB-${violations.length + 1}`,
          framework: 'data_cross_border',
          framework_name: FRAMEWORK_NAMES.data_cross_border,
          severity: 'critical',
          description: `Overseas LLM endpoint detected: ${endpoint.name} — data may leave China`,
          evidence: line.trim(),
          location: `${source}:${i + 1}`,
        });

        // Suggest domestic alternative
        const alt = DOMESTIC_LLM_ALTERNATIVES[i % DOMESTIC_LLM_ALTERNATIVES.length];
        if (alt) {
          suggestions.push({
            id: `SUG-${suggestions.length + 1}`,
            framework: 'data_cross_border',
            framework_name: FRAMEWORK_NAMES.data_cross_border,
            suggestion: `Replace ${endpoint.name} with domestic alternative: ${alt.name} (${alt.endpoint}) — API docs: ${alt.api_docs}`,
            priority: 'P0',
          });
        }
      }
    }
  }

  return { violations, suggestions };
}

/**
 * Check for PII exposure (PIPL compliance).
 *
 * @param content - The content to scan.
 * @param source - Source identifier.
 * @returns Violations related to PII exposure.
 */
function checkPII(content: string, source: string): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    for (const { pattern, description } of PII_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          id: `PIPL-${violations.length + 1}`,
          framework: 'pipl',
          framework_name: FRAMEWORK_NAMES.pipl,
          severity: 'critical',
          description: `PII detected: ${description}`,
          evidence: line.trim(),
          location: `${source}:${i + 1}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check for AI content labeling compliance.
 *
 * @param content - The content to scan.
 * @param source - Source identifier.
 * @returns Violations and suggestions related to AI labeling.
 */
function checkAILabeling(
  content: string,
  source: string,
): { violations: ComplianceViolation[]; suggestions: ComplianceSuggestion[] } {
  const violations: ComplianceViolation[] = [];
  const suggestions: ComplianceSuggestion[] = [];
  const lines = content.split('\n');

  let hasAIGeneratedContent = false;
  let hasLabel = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    for (const { pattern, description } of AI_LABEL_PATTERNS) {
      if (pattern.test(line)) {
        hasAIGeneratedContent = true;
        // Check if the same line or nearby lines contain a label
        if (/AI生成|人工智能生成|本内容由AI|AI generated|AI辅助/i.test(line)) {
          hasLabel = true;
        }
      }
    }
  }

  if (hasAIGeneratedContent && !hasLabel) {
    violations.push({
      id: 'AIL-1',
      framework: 'ai_labeling',
      framework_name: FRAMEWORK_NAMES.ai_labeling,
      severity: 'medium',
      description: 'AI-generated content detected without proper labeling (AI标识)',
      evidence: 'AI-generated content without disclosure label',
      location: source,
    });

    suggestions.push({
      id: 'SUG-AIL-1',
      framework: 'ai_labeling',
      framework_name: FRAMEWORK_NAMES.ai_labeling,
      suggestion: 'Add AI-generated content label (AI标识) — e.g. "本内容由AI生成" or "[AI Generated]"',
      priority: 'P1',
    });
  }

  return { violations, suggestions };
}

/**
 * Check for cybersecurity law (网络安全法) compliance.
 * Checks for: logging requirements, access control, data retention.
 *
 * @param content - The content to scan.
 * @param source - Source identifier.
 * @returns Violations related to cybersecurity law.
 */
function checkCybersecurityLaw(
  content: string,
  source: string,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  // Check for hardcoded credentials without proper handling
  if (/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}['"]/i.test(content)) {
    violations.push({
      id: 'CSL-1',
      framework: 'cybersecurity_law',
      framework_name: FRAMEWORK_NAMES.cybersecurity_law,
      severity: 'high',
      description: 'Hardcoded password detected — violates 网络安全法 第22条 (security protection obligations)',
      evidence: 'Password in source code',
      location: source,
    });
  }

  // Check for missing security logging
  if (!/log|audit|monitor|记录|审计/i.test(content) && content.length > 500) {
    violations.push({
      id: 'CSL-2',
      framework: 'cybersecurity_law',
      framework_name: FRAMEWORK_NAMES.cybersecurity_law,
      severity: 'medium',
      description: 'No security logging/audit mechanism detected — 网络安全法 requires logging for network operations',
      evidence: 'No log/audit/monitor keywords found',
      location: source,
    });
  }

  return violations;
}

/**
 * Check for 等保2.0 (MLPS 2.0) compliance.
 * Checks for: access control, encryption, backup.
 *
 * @param content - The content to scan.
 * @param source - Source identifier.
 * @returns Violations related to 等保2.0.
 */
function checkDengbao(
  content: string,
  source: string,
): { violations: ComplianceViolation[]; suggestions: ComplianceSuggestion[] } {
  const violations: ComplianceViolation[] = [];
  const suggestions: ComplianceSuggestion[] = [];

  // Check for encryption requirements
  if (/password|passwd|secret|token/i.test(content) && !/encrypt|hash|bcrypt|argon|aes|rsa/i.test(content)) {
    violations.push({
      id: 'DB-1',
      framework: 'dengbao_2',
      framework_name: FRAMEWORK_NAMES.dengbao_2,
      severity: 'high',
      description: 'Sensitive data (password/secret/token) found without encryption — 等保2.0 requires encryption at rest',
      evidence: 'Sensitive data without encryption indicators',
      location: source,
    });

    suggestions.push({
      id: 'SUG-DB-1',
      framework: 'dengbao_2',
      framework_name: FRAMEWORK_NAMES.dengbao_2,
      suggestion: 'Encrypt sensitive data using AES-256 (at rest) or TLS 1.3 (in transit). Hash passwords with bcrypt/argon2.',
      priority: 'P0',
    });
  }

  // Check for backup requirements
  if (!/backup|备份|recovery|恢复/i.test(content) && content.length > 1000) {
    suggestions.push({
      id: 'SUG-DB-2',
      framework: 'dengbao_2',
      framework_name: FRAMEWORK_NAMES.dengbao_2,
      suggestion: 'Add data backup and recovery mechanism — 等保2.0 requires data backup for Level 2+ systems',
      priority: 'P2',
    });
  }

  return { violations, suggestions };
}

/**
 * Determine compliance level from score.
 */
function determineLevel(score: number, violations: ComplianceViolation[]): ComplianceLevel {
  const hasCritical = violations.some(v => v.severity === 'critical');
  const hasHigh = violations.some(v => v.severity === 'high');

  if (hasCritical || score < 60) return 'red';
  if (hasHigh || score < 80) return 'yellow';
  return 'green';
}

/**
 * Run a comprehensive China compliance check on content.
 *
 * Maps findings to: 网安法 / PIPL / 等保2.0 / 数据出境 / AI标识
 * Produces a Red/Yellow/Green scorecard.
 *
 * @param content - The content to check (code, config, documentation).
 * @param source - Source identifier (file path, config name).
 * @param existingFindings - Pre-existing security findings to incorporate.
 * @returns Comprehensive compliance result.
 */
export function checkCompliance(
  content: string,
  source: string,
  existingFindings: SecurityFinding[] = [],
): ComplianceResult {
  const allViolations: ComplianceViolation[] = [];
  const allSuggestions: ComplianceSuggestion[] = [];

  // 1. Check overseas LLM endpoints (数据出境)
  const overseasResult = checkOverseasLLM(content, source);
  allViolations.push(...overseasResult.violations);
  allSuggestions.push(...overseasResult.suggestions);

  // 2. Check PII (个人信息保护法)
  allViolations.push(...checkPII(content, source));

  // 3. Check AI labeling (AI标识)
  const aiLabelResult = checkAILabeling(content, source);
  allViolations.push(...aiLabelResult.violations);
  allSuggestions.push(...aiLabelResult.suggestions);

  // 4. Check cybersecurity law (网络安全法)
  allViolations.push(...checkCybersecurityLaw(content, source));

  // 5. Check 等保2.0
  const dengbaoResult = checkDengbao(content, source);
  allViolations.push(...dengbaoResult.violations);
  allSuggestions.push(...dengbaoResult.suggestions);

  // Incorporate existing security findings as additional violations
  for (const finding of existingFindings) {
    if (finding.type === 'secret') {
      allViolations.push({
        id: `SF-${allViolations.length + 1}`,
        framework: 'cybersecurity_law',
        framework_name: FRAMEWORK_NAMES.cybersecurity_law,
        severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
        description: `Security finding: ${finding.description}`,
        evidence: `${finding.file}:${finding.line}`,
        location: finding.file,
      });
    }
    if (finding.type === 'data_exfiltration') {
      allViolations.push({
        id: `SF-${allViolations.length + 1}`,
        framework: 'data_cross_border',
        framework_name: FRAMEWORK_NAMES.data_cross_border,
        severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
        description: `Data exfiltration risk: ${finding.description}`,
        evidence: `${finding.file}:${finding.line}`,
        location: finding.file,
      });
    }
  }

  // Build per-framework breakdown
  const frameworks: ComplianceFramework[] = [
    'cybersecurity_law', 'pipl', 'dengbao_2', 'data_cross_border', 'ai_labeling',
  ];

  const frameworkBreakdown = frameworks.map(fw => {
    const fwViolations = allViolations.filter(v => v.framework === fw);
    const fwScore = Math.max(0, 100 - fwViolations.length * 25);
    return {
      framework: fw,
      framework_name: FRAMEWORK_NAMES[fw],
      score: fwScore,
      violations: fwViolations.length,
      passed: fwViolations.length === 0,
    };
  });

  // Calculate overall score
  const totalPossible = frameworks.length * 100;
  const earnedScore = frameworkBreakdown.reduce((sum, f) => sum + f.score, 0);
  const score = Math.round((earnedScore / totalPossible) * 100);

  const level = determineLevel(score, allViolations);
  const passed = level !== 'red';

  return {
    score,
    level,
    violations: allViolations,
    suggestions: allSuggestions,
    frameworkBreakdown,
    passed,
  };
}

/**
 * Get the list of domestic LLM alternatives.
 */
export function getDomesticLLMAlternatives(): typeof DOMESTIC_LLM_ALTERNATIVES {
  return [...DOMESTIC_LLM_ALTERNATIVES];
}

/**
 * Get the list of known overseas LLM endpoints.
 */
export function getOverseasLLMEndpoints(): Array<{ name: string; pattern: string }> {
  return OVERSEAS_LLM_ENDPOINTS
    .filter(e => !e.name.includes('通义千问'))
    .map(e => ({ name: e.name, pattern: e.pattern.source }));
}
