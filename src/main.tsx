import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Service worker só na web (https/localhost); Android e Electron já empacotam os arquivos.
const isNativeShell = location.protocol === 'quartzo:' || 'Capacitor' in window;
if (!isNativeShell && 'serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => void 0);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
