import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoExperience } from './DemoExperience.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Demo root is missing.');
createRoot(root).render(<StrictMode><DemoExperience /></StrictMode>);
