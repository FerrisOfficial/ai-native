/** Isolated, deterministic UI verification. Never calls a model or publishes remotely. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { GitService } from '../server/git.js';
import { Terminals } from '../server/terminals.js';
import { Workflow } from '../server/workflow.js';
import { ClaudeDriver, type AgentRequest, type AgentDriver } from '../server/claude.js';
import { createApp } from '../server/app.js';
import { checked, run } from '../server/process.js';
import type { Session } from '../shared/types.js';

const parent = resolve('.data/ui-verification');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'run-')),
  repo = join(root, 'repo'),
  skills = join(root, 'skills');
await mkdir(repo);
await mkdir(join(skills, 'fixture'), { recursive: true });
await writeFile(
  join(skills, 'fixture', 'SKILL.md'),
  '---\nname: fixture\ndescription: Deterministic UI verification skill.\n---\nUsed only by the local UI test driver.',
);
await checked(run, 'git', ['init', '--initial-branch=main'], repo);
await checked(run, 'git', ['config', 'user.name', 'UI Verification'], repo);
await checked(run, 'git', ['config', 'user.email', 'ui@example.test'], repo);
await checked(run, 'git', ['config', 'commit.gpgsign', 'false'], repo);
await writeFile(join(repo, 'README.md'), '# UI verification repository\n');
await checked(run, 'git', ['add', '.'], repo);
await checked(run, 'git', ['commit', '-m', 'Initial fixture'], repo);
await checked(
  run,
  'git',
  ['init', '--bare', '--initial-branch=main', join(root, 'remote.git')],
  root,
);
await checked(run, 'git', ['remote', 'add', 'origin', join(root, 'remote.git')], repo);
await checked(run, 'git', ['push', '-u', 'origin', 'main'], repo);
const store = new Store(join(root, 'workflow.sqlite'));
class FixtureAgent implements AgentDriver {
  permissions = new ClaudeDriver(store);
  async execute({ project, stage, signal }: AgentRequest) {
    const session: Session = {
      id: randomUUID(),
      projectId: project.id,
      stage,
      createdAt: new Date().toISOString(),
    };
    store.put('sessions', session);
    store.event(
      'message',
      { role: 'user', text: `Work on ${project.name}.`, stage, sessionId: session.id },
      project.id,
    );
    if (stage === 'plan' && project.name.startsWith('Confirm')) {
      const permission = await this.permissions.permission(
        project,
        session,
        'Bash',
        { command: process.env.UI_PERMISSION_COMMAND ?? 'gh issue view 42 --json title,body' },
        signal,
      );
      if (permission.behavior === 'deny') throw new Error('Ticket tool permission was denied.');
      await this.permissions.permission(
        project,
        session,
        'AskUserQuestion',
        {
          questions: [
            {
              question: 'Which empty state should we use?',
              options: [
                { label: 'Guided setup', description: 'Show the next action.' },
                { label: 'Minimal', description: 'Keep the board quiet.' },
              ],
            },
          ],
        },
        signal,
      );
    }
    if (signal.aborted) throw new Error('Interrupted');
    if (stage === 'plan') {
      const plan = `## ${project.name}\n\n### Intended behavior\nGive the user a clear next action and preserve the current workflow.\n\n### Implementation\n1. Add the requested behavior.\n2. Keep existing states consistent.\n3. Verify the result with the configured tests.\n\n### Acceptance\nThe requested flow works and is ready for an independent review.`;
      store.event(
        'message',
        { role: 'assistant', text: plan, stage, sessionId: session.id },
        project.id,
      );
      return {
        ticketAccessible: true,
        ticket: 'An isolated ticket fixture for UI verification.',
        plan,
      };
    }
    if (stage === 'implementation') {
      await writeFile(
        join(project.worktree, 'feature.txt'),
        `UI verification round ${project.round}\n`,
      );
      store.event(
        'message',
        {
          role: 'assistant',
          text: 'Implemented the requested behavior. Ready for tests and review.',
          stage,
          sessionId: session.id,
        },
        project.id,
      );
      return {
        summary:
          'Added the requested behavior and preserved the existing interaction. The implementation is ready for an independent review.',
      };
    }
    return {
      summary: 'The main behavior matches the plan. Two details would make the result more useful.',
      items: [
        {
          id: 'a',
          severity: 'medium',
          title: 'Explain the next action',
          description:
            'Add one short sentence that tells users what will happen after they continue.',
          file: 'feature.txt',
          line: 1,
        },
        {
          id: 'b',
          severity: 'low',
          title: 'Keep the wording consistent',
          description: 'Use the same action label throughout the flow.',
          file: 'feature.txt',
          line: 1,
        },
      ],
    };
  }
  async interrupt() {}
  answer(id: string, answer: { allow?: boolean; answers?: Record<string, string> }) {
    this.permissions.answer(id, answer);
  }
}
const workflow = new Workflow(
  store,
  new GitService(join(root, 'worktrees')),
  new FixtureAgent(),
  new Terminals(store),
  root,
  skills,
);
const choice = { skill: 'fixture', model: 'default' };
const repository = await workflow.repository({
  name: 'Product workspace (UI fixture)',
  path: repo,
  choices: { plan: choice, implementation: choice, review: choice },
  terminals: [
    { id: 'shell', name: 'Workspace', command: "Write-Output 'UI_TERMINAL_READY'", env: {} },
  ],
  testCommand: "Write-Output 'Fixture tests passed'",
});
const create = (name: string) =>
  workflow.create({ name, ticketUrl: 'https://tickets.example.test/42', repoId: repository.id });
const ready = await create('Refresh account navigation');
while (workflow.get(ready.id).status !== 'awaiting_plan' || workflow.active.has(ready.id)) {
  if (workflow.get(ready.id).status === 'blocked') throw new Error(workflow.get(ready.id).error);
  await new Promise((r) => setTimeout(r, 50));
}
workflow.approvePlan(ready.id);
await create('Improve invitation acceptance');
await create('Confirm empty state behavior');
const app = await createApp(workflow, { port: 4320 });
await app.listen({ host: '127.0.0.1', port: 4320 });
console.log(`UI verification fixture: http://127.0.0.1:4320\nData: ${root}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await workflow.close();
  await app.close();
  store.close();
  process.exit();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
