/**
 * Smoke: aza_meta swarm_status returns how_to + agents.
 */
async function main() {
  const { handleAzaMeta } = await import('../packages/mcp-server/src/unified-handlers.ts');
  const root = 'd:/workspace/aza_0716/azaloop-main';
  const r: any = await handleAzaMeta({ action: 'swarm_status', workspace_path: root });
  if (!r?.success || !r?.data?.how_to?.dispatch) {
    console.error('FAIL', r);
    process.exit(1);
  }
  console.log('PASS: swarm_status includes how_to', Object.keys(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
