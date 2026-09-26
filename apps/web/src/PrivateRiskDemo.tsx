import { useEffect, useRef, useState } from 'react';
import { PrivateRiskClient, type PrivateRiskClientState } from './private-risk-client.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';
import { TaskAuthorizationDemo } from './TaskAuthorizationDemo.tsx';

export function PrivateRiskDemo() {
  const client = useRef<PrivateRiskClient | null>(null);
  const [state, setState] = useState<PrivateRiskClientState>({ selectedId: 'H1', status: null, loading: false, message: '私人电脑专用，只查询地址风险，不付款。' });
  useEffect(() => {
    let active = true;
    const instance = new PrivateRiskClient(next => { if (active) setState(next); });
    client.current = instance;
    if (window.location.protocol === 'http:') void instance.refresh();
    return () => { active = false; instance.dispose(); client.current = null; };
  }, []);
  return <><TaskAuthorizationDemo /><PrivateRiskPanel {...state} onSelect={id => client.current?.select(id)} onScan={() => { void client.current?.scan(); }} onRefresh={() => { void client.current?.refresh(); }} /></>;
}
