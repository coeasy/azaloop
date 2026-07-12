import { type PRD } from '@azaloop/shared';

export interface ChangeProposal {
  id: string;
  title: string;
  description: string;
  motivation: string;
  impact: 'low' | 'medium' | 'high';
  affected_stories: string[];
  created_at: string;
}

export interface SpecItem {
  id: string;
  proposal_id: string;
  title: string;
  specification: string;
  acceptance: string[];
}

export interface DesignDecisions {
  id: string;
  spec_id: string;
  decisions: Array<{
    context: string;
    options: string[];
    chosen: string;
    rationale: string;
  }>;
}

export class ChangeManager {
  private proposals: Map<string, ChangeProposal> = new Map();
  private specs: Map<string, SpecItem> = new Map();
  private designs: Map<string, DesignDecisions> = new Map();

  createProposal(title: string, description: string, motivation: string, impact: ChangeProposal['impact']): ChangeProposal {
    const proposal: ChangeProposal = {
      id: `PROP-${Date.now()}`,
      title,
      description,
      motivation,
      impact,
      affected_stories: [],
      created_at: new Date().toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  createSpec(proposalId: string, title: string, specification: string, acceptance: string[]): SpecItem | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;
    const spec: SpecItem = {
      id: `SPEC-${Date.now()}`,
      proposal_id: proposalId,
      title,
      specification,
      acceptance,
    };
    this.specs.set(spec.id, spec);
    return spec;
  }

  createDesign(specId: string, decisions: DesignDecisions['decisions']): DesignDecisions | null {
    const spec = this.specs.get(specId);
    if (!spec) return null;
    const design: DesignDecisions = {
      id: `DSN-${Date.now()}`,
      spec_id: specId,
      decisions,
    };
    this.designs.set(design.id, design);
    return design;
  }

  getProposal(id: string): ChangeProposal | undefined {
    return this.proposals.get(id);
  }

  getSpec(id: string): SpecItem | undefined {
    return this.specs.get(id);
  }

  getDesign(id: string): DesignDecisions | undefined {
    return this.designs.get(id);
  }

  generateTasksFromDesign(designId: string): string[] {
    const design = this.designs.get(designId);
    if (!design) return [];
    return design.decisions.map((d, i) => `DSN-${designId}-TASK-${i + 1}: Implement ${d.chosen} (${d.context})`);
  }

  linkProposalToStory(proposalId: string, storyId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal && !proposal.affected_stories.includes(storyId)) {
      proposal.affected_stories.push(storyId);
    }
  }
}
