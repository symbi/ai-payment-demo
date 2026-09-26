import { assessDemoPayment, isDemoAssessmentInput, type DemoAssessmentInput, type DemoAssessmentResult } from './demo-assessment.ts';

export type DemoScenario = 'normal' | 'delayed' | 'unresolved';
export type DemoRequestInput = DemoAssessmentInput & { scenario: DemoScenario };
export type DemoRequestStatus = 'checking' | 'completed' | 'unresolved';
export interface DemoRequest {
  id: string;
  input: DemoRequestInput;
  status: DemoRequestStatus;
  createdAt: number;
  readyAt: number;
  assessmentRuns: number;
  result: DemoAssessmentResult | null;
  simulation: true;
  paymentEnabled: false;
  execution: { signed: false; submitted: false; paid: false; reportPurchased: false };
}
export const REQUEST_CAPACITY = 128;
export const REQUEST_DELAY_MS = { normal: 300, delayed: 1000, unresolved: 300 } as const;
export const isRequestId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);

export function isDemoRequestInput(value: unknown): value is DemoRequestInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { scenario, ...input } = value as DemoRequestInput;
  return ['normal', 'delayed', 'unresolved'].includes(scenario) && isDemoAssessmentInput(input)
    && input.fixtureId.length <= 80 && input.amount.length <= 80 && input.taskLimit.length <= 80;
}

// Explicit field order: property insertion order from callers is never an identity boundary.
export function canonicalInput(input: DemoRequestInput): string {
  return JSON.stringify({ fixtureId: input.fixtureId, amount: input.amount, taskLimit: input.taskLimit,
    weights: [...input.weights], contentChanged: input.contentChanged, scenario: input.scenario });
}
export function createRequest(id: string, input: DemoRequestInput, now: number): DemoRequest {
  if (!isRequestId(id) || !isDemoRequestInput(input) || !Number.isSafeInteger(now) || now < 0) throw new RequestError('invalid', '模拟请求输入无效。');
  return { id, input: JSON.parse(canonicalInput(input)), status: 'checking', createdAt: now,
    readyAt: now + REQUEST_DELAY_MS[input.scenario], assessmentRuns: 0, result: null,
    simulation: true, paymentEnabled: false, execution: { signed: false, submitted: false, paid: false, reportPurchased: false } };
}
export function advanceRequest(record: DemoRequest, now: number): DemoRequest {
  if (record.status !== 'checking' || now < record.readyAt) return record;
  if (record.input.scenario === 'unresolved') return { ...record, status: 'unresolved' };
  return { ...record, status: 'completed', assessmentRuns: 1, result: assessDemoPayment(record.input) };
}
export class RequestError extends Error {
  constructor(public code: 'invalid' | 'conflict' | 'capacity', message: string) { super(message); }
}
// No expiry/eviction within one store lifetime. Restart loses all records; clients must GET,
// never POST a recovered id. Capacity rejection preserves every pending and completed id.
export class DemoRequestStore {
  private records = new Map<string, DemoRequest>();
  constructor(private now: () => number = Date.now, private capacity = REQUEST_CAPACITY) {}
  post(id: string, input: DemoRequestInput): DemoRequest {
    if (!isRequestId(id) || !isDemoRequestInput(input)) throw new RequestError('invalid', '模拟请求输入无效。');
    const existing = this.records.get(id);
    if (existing) {
      if (canonicalInput(existing.input) !== canonicalInput(input)) throw new RequestError('conflict', '请求编号已绑定不同内容，拒绝重复操作。');
      return this.get(id)!;
    }
    if (this.records.size >= this.capacity) throw new RequestError('capacity', '模拟记录容量已满；旧请求仍保留，请结束本次演示。');
    const record = createRequest(id, input, this.now());
    this.records.set(id, record);
    return structuredClone(record);
  }
  get(id: string): DemoRequest | null {
    const existing = this.records.get(id);
    if (!existing) return null;
    const record = advanceRequest(existing, this.now());
    this.records.set(id, record);
    return structuredClone(record);
  }
  restore(record: DemoRequest): void {
    if (!isDemoRequest(record)) throw new RequestError('invalid', '本地模拟记录无效。');
    const existing = this.records.get(record.id);
    if (existing && canonicalInput(existing.input) !== canonicalInput(record.input)) throw new RequestError('conflict', '恢复内容冲突。');
    if (!existing && this.records.size >= this.capacity) throw new RequestError('capacity', '模拟记录容量已满。');
    if (!existing) this.records.set(record.id, structuredClone(record));
  }
}

// Persisted/transport results must be the exact deterministic outcome of the recorded input.
// In particular, checking/unresolved can never carry an allow result or real execution flag.
export function isDemoRequest(value: unknown): value is DemoRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as DemoRequest;
  if (!isRequestId(v.id) || !isDemoRequestInput(v.input) || !Number.isSafeInteger(v.createdAt) || v.createdAt < 0) return false;
  const initial = createRequest(v.id, v.input, v.createdAt);
  const expected = v.status === 'checking' ? initial : advanceRequest(initial, initial.readyAt);
  return v.status === expected.status && v.readyAt === expected.readyAt && v.assessmentRuns === expected.assessmentRuns
    && v.simulation === true && v.paymentEnabled === false && !!v.execution
    && Object.keys(initial.execution).every(key => v.execution[key as keyof typeof v.execution] === false)
    && JSON.stringify(v.result) === JSON.stringify(expected.result);
}
