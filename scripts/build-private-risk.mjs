import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../apps/web/src/private-risk-main.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2022'], jsx: 'automatic', minify: true, charset: 'utf8', absWorkingDir: root, loader: { '.css': 'empty' } });
const script = bundle.outputFiles[0].text;
const css = 'body{margin:0;background:#07120e}' + (await Promise.all(['task-authorization.css','private-risk.css'].map(name => readFile(new URL(`../apps/web/src/${name}`, import.meta.url), 'utf8')))).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'"><title>Agent Payment Guard</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
await writeFile(new URL('../docs/private-risk.html', import.meta.url), html);
console.log(`Built private-risk.html (${Buffer.byteLength(html)} bytes, inline assets; no scan performed)`);
