import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSampleReports, extractDeclarations, SAMPLE_FILE } from './contract-insights.ts';

describe('bundled sample lexical inventory (not a Solidity compiler)', () => {
  it('derives counts and source lines from the actual bundled sample', () => {
    const { preview, report } = createSampleReports();
    expect(preview.metrics).toEqual({ functions: 4, events: 2, modifiers: 1 });
    const lines = readFileSync(SAMPLE_FILE, 'utf8').split('\n');
    expect(report.declarations.functions.map(x => x.name)).toEqual(['deposit', 'balanceOf', 'withdraw', 'transferOwnership']);
    for (const entries of Object.values(report.declarations)) {
      for (const d of entries) expect(lines[d.line - 1]).toContain(d.name);
    }
    expect(preview).not.toHaveProperty('declarations');
    expect(preview.source.sha256).toBe(report.source.sha256);
    expect(JSON.parse(readFileSync(new URL('../samples/public-sample.json', import.meta.url), 'utf8'))).toEqual(preview);
  });
  it('skips comment/string keywords and nested body keywords without shifting source lines', () => {
    const s = `contract Demo {
      // function phantom() {} event Fake();
      /* modifier misleading() { } */
      string constant text = "function fake() { event Nothing(); }";
      function real() external { string memory x = 'modifier fake() {}'; }
      event Seen(uint x);
      modifier gate() { _; }
    }`;
    expect(extractDeclarations(s)).toEqual({ functions: [{ name: 'real', line: 5 }], events: [{ name: 'Seen', line: 6 }], modifiers: [{ name: 'gate', line: 7 }] });
  });
  it.each(['contract X { /*', 'contract X { string x = "open;', 'contract X {',
    'contract X is Y {}', 'contract X {} contract Y {}', 'import "x"; contract X {}',
    'contract X { function () external {} }'])('rejects unsupported or incomplete sample input', source => {
    expect(() => extractDeclarations(source)).toThrow();
  });
});
