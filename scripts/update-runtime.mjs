// Deliberately uses only Node built-ins: npm ci replaces node_modules during an update.
import { spawn } from 'node:child_process';

export async function command(exe, args, cwd, output = () => {}, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    let stdout = '';
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => child.kill());
      } else child.kill();
    };
    const timer = setTimeout(stop, 10 * 60 * 1000);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const collect = (data) => {
      const value = data.toString();
      text = (text + value).slice(-16000);
      output(value);
    };
    child.stdout.on('data', (data) => {
      stdout = (stdout + data.toString()).slice(-16000);
      collect(data);
    });
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (cancelled) reject(new Error(`${exe} ${args[0]} was cancelled or timed out.`));
      else if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${exe} ${args[0]} failed (exit ${code}). ${text.trim()}`));
    });
  });
}

export async function prepareUpdate(root, run = command) {
  const git = (...args) => run('git', args, root);
  const remote = await git('remote', 'get-url', 'origin');
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)FerrisOfficial\/ai-native(?:\.git)?\/?$/i.test(
      remote,
    )
  )
    throw new Error('The application origin must point to FerrisOfficial/ai-native on GitHub.');
  if (await git('status', '--porcelain', '--untracked-files=all'))
    throw new Error('The application has local changes. Commit or move them before updating.');
  const head = await git('ls-remote', '--symref', 'origin', 'HEAD');
  const branch = /^ref: refs\/heads\/([^\s]+)\s+HEAD$/m.exec(head)?.[1];
  if (!branch) throw new Error('Could not discover the default branch on GitHub.');
  await git('check-ref-format', `refs/heads/${branch}`);
  if ((await git('symbolic-ref', '--quiet', '--short', 'HEAD')) !== branch)
    throw new Error(`Switch the application checkout to ${branch} before updating.`);
  const before = await git('rev-parse', 'HEAD');
  await git('fetch', '--no-tags', 'origin', `refs/heads/${branch}`);
  const target = await git('rev-parse', 'FETCH_HEAD');
  if (!/^[a-f0-9]{40,64}$/.test(target)) throw new Error('Invalid update revision.');
  try {
    await git('merge-base', '--is-ancestor', before, target);
  } catch {
    throw new Error(
      'The application has local commits or diverged history. Update the branch manually.',
    );
  }
  return { before, target, branch };
}

export async function applyUpdate(root, plan, run = command) {
  const git = (...args) => run('git', args, root);
  if (
    (await git('rev-parse', 'HEAD')) !== plan.before ||
    (await git('symbolic-ref', '--quiet', '--short', 'HEAD')) !== plan.branch ||
    (await git('status', '--porcelain', '--untracked-files=all'))
  )
    throw new Error(
      'The application checkout changed while the update was being prepared. Retry after resolving local changes.',
    );
  await git('merge', '--ff-only', '--no-edit', plan.target);
}

export function maintenancePage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Updating AI Native Workflow</title><style>
body{background:#f7f8fa;color:#272831;font:16px/1.6 system-ui;margin:0;padding:8vh 6vw}main{max-width:780px;margin:auto;background:white;padding:32px;border:1px solid #e9eaf0;border-radius:16px}h1{font-size:26px}p{color:#646675}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8fa;padding:20px;border-radius:12px;max-height:45vh;overflow:auto;font-size:12px}a{color:#7352d6}a[hidden]{display:none}
</style><main><h1>Updating AI Native Workflow</h1><p id="message" role="status" aria-live="polite">Connecting to the updater…</p><pre id="log" hidden></pre><a id="back" hidden href="/#settings">Back to Settings</a></main>
<script>
const url=new URL(location.href);url.searchParams.set('json','1');
async function poll(){try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Reconnecting');const state=await response.json();document.getElementById('message').textContent=state.message;const log=document.getElementById('log');log.hidden=!state.log;log.textContent=state.log||'';if(state.status==='updated'||state.status==='current'){location.replace('/#settings');return;}if(state.status==='error'){document.getElementById('back').hidden=state.offline;return;}}catch{}setTimeout(poll,1500);}poll();
</script></html>`;
}
