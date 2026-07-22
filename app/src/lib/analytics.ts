// thin wrapper over the PostHog inline snippet (window.posthog).
// no-op during SSR; the snippet stub queues calls until array.js loads.
export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.posthog?.capture(event, props);
}

// PWA-specific context that posthog-js does NOT auto-capture.
// (OS, browser, device type, screen, host/url, referrer and geoip ARE added
// automatically by posthog-js as $os/$browser/$device_type/$host/... so we do
// not duplicate them here.)
export function pwaContext(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = navigator.userAgent || '';
  const mm = (q: string) => window.matchMedia?.(q).matches ?? false;

  const displayMode = mm('(display-mode: standalone)')
    ? 'standalone'
    : mm('(display-mode: minimal-ui)')
      ? 'minimal-ui'
      : mm('(display-mode: fullscreen)')
        ? 'fullscreen'
        : 'browser';

  const iosStandalone = nav.standalone === true;
  // iPadOS 13+ reports as "Macintosh"; detect via touch support.
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof document !== 'undefined' &&
      'ontouchend' in document);
  const isAndroid = /Android/.test(ua);
  const platform = isIos
    ? 'ios'
    : isAndroid
      ? 'android'
      : /Mobi/.test(ua)
        ? 'other'
        : 'desktop';

  return {
    platform,
    display_mode: displayMode,
    standalone: displayMode === 'standalone' || iosStandalone,
    ios_standalone: iosStandalone,
    prompt_supported: 'onbeforeinstallprompt' in window,
  };
}

// track() for PWA events: always merges the non-auto PWA context above.
export function trackPwa(event: string, props?: Record<string, unknown>): void {
  track(event, { ...pwaContext(), ...props });
}
