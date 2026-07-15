// Roo Code pre-tool hook for AzaLoop (0.2.x / 8 unified tools)
const fs = require('fs');
const path = require('path');

module.exports = async function azaPreTool({ tool }) {
  const azaDir = path.join(process.cwd(), '.aza');
  const stateFile = path.join(azaDir, 'STATE.yaml');

  if (!fs.existsSync(stateFile)) return;

  let stage = null;
  try {
    const text = fs.readFileSync(stateFile, 'utf8');
    const match = text.match(/^[ \t]*current_stage:[ \t]*"?([a-z]+)"?/m);
    if (match) stage = match[1];
  } catch {
    return;
  }
  if (!stage) return;

  const blocked = {
    open: ['aza_task_implement', 'aza_task_design', 'aza_quality_check', 'aza_doc_generate'],
    design: ['aza_task_implement', 'aza_quality_check', 'aza_doc_generate', 'aza_finish'],
    build: ['aza_prd', 'aza_prd_review', 'aza_prd_modify', 'aza_prd_approve', 'aza_doc_generate', 'aza_finish'],
    verify: ['aza_task_implement', 'aza_prd_modify', 'aza_doc_generate'],
    archive: ['aza_task_implement', 'aza_prd_modify', 'aza_quality_check'],
  };
  const list = blocked[stage] || [];
  if (list.includes(tool)) {
    throw new Error(
      `[AzaLoop pre-tool] BLOCKED: tool "${tool}" is not allowed in stage "${stage}". ` +
        `Use aza_loop(action=next|full) to advance.`,
    );
  }

  const resumePath = path.join(azaDir, 'RESUME.md');
  if (fs.existsSync(resumePath)) {
    console.log('[AzaLoop] Tool call tracked for resume continuity');
  }
};
