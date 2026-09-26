import { describeScanSchema } from '../../../shared/scan-diagnostic.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { RiskResult } from '../../../shared/contracts.ts';
import { PRIVATE_SCAN_REVISION, PRIVATE_RISK_CANDIDATES, type PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

type Scan = NonNullable<RiskResult['scan']>;
function render(scan: Partial<Scan> = {}, source: 'live' | 'unavailable' = 'unavailable', reasons = ['SECRET_PROVIDER_TEXT']) {
  const status: PrivateScanStatus = {
    contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false, ready: true,
    message: '', maxRequests: 3, usedRequests: 1,
    records: [{ candidateId: 'H1', state: source === 'live' ? 'completed' : 'unavailable', attemptedAt: '2026-09-27T01:00:00.000Z', risk: {
      address: PRIVATE_RISK_CANDIDATES[0].address, checkedAt: '2026-09-27T01:00:00.000Z', provider: 'intercepta', source, decision: 'hold', reasons,
      scan: { transport: 'unavailable', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified', ...scan },
    } }],
  };
  return renderToStaticMarkup(createElement(PrivateRiskPanel, {
    selectedId: 'H1', status, loading: false, message: '', onSelect() {}, onScan() {}, onRefresh() {},
  }));
}

it('shows schema failure with HTTP 200 without discarding unavailable diagnostics', () => {
  const html = render({ transport: 'received', httpStatus: 200, diagnosticCode: 'schema-unsupported', schemaDiagnostic: {
    topLevelKeys: ['toxicScore', 'traits', 'metadata'], otherKeysCount: 2, toxicScoreType: 'string', traitsType: 'array', traitsCount: 3,
  } });
  expect(html).toContain('core schema is unsupported');
  expect(html).toContain('>200<');
  expect(html).toContain('toxicScore, traits, metadata');
  expect(html).toContain('Response traits length');
  expect(html).toContain('>3<');
  expect(html).toContain('HOLD');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
});

it.each([
  ['http-error', 'non-success HTTP status'], ['body-invalid', 'could not be read'], ['timeout', 'timed out'],
  ['transport-error', 'transport failed'], ['configuration', 'Local scan configuration'],
] as const)('renders safe %s explanation even for unavailable records', (diagnosticCode, expected) => {
  const html = render({ diagnosticCode, ...(diagnosticCode === 'http-error' ? { httpStatus: 429 } : {}) });
  expect(html).toContain(expected);
  expect(html).toContain('HOLD');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
  if (diagnosticCode === 'http-error') expect(html).toContain('>429<');
});

it('keeps totals, unknown traits, extra fields and displayed known labels distinct', () => {
  const html = render({ transport: 'received', httpStatus: 200, diagnosticCode: 'observed', toxicScore: 0,
    traitsCount: 4, unknownTraitsCount: 2, additionalFieldsCount: 3, traitLabels: ['rug_pull', 'blacklist'],
  }, 'live');
  expect(html).toContain('Evidence</dt><dd>4');
  expect(html).toContain('Total observed traits</dt><dd>4');
  expect(html).toContain('Unknown trait count</dt><dd>2');
  expect(html).toContain('Ignored additional fields</dt><dd>3');
  expect(html).toContain('Displayed known labels</dt><dd>2');
  expect(html).toContain('rug_pull');
  expect(html).toContain('blacklist');
  expect(html).toContain('Some provider evidence is not yet understood');
  expect(html).toContain('HOLD');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
});

it('maps only exact known legacy reasons and never exposes arbitrary reason text', () => {
  expect(render({}, 'unavailable', ['Unsupported scan response. Review required.'])).toContain('core schema is unsupported');
  const unknown = render({}, 'unavailable', ['Scan service unavailable. SECRET_PROVIDER_TEXT']);
  expect(unknown).toContain('legacy record contains no bounded diagnostic category');
  expect(unknown).not.toContain('SECRET_PROVIDER_TEXT');
  expect(unknown).toContain('HTTP status</dt><dd>Not recorded');
});

it('does not render unvalidated schema names or type text', () => {
  const html = render({ schemaDiagnostic: { topLevelKeys: ['SECRET_KEY_NAME'], otherKeysCount: 0,
    toxicScoreType: 'SECRET_TYPE', traitsType: 'array' } });
  expect(html).not.toContain('SECRET_KEY_NAME');
  expect(html).not.toContain('SECRET_TYPE');
});

it('renders bounded known-field failures and unknown counts without trait values', () => {
  const html = render({ transport:'received', httpStatus:200, diagnosticCode:'schema-unsupported', schemaDiagnostic:describeScanSchema({toxicScore:1, traits:[{name:'known_scammer'},{name:'SECRET-UNKNOWN'}]}) });
  expect(html).toContain('missing / invalid risk');
  expect(html).toContain('Description missing / invalid');
  expect(html).toContain('Malformed items');
  expect(html).not.toContain('SECRET');
});

it('explains provider omission of optional txsCount while keeping HOLD', () => {
  const html = render({ transport: 'received', httpStatus: 200, diagnosticCode: 'observed',
    schemaDiagnostic: describeScanSchema({ toxicScore: 1, traits: [{ name: 'rug_pull', risk: 1, description: '' }] }),
  }, 'live');
  expect(html).toContain('Optional txsCount missing / invalid');
  expect(render({ diagnosticCode: 'observed' }, 'live')).toContain('Missing values remain missing');
  expect(html).toContain('HOLD');
});
