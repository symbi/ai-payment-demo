import { canonicalInput, createRequest, DemoRequestStore, isDemoRequest, type DemoRequest, type DemoRequestInput } from '../../../shared/demo-requests.ts';

export type DemoMode = 'file' | 'http';
export const STORAGE_KEY = 'pay-assessment-demo:request:v1';
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface RequestTransport {
  post(id: string, input: DemoRequestInput): Promise<DemoRequest>;
  get(id: string): Promise<DemoRequest | null>;
  restore?(record: DemoRequest): void;
}
export interface ClientState {
  record: DemoRequest | null;
  busy: boolean;
  invalidated: boolean;
  recoveryBlocked: boolean;
  notice: string;
  storageWarning: string;
}
interface ClientOptions {
  mode: DemoMode;
  transport: RequestTransport;
  storage?: StoragePort;
  now?: () => number;
  id?: () => string;
  wait?: (ms: number) => Promise<void>;
  onChange?: (state: ClientState) => void;
}
const copy = <T,>(v: T): T => structuredClone(v);
export class DemoRequestClient {
  private state: ClientState = { record: null, busy: false, invalidated: false, recoveryBlocked: false, notice: '等待评估。', storageWarning: '' };
  private generation = 0;
  private revision = 0;
  private now: () => number;
  private wait: (ms: number) => Promise<void>;
  constructor(private options: ClientOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  snapshot(): ClientState { return copy(this.state); }
  get blocked(): boolean { return this.state.busy || this.state.recoveryBlocked || (!!this.state.record && this.state.record.status !== 'completed'); }
  private publish(): void { this.options.onChange?.(this.snapshot()); }
  private persist(): void {
    try {
      if (!this.options.storage) throw new Error('Storage unavailable');
      this.options.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, mode: this.options.mode,
        record: this.state.record, invalidated: this.state.invalidated, recoveryBlocked: this.state.recoveryBlocked }));
    } catch { this.state.storageWarning = '本地存储不可用，刷新后无法保证恢复本次模拟；没有真实转账。'; }
  }
  invalidate(): void {
    this.revision += 1;
    this.state.invalidated = true;
    this.state.notice = this.blocked ? '输入已变，旧决定已清除；原请求仍被拦截，请查询或显式结束此模拟。' : '输入已变，请重新评估。旧决定已清除。';
    this.persist(); this.publish();
  }
  // Synchronous reservation precedes the first await, including same-event-loop double clicks.
  async submit(input: DemoRequestInput): Promise<void> {
    if (this.blocked) { this.state.notice = '重复操作已拦截。请查询原请求，或显式结束此模拟；没有转账。'; this.publish(); return; }
    if (this.state.record && canonicalInput(this.state.record.input) === canonicalInput(input) && !this.state.invalidated) {
      this.state.notice = '复用原请求结果，没有再次评估或转账。'; this.publish(); return;
    }
    let record: DemoRequest;
    try {
      const id = this.options.id?.() ?? `demo-${crypto.randomUUID()}`;
      record = createRequest(id, input, this.now());
    }
    catch { this.state.invalidated = true; this.state.notice = '输入无效，请检查五项权重与金额；未创建请求。'; this.publish(); return; }
    const id = record.id;
    this.state = { ...this.state, record, busy: true, invalidated: false, notice: '检查中：正在核对模拟输入，未签名、未转账。' };
    const generation = ++this.generation;
    const revision = this.revision;
    this.persist(); this.publish();
    try {
      const response = await this.options.transport.post(id, input);
      if (!this.accept(response, generation, revision)) return;
      // One bounded follow-up, never a polling/retry loop. Also makes checking perceptible.
      if (response.status === 'checking') {
        await this.wait(Math.max(0, Math.min(1000, response.readyAt - this.now())));
        if (generation !== this.generation) return;
        const result = await this.options.transport.get(id);
        this.accept(result, generation, revision);
      }
    } catch { this.fail(generation); }
    finally { if (generation === this.generation) { this.state.busy = false; this.persist(); this.publish(); } }
  }
  private accept(record: DemoRequest | null, generation: number, revision: number): boolean {
    if (generation !== this.generation) return false;
    if (!record || !isDemoRequest(record) || record.id !== this.state.record?.id
      || canonicalInput(record.input) !== canonicalInput(this.state.record.input)) {
      this.fail(generation); return false;
    }
    this.state.record = copy(record);
    this.state.invalidated ||= revision !== this.revision;
    this.state.notice = this.state.invalidated ? '输入已变，旧决定已清除。原请求状态已更新；重新评估前请确认输入。'
      : record.status === 'completed' ? '模拟评估完成；未签名、未提交、未付款。'
      : record.status === 'checking' ? '检查中：等待模拟结果。'
      : '结果未确认（模拟），不能视为允许。查询原请求，或显式结束此模拟后重新评估；没有转账。';
    this.persist(); this.publish(); return true;
  }
  private fail(generation: number): void {
    if (generation !== this.generation) return;
    if (this.state.record) this.state.record = { ...this.state.record, status: 'unresolved', result: null };
    this.state.notice = '结果未确认：请求失败、超时或原记录不存在。不会自动重新发起或允许；请查询原请求或结束此模拟。没有转账。';
    this.persist(); this.publish();
  }
  async query(): Promise<void> {
    if (this.state.busy || !this.state.record) return;
    this.state.busy = true; this.publish();
    const generation = this.generation, revision = this.revision;
    try { this.accept(await this.options.transport.get(this.state.record.id), generation, revision); }
    catch { this.fail(generation); }
    finally { if (generation === this.generation) { this.state.busy = false; this.persist(); this.publish(); } }
  }
  async recover(): Promise<DemoRequestInput | null> {
    let saved: unknown;
    try {
      if (!this.options.storage) throw new Error('Storage unavailable');
      const raw = this.options.storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      if (raw.length > 16000) throw new Error('Invalid saved record');
      saved = JSON.parse(raw);
    } catch {
      this.state.recoveryBlocked = true;
      this.state.notice = '本地记录无法读取或已损坏，结果未确认；请显式结束此模拟再开始。';
      this.state.storageWarning = '刷新恢复不可用，不代表请求没有发生；没有真实转账。';
      this.publish(); return null;
    }
    const s = saved as { version?: number; mode?: string; record?: unknown; invalidated?: boolean; recoveryBlocked?: boolean } | null;
    if (!s || s.version !== 1 || s.mode !== this.options.mode || typeof s.invalidated !== 'boolean'
      || typeof s.recoveryBlocked !== 'boolean' || (s.record !== null && !isDemoRequest(s.record))) {
      // Uncertain HTTP errors are saved as unresolved, even if the original scenario was normal.
      // Recover only a verified request identity below; never a cached decision.
      const r = s?.record as DemoRequest | undefined;
      let identity: DemoRequest | null = null;
      try {
        if (s?.version === 1 && s.mode === this.options.mode && typeof s.invalidated === 'boolean'
          && typeof s.recoveryBlocked === 'boolean' && r?.status === 'unresolved' && r.result === null
          && (r.assessmentRuns === 0 || r.assessmentRuns === 1)
          && isDemoRequest({ ...r, status: 'checking', assessmentRuns: 0 })) {
          identity = createRequest(r.id, r.input, r.createdAt);
        }
      } catch { /* malformed data cannot supply a known outcome */ }
      if (!identity) {
        this.state.recoveryBlocked = true; this.state.notice = '本地记录损坏或来自其他模式，结果未确认；请显式结束此模拟再开始。'; this.publish(); return null;
      }
      this.state.record = { ...identity, status: 'unresolved' };
      this.state.invalidated = s?.invalidated !== false;
      if (this.options.mode === 'file') {
        this.state.recoveryBlocked = true; this.state.notice = '本地原记录无法确认；请显式结束此模拟。没有转账。'; this.publish(); return copy(identity.input);
      }
    } else {
      this.state.record = s.record as DemoRequest | null;
      this.state.invalidated = s.invalidated;
      this.state.recoveryBlocked = s.recoveryBlocked;
      if (this.state.record && this.options.mode === 'file') this.options.transport.restore?.(this.state.record);
    }
    if (!this.state.record) { this.publish(); return null; }
    const input = copy(this.state.record.input);
    // HTTP cached results are never shown before querying the current server instance.
    if (this.options.mode === 'http') this.state.record = { ...this.state.record, status: 'unresolved', result: null };
    this.state.notice = '正在查询原模拟请求；不会重新提交。'; this.publish();
    await this.query();
    return input;
  }
  end(): void {
    ++this.generation; ++this.revision;
    this.state = { ...this.state, record: null, busy: false, invalidated: false, recoveryBlocked: false,
      notice: '已显式结束此模拟；没有转账。可修改输入并开始新评估。' };
    this.persist(); this.publish();
  }
}

export function fileTransport(now: () => number = Date.now): RequestTransport {
  const store = new DemoRequestStore(now);
  return { post: async (id, input) => store.post(id, input), get: async id => store.get(id), restore: record => store.restore(record) };
}
export function httpTransport(fetcher: typeof fetch = fetch): RequestTransport {
  async function request(path: string, input?: { id: string; input: DemoRequestInput }): Promise<DemoRequest | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(path, { method: input ? 'POST' : 'GET', cache: 'no-store',
        ...(input ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}), signal: controller.signal });
      if (!input && response.status === 404) return null;
      if (!response.ok) throw new Error('Demo request rejected');
      const value: unknown = await response.json();
      if (!isDemoRequest(value)) throw new Error('Invalid demo record');
      return value;
    } finally { clearTimeout(timeout); }
  }
  return { post: async (id, input) => (await request('/api/demo/requests', { id, input }))!,
    get: id => request(`/api/demo/requests/${encodeURIComponent(id)}`) };
}
