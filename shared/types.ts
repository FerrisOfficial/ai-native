import { z } from 'zod';

export const stages = ['plan', 'implementation', 'review'] as const;
export type AgentStage = (typeof stages)[number];
export type Stage = 'prepare' | AgentStage | 'test' | 'publish';
export type Status =
  | 'new'
  | 'queued'
  | 'running'
  | 'awaiting_plan'
  | 'awaiting_result'
  | 'blocked'
  | 'interrupted'
  | 'published'
  | 'archived';
export const choiceSchema = z.object({
  skill: z.string().min(1),
  model: z.string().min(1).default('default'),
});
export const choicesSchema = z.object({
  plan: choiceSchema,
  implementation: choiceSchema,
  review: choiceSchema,
});
export const terminalSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string(),
  env: z.record(z.string(), z.string()).default({}),
});
export const repoSchema = z.object({
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1),
  baseBranch: z.string().default(''),
  setupCommand: z.string().default(''),
  testCommand: z.string().default(''),
  copyFiles: z.array(z.string().min(1)).default([]),
  terminals: z.array(terminalSpecSchema).max(8).default([]),
  choices: choicesSchema,
});
export type RepoInput = z.infer<typeof repoSchema>;
export type RepoSuggestion = {
  detected: string[];
  evidence: string[];
  warnings: string[];
  setupCommand: string;
  testCommand: string;
  terminals: z.infer<typeof terminalSpecSchema>[];
};
export const budgetSchema = z.number().finite().min(0).max(1000000).nullable();
export type Repository = RepoInput & {
  id: string;
  createdAt: string;
  remote: string;
  removedAt?: string;
};
export type Choices = z.infer<typeof choicesSchema>;
export type Skill = {
  source?: 'application' | 'repository';
  id: string;
  name: string;
  description: string;
  valid: boolean;
  error?: string;
};
export type ReviewItem = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  file?: string;
  line?: number;
};
export type Review = { summary: string; items: ReviewItem[] };
export type TestReport = {
  status: 'passed' | 'failed' | 'not_configured';
  output: string;
  exitCode: number | null;
};
export type Project = {
  budgetUsd?: number | null;
  id: string;
  name: string;
  ticketUrl: string;
  repoId: string;
  config: Repository;
  choices: Choices;
  createdAt: string;
  updatedAt: string;
  status: Status;
  stage: Stage;
  branch: string;
  worktree: string;
  baseCommit?: string;
  port: number;
  skillRoot: string;
  error?: string;
  ticket?: string;
  plan?: string;
  summary?: string;
  review?: Review;
  tests?: TestReport;
  feedback?: string;
  round: number;
  reviewedFingerprint?: string;
  acceptedFingerprint?: string;
  commitSha?: string;
  prUrl?: string;
  worktreeRemoved?: boolean;
  setupComplete?: boolean;
};
export type Run = {
  usage?: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    apiDurationMs: number;
  };
  usageExpected?: boolean;
  id: string;
  projectId: string;
  stage: Stage;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'complete' | 'failed' | 'interrupted';
  error?: string;
};
export type Session = {
  id: string;
  projectId: string;
  stage: AgentStage;
  claudeId?: string;
  round?: number;
  createdAt: string;
};
export type TerminalRecord = {
  removedAt?: string;
  id: string;
  projectId: string;
  name: string;
  command: string;
  env: Record<string, string>;
  status: 'running' | 'exited' | 'interrupted';
  output: string;
  exitCode?: number;
  createdAt: string;
};
export type Question = {
  id: string;
  projectId: string;
  sessionId: string;
  kind: 'permission' | 'question';
  tool: string;
  input: Record<string, unknown>;
  status: 'pending' | 'answered' | 'expired';
  answer?: unknown;
  createdAt: string;
};
export type Approval = {
  id: string;
  projectId: string;
  kind: 'plan' | 'publication';
  fingerprint: string;
  createdAt: string;
};
export type WorkflowEvent = {
  seq: number;
  projectId?: string;
  kind: string;
  data: unknown;
  createdAt: string;
};
export type Snapshot = {
  repositories: Repository[];
  projects: Project[];
  skills: Skill[];
  concurrency: number;
  active: number;
  pendingProjectIds?: string[];
  diagnostics?: Record<string, string>;
};
export type ProjectDetail = {
  project: Project;
  runs: Run[];
  sessions: Session[];
  terminals: TerminalRecord[];
  questions: Question[];
  events: WorkflowEvent[];
};

export interface CommandPermission {
  scope?: 'exact' | 'prefix';
  prefix?: string;
  id: string;
  repoId: string;
  tool: string;
  input: Record<string, unknown>;
  signature: string;
  createdAt: string;
  revokedAt?: string;
}
