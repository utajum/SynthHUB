// "Install app" button: uses the beforeinstallprompt captured early by
// src/components/pwa-early.astro (before this island hydrates) and triggers the
// native PWA install. Hidden when already installed or unsupported.
import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { trackPwa } from '../lib/analytics';

const INSTALLED_FLAG = 'sh_pwa_installed';

// Fire the funnel-top "an install is possible" event at most once per page load.
let availableAnnounced = false;
function announceAvailable(): void {
  if (availableAnnounced) return;
  availableAnnounced = true;
  trackPwa('pwa_install_available');
}

function markInstalled(method: 'prompt' | 'ios'): void {
  try {
    if (localStorage.getItem(INSTALLED_FLAG)) return;
    localStorage.setItem(INSTALLED_FLAG, method);
  } catch {
    return;
  }
  // `method` = how the install was detected; device platform/os travel along in
  // pwaContext() ($os is auto-captured too).
  trackPwa('pwa_installed', { method });
}

export default function InstallButton() {
  const [deferred, setDeferred] = createSignal<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = createSignal(false);

  onMount(() => {
    const store = (window.__pwaInstall = window.__pwaInstall || {
      deferred: null,
      installed: false,
    });

    // Consume anything the early script already captured before hydration.
    if (store.installed) {
      setInstalled(true);
      markInstalled('prompt');
    }
    if (store.deferred) {
      setDeferred(store.deferred);
      announceAvailable();
    }

    // Subscribe for events that arrive after hydration.
    store.onDeferred = (e) => {
      setDeferred(e);
      announceAvailable();
    };
    store.onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      markInstalled('prompt');
    };

    // Standalone launch (already-installed users) - fires every launch.
    const isIos =
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || isIos;
    if (standalone) {
      setInstalled(true);
      trackPwa('pwa_launch_standalone');
      // iOS never fires appinstalled; treat first standalone launch as install.
      if (isIos) markInstalled('ios');
    }

    onCleanup(() => {
      if (store.onDeferred) delete store.onDeferred;
      if (store.onInstalled) delete store.onInstalled;
    });
  });

  const install = async () => {
    const e = deferred();
    if (!e) return;
    await e.prompt();
    const choice = await e.userChoice.catch(() => undefined);
    if (choice) trackPwa('pwa_install_prompt', { outcome: choice.outcome });
    setDeferred(null);
  };

  return (
    <Show when={deferred() && !installed()}>
      <button
        class="social-link install"
        onClick={install}
        title="Install SynthHub as an app on this device"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
        </svg>
        <span>./install</span>
      </button>
    </Show>
  );
}
