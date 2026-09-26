import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PayAssessmentDemo } from './PayAssessmentDemo.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Demo root is missing.');
createRoot(root).render(<StrictMode><PayAssessmentDemo /></StrictMode>);
