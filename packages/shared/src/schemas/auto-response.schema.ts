import { z } from 'zod';

/**
 * vNext host-contract schemas (v1).
 *
 * These pin the strict request/response shape exchanged between the
 * autonomous loop and the host AI that physically executes tools
 * (aza_spec implement, aza_quality check, …) and reports evidence
 * back through executeVerifiedHostReport.
 *
 * Strictness (`.strict()`) is deliberate: a legacy `next_action`
 * field or any unexpected key must be rejected so a malformed host
 * response can never masquerade as a valid v1 contract.
 */

export const HOST_ACTION_KINDS = [
  'implement',
  'run_command',
  'inspect',
  'repair',
] as const;
export type HostActionKindV1 = (typeof HOST_ACTION_KINDS)[number];

/** How the host must report completion of an issued action. */
export const HostActionReportV1Schema = z
  .object({
    tool: z.string().min(1),
    action: z.string().min(1),
    action_id: z.string().min(1),
    task_fingerprint: z.string().min(1),
    tool_name: z.string().min(1),
  })
  .strict();

/** An action the host is authorized to execute for a given task fingerprint. */
export const HostActionV1Schema = z
  .object({
    action_id: z.string().min(1),
    task_fingerprint: z.string().min(1),
    kind: z.enum(HOST_ACTION_KINDS),
    tool_name: z.string().min(1),
    instruction: z.string().min(1),
    acceptance: z.array(z.string()),
    report: HostActionReportV1Schema,
  })
  .strict();

/** Evidence the host submits after executing an issued action. */
export const HostReportV1Schema = z
  .object({
    contract_version: z.literal('1').optional(),
    action_id: z.string().min(1),
    task_fingerprint: z.string().min(1),
    tool_name: z.string().min(1),
    evidence: z.array(z.string()).min(1),
    payload: z.record(z.unknown()).optional(),
  })
  .strict();

/** The loop's reply to a verified host report — never carries a next_action. */
export const AutoResponseV1Schema = z
  .object({
    host_action: z.null(),
  })
  .strict();

export type HostActionV1 = z.infer<typeof HostActionV1Schema>;
export type HostReportV1 = z.infer<typeof HostReportV1Schema>;
export type AutoResponseV1 = z.infer<typeof AutoResponseV1Schema>;
export type HostActionDraft = Omit<HostActionV1, 'action_id' | 'report'>;
