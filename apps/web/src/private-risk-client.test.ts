import { describe, expect, it, vi } from 'vitest';
import { PrivateRiskClient } from './private-risk-client.ts';
import { CANDIDATE_NETWORK, PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION, isPrivateScanStatus, type PrivateCandidateId, type PrivateScanRecord, type PrivateScanStatus } from '../../../shared/private-risk.ts';

// Injected synthetic response shapes only. No API request, provider verification or payment.
const empty = (): PrivateScanStatus => ({ contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false, ready: true, message: 'test-only', maxRequests: 3, usedRequests: 0, records: [] });
function record(candidateId: PrivateCandidateId, score = 0): PrivateScanRecord {
  return { candidateId, state: 'completed', attemptedAt: '2026-09-27T00:00:00Z', risk: {
    address: PRIVATE_RISK_CANDIDATES.find(item => item.id === candidateId)!.address, checkedAt: '2026-09-27T00:00:01Z', provider: 'intercepta', source: 'live', decision: 'hold', reasons: ['test-only unverified semantics'],
    scan: { transport: 'received', toxicScore: score, traitsCount: 0, traitLabels: [], requestedNetwork: CANDIDATE_NETWORK, coverage: 'unverified', semantics: 'unverified' },
  } };
}
function status(...records: PrivateScanRecord[]): PrivateScanStatus { return { ...empty(), usedRequests: records.length, records }; }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(resolveValue => { resolve = resolveValue; }); return { resolve, promise }; }

describe('private scan client with injected offline transport', () => {
  it('selection alone never scans, and refresh only reads existing records', async () => {
    const request = vi.fn(async () => empty());
    const client = new PrivateRiskClient(() => {}, request);
    client.select('L1');
    expect(request).not.toHaveBeenCalled();
    await client.refresh();
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/private-risk/status', undefined);
  });
  it('a scan needs confirmed readiness and sends only the fixed candidate id', async () => {
    const request = vi.fn(async (path: string) => path.endsWith('status') ? empty() : status(record('H1')));
    const client = new PrivateRiskClient(() => {}, request);
    await client.scan();
    expect(request).not.toHaveBeenCalled();
    await client.refresh(); await client.scan();
    expect(request).toHaveBeenLastCalledWith('/api/private-risk/scan', { candidateId: 'H1' });
    expect(client.state.status?.records[0].risk?.scan?.toxicScore).toBe(0);
    expect(client.state.status?.records[0].risk?.decision).toBe('hold');
    await client.scan();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('blocks double clicks and does not switch the selected address on a late result', async () => {
    const pending = deferred();
    const request = vi.fn((path: string) => path.endsWith('status') ? Promise.resolve(empty()) : pending.promise);
    const client = new PrivateRiskClient(() => {}, request);
    await client.refresh(); const first = client.scan(); await client.scan();
    client.select('G1'); pending.resolve(status(record('H1'))); await first;
    expect(request).toHaveBeenCalledTimes(2);
    expect(client.state.selectedId).toBe('G1');
    expect(client.state.status?.records.some(item => item.candidateId === 'G1')).toBe(false);
  });
  it.each([
    { ...empty(), ready: false },
    status(record('H1'), record('G1'), record('L1')),
    status({ candidateId: 'G1', state: 'pending', attemptedAt: '2026-09-27T00:00:00Z', risk: null }),
  ])('does not scan when disabled, exhausted or another attempt is pending', async initial => {
    const request = vi.fn(async () => initial);
    const client = new PrivateRiskClient(() => {}, request);
    await client.refresh(); await client.scan();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'malformed', 'wrong candidate'])('never retries an uncertain or invalid scan: %s', async mode => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('status')) return empty();
      if (mode === 'throw') throw new Error('private detail must not reach UI');
      return mode === 'malformed' ? { allow: true } : status(record('L1'));
    });
    const client = new PrivateRiskClient(() => {}, request);
    await client.refresh(); await client.scan(); await client.scan();
    expect(request).toHaveBeenCalledTimes(2);
    expect(client.state.status).toBeNull();
    expect(client.state.message).toContain('结果未确认');
    expect(client.state.message).not.toContain('private detail');
  });
  it('does not update the UI after disposal', async () => {
    const pending = deferred(); const onChange = vi.fn();
    const client = new PrivateRiskClient(onChange, () => pending.promise);
    const work = client.refresh(); const before = onChange.mock.calls.length;
    client.dispose(); pending.resolve(empty()); await work;
    expect(onChange).toHaveBeenCalledTimes(before);
  });
});

describe('private result envelope validation', () => {
  it('accepts a bounded zero raw score without inventing safety or a combined score', () => {
    expect(isPrivateScanStatus(status(record('H1', 0)))).toBe(true);
    expect(isPrivateScanStatus({ ...empty(), combinedScore: 0 })).toBe(false);
  });
  it.each(['address', 'decision', 'source', 'paymentEnabled', 'trait', 'count', 'duplicate'])('rejects invalid boundary: %s', change => {
    const value = status(record('H1'));
    const risk = value.records[0].risk!;
    if (change === 'address') risk.address = PRIVATE_RISK_CANDIDATES[4].address;
    if (change === 'decision') risk.decision = 'allow';
    if (change === 'source') risk.source = 'fixture';
    if (change === 'paymentEnabled') (value as { paymentEnabled: boolean }).paymentEnabled = true;
    if (change === 'trait') risk.scan!.traitLabels = ['untrusted-label'];
    if (change === 'count') value.usedRequests = 0;
    if (change === 'duplicate') { value.records.push(value.records[0]); value.usedRequests = 2; }
    expect(isPrivateScanStatus(value)).toBe(false);
  });
});
