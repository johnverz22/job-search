// `npm run dev`: the API/crawler (restarts on change) on :8080 and the Vite dev server, which proxies /api to it.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [['run', 'dev:server'], ['run', 'dev', '--prefix', 'web']].map((args) =>
  spawn(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' }));

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  process.exitCode = code;
}
for (const c of children) c.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
