/**
 * Project State Orchestrator — manages cross-app project lifecycle transitions:
 * design (arkiol-core) <-> animation (animation-studio) with shared state.
 */
export type ProjectPhase = 'draft' | 'designing' | 'animating' | 'rendering' | 'reviewing' | 'approved' | 'exported' | 'archived';

export interface ProjectState {
  projectId: string;
  workspaceId: string;
  phase: ProjectPhase;
  designJobIds: string[];
  animationJobIds: string[];
  renderJobIds: string[];
  lastUpdated: Date;
  metadata: Record<string, unknown>;
}

const VALID_TRANSITIONS: Record<ProjectPhase, ProjectPhase[]> = {
  draft: ['designing', 'animating'],
  designing: ['animating', 'reviewing', 'draft'],
  animating: ['rendering', 'reviewing', 'designing'],
  rendering: ['reviewing', 'animating'],
  reviewing: ['approved', 'designing', 'animating'],
  approved: ['exported', 'reviewing'],
  exported: ['archived', 'reviewing'],
  archived: ['draft'],
};

export function canTransition(from: ProjectPhase, to: ProjectPhase): boolean {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

export function transitionProject(state: ProjectState, to: ProjectPhase): ProjectState {
  if (!canTransition(state.phase, to)) throw new Error(`Invalid transition: ${state.phase} -> ${to}`);
  return { ...state, phase: to, lastUpdated: new Date() };
}

export function createProjectState(projectId: string, workspaceId: string): ProjectState {
  return { projectId, workspaceId, phase: 'draft', designJobIds: [], animationJobIds: [], renderJobIds: [], lastUpdated: new Date(), metadata: {} };
}
