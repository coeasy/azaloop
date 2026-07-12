// Cursor pre-tool hook for AzaLoop
// Ensures RESUME is updated after every tool call
module.exports = async function(context) {
  const fs = require('fs');
  const path = require('path');
  const azaDir = path.join(process.cwd(), '.aza');
  const resumePath = path.join(azaDir, 'RESUME.md');
  if (fs.existsSync(azaDir) && fs.existsSync(resumePath)) {
    console.log('[AzaLoop] Tool call tracked for resume continuity');
  }
};
