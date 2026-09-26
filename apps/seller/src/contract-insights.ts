import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const INSIGHTS_PATH = '/api/contract-insights';
export const SAMPLE_PATH = `${INSIGHTS_PATH}/sample`;
export const SAMPLE_FILE = new URL('../samples/ExampleVault.sol', import.meta.url);
interface Token { value: string; line: number }
interface Declaration { name: string; line: number }
type Category = 'functions' | 'events' | 'modifiers';

/** Lexical declaration inventory, not a Solidity parser/compiler or security analysis. */
export function extractDeclarations(source: string): Record<Category, Declaration[]> {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) { if (ch === '\n') line++; i++; continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) {
      i += 2;
      while (i < source.length && !source.startsWith('*/', i)) { if (source[i] === '\n') line++; i++; }
      if (i === source.length) throw new Error('Unterminated comment');
      i += 2; continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch; i++; let closed = false;
      while (i < source.length) {
        if (source[i] === '\n') line++;
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === quote) { closed = true; break; }
      }
      if (!closed) throw new Error('Unterminated string');
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (word) { tokens.push({ value: word[0], line }); i += word[0].length; }
    else { tokens.push({ value: ch, line }); i++; }
  }
  const declarations: Record<Category, Declaration[]> = { functions: [], events: [], modifiers: [] };
  let depth = 0; let contracts = 0;
  const category: Record<string, Category> = { function: 'functions', event: 'events', modifier: 'modifiers' };
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]!;
    if (['import', 'library', 'interface', 'assembly'].includes(t.value)) throw new Error('Unsupported sample construct');
    if (t.value === 'contract') {
      if (depth !== 0 || ++contracts !== 1 || tokens[n + 2]?.value !== '{') throw new Error('Only one non-inherited sample contract is supported');
    }
    if (t.value === '{') depth++;
    if (t.value === '}' && --depth < 0) throw new Error('Unbalanced braces');
    const key = Object.hasOwn(category, t.value) ? category[t.value] : undefined;
    if (depth === 1 && key) {
      const name = tokens[n + 1];
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name.value) || tokens[n + 2]?.value !== '(') throw new Error('Unsupported declaration');
      declarations[key].push({ name: name.value, line: t.line });
    }
  }
  if (depth !== 0 || contracts !== 1) throw new Error('Unbalanced or missing sample contract');
  return declarations;
}

export function createSampleReports() {
  const sourceText = readFileSync(SAMPLE_FILE, 'utf8');
  const declarations = extractDeclarations(sourceText);
  const source = { filename: 'ExampleVault.sol', path: 'apps/seller/samples/ExampleVault.sol',
    sha256: createHash('sha256').update(sourceText).digest('hex'), language: 'Solidity', origin: 'bundled-demo' };
  const common = {
    schemaVersion: 'contract-insights/v1', sampleName: 'ExampleVault', source,
    metrics: (['functions', 'events', 'modifiers'] as const).map(key => ({ key,
      label: key[0]!.toUpperCase() + key.slice(1), value: declarations[key].length })),
    method: 'Deterministic lexical declaration inventory of the bundled ExampleVault.sol only; comments and strings skipped, contract body depth checked.',
    limitations: ['Only the bundled teaching sample is served; arbitrary source/address analysis is unsupported.',
      'Not a Solidity compiler, semantic analysis, vulnerability scan, risk score, or safety assessment.',
      'Counts named explicit declarations only; excludes constructor, generated getters, inheritance and runtime behavior.',
      'This sample is not deployed; its source is not the payment recipient address or an Intercepta scan target.'],
  };
  return {
    preview: { kind: 'public-sample' as const, source: { filename: source.filename, sha256: source.sha256 },
      metrics: { functions: declarations.functions.length, events: declarations.events.length, modifiers: declarations.modifiers.length },
      method: common.method, limitations: common.limitations },
    report: { ...common, kind: 'paid-structure-report' as const, declarations },
  };
}
