import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivateRiskDemo } from './PrivateRiskDemo.tsx';
import './private-risk.css';

createRoot(document.getElementById('root')!).render(<StrictMode><PrivateRiskDemo /></StrictMode>);
