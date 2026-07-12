import type { SecurityFinding } from './secret';

/**
 * A single step in a tool-call or command sequence.
 */
export interface SequenceStep {
  /** Step index in the sequence (0-based). */
  index: number;
  /** The raw text of the step (e.g. a bash command, a tool call). */
  text: string;
  /** Whether this step accesses sensitive data. */
  accesses_sensitive_data: boolean;
  /** Whether this step sends data externally. */
  sends_externally: boolean;
  /** Detection reason. */
  reason: string;
}

/**
 * A detected data exfiltration chain.
 */
export interface ExfiltrationChain {
  /** Unique chain identifier. */
  id: string;
  /** The full sequence of steps forming the chain. */
  steps: SequenceStep[];
  /** The data source that was accessed. */
  data_source: string;
  /** The exfiltration channel used. */
  exfil_channel: string;
  /** Severity of the exfiltration. */
  severity: 'high' | 'critical';
  /** Human-readable description. */
  description: string;
}

/**
 * Extended security finding with exfiltration-specific metadata.
 */
export interface DataExfiltrationFinding extends SecurityFinding {
  type: 'data_exfiltration';
  chain: ExfiltrationChain;
}

/**
 * Result of a data exfiltration scan.
 */
export interface DataExfiltrationScanResult {
  findings: DataExfiltrationFinding[];
  chains: ExfiltrationChain[];
  /** Steps that accessed sensitive data (allowed if internal only). */
  sensitive_reads: SequenceStep[];
  /** Steps that sent data externally (blocked if chained with sensitive reads). */
  external_sends: SequenceStep[];
}

/**
 * Patterns that indicate reading sensitive data.
 */
