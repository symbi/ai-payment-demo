import type { TaskPaymentPreflightChecker } from './task-payment-preflight.ts';
import { isTaskPaymentPreflight } from '../../../shared/task-payment-preflight.ts';
import { CONTRACT_VERSION, PRICE_ATOMIC, RESOURCE_PATH, TEST_NETWORK, TEST_USDC, type PurchaseResult } from '../../../shared/contracts.ts';
import type { BuyerConfig } from './config.ts';
import { checkPolicy, isAddress } from './policy.ts';
import { unavailableRisk } from './risk.ts';
import { scanUnavailable, type RiskScanner } from './intercepta.ts';
import { event, hold, initialResult } from './result.ts';
import { InputError } from './input.ts';
import { SellerClient, SellerError, type Quote } from './seller.ts';
import { ProtectedPayment, type TestPaymentDependencies } from './protected-payment.ts';

interface Entry { prompt: string; result: PurchaseResult; quote?: Quote; inspecting?: Promise<void>; paymentCheck?: Promise<void>; checkedPayment: boolean }
export class BuyerService {
  private entries = new Map<string, Entry>();
  private protectedPayment?: ProtectedPayment;
  constructor(private config: BuyerConfig, private seller = new SellerClient(config.sellerUrl), private scan: RiskScanner = async (address, network) => scanUnavailable(address, network, 'Scan adapter unavailable.'), payment?: TestPaymentDependencies, private readonly preflight?: TaskPaymentPreflightChecker) {
    if (payment?.testFixtureOnly === true) this.protectedPayment = new ProtectedPayment(config.sellerUrl, payment);
  }
  async health() {
    return { contractVersion: CONTRACT_VERSION, resourcePath: RESOURCE_PATH, buyer: { connected: true }, seller: await this.seller.health(), configuration: { payToConfigured: isAddress(this.config.payTo), interceptaKeyConfigured: this.config.riskKeyConfigured, paymentRequested: this.config.paymentRequested }, paymentEnabled: false, aiMode: 'not_configured', network: TEST_NETWORK, asset: TEST_USDC, budgetAtomic: PRICE_ATOMIC, risk: { source: 'unavailable', message: '尚未验证真实 Intercepta 扫描；签名与付款关闭' } };
  }
  async inspect(id: string, prompt: string): Promise<PurchaseResult> {
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.prompt !== prompt) throw new InputError('同一 requestId 不能更改任务内容；请新建请求', 409);
      await existing.inspecting;
      return structuredClone(existing.result);
    }
    // Do not evict IDs silently: future payment states must not be forgotten and retried.
    if (this.entries.size >= 500) throw new InputError('本次本地会话已达到 500 个请求；请交由操作者处理', 503);
    const entry: Entry = { prompt, result: initialResult(id), checkedPayment: false };
    this.entries.set(id, entry); // reserve identity before first await
    event(entry.result, 'request', 'Manual Contract Insights request; fixed seller only.');
    entry.inspecting = this.inspectOnce(entry);
    await entry.inspecting;
    return structuredClone(entry.result);
  }
  private async inspectOnce(entry: Entry) {
    try {
      entry.quote = await this.seller.quote();
      entry.result.terms = entry.quote.terms;
      event(entry.result, 'quote', '收到卖方 HTTP 402；已读取原始付款条件，未签名');
      this.evaluate(entry.result);
    } catch (error) { hold(entry.result, error instanceof SellerError ? error.message : '请求检查失败；暂停'); }
  }
  private evaluate(result: PurchaseResult) {
    const policy = checkPolicy(result.terms!, this.config.payTo);
    event(result, 'policy', policy.reasons.join('；'));
    if (policy.decision !== 'allow') {
      result.decision = policy.decision; result.status = policy.decision === 'deny' ? 'denied' : 'held'; result.reasons = policy.reasons;
      return;
    }
    const risk = unavailableRisk(result.terms!.payTo, this.config.riskKeyConfigured);
    result.risk = risk;
    hold(result, risk.reasons.join('；'));
    event(result, 'payment', '签名器未接入，付款关闭；本地条件符合也不会自动付款');
  }
  async pay(id: string): Promise<PurchaseResult> {
    const entry = this.entries.get(id);
    if (!entry) throw new InputError('未找到已检查请求，请先查看付款条件', 404);
    await entry.inspecting;
    // No automatic retries, especially after a future ambiguous settlement.
    if (entry.result.status === 'settlement_unknown' || entry.result.status === 'paid' || entry.result.status === 'denied') return structuredClone(entry.result);
    if (!entry.checkedPayment) {
      entry.checkedPayment = true;
      entry.paymentCheck = this.recheck(entry);
    }
    await entry.paymentCheck;
    return structuredClone(entry.result);
  }
  private async recheck(entry: Entry) {
    if (!entry.quote) { hold(entry.result, '没有可复查的付款条件；未付款，不自动重试'); return; }
    event(entry.result, 'recheck', '重新请求卖方报价并核对完整条件；未签名');
    try {
      const quote = await this.seller.quote();
      if (quote.fingerprint !== entry.quote.fingerprint) { hold(entry.result, '卖方付款条件已变化，原检查失效；请查看新的请求，不会自动付款'); return; }
      const policy = checkPolicy(quote.terms, this.config.payTo);
      if (policy.decision !== 'allow') { this.evaluate(entry.result); return; }
      if (this.preflight) {
        const result = await this.preflight(quote);
        if (!isTaskPaymentPreflight(result)) { hold(entry.result, '许可检查结果无效；未扫描、未签名，不自动重试'); return; }
        entry.result.grantPreflight = result;
        hold(entry.result, result.passed
          ? '已保存许可与本次付款意图范围匹配；余额、预算预留及执行尚未接通，保持暂停'
          : `任务许可预检未通过（${result.code}）；保持暂停，不自动重试`);
        event(entry.result, 'grant_preflight', '后端已检查保存的任务许可；未扫描、未占用预算、未签名或付款');
        return;
      }
      if (this.protectedPayment) {
        const { execution, data } = await this.protectedPayment.execute(entry.result.requestId, entry.prompt, quote);
        entry.result.execution = execution;
        entry.result.decision = execution.decision;
        entry.result.reasons = execution.reasons;
        // Fixture execution is not a claim that the runtime can make a real payment.
        entry.result.paymentEnabled = false;
        entry.result.status = execution.taskComplete ? 'paid' : execution.settlement === 'unknown' ? 'settlement_unknown' : 'held';
        entry.result.counters.sign = execution.signing === 'signed' ? 1 : 0;
        entry.result.counters.settle = execution.settlement === 'settled' ? 1 : 0;
        if (data !== undefined) entry.result.data = data;
        event(entry.result, 'payment', `离线受控测试状态：${execution.reasonCodes.join(',')}`);
        return;
      }
      event(entry.result, 'scan', 'Explicit check: requesting address scan; payment disabled');
      let risk;
      try { risk = await this.scan(quote.terms.payTo, quote.terms.network); }
      catch { risk = scanUnavailable(quote.terms.payTo, quote.terms.network, 'Scan unavailable. No automatic retry.'); }
      if (risk.address.toLowerCase() !== quote.terms.payTo.toLowerCase() || (risk.scan && risk.scan.requestedNetwork !== quote.terms.network)) risk = scanUnavailable(quote.terms.payTo, quote.terms.network, 'Scan identity mismatch.');
      entry.result.risk = { ...risk, decision: 'hold' };
      hold(entry.result, risk.reasons.join('; '));
      event(entry.result, 'scan_result', 'Scan check returned; payment remains disabled');
    } catch (error) { hold(entry.result, error instanceof SellerError ? error.message : '付款复查失败；暂停且不自动重试'); }
  }
  get(id: string): PurchaseResult {
    const entry = this.entries.get(id);
    if (!entry) throw new InputError('未找到请求；服务重启后不会保留本地会话记录', 404);
    return structuredClone(entry.result);
  }
}
export type BuyerHealth = Awaited<ReturnType<BuyerService['health']>>;
