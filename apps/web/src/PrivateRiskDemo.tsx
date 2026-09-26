import { useEffect, useRef, useState } from 'react';
import { PrivateRiskClient, type PrivateRiskClientState } from './private-risk-client.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';
import { TaskAuthorizationDemo } from './TaskAuthorizationDemo.tsx';

export function PrivateRiskDemo({ offlineFixture = false }: { offlineFixture?: boolean }) {
  const client = useRef<PrivateRiskClient | null>(null);
  const [state, setState] = useState<PrivateRiskClientState>({ selectedId: 'H1', status: null, loading: false, message: '' });
  useEffect(() => {
    let active = true;
    const instance = new PrivateRiskClient(next => { if (active) setState(next); });
    client.current = instance;
    if (window.location.protocol === 'http:') void instance.refresh();
    return () => { active = false; instance.dispose(); client.current = null; };
  }, []);
  return <>
    <PrivateRiskPanel offlineFixture={offlineFixture} {...state} onSelect={id => client.current?.select(id)} onScan={() => { void client.current?.scan(); }} onRefresh={() => { void client.current?.refresh(); }} />
    <details className="task-authorization-disclosure">
      <summary>Advanced spending policy</summary>
      <TaskAuthorizationDemo />
    </details>
  </>;
}