const SENSITIVE_DATA_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:cat|head|tail|less|more|vi|nano|vim)\s+.*(?:passwd|shadow|\.env|\.ssh|id_rsa|id_ed25519|credentials|secret)/i, description: 'Reading sensitive file (passwd/shadow/.env/ssh key)' },
  { pattern: /(?:read|open|load|fetch)\s*\(.*(?:passwd|shadow|\.env|\.ssh|credentials|secret|token)/i, description: 'Programmatic read of sensitive file' },
  { pattern: /(?:aws\s+secretsmanager|aws\s+ssm|gcloud\s+secrets|az\s+keyvault)/i, description: 'Cloud secret manager access' },
  { pattern: /SELECT\s+.*(?:password|secret|token|credit_card|ssn|api_key)\s+FROM/i, description: 'SQL query accessing sensitive columns' },
  { pattern: /(?:getenv|process\.env|os\.environ)\s*\[/i, description: 'Environment variable access' },
  { pattern: /(?:database|db|redis|mongo|postgres|mysql|sqlite).*(?:query|find|get|select|read)/i, description: 'Database read operation' },
  { pattern: /(?:kubectl|docker)\s+(?:exec|cp|logs).*(?:secret|configmap)/i, description: 'K8s/Docker secret access' },
];

/**
 * Patterns that indicate sending data externally (blocked).
 */
const EXTERNAL_SEND_PATTERNS: Array<{ pattern: RegExp; description: string; channel: string }> = [
  { pattern: /curl\s+.*(?:-X\s+POST|--data|--data-raw|-d\s)/i, description: 'curl POST request (external exfil)', channel: 'curl' },
  { pattern: /curl\s+.*(?:https?:\/\/|ftp:)/i, description: 'curl to external URL', channel: 'curl' },
  { pattern: /wget\s+.*(?:--post-data|--post-file)/i, description: 'wget POST request (external exfil)', channel: 'wget' },
  { pattern: /wget\s+.*https?:\/\//i, description: 'wget to external URL', channel: 'wget' },
  { pattern: /nc\s+.*(?:-e|--exec)|ncat\s+.*(?:-e|--exec)/i, description: 'nc/ncat with exec (reverse shell risk)', channel: 'nc' },
  { pattern: /(?:echo|printf)\s+.*\|\s*(?:nc|ncat|netcat)\s/i, description: 'Pipe to netcat (exfil channel)', channel: 'nc' },
  { pattern: /(?:python|python3|node|ruby|perl)\s+.*(?:requests\.post|http\.post|fetch|urllib|urlopen)/i, description: 'Script-based HTTP POST (external exfil)', channel: 'script_http' },
  { pattern: /(?:python|python3)\s+.*(?:smtplib|smtp|email\.message)/i, description: 'Python email send (exfil via email)', channel: 'email' },
  { pattern: /(?:node|npx)\s+.*(?:nodemailer|sendmail|mail)/i, description: 'Node.js email send (exfil via email)', channel: 'email' },
  { pattern: /sendmail\s+/i, description: 'sendmail command (exfil via email)', channel: 'email' },
  { pattern: /mail\s+.*-s\s/i, description: 'mail command (exfil via email)', channel: 'email' },
  { pattern: /(?:python|python3)\s+.*socket\s*\(/i, description: 'Python raw socket (exfil channel)', channel: 'socket' },
  { pattern: /(?:base64|openssl\s+enc)\s+.*\|\s*(?:curl|wget|nc|python)/i, description: 'Encode then send externally (obfuscated exfil)', channel: 'encoded_exfil' },
  { pattern: /(?:dig|nslookup|host)\s+.*\$\(/i, description: 'DNS exfiltration via command substitution', channel: 'dns' },
  { pattern: /(?:git\s+(?:push|remote\s+add)).*https?:\/\//i, description: 'git push to external remote (exfil)', channel: 'git' },
];

/**
 * Patterns that indicate internal data return (allowed).
 * DLP model: data returned internally is OK, sending externally is blocked.
 */
const INTERNAL_RETURN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /return\s+/i, description: 'Function return (internal)' },
  { pattern: /(?:console\.log|print|printf|echo)\s+/i, description: 'Console/stdout output (internal)' },
  { pattern: /(?:res\.json|res\.send|ctx\.body|response\.json)\s*\(/i, description: 'API response (internal to caller)' },
];

/**
 * Scan a sequence of tool calls / commands for data exfiltration chains.
 *
 * DLP model:
 * - Reading sensitive data and returning internally: ALLOWED
 * - Reading sensitive data then sending externally (email/HTTP/curl): BLOCKED
 *
 * @param steps - Array of command/tool-call text (in execution order).
 * @param source - Source identifier (file path, session id).
 * @returns Scan result with detected exfiltration chains.
 */
export function scanDataExfiltration(
  steps: string[],
  source: string,
): DataExfiltrationScanResult {
  const findings: DataExfiltrationFinding[] = [];
  const chains: ExfiltrationChain[] = [];
  const sensitiveReads: SequenceStep[] = [];
  const externalSends: SequenceStep[] = [];

  // Classify each step
  const classifiedSteps: SequenceStep[] = steps.map((text, index) => {
    const accessesSensitive = SENSITIVE_DATA_PATTERNS.some(({ pattern }) => pattern.test(text));
    const sendsExternally = EXTERNAL_SEND_PATTERNS.some(({ pattern }) => pattern.test(text));
    const isInternalReturn = INTERNAL_RETURN_PATTERNS.some(({ pattern }) => pattern.test(text));

    const reason = [
      accessesSensitive ? 'accesses_sensitive_data' : '',
      sendsExternally ? 'sends_externally' : '',
      isInternalReturn ? 'internal_return' : '',
    ].filter(Boolean).join(', ') || 'neutral';

    const step: SequenceStep = {
      index,
      text,
      accesses_sensitive_data: accessesSensitive,
      sends_externally: sendsExternally,
      reason,
    };

    if (accessesSensitive) sensitiveReads.push(step);
    if (sendsExternally) externalSends.push(step);

    return step;
  });

  // Detect chains: sensitive read followed by external send
  for (let i = 0; i < classifiedSteps.length; i++) {
    const readStep = classifiedSteps[i];
    if (!readStep || !readStep.accesses_sensitive_data) continue;

    // Look for a subsequent external send (within next 5 steps)
    for (let j = i + 1; j < Math.min(i + 6, classifiedSteps.length); j++) {
      const sendStep = classifiedSteps[j];
      if (!sendStep || !sendStep.sends_externally) continue;

      const exfilPattern = EXTERNAL_SEND_PATTERNS.find(({ pattern }) => pattern.test(sendStep.text));
      const channel = exfilPattern?.channel ?? 'unknown';
      const sensitivePattern = SENSITIVE_DATA_PATTERNS.find(({ pattern }) => pattern.test(readStep.text));
      const dataSource = sensitivePattern?.description ?? 'sensitive data';

      const chainSteps = classifiedSteps.slice(i, j + 1);

      const chain: ExfiltrationChain = {
        id: `EXFIL-${i}-${j}`,
        steps: chainSteps,
        data_source: dataSource,
        exfil_channel: channel,
        severity: 'critical',
        description: `Data exfiltration chain detected: read ${dataSource} (step ${i}) → send via ${channel} (step ${j})`,
      };
      chains.push(chain);

      findings.push({
        type: 'data_exfiltration',
        severity: 'critical',
        file: source,
        line: i + 1,
        description: chain.description,
        chain,
      });

      break; // Only report first exfil per read
    }
  }

  return {
    findings,
    chains,
    sensitive_reads: sensitiveReads,
    external_sends: externalSends,
  };
}

/**
 * Scan a single multi-line content block for exfiltration patterns.
 * Useful for scanning a script file for inline exfiltration.
 *
 * @param content - Multi-line text content to scan.
 * @param source - Source identifier.
 * @returns Scan result treating each line as a step.
 */
export function scanDataExfiltrationContent(
  content: string,
  source: string,
): DataExfiltrationScanResult {
  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
  return scanDataExfiltration(lines, source);
}

/**
 * Check if a single command accesses sensitive data.
 */
export function isSensitiveDataAccess(command: string): boolean {
  return SENSITIVE_DATA_PATTERNS.some(({ pattern }) => pattern.test(command));
}

/**
 * Check if a single command sends data externally.
 */
export function isExternalSend(command: string): boolean {
  return EXTERNAL_SEND_PATTERNS.some(({ pattern }) => pattern.test(command));
}

/**
 * Check if a single command is a safe internal return.
 */
export function isInternalReturn(command: string): boolean {
  return INTERNAL_RETURN_PATTERNS.some(({ pattern }) => pattern.test(command));
}
