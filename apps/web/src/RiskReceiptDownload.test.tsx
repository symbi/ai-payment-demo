import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION, type PrivateScanStatus } from '../../../shared/private-risk.ts';
import { RiskReceiptDownload } from './RiskReceiptDownload.tsx';

const status: PrivateScanStatus = {
  contractRevision: PRIVATE_SCAN_REVISION,
  mode: 'private-scan-only',
  paymentEnabled: false,
  ready: true,
  message: '',
  maxRequests: 3,
  usedRequests: 1,
  records: [{
    candidateId: 'H1', state: 'completed', attemptedAt: '2026-09-27T01:00:00.000Z',
    risk: {
      address: PRIVATE_RISK_CANDIDATES[0].address, checkedAt: '2026-09-27T01:02:03.000Z',
      provider: 'intercepta', source: 'live', decision: 'hold', reasons: ['not rendered'],
      scan: { transport: 'received', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified', toxicScore: 0, traitsCount: 0, traitLabels: [] },
    },
  }],
};

it('enables the fixed-label download only for an existing valid selected record', () => {
  const enabled = renderToStaticMarkup(createElement(RiskReceiptDownload, { status, candidateId: 'H1' }));
  const missing = renderToStaticMarkup(createElement(RiskReceiptDownload, { status, candidateId: 'G1' }));
  const invalid = renderToStaticMarkup(createElement(RiskReceiptDownload, { status: { ...status, token: 'secret' }, candidateId: 'H1' }));
  expect(enabled).toContain('下载本次评估摘要');
  expect(enabled).not.toContain('disabled');
  expect(enabled).not.toContain('not rendered');
  expect(missing).toContain('disabled');
  expect(invalid).toContain('disabled');
});
