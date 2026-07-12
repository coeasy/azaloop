import { z } from 'zod';

export const AcceptanceCriteriaSchema = z.object({
  id: z.string(),
  description: z.string(),
  testable: z.boolean(),
  status: z.enum(['pending', 'passed', 'failed']),
});

export const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  complexity: z.enum(['L1', 'L2', 'L3', 'L4']),
  acceptance_criteria: z.array(AcceptanceCriteriaSchema),
  dependencies: z.array(z.string()).default([]),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
});

export const ArchitectureSchema = z.object({
  type: z.enum(['system', 'flow', 'deployment', 'data', 'component', 'sequence', 'class']),
  mermaid: z.string(),
  description: z.string(),
});

export const PRDSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  overview: z.string(),
  goals: z.array(z.string()),
  target_users: z.array(z.string()),
  functional_requirements: z.array(z.object({
    id: z.string(),
    description: z.string(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  })),
  non_functional_requirements: z.array(z.object({
    id: z.string(),
    description: z.string(),
    category: z.enum(['performance', 'security', 'usability', 'reliability', 'maintainability']),
  })),
  stories: z.array(StorySchema),
  architecture: z.array(ArchitectureSchema).default([]),
  acceptance_criteria: z.array(AcceptanceCriteriaSchema),
  risks: z.array(z.object({
    description: z.string(),
    probability: z.enum(['low', 'medium', 'high']),
    mitigation: z.string(),
  })).default([]),
});

export type PRD = z.infer<typeof PRDSchema>;
export type Story = z.infer<typeof StorySchema>;
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteriaSchema>;
export type Architecture = z.infer<typeof ArchitectureSchema>;
