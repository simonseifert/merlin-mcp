import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { captureKey } from './api';
import App from './App';
import './styles.css';

captureKey();
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
