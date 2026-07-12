// Cursor post-tool hook for AzaLoop
// Updates RESUME after tool execution
module.exports = async function(context) {
  const fs = require('fs');
  const path = require('path');
  const azaDir = path.join(process.cwd(), '.aza');
  const resumePath = path.join(azaDir, 'RESUME.md');
  if (fs.existsSync(azaDir)) {
    const content = fs.readFileSync(resumePath, 'utf8');
    const updated = content.replace(
      /last_active_at: .*/,
      `last_active_at: ${new Date().toISOString()}`
    );
    fs.writeFileSync(resumePath, updated);
  }
};
