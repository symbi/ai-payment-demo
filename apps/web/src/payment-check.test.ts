import { expect, it } from 'vitest';
import { paymentCheckModel } from './payment-check.ts';
import { TEST_USDC, type PurchaseResult } from '../../../shared/contracts.ts';
const current: PurchaseResult = { requestId: 'existing-order', status: 'held', decision: 'hold', reasons: ['Unverified'], terms: { scheme: 'exact', amount: '1000', asset: TEST_USDC, payTo: '0x2222222222222222222222222222222222222222', network: 'eip155:84532' }, risk: { source: 'live', decision: 'hold', reasons: ['Unverified'], address: '0x2222222222222222222222222222222222222222', checkedAt: '2026-09-26T00:00:00Z', provider: 'intercepta', scan: { transport: 'received', toxicScore: 0, traitsCount: 0, requestedNetwork: 'eip155:84532', coverage: 'unverified', semantics: 'unverified' } }, counters: { sign: 0, settle: 0 }, events: [], aiMode: 'not_configured', paymentEnabled: false };
it.each([['continue','Continue'],['block','Block'],['pause','Pause']] as const)('labels %s as offline evidence without a simulated score or payment', (view, decision) => {
 const model = paymentCheckModel(view, current, false); expect(model.source).toContain('Offline'); expect(model.decision).toBe(decision); expect(model.call).toBe('Not called'); expect(model.score).toBe('Not simulated'); expect(model.payment).toBe('Not paid'); expect(model.payTo).not.toBe(current.terms!.payTo);
});
it('keeps real zero score paused and binds display to actual quote/scan', () => {
 const model=paymentCheckModel('current',current,false); expect(model.decision).toBe('Pause'); expect(model.score).toBe('0 · uninterpreted'); expect(model.payTo).toBe(current.terms!.payTo); expect(model.scanAddress).toBe(current.risk!.address); expect(model.source).toContain('Live provider');
 expect(paymentCheckModel('current',{...current,decision:'allow'},false).decision).toBe('Pause');
});
it('unknown state overrides a previous block and counters are unconfirmed', () => {
 const model=paymentCheckModel('current',{...current,decision:'deny'},true);expect(model.decision).toBe('Pause');expect(model.signature).toBe('Unconfirmed');expect(model.payment).toBe('Unconfirmed');
});
it('does not invent data when no current order exists',()=>{const m=paymentCheckModel('current',null,false);expect(m.payTo).toBe('Not available');expect(m.decision).toBe('Pause');expect(m.payment).toBe('No record');});
it('does not relabel a fixture response as a live scan',()=>{const m=paymentCheckModel('current',{...current,risk:{...current.risk!,source:'fixture'}},false);expect(m.source).toContain('Fixture');expect(m.decision).toBe('Pause');});
it('preserves backend-reported paid/counter facts without claiming chain verification',()=>{const m=paymentCheckModel('current',{...current,status:'paid',counters:{sign:1,settle:1}},false);expect(m.signature).toBe('1 sign calls reported');expect(m.payment).toContain('not chain verification');});
