import { useState } from 'react';
import type { TaskGrant, TaskGrantInput, TaskGrantPanelProps } from '../../../shared/task-grant.ts';
import { isTaskGrantInput } from '../../../shared/task-grant.ts';
import { parseUsdcAtomic } from '../../../shared/demo-assessment.ts';
import './task-authorization.css';

const atomicToUsdc = (value: string) => {
  const padded = value.padStart(7, '0');
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, '') || '0';
  const fraction = padded.slice(-6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

const displayAddress = (value: string | null) => value ?? '未配置';
const displayNetwork = (value: string) => value === 'eip155:84532' ? `Base Sepolia（测试网）（${value}）` : value;
const displayAsset = (value: string) => `测试 USDC（${value}）`;

function Field({ label, value }: { label: string; value: string }) {
  return <div className="task-authorization-field"><dt>{label}</dt><dd>{value}</dd></div>;
}

function GrantSummary({ grant, title = '已保存的任务许可' }: { grant: TaskGrant; title?: string }) {
  const expired = Date.parse(grant.expiresAt) <= Date.now();
  return <section className="task-authorization-card task-authorization-saved" aria-labelledby="task-authorization-saved-title">
    <div className="task-authorization-card-heading"><div><p className="task-authorization-eyebrow">已保存内容</p><h2 id="task-authorization-saved-title">{title}</h2></div><span className="task-authorization-status">{expired ? '已过期' : '已保存'}</span></div>
    <dl className="task-authorization-details">
      <Field label="许可 ID / 版本" value={`${grant.grantId} · v${grant.version}`} />
      <Field label="总预算" value={`${atomicToUsdc(grant.totalBudgetAtomic)} USDC`} />
      <Field label="单笔上限" value={`${atomicToUsdc(grant.perTransactionAtomic)} USDC`} />
      <Field label="有效期" value={`${grant.validForMinutes} 分钟（至 ${grant.expiresAt}）`} />
    </dl>
    <p className="task-authorization-note">已保存，尚未接通付款。续期或修改本轮未接入；保留旧记录，不能在此页面随意改账。</p>
  </section>;
}

export function TaskAuthorizationPanel({ status, loading, message, onSave, onRefresh }: TaskGrantPanelProps) {
  const [totalBudget, setTotalBudget] = useState('');
  const [perTransaction, setPerTransaction] = useState('');
  const [validForMinutes, setValidForMinutes] = useState('30');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const context = status?.context;
  const canEdit = !!status && status.canSave && !status.grant;
  const busy = loading || saving;

  const validate = (): TaskGrantInput | null => {
    const total = parseUsdcAtomic(totalBudget);
    const single = parseUsdcAtomic(perTransaction);
    const minutes = Number(validForMinutes);
    if (!total || !single) { setFormError('请输入大于 0 的 USDC 金额，最多 6 位小数。'); return null; }
    if (single > total) { setFormError('单笔上限不能超过总预算。'); return null; }
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) { setFormError('有效分钟必须是 1 到 1440 的整数。'); return null; }
    if (!confirmed) { setFormError('请确认这是本任务的许可设置。'); return null; }
    const input: TaskGrantInput = { totalBudgetAtomic: total.toString(), perTransactionAtomic: single.toString(), validForMinutes: minutes, confirmed: true };
    if (!isTaskGrantInput(input)) { setFormError('许可设置未通过校验，请检查输入。'); return null; }
    return input;
  };

  const save = async () => {
    setFormError('');
    const input = validate();
    if (!input || !canEdit || busy) return;
    setSaving(true);
    try { await onSave(input); }
    catch { setFormError('保存结果未确认，请查询已有许可。'); }
    finally { setSaving(false); }
  };

  return <section className="task-authorization-panel" aria-labelledby="task-authorization-title">
    <header className="task-authorization-hero">
      <p className="task-authorization-eyebrow">TASK PERMISSION / BUDGET</p>
      <h1 id="task-authorization-title">任务许可与预算</h1>
      <p>为同一个付款 Demo 配置任务可用的预算边界。这里保存的是应用许可，不会连接钱包、签名或开始任务。</p>
    </header>

    <section className="task-authorization-card" aria-labelledby="task-authorization-context-title">
      <div className="task-authorization-card-heading"><div><p className="task-authorization-eyebrow">任务范围</p><h2 id="task-authorization-context-title">这项许可给谁使用</h2></div></div>
      <dl className="task-authorization-details">
        <Field label="任务名称" value={context?.taskName ?? '未加载'} />
        <Field label="任务 ID" value={context?.taskId ?? '未加载'} />
        <Field label="执行器" value={context ? `${context.agentName}（${context.agentId}）` : '未加载'} />
        <Field label="付款账户" value={displayAddress(context?.account ?? null)} />
        <Field label="受控卖方" value={displayAddress(context?.payTo ?? null)} />
        <Field label="网络 / 资产" value={context ? `${displayNetwork(context.network)} / ${displayAsset(context.asset)}` : '未加载'} />
      </dl>
      <p className="task-authorization-note">执行链尚未接通；保存不代表开始任务。地址仅作文本展示，不生成外链。</p>
    </section>

    <section className="task-authorization-card" aria-labelledby="task-authorization-accounting-title">
      <div className="task-authorization-card-heading"><div><p className="task-authorization-eyebrow">账本状态</p><h2 id="task-authorization-accounting-title">预算不等于钱包余额</h2></div><span className="task-authorization-status task-authorization-status-muted">未接入</span></div>
      <dl className="task-authorization-details task-authorization-accounting">
        <Field label="已花费" value="未接入" /><Field label="已预留" value="未接入" />
        <Field label="可用预算" value="未接入" /><Field label="钱包余额" value="未接入" />
      </dl>
      <p className="task-authorization-note">当前没有账本或钱包余额数据，不填 0，也不从总预算推断可用金额。</p>
    </section>

    {status?.grant ? <GrantSummary grant={status.grant} /> : null}

    {!status?.grant && <section className="task-authorization-card" aria-labelledby="task-authorization-form-title">
      <div className="task-authorization-card-heading"><div><p className="task-authorization-eyebrow">尚未保存</p><h2 id="task-authorization-form-title">设置任务预算</h2></div></div>
      {!status ? <p className="task-authorization-empty">尚未加载许可状态，当前不能保存。</p> : !status.canSave ? <p className="task-authorization-empty">付款账户或受控卖方尚未配置，当前不能保存。未知账户不会被假设为当前钱包。</p> : <div className="task-authorization-form">
        <div className="task-authorization-input-grid">
          <label htmlFor="task-authorization-total">USDC 总预算<input id="task-authorization-total" inputMode="decimal" value={totalBudget} onChange={event => setTotalBudget(event.target.value)} placeholder="例如 10.50" disabled={busy} /></label>
          <label htmlFor="task-authorization-single">USDC 单笔上限<input id="task-authorization-single" inputMode="decimal" value={perTransaction} onChange={event => setPerTransaction(event.target.value)} placeholder="例如 2.00" disabled={busy} /></label>
        </div>
        <label htmlFor="task-authorization-minutes">有效分钟<input id="task-authorization-minutes" inputMode="numeric" value={validForMinutes} onChange={event => setValidForMinutes(event.target.value)} disabled={busy} /></label>
        <label className="task-authorization-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />我确认这是本任务的许可设置，保存不代表付款或任务已开始。</label>
        {formError && <p className="task-authorization-error" role="alert">{formError}</p>}
        <button className="task-authorization-primary" type="button" disabled={busy || !canEdit} onClick={save}>{saving ? '正在保存…' : '保存任务许可'}</button>
      </div>}
    </section>}

    <section className="task-authorization-card task-authorization-capabilities" aria-labelledby="task-authorization-capabilities-title">
      <div className="task-authorization-card-heading"><div><p className="task-authorization-eyebrow">当前边界</p><h2 id="task-authorization-capabilities-title">尚未接通的能力</h2></div></div>
      <ul><li>执行器不会因保存许可而自动开始任务。</li><li>付款、签名、钱包连接和链上结算尚未接通。</li><li>账本花费、预留、可用金额和钱包余额尚未接入。</li><li>风险阈值、权重和混合风险总分不在本面板中。</li></ul>
    </section>

    <div className="task-authorization-actions"><button type="button" disabled={busy} onClick={onRefresh}>查询已有许可</button>{message && <p className="task-authorization-message" role="alert">{message}</p>}</div>
  </section>;
}
