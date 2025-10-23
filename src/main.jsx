import { render } from 'preact';
import App from './App.jsx';
import '../styles.css';

// Register service worker for caching static assets
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
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
