import { describe, it, expect } from 'vitest';
import { LEGACY_TOOL_MAP } from '../../packages/mcp-server/src/unified-handlers';

describe('LEGACY_TOOL_MAP (8-tool remapping)', () => {
  it('maps host design/implement/verify to aza_spec', () => {
    expect(LEGACY_TOOL_MAP.aza_task_design).toEqual({ tool: 'aza_spec', action: 'design' });
    expect(LEGACY_TOOL_MAP.aza_task_implement).toEqual({ tool: 'aza_spec', action: 'implement' });
    expect(LEGACY_TOOL_MAP.aza_task_verify).toEqual({ tool: 'aza_spec', action: 'verify' });
  });

  it('maps quality and ship aliases without collapsing to aza_loop/next', () => {
    expect(LEGACY_TOOL_MAP.aza_quality_check).toEqual({ tool: 'aza_quality', action: 'check' });
    expect(LEGACY_TOOL_MAP.aza_ship).toEqual({ tool: 'aza_finish', action: 'ship' });
    expect(LEGACY_TOOL_MAP.aza_loop_next).toEqual({ tool: 'aza_loop', action: 'next' });
  });

  it('maps session/prd legacy names', () => {
    expect(LEGACY_TOOL_MAP.aza_context_calibrate).toEqual({ tool: 'aza_session', action: 'calibrate' });
    expect(LEGACY_TOOL_MAP.aza_prd_approve).toEqual({ tool: 'aza_prd', action: 'approve' });
  });
});
