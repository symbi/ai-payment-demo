import { api } from './api.ts';
import { isPrivateScanStatus, privateCandidate, type PrivateCandidateId, type PrivateScanStatus } from '../../../shared/private-risk.ts';

export type PrivateRiskClientState = { selectedId: PrivateCandidateId; status: PrivateScanStatus | null; loading: boolean; message: string };
type Request = (path: string, body?: { candidateId: PrivateCandidateId }) => Promise<unknown>;
export class PrivateRiskClient {
  state: PrivateRiskClientState = { selectedId: 'H1', status: null, loading: false, message: '仅在私人电脑使用，先确认本机扫描服务状态。' };
  private disposed = false;
  private revision = 0;
  constructor(private onChange: (state: PrivateRiskClientState) => void, private request: Request = (path, body) => api(path, isPrivateScanStatus, body)) {}
  private publish() { if (!this.disposed) this.onChange(structuredClone(this.state)); }
  select(value: PrivateCandidateId) {
    if (!privateCandidate(value) || this.disposed) return;
    this.revision++;
    this.state.selectedId = value;
    this.state.message = '地址已切换；选择地址不会调用风险服务。';
    this.publish();
  }
  async refresh() { await this.run('/api/private-risk/status'); }
  async scan() {
    const status = this.state.status;
    if (!status?.ready || status.usedRequests >= status.maxRequests || status.records.some(record => record.candidateId === this.state.selectedId || record.state === 'pending')) return;
    await this.run('/api/private-risk/scan', { candidateId: this.state.selectedId });
  }
  private async run(path: string, body?: { candidateId: PrivateCandidateId }) {
    if (this.disposed || this.state.loading) return;
    const revision = this.revision;
    this.state.loading = true;
    this.state.message = body ? '正在请求真实扫描；不要重复提交。' : '查询本机已有记录，不重新扫描。';
    this.publish();
    try {
      const result = await this.request(path, body);
      if (!isPrivateScanStatus(result) || (body && !result.records.some(record => record.candidateId === body.candidateId))) throw new Error('Invalid result');
      if (this.disposed) return;
      this.state.status = structuredClone(result);
      this.state.message = revision === this.revision ? result.message : '记录已更新；当前仍展示你所选地址的结果。';
    } catch {
      if (this.disposed) return;
      this.state.status = null;
      this.state.message = body ? '扫描结果未确认。请查询已有记录；不会自动重试，也不能据此认定没有消耗请求。' : '未连接私人扫描服务。此入口只在私人电脑独立启动；公司离线服务不提供真实扫描。';
    } finally {
      this.state.loading = false;
      this.publish();
    }
  }
  dispose() { this.disposed = true; this.revision++; }
}
