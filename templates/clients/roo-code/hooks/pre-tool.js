// Roo Code pre-tool hook for AzaLoop
// Mirrors the Cursor pre-tool.js hook: validates the current pipeline stage
// before allowing the tool to run, and logs resume-continuity messages.
//
// Roo Code hook protocol: the hook module must export a default async
// function that receives `{ tool, args, ctx }` and may throw to block.

const fs = require('fs');
const path = require('path');

module.exports = async function azaPreTool({ tool, args }) {
  const azaDir = path.join(process.cwd(), '.aza');
  const stateFile = path.join(azaDir, 'STATE.yaml');

  // No AzaLoop state — nothing to enforce.
  if (!fs.existsSync(stateFile)) return;

  // Extract the current stage from STATE.yaml with a tolerant parser.
  let stage = null;
  try {
    const text = fs.readFileSync(stateFile, 'utf8');
    const match = text.match(/^[ \t]*current_stage:[ \t]*"?([a-z]+)"?/m);
    if (match) stage = match[1];
  } catch {
    return;
  }
  if (!stage) return;

  // Stage→blocked-tools matrix (subset of stage-tool-guard.ts for client-side
  // defense in depth — MCP layer is authoritative).
  const blocked = {
    open:    ['aza_task_implement', 'aza_task_design', 'aza_quality_check', 'aza_doc_generate'],
    design:  ['aza_task_implement', 'aza_quality_check', 'aza_doc_generate'],
    build:   ['aza_prd_review', 'aza_prd_modify', 'aza_prd_approve', 'aza_doc_generate'],
    verify:  ['aza_task_implement', 'aza_prd_modify', 'aza_doc_generate'],
    archive: ['aza_task_implement', 'aza_prd_modify', 'aza_quality_check'],
  };
  const list = blocked[stage] || [];
  if (list.includes(tool)) {
    throw new Error(
      `[AzaLoop pre-tool] BLOCKED: tool "${tool}" is not allowed in stage "${stage}". ` +
      `Use aza_loop_next to advance.`
    );
  }

  // Resume-continuity trace.
  const resumePath = path.join(azaDir, 'RESUME.md');
  if (fs.existsSync(resumePath)) {
    console.log('[AzaLoop] Tool call tracked for resume continuity');
  }
};
