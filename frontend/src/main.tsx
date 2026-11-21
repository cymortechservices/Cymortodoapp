import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { isNative } from './lib/native';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/700.css';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e)); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
