// Cursor on-stop hook for AzaLoop
// Generates RESUME on session end for cross-session continuity
module.exports = async function(context) {
  const { execSync } = require('child_process');
  try {
    execSync('npx aza continue', { cwd: process.cwd(), stdio: 'pipe' });
  } catch (e) {
    // Silently handle — resume may already be written
  }
};
