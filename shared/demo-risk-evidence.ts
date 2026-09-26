import type { RiskResult } from './contracts.ts';

export type DemoRiskFixture = {
  sourceLabel: '接口格式模拟样例（synthetic）';
  scan: NonNullable<RiskResult['scan']>;
};

const received = (toxicScore: number, traitLabels: string[]): DemoRiskFixture => ({
  sourceLabel: '接口格式模拟样例（synthetic）',
  scan: {
    transport: 'received', toxicScore, traitsCount: traitLabels.length, traitLabels,
    requestedNetwork: 'eip155:84532', coverage: 'unverified', semantics: 'unverified',
  },
});

/** Synthetic interface examples only; none are provider observations or address claims. */
export const DEMO_RISK_FIXTURES: Readonly<Record<string, DemoRiskFixture>> = {
  'known-risk-a': received(87, ['known_scammer', 'blacklist']),
  'known-risk-b': received(72, ['sanction_address', 'suspicious_deployer']),
  'controlled-a': received(0, []),
  'controlled-b': received(0, []),
  'gray-complete': received(35, ['non_kyc_transfers']),
  'gray-stale': {
    sourceLabel: '接口格式模拟样例（synthetic）',
    scan: { transport: 'unavailable', requestedNetwork: 'eip155:84532', coverage: 'unverified', semantics: 'unverified' },
  },
};
