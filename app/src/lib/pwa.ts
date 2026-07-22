// register the service worker (idempotent; no-op during SSR)
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // non-fatal: the app works without offline caching
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}
