import type { RiskResult } from '../../../shared/contracts.ts';

export function unavailableRisk(address: string, keyConfigured: boolean): RiskResult {
  return {
    address, checkedAt: new Date().toISOString(), provider: 'intercepta', source: 'unavailable', decision: 'hold',
    reasons: [keyConfigured ? 'Scan not requested. Use Check to request a scan. Payment unavailable.' : 'API key unavailable. Payment unavailable.'],
  };
}

/** Future transport seam only. No production route calls a transport before its response contract is verified.
 * Unknown payloads (including an apparent allow) cannot become authorization.
 */
export async function inspectUnverifiedScan(address: string, transport: (signal: AbortSignal) => Promise<unknown>, timeoutMs = 3000): Promise<RiskResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = unavailableRisk(address, true);
  try {
    await Promise.race([transport(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    })]);
    result.reasons = ['扫描响应结构尚未验证，无法判定风险；暂停付款'];
  } catch {
    result.reasons = ['扫描失败或超时，风险未知；暂停付款'];
  } finally { clearTimeout(timer); }
  return result;
}
