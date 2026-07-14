/**
 * v14 — P9.3: State migration v1 → v2
 *
 * v1 STATE.yaml did not have a `schema_version` field. v2 adds
 * `schema_version: 2` plus a `pipeline.completion_gate` block with an
 * empty `required_phases` array.
 *
 * The migration is forward-only (azaloop never downgrades state). If
 * the input already declares v2, the transformer is a no-op pass-through.
 */
export default function migrateV1ToV2(state: Record<string, unknown>): Record<string, unknown> {
  const out = { ...state };
  out.schema_version = 2;
  // Add `pipeline.completion_gate` if not present.
  if (out.pipeline && typeof out.pipeline === 'object') {
    const pipeline = out.pipeline as Record<string, unknown>;
    if (!('completion_gate' in pipeline)) {
      pipeline.completion_gate = { required_phases: [] };
    }
  }
  return out;
}
