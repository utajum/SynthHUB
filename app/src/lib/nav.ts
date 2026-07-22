// URL <-> device-selection sync. Every device has a prerendered page at
// /device/<slug>/; in-app selection updates the URL without a reload so the
// MIDI/USB session survives and back/forward work.

// "/device/<slug>[/]" -> slug, else null
export function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/device\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

// canonical per-device path (trailing slash matches the static route)
export function deviceHref(slug: string): string {
  return `/device/${slug}/`;
}

// user actions push a history entry; programmatic reconciliation replaces.
// markUserNav() flags the next syncUrl() as user-driven.
let userNav = false;
export function markUserNav(): void {
  userNav = true;
}

// reconcile the address bar with the selected slug (null = root)
export function syncUrl(slug: string | null): void {
  if (typeof window === 'undefined') return;
  const desired = slug ? deviceHref(slug) : '/';
  if (window.location.pathname === desired) {
    userNav = false;
    return;
  }
  const push = userNav;
  userNav = false;
  const state = { slug };
  if (push) window.history.pushState(state, '', desired);
  else window.history.replaceState(state, '', desired);
}

// true when a left-click should be handled in-app (unmodified primary button)
export function isPlainLeftClick(e: MouseEvent): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}
