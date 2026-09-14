import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUpdate, command, maintenancePage } from './update-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 4317);
const npmCli =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const logPath = join(root, 'application-update.log');
let child;
let maintenance;
let updating = false;
let stopping = false;
let state;
const commands = new AbortController();

function log(text) {
  state.log = ((state.log ?? '') + text).slice(-16000);
  process.stdout.write(text);
  appendFileSync(logPath, text);
}

function start(result) {
  return new Promise((resolve, reject) => {
    const current = fork(join(root, 'server/index.ts'), [], {
      cwd: root,
      execArgv: ['--import', 'tsx'],
      windowsHide: true,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        AI_NATIVE_SUPERVISED: '1',
        AI_NATIVE_UPDATE_RESULT: result ? JSON.stringify(result) : '',
      },
    });
    child = current;
    const timer = setTimeout(() => {
      reject(new Error('The updated server did not become ready within 30 seconds.'));
    }, 30000);
    current.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timer);
        resolve();
      } else if (message?.type === 'update' && !updating && !stopping) {
        updating = true;
        // Let the API response and the browser's progress page finish loading.
        setTimeout(() => void update(message.plan, message.id), 1000);
      }
    });
    current.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    current.on('exit', (code) => {
      clearTimeout(timer);
      if (child === current) child = undefined;
      reject(new Error(`The application exited before becoming ready (exit ${code}).`));
      if (!updating && !stopping) process.exit(code ?? 1);
    });
  });
}

async function stopChild() {
  const current = child;
  if (!current || current.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The application did not stop. No files were updated.')),
      30000,
    );
    current.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    current.send({ type: 'shutdown' }, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

async function serveProgress() {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  maintenance = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const origin = request.headers.origin;
    if (
      !hosts.has(request.headers.host) ||
      (origin && ![...hosts].some((host) => origin === `http://${host}`)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    if (
      request.method !== 'GET' ||
      url.pathname !== '/update-status' ||
      url.searchParams.get('key') !== state.id
    ) {
      response
        .writeHead(503, { 'Content-Type': 'text/plain' })
        .end('Application update in progress. Keep the update status page open.');
      return;
    }
    response.setHeader(
      'Content-Type',
      url.searchParams.has('json') ? 'application/json' : 'text/html; charset=utf-8',
    );
    response.end(url.searchParams.has('json') ? JSON.stringify(state) : maintenancePage());
  });
  await new Promise((resolve, reject) => {
    maintenance.once('error', reject);
    maintenance.listen(port, '127.0.0.1', resolve);
  });
}

async function stopProgress() {
  if (!maintenance?.listening) return;
  await new Promise((resolve, reject) =>
    maintenance.close((error) => (error ? reject(error) : resolve())),
  );
}

async function update(plan, id) {
  if (stopping) return;
  state = { id, status: 'installing', message: 'Stopping the application…', offline: true };
  let stopped = false;
  try {
    if (!existsSync(npmCli))
      throw new Error('Cannot find npm. Start the application with npm start.');
    await stopChild();
    stopped = true;
    await serveProgress();
    const run = (exe, args, cwd) => command(exe, args, cwd, log, commands.signal);
    log(`\nApplication update ${new Date().toISOString()}: ${plan.before} → ${plan.target}\n`);
    state.message = 'Installing the latest source from GitHub…';
    await applyUpdate(root, plan, run);
    state.message = 'Installing dependencies…';
    await run(process.execPath, [npmCli, 'ci', '--include=dev', '--no-audit', '--no-fund'], root);
    state.message = 'Building the application…';
    await run(process.execPath, [npmCli, 'run', 'build'], root);
    state.status = 'restarting';
    state.message = 'Restarting the application…';
    await stopProgress();
    await start({
      id,
      status: 'updated',
      message: 'Application updated successfully.',
      revision: plan.target,
    });
    updating = false;
  } catch (error) {
    if (stopping) return;
    state = {
      ...state,
      status: 'error',
      message: `Update failed: ${error.message} Stop this launcher, resolve the problem in ${root}, then run npm ci, npm run build and npm start. Details: ${logPath}`,
    };
    console.error(state.message);
    if (!stopped && child?.connected) {
      // A pre-shutdown failure can be reported by the still-running application.
      child.send({ type: 'update-error', state: { ...state, offline: false } });
      updating = false;
    } else if (!maintenance?.listening) {
      const failedChild = child;
      if (failedChild && failedChild.exitCode === null) {
        await new Promise((resolve) => {
          failedChild.once('exit', resolve);
          failedChild.kill();
        });
      }
      try {
        await serveProgress();
      } catch (error) {
        console.error(error);
      }
    }
  }
}

async function close() {
  if (stopping) return;
  stopping = true;
  commands.abort();
  try {
    await stopChild();
    await stopProgress();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
process.on('message', (message) => {
  if (message?.type === 'shutdown') void close();
});
process.on('disconnect', () => void close());
try {
  await start();
} catch (error) {
  console.error(error);
  await close();
}
