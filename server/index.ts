import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Store } from './store.js';
import { GitService } from './git.js';
import { ClaudeDriver } from './claude.js';
import { Terminals } from './terminals.js';
import { Workflow } from './workflow.js';
import { createApp } from './app.js';

const dataRoot = process.env.AI_NATIVE_DATA
  ? resolve(process.env.AI_NATIVE_DATA)
  : join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'ai-native-workflow');
await mkdir(dataRoot, { recursive: true });
const store = new Store(join(dataRoot, 'workflow.sqlite'));
const git = new GitService(join(dataRoot, 'worktrees'));
const workflow = new Workflow(
  store,
  git,
  new ClaudeDriver(store),
  new Terminals(store),
  dataRoot,
  resolve('skills'),
);
const port = Number(process.env.PORT ?? 4317);
const app = await createApp(workflow, { port });
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`AI Native Workflow: http://127.0.0.1:${port}\nLocal data: ${dataRoot}`);
} catch (error) {
  console.error(error);
  store.close();
  process.exit(1);
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await workflow.close();
  await app.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
