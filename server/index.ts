import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { startEngine } from './engine.js';
import { AppUpdater } from './updater.js';

const updater = new AppUpdater(
  process.env.AI_NATIVE_SUPERVISED === '1' && process.send
    ? (plan, id) => {
        if (!process.connected)
          throw new Error('The application launcher disconnected. Restart with npm start.');
        process.send!({ type: 'update', plan, id }, (error) => {
          if (error) updater.state = { id, status: 'error', message: error.message };
        });
      }
    : undefined,
  undefined,
  process.env.AI_NATIVE_UPDATE_RESULT ? JSON.parse(process.env.AI_NATIVE_UPDATE_RESULT) : undefined,
);

try {
  const engine = await startEngine({
    dataRoot: process.env.AI_NATIVE_DATA
      ? resolve(process.env.AI_NATIVE_DATA)
      : join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'ai-native-workflow'),
    worktreesRoot: process.env.AI_NATIVE_WORKTREES,
    port: Number(process.env.PORT ?? 4317),
    updater,
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
  process.on('message', (message: { type?: string; state?: typeof updater.state }) => {
    if (message.type === 'shutdown') close();
    if (message.type === 'update-error' && message.state) updater.state = message.state;
  });
  process.on('disconnect', close);
  process.send?.({ type: 'ready' });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
