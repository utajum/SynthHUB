// thin wrapper over the PostHog inline snippet (window.posthog).
// no-op during SSR; the snippet stub queues calls until array.js loads.
export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.posthog?.capture(event, props);
}

const UID_KEY = 'sh_uid';

function mintUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Best-effort fallback (very old browsers). Not RFC-strict, good enough here.
  const b = new Uint8Array(16);
  (c?.getRandomValues ?? ((a: Uint8Array) => a))(b);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function bootstrapAnalyticsIdentity(): void {
  if (typeof window === 'undefined') return;
  let uid: string | null = null;
  try {
    uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = mintUuid();
      localStorage.setItem(UID_KEY, uid);
    }
  } catch {
    // localStorage blocked (private mode / disabled) — bail; PostHog stays
    // per-session anonymous as before. No worse than the old behavior.
    return;
  }
  // posthog-js's stub queues calls until array.js loads, so this is safe to
  // fire immediately after the inline snippet runs.
  window.posthog?.identify(uid);
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
