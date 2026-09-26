import { useEffect,useRef,useState } from 'react';
import { TaskAuthorizationPanel } from './TaskAuthorizationPanel.tsx';
import { TaskGrantClient,type TaskGrantClientState } from './task-grant-client.ts';

const atomicToUsdc=(value:string)=>{
  const padded=value.padStart(7,'0');
  const whole=padded.slice(0,-6).replace(/^0+(?=\d)/,'')||'0';
  const fraction=padded.slice(-6).replace(/0+$/,'');
  return fraction?`${whole}.${fraction}`:whole;
};

export function TaskAuthorizationDemo(){
  const client=useRef<TaskGrantClient|null>(null);
  const [state,setState]=useState<TaskGrantClientState>({status:null,loading:false,message:''});
  useEffect(()=>{
    let active=true;
    const instance=new TaskGrantClient(next=>{if(active)setState(next);});client.current=instance;
    if(window.location.protocol==='http:')void instance.refresh();
    return()=>{active=false;instance.dispose();client.current=null;};
  },[]);
  const grant=state.status?.grant;
  return <section className="agent-spending-policy" aria-labelledby="agent-spending-policy-title">
    <div className="agent-spending-policy-heading">
      <div><p className="private-risk-kicker">OWNER-CONFIGURED BOUNDARY</p><h2 id="agent-spending-policy-title">Agent Spending Policy</h2></div>
      <span className="private-risk-badge">Execution disconnected</span>
    </div>
    <dl className="agent-spending-policy-summary">
      <div><dt>Task budget:</dt><dd>{grant?`${atomicToUsdc(grant.totalBudgetAtomic)} USDC`:'Not configured'}</dd></div>
      <div><dt>Per-payment limit:</dt><dd>{grant?`${atomicToUsdc(grant.perTransactionAtomic)} USDC`:'Not configured'}</dd></div>
      <div><dt>Expiry:</dt><dd>{grant?grant.expiresAt:'Not configured'}</dd></div>
      <div><dt>Remaining ledger / wallet:</dt><dd>Unknown · not connected</dd></div>
    </dl>
    <p className="private-risk-note">Saved grant facts apply only to their stored task context. They do not authorize the selected recipient or enable execution.</p>
    <details className="agent-spending-policy-manage">
      <summary>Manage policy</summary>
      <TaskAuthorizationPanel {...state} onSave={input=>client.current?.save(input)} onRefresh={()=>client.current?.refresh()}/>
    </details>
  </section>;
}
