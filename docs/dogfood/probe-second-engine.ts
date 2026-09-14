/** Reproduce startup recovery before port acquisition, using disposable data only. */
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../../server/store.js';

await mkdir(resolve('.data/dogfood'), { recursive: true });
const root = await mkdtemp(resolve('.data/dogfood/second-engine-'));
const store = new Store(join(root, 'workflow.sqlite'));
const records = ['projects', 'runs', 'terminals', 'questions'] as const;
for (const table of records) {
  store.put(table, { id: 'probe', status: table === 'questions' ? 'pending' : 'running' });
}
const occupied = createServer();
await new Promise<void>((done) => occupied.listen(0, '127.0.0.1', done));
const port = (occupied.address() as { port: number }).port;
let stderr = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), AI_NATIVE_DATA: root },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.resume();
child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
const code = await new Promise<number | null>((done, reject) => {
  child.on('exit', done);
  child.on('error', reject);
});
const result = {
  isolatedData: root,
  portWasOccupied: true,
  exitCode: code,
  addressInUseReported: stderr.includes('EADDRINUSE'),
  afterFailedStartup: Object.fromEntries(
    records.map((table) => [table, store.get<{ status: string }>(table, 'probe')?.status]),
  ),
};
await writeFile(
  resolve('docs/dogfood/second-engine-result.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
store.close();
await new Promise<void>((done) => occupied.close(() => done()));
