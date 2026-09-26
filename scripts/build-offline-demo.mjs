import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const entry = new URL('../apps/web/src/demo-main.tsx', import.meta.url);
const cssPath = new URL('../apps/web/src/pay-assessment.css', import.meta.url);
const outputPath = new URL('../docs/offline-pay.html', import.meta.url);

const bundled = await build({
  entryPoints: [fileURLToPath(entry)], bundle: true, write: false, format: 'iife', platform: 'browser',
  target: ['es2022'], jsx: 'automatic', minify: true, charset: 'utf8', absWorkingDir: projectRoot,
  loader: { '.css': 'empty' },
});
const script = bundled.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundled.outputFiles[0]?.text;
if (!script) throw new Error('Offline demo JavaScript bundle was not generated.');
const css = await readFile(cssPath, 'utf8');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'">
<title>付款评估演示</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
await writeFile(outputPath, html, 'utf8');
console.log(`Built ${fileURLToPath(outputPath)} (${Buffer.byteLength(html)} bytes, all assets inline)`);
