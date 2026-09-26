import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const npmCli = process.env.npm_execpath;

function readGit(args, label) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim() ?? `exit ${result.status ?? 1}`;
    console.error(`[ci:local] METADATA FAIL: ${label} (${detail})`);
    process.exit(1);
  }
  return result.stdout.trim();
}

const head = readGit(['rev-parse', 'HEAD'], 'git HEAD');
const dirty = readGit(['status', '--porcelain', '--untracked-files=normal'], 'git dirty state') !== '';

console.log(`[ci:local] Node: ${process.version}`);
console.log(`[ci:local] Git HEAD: ${head}`);
console.log(`[ci:local] Git dirty: ${dirty ? 'yes' : 'no'}`);

if (!npmCli) {
  console.error('[ci:local] SETUP FAIL: npm_execpath is unavailable; run this command through npm run ci:local.');
  process.exit(1);
}

let vitestEntry;
try {
  vitestEntry = resolve(dirname(require.resolve('vitest/package.json')), require('vitest/package.json').bin.vitest);
} catch {
  console.error('[ci:local] SETUP FAIL: the locally installed Vitest entry was not found. Install steps are intentionally not run.');
  process.exit(1);
}

const steps = [
  { name: 'typecheck', command: process.execPath, args: [npmCli, 'run', 'typecheck'] },
  {
    name: 'offline Vitest suite (all discovered tests, one worker)',
    command: process.execPath,
    args: [vitestEntry, 'run', '--maxWorkers=1'],
  },
  { name: 'private page build', command: process.execPath, args: [npmCli, 'run', 'private:risk:build'] },
  { name: 'buyer production build', command: process.execPath, args: [npmCli, 'run', 'build'] },
];

const results = [];

function printResults() {
  console.log('[ci:local] Step results:');
  for (const result of results) {
    console.log(`[ci:local] ${result.name}: ${result.status} (exit ${result.exitCode})`);
  }
  for (const step of steps.slice(results.length)) {
    console.log(`[ci:local] ${step.name}: NOT RUN (fail-fast)`);
  }
}

for (const [index, step] of steps.entries()) {
  console.log(`[ci:local] STEP ${index + 1}/${steps.length} START: ${step.name}`);
  const result = spawnSync(step.command, step.args, { stdio: 'inherit' });
  const exitCode = result.status ?? 1;

  if (result.error || exitCode !== 0) {
    results.push({ name: step.name, status: 'FAIL', exitCode });
    if (result.error) console.error(`[ci:local] ${step.name}: ${result.error.message}`);
    printResults();
    process.exit(exitCode);
  }

  results.push({ name: step.name, status: 'PASS', exitCode });
  console.log(`[ci:local] STEP ${index + 1}/${steps.length} PASS (exit ${exitCode}): ${step.name}`);
}

printResults();
