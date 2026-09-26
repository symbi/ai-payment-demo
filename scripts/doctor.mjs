import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [major, minor] = process.versions.node.split('.').map(Number);
const runtimeOK = major >= 22 && major < 27 && (major !== 22 || minor >= 12);
const packages = ['express', 'react', 'vite', 'vitest', '@x402/core'];
const installed = packages.every(name => { try { require.resolve(name); return true; } catch { return false; } });
console.log(JSON.stringify({node: process.version, runtimeOK, dependenciesInstalled: installed,
  envFilePresent: existsSync(new URL('../.env', import.meta.url)),
  note: 'No secret values read or displayed. Missing API key must hold payment.'}, null, 2));
process.exitCode = runtimeOK && installed ? 0 : 1;
