import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HomePage } from './pages/HomePage';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
