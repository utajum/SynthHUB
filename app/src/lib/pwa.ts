// register the service worker (idempotent; no-op during SSR)
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // updateViaCache 'none': update checks always fetch /sw.js from the network
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((err) => {
        // non-fatal: the app works without offline caching
        console.warn('[pwa] service worker registration failed:', err);
      });
  });
}
