import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { startEngine } from './engine.js';

try {
  const engine = await startEngine({
    dataRoot: process.env.AI_NATIVE_DATA
      ? resolve(process.env.AI_NATIVE_DATA)
      : join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'ai-native-workflow'),
    worktreesRoot: process.env.AI_NATIVE_WORKTREES,
    port: Number(process.env.PORT ?? 4317),
  });
  console.log(
    `AI Native Workflow: ${engine.app.listeningOrigin}\nLocal data: ${engine.dataRoot}\nWorktrees: ${engine.workflow.git.root}`,
  );
  const close = () => {
    void engine.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
