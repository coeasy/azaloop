/**
 * Normalize a CLI path argument for the bundled Windows SEA executable.
 *
 * When the native Windows `aza.exe` is launched from a Git-Bash / msys /
 * WSL-style shell, users pass POSIX drive prefixes such as `/c/Users/foo`
 * or `/p/github/...`. Native Node does NOT understand those prefixes — it
 * treats the leading `/c/` as *relative to the current drive root*, silently
 * writing files to a wrong location (e.g. `P:\c\Users\...` instead of
 * `C:\Users\...`), which the shell then cannot find.
 *
 * This rewrites `/x/...` → `X:\...` on Windows only. Native Windows paths
 * (`C:\...`), UNC (`\\server\...`) and relative paths are returned unchanged.
 */
export function normalizeCliPath(input?: string): string | undefined {
  if (!input) return input;
  if (process.platform !== 'win32') return input;
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(input);
  if (!m) return input;
  const drive = m[1]!.toUpperCase();
  const rest = m[2]!.replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}
