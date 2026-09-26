import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivateRiskDemo } from './PrivateRiskDemo.tsx';
import './private-risk.css';

const root = document.getElementById('root')!;
// Only offline harness HTML opts in before mount; saved evidence never selects this mode.
const offlineFixture = root.dataset.evidencePresentation === 'offline-fixture';
createRoot(root).render(<StrictMode><PrivateRiskDemo offlineFixture={offlineFixture} /></StrictMode>);
