import { parseUsdcAtomic } from '../../../shared/demo-assessment.ts';
import {
  evaluatePolicyPreview,
  isPolicyPreviewResult,
  POLICY_PREVIEW_CASES,
  type PolicyPreviewInput,
} from '../../../shared/policy-preview.ts';
import type { PolicyPreviewViewState } from '../../../shared/policy-preview-view.ts';

export interface PolicyPreviewTransport {
  assess(input: PolicyPreviewInput): Promise<unknown>;
}

export interface PolicyPreviewClientOptions {
  mode: 'file' | 'http';
  onChange: (state: PolicyPreviewViewState) => void;
  transport?: PolicyPreviewTransport;
}

const INITIAL_STATE: PolicyPreviewViewState = {
  caseId: 'case-01',
  budgetText: '0.002000',
  phase: 'idle',
  result: null,
  message: '等待合成政策评估。',
};

function copyState(state: PolicyPreviewViewState): PolicyPreviewViewState {
  return structuredClone(state);
}

function formatUsdcAtomic(atomic: string): string {
  const padded = atomic.padStart(7, '0');
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`;
}

function budgetAtomic(budgetText: string): string | null {
  // The shared parser owns decimal conversion; this bound prevents an
  // overlong decimal from reaching BigInt and matches the v1 atomic limit.
  if (!/^(?:0|[1-9]\d{0,71})(?:\.\d{1,6})?$/.test(budgetText)) return null;
  const parsed = parseUsdcAtomic(budgetText);
  return parsed === null ? null : parsed.toString();
}

export function filePolicyPreviewTransport(): PolicyPreviewTransport {
  return {
    async assess(input) {
      const result = evaluatePolicyPreview(input);
      if (!result) throw new Error('Policy preview input was rejected');
      return result;
    },
  };
}

export function httpPolicyPreviewTransport(fetcher: typeof fetch = fetch): PolicyPreviewTransport {
  return {
    async assess(input) {
      const response = await fetcher('/api/demo/policy-preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Policy preview request failed');
      const value: unknown = await response.json();
      if (!isPolicyPreviewResult(value)) throw new Error('Policy preview response was rejected');
      return value;
    },
  };
}

export class PolicyPreviewClient {
  public state: PolicyPreviewViewState = copyState(INITIAL_STATE);

  private readonly transport: PolicyPreviewTransport;
  private revision = 0;
  private sequence = 0;
  private pending = false;
  private disposed = false;

  constructor(private readonly options: PolicyPreviewClientOptions) {
    this.transport = options.transport ?? (options.mode === 'file'
      ? filePolicyPreviewTransport()
      : httpPolicyPreviewTransport());
  }

  private publish(): void {
    if (!this.disposed) this.options.onChange(copyState(this.state));
  }

  private currentInput(): PolicyPreviewInput | null {
    if (!POLICY_PREVIEW_CASES.some(item => item.caseId === this.state.caseId)) return null;
    const taskBudgetAtomic = budgetAtomic(this.state.budgetText);
    return taskBudgetAtomic === null ? null : { caseId: this.state.caseId, taskBudgetAtomic };
  }

  private invalidMessage(): string {
    return POLICY_PREVIEW_CASES.some(item => item.caseId === this.state.caseId)
      ? '预算必须是大于 0、最多 6 位小数且不过长的普通 USDC 数字。'
      : '未知样例，不能发起政策评估。';
  }

  private invalidate(message: string): void {
    this.revision += 1;
    this.state = {
      ...this.state,
      phase: this.pending ? 'loading' : (this.currentInput() ? 'idle' : 'error'),
      result: null,
      message,
    };
    this.publish();
  }

  setCaseId(caseId: string): void {
    if (this.disposed || caseId === this.state.caseId) return;
    const selected = POLICY_PREVIEW_CASES.find(item => item.caseId === caseId);
    this.state = {
      ...this.state,
      caseId,
      ...(selected ? { budgetText: formatUsdcAtomic(selected.exampleTaskBudgetAtomic) } : {}),
    };
    this.invalidate(selected ? '输入已变，请重新评估。' : '未知样例，不能发起政策评估。');
  }

  setBudgetText(budgetText: string): void {
    if (this.disposed || budgetText === this.state.budgetText) return;
    this.state = { ...this.state, budgetText };
    this.invalidate(budgetAtomic(budgetText) === null
      ? '预算必须是大于 0、最多 6 位小数且不过长的普通 USDC 数字。'
      : '输入已变，请重新评估。');
  }

  async assess(): Promise<void> {
    if (this.disposed || this.pending) return;
    const input = this.currentInput();
    if (!input) {
      this.state = { ...this.state, phase: 'error', result: null, message: this.invalidMessage() };
      this.publish();
      return;
    }

    this.pending = true;
    const sequence = ++this.sequence;
    const revision = this.revision;
    this.state = { ...this.state, phase: 'loading', result: null, message: '正在评估合成政策；没有支付或执行。' };
    this.publish();

    let response: unknown;
    let failed = false;
    try {
      response = await this.transport.assess(input);
    } catch {
      failed = true;
    }

    if (sequence === this.sequence) this.pending = false;
    if (this.disposed || sequence !== this.sequence) return;

    if (revision !== this.revision) {
      const current = this.currentInput();
      this.state = {
        ...this.state,
        phase: current ? 'idle' : 'error',
        result: null,
        message: current ? '输入已变，旧返回已丢弃；请重新评估。' : this.invalidMessage(),
      };
      this.publish();
      return;
    }

    if (failed || !isPolicyPreviewResult(response)
      || response.case.caseId !== input.caseId
      || response.taskBudgetAtomic !== input.taskBudgetAtomic) {
      this.state = { ...this.state, phase: 'error', result: null, message: '评估失败或返回不匹配；旧允许结果已清除，不会自动重试。' };
      this.publish();
      return;
    }

    this.state = { ...this.state, phase: 'ready', result: structuredClone(response), message: '合成政策评估完成；仅供预览，不能执行支付。' };
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.sequence += 1;
  }
}
