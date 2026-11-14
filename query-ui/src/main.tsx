import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryUi } from './App';
import { loadMappings } from './lib/app-mappings';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><QueryUi mappings={loadMappings()} /></StrictMode>);
