import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const commands = [
  ['seller', ['node_modules/tsx/dist/cli.mjs', 'apps/seller/src/index.ts']],
  ['buyer', ['node_modules/tsx/dist/cli.mjs', 'apps/buyer/src/index.ts']],
  ['page', ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts', '--host', '127.0.0.1', '--port', '5178', '--strictPort']]
];
let closing = false;
const children = commands.map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!closing) { console.error(`${name} stopped (${code})`); stop(code || 1); } });
  return child;
});
function stop(code) { if (closing) return; closing = true; children.forEach(c => c.kill('SIGTERM')); process.exitCode = code; }
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
