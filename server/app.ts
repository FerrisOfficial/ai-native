import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Question, TerminalRecord, WorkflowEvent } from '../shared/types.js';
import { Workflow } from './workflow.js';
import { ClaudeDriver } from './claude.js';
import { run } from './process.js';
import { availableSkills } from './skills.js';
import { detectRepository } from './detect.js';
import { savedCommands } from './permissions.js';
import type { CommandPermission } from '../shared/types.js';
import { budgetSchema } from '../shared/types.js';

export async function createApp(
  workflow: Workflow,
  options: { port?: number; uiDir?: string; allowedOrigins?: string[] } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const token = randomBytes(32).toString('hex');
  const port = options.port ?? 4317;
  const cookieName = `ai_native_session_${port}`;
  const origins = new Set(
    options.allowedOrigins ?? [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ],
  );
  const hosts = new Set([...origins].map((o) => new URL(o).host));
  const validToken = (value?: string) =>
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
  app.addHook('onRequest', async (request, reply) => {
    if (!hosts.has(request.headers.host ?? ''))
      return reply.code(403).send({ error: 'Invalid Host header' });
    const origin = request.headers.origin;
    if (origin && !origins.has(origin))
      return reply.code(403).send({ error: 'Invalid request origin' });
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site')
      return reply.code(403).send({ error: 'Cross-site requests are not allowed' });
    if (request.url.startsWith('/api/') && !request.url.startsWith('/api/bootstrap')) {
      if (!validToken(request.headers['x-session-token'] as string))
        return reply.code(401).send({ error: 'Local session expired; reload the page' });
    }
    if (request.url.startsWith('/ws')) {
      const cookies = Object.fromEntries(
        (request.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')),
      );
      if (!origin || !origins.has(origin) || !validToken(cookies[cookieName]))
        return reply.code(401).send({ error: 'Invalid WebSocket session' });
    }
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof z.ZodError ? 400 : 409).send({
      error:
        error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : (error as Error).message,
    });
  });
  app.get('/api/bootstrap', async (_request, reply) => {
    reply.header('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return { token };
  });
  app.get('/api/snapshot', async () => workflow.snapshot());
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/diagnostics', async () => {
    const checks = await Promise.allSettled([
      run('git', ['--version'], process.cwd()),
      run(
        workflow.agent instanceof ClaudeDriver ? workflow.agent.executable : 'claude',
        ['auth', 'status'],
        process.cwd(),
      ),
      run('gh', ['auth', 'status'], process.cwd()),
    ]);
    return Object.fromEntries(
      checks.map((result, index) => {
        const name = ['git', 'claude', 'github'][index];
        if (result.status === 'rejected')
          return [name, { ok: false, message: String(result.reason) }];
        const { exitCode, stdout, stderr } = result.value;
        if (name === 'claude') {
          try {
            const auth = JSON.parse(stdout);
            return [
              name,
              {
                ok: !!auth.loggedIn,
                message: auth.loggedIn
                  ? `Logged in (${auth.authMethod}). A model call may still require refreshed credentials.`
                  : 'Run claude auth login in your terminal.',
              },
            ];
          } catch {
            /* display error */
          }
        }
        return [
          name,
          {
            ok: exitCode === 0,
            message:
              name === 'github' && exitCode === 0
                ? 'GitHub CLI is authenticated'
                : (stdout || stderr).slice(0, 2000),
          },
        ];
      }),
    );
  });
  app.get('/api/models', async () => {
    if (!(workflow.agent instanceof ClaudeDriver))
      return [{ value: 'default', displayName: 'Claude default', description: '' }];
    async function* empty(): AsyncGenerator<never> {
      /* initialize without submitting a model prompt */
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const stream = query({
      prompt: empty(),
      options: {
        pathToClaudeCodeExecutable: workflow.agent.executable,
        abortController: controller,
        settingSources: ['user'],
      },
    });
    try {
      return [
        { value: 'default', displayName: 'Claude default', description: '' },
        ...(await stream.supportedModels()),
      ];
    } finally {
      clearTimeout(timer);
      stream.close();
    }
  });
  app.get<{ Params: { id: string } }>('/api/repositories/:id/permissions', async (request) =>
    savedCommands(workflow.store, request.params.id),
  );
  app.delete<{ Params: { id: string; permissionId: string } }>(
    '/api/repositories/:id/permissions/:permissionId',
    async (request) => {
      const permission = workflow.store.get<CommandPermission>(
        'command_permissions',
        request.params.permissionId,
      );
      if (!permission || permission.repoId !== request.params.id)
        throw new Error('Permission not found');
      workflow.store.put('command_permissions', {
        ...permission,
        revokedAt: new Date().toISOString(),
      });
      workflow.store.event('command_permission_revoked', {
        id: permission.id,
        repoId: permission.repoId,
      });
      return { ok: true };
    },
  );
  app.post('/api/repositories', async (request) => workflow.repository(request.body));
  app.delete<{ Params: { id: string } }>('/api/repositories/:id', async (request) => {
    workflow.removeRepository(request.params.id);
    return { ok: true };
  });
  app.post('/api/skills/discover', async (request) => {
    const { path } = z.object({ path: z.string().min(1) }).parse(request.body);
    await workflow.git.git(['rev-parse', '--show-toplevel'], path);
    return availableSkills(workflow.skillsRoot, path);
  });
  app.post('/api/repositories/detect', async (request) => {
    const { path } = z.object({ path: z.string().min(1) }).parse(request.body);
    const root = await workflow.git.git(['rev-parse', '--show-toplevel'], path);
    return detectRepository(root);
  });
  app.put<{ Params: { id: string } }>('/api/projects/:id/budget', async (request) => {
    const { budgetUsd } = z.object({ budgetUsd: budgetSchema }).parse(request.body);
    const project = workflow.idle(request.params.id);
    return workflow.save({ ...project, budgetUsd });
  });
  app.put<{ Params: { id: string } }>('/api/repositories/:id', async (request) =>
    workflow.repository(request.body, request.params.id),
  );
  app.post('/api/projects', async (request) => workflow.create(request.body));
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) =>
    workflow.detail(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/projects/:id/events',
    async (request) => {
      workflow.get(request.params.id);
      return workflow.store.events(
        request.params.id,
        z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(request.query.after ?? 0),
      );
    },
  );
  const locks = new Set<string>();
  app.post<{ Params: { id: string; action: string } }>(
    '/api/projects/:id/actions/:action',
    async (request) => {
      const { id, action } = request.params;
      if (locks.has(id)) throw new Error('Another project action is in progress');
      locks.add(id);
      try {
        if (action === 'resume') workflow.enqueue(id);
        else if (action === 'stop') await workflow.stop(id);
        else if (action === 'approve-plan') workflow.approvePlan(id);
        else if (action === 'revise-plan')
          workflow.revisePlan(
            id,
            z.object({ feedback: z.string().min(1) }).parse(request.body).feedback,
          );
        else if (action === 'correct') {
          const body = z
            .object({ items: z.array(z.string()), feedback: z.string() })
            .parse(request.body);
          workflow.correct(id, body.items, body.feedback);
        } else if (action === 'publish') await workflow.approvePublication(id);
        else if (action === 'archive') await workflow.archive(id);
        else if (action === 'remove-worktree') await workflow.removeWorktree(id);
        else if (action === 'reverify') {
          const p = workflow.idle(id);
          if (!p.plan || p.worktreeRemoved || p.status === 'archived')
            throw new Error('Project cannot be verified');
          workflow.save({
            ...p,
            stage: 'test',
            status: 'new',
            acceptedFingerprint: undefined,
            commitSha: undefined,
          });
          workflow.enqueue(id);
        } else throw new Error('Unknown project action');
        return workflow.get(id);
      } finally {
        locks.delete(id);
      }
    },
  );
  app.post<{ Params: { id: string } }>('/api/questions/:id/answer', async (request) => {
    workflow.agent.answer(
      request.params.id,
      z
        .object({
          allow: z.boolean().optional(),
          remember: z.boolean().optional(),
          commandPrefix: z.string().trim().min(1).max(200).optional(),
          answers: z.record(z.string(), z.string()).optional(),
        })
        .parse(request.body),
    );
    return { ok: true };
  });
  app.put('/api/settings', async (request) => {
    const body = z.object({ concurrency: z.number().int().min(1).max(10) }).parse(request.body);
    workflow.store.setSetting('concurrency', body.concurrency);
    workflow.kick();
    return body;
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/terminals', async (request) => {
    const p = workflow.get(request.params.id);
    if (
      p.status === 'archived' ||
      p.stage === 'prepare' ||
      (p.stage === 'publish' && p.status === 'running')
    )
      throw new Error('Terminals are unavailable in this state');
    await workflow.git.assertWorktree(p);
    return workflow.terminals.start(p, { name: 'Shell', command: '', env: {} });
  });
  app.post<{ Params: { id: string; action: string } }>(
    '/api/terminals/:id/:action',
    async (request) => {
      const t = workflow.store.get<TerminalRecord>('terminals', request.params.id);
      if (!t || t.removedAt) throw new Error('Terminal not found');
      const p = workflow.get(t.projectId);
      if (request.params.action === 'stop') await workflow.terminals.stop(t.id);
      else if (request.params.action === 'remove') await workflow.terminals.remove(t.id);
      else if (request.params.action === 'restart') {
        if (
          p.status === 'archived' ||
          p.worktreeRemoved ||
          (p.stage === 'publish' && ['queued', 'running'].includes(p.status))
        )
          throw new Error('Cannot restart a terminal in this state');
        if (workflow.terminals.active.has(t.id))
          throw new Error('Stop the terminal before restarting');
        await workflow.git.assertWorktree(p);
        workflow.terminals.start(p, t, t.id);
      } else throw new Error('Unknown terminal action');
      return { ok: true };
    },
  );
  await app.register(websocket, { options: { maxPayload: 65536 } });
  app.get('/ws', { websocket: true }, (socket) => {
    const send = (event: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    };
    const event = (e: WorkflowEvent) => send({ type: 'event', event: e });
    const live = (data: unknown) => send({ type: 'live', data });
    workflow.store.bus.on('event', event);
    workflow.store.bus.on('live', live);
    socket.on('message', (bytes: Buffer) => {
      try {
        const input = z
          .discriminatedUnion('type', [
            z.object({
              type: z.literal('input'),
              terminalId: z.string(),
              text: z.string().max(32768),
            }),
            z.object({
              type: z.literal('resize'),
              terminalId: z.string(),
              cols: z.number().int(),
              rows: z.number().int(),
            }),
            z.object({ type: z.literal('attach'), terminalId: z.string() }),
          ])
          .parse(JSON.parse(bytes.toString()));
        const terminal = workflow.store.get<TerminalRecord>('terminals', input.terminalId);
        if (!terminal || terminal.removedAt) throw new Error('Terminal not found');
        const p = workflow.get(terminal.projectId);
        if (input.type === 'attach') {
          send({
            type: 'live',
            data: {
              kind: 'terminal_snapshot',
              projectId: terminal.projectId,
              terminalId: terminal.id,
              text: terminal.output,
            },
          });
          return;
        }
        if (p.stage === 'publish' && ['running', 'queued'].includes(p.status))
          throw new Error('Terminal input is paused during publication');
        if (input.type === 'input') workflow.terminals.input(input.terminalId, input.text);
        else workflow.terminals.resize(input.terminalId, input.cols, input.rows);
      } catch (error) {
        send({ type: 'error', error: String(error) });
      }
    });
    socket.on('close', () => {
      workflow.store.bus.off('event', event);
      workflow.store.bus.off('live', live);
    });
    send({ type: 'connected' });
  });
  const uiDir = options.uiDir ?? resolve('dist');
  if (existsSync(uiDir)) {
    await app.register(staticFiles, { root: uiDir });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  } else
    app.get('/', async (_request, reply) =>
      reply
        .type('text/html')
        .send(
          '<h1>AI Native Workflow</h1><p>Build the GUI with npm run build, or run npm run dev:ui and open <a href="http://127.0.0.1:5173">the development UI</a>.</p>',
        ),
    );
  return app;
}
