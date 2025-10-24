import { render } from 'preact';
import App from '../../renderer/App';
import '../styles.css';
import logger from '../../utils/logger';

// Register service worker for caching static assets
// Guard registration: service workers require a secure origin (https:// or localhost)
// In Electron packaged apps the renderer is often loaded via file:// which can't register
// a service worker and results in errors like "Failed to register a ServiceWorker for scope ('file:///C:/')".
// Only attempt registration when not in dev and not loaded from file: protocol.
if (
  'serviceWorker' in navigator &&
  !(import.meta as any).env?.DEV &&
  window?.location?.protocol !== 'file:'
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        logger.log('[App] ServiceWorker registered:', registration.scope);
      })
      .catch((error) => {
        logger.warn('[App] ServiceWorker registration failed:', error);
      });
  });
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
