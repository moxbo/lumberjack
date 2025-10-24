import { render } from 'preact';
import App from './App.jsx';
import '../styles.css';

// Register service worker for caching static assets
// Guard registration: service workers require a secure origin (https:// or localhost)
// In Electron packaged apps the renderer is often loaded via file:// which can't register
// a service worker and results in errors like "Failed to register a ServiceWorker for scope ('file:///C:/')".
// Only attempt registration when not in dev and not loaded from file: protocol.
if (
  'serviceWorker' in navigator &&
  !import.meta.env.DEV &&
  window?.location?.protocol !== 'file:'
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('[App] ServiceWorker registered:', registration.scope);
      })
      .catch((error) => {
        console.warn('[App] ServiceWorker registration failed:', error);
      });
  });
}

render(<App />, document.getElementById('app'));
