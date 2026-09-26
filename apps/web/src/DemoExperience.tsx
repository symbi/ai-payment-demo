import { useEffect, useRef, useState } from 'react';
import { POLICY_PREVIEW_CASES } from '../../../shared/policy-preview.ts';
import type { PolicyPreviewViewState } from '../../../shared/policy-preview-view.ts';
import { PolicyPreviewClient } from './policy-preview-client.ts';
import { PolicyPreviewPanel } from './PolicyPreviewPanel.tsx';
import { PayAssessmentDemo } from './PayAssessmentDemo.tsx';
import './policy-preview-shell.css';

function FixedPolicyPreview() {
  const client = useRef<PolicyPreviewClient | null>(null);
  const [state, setState] = useState<PolicyPreviewViewState>({
    caseId: 'case-01', budgetText: '0.002000', phase: 'idle', result: null, message: '选择合成案例，再评估。',
  });
  useEffect(() => {
    let alive = true;
    const instance = new PolicyPreviewClient({
      mode: window.location.protocol === 'file:' ? 'file' : 'http',
      onChange: next => { if (alive) setState({ ...next }); },
    });
    client.current = instance;
    setState({ ...instance.state });
    return () => { alive = false; instance.dispose(); client.current = null; };
  }, []);
  return <PolicyPreviewPanel cases={POLICY_PREVIEW_CASES} state={state}
    onCaseChange={value => client.current?.setCaseId(value)}
    onBudgetChange={value => client.current?.setBudgetText(value)}
    onAssess={() => { void client.current?.assess(); }} />;
}

export function DemoExperience() {
  const [view, setView] = useState<'policy' | 'weighted'>('policy');
  return <>
    <nav className="demo-view-switcher" aria-label="演示模式">
      <span>PAY / ASSESS</span>
      <div>
        <button type="button" aria-pressed={view === 'policy'} onClick={() => setView('policy')}>四动作评估</button>
        <button type="button" aria-pressed={view === 'weighted'} onClick={() => setView('weighted')}>原评分实验</button>
      </div>
      <small>两种模式均为离线合成演示</small>
    </nav>
    {view === 'policy' ? <FixedPolicyPreview /> : <PayAssessmentDemo />}
  </>;
}
