/**
 * CI guard: MCP registry names === handler names (8 unified tools).
 * Run: npx tsx scripts/check-mcp-drift.ts
 */
import { TOOL_REGISTRY, validateRegistryConsistency } from '../packages/mcp-server/src/tool-registry';
import { RAW_HANDLERS, getRegistryErrors } from '../packages/mcp-server/src/index';

const EXPECTED = [
  'aza_session',
  'aza_prd',
  'aza_loop',
  'aza_spec',
  'aza_quality',
  'aza_finish',
  'aza_memory',
  'aza_meta',
];

const names = TOOL_REGISTRY.map((t) => t.name).sort();
const expected = [...EXPECTED].sort();

let failed = false;

if (names.length !== 8 || names.join() !== expected.join()) {
  console.error('[drift] TOOL_REGISTRY must be exactly 8 unified tools.');
  console.error('  got:', names);
  console.error('  expected:', expected);
  failed = true;
}

const handlerNames = Object.keys(RAW_HANDLERS).sort();
if (handlerNames.join() !== expected.join()) {
  console.error('[drift] RAW_HANDLERS mismatch.');
  console.error('  got:', handlerNames);
  failed = true;
}

const consistency = validateRegistryConsistency(RAW_HANDLERS as any);
if (consistency.length) {
  console.error('[drift] validateRegistryConsistency:', consistency);
  failed = true;
}

const bootErrors = getRegistryErrors();
if (bootErrors.length) {
  console.error('[drift] boot registry errors:', bootErrors);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('[ok] MCP drift check passed — 8 unified tools, handlers ≡ registry');
