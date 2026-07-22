// Root Solid island: boots transports, wires the service worker, and lays out
// the three-column workspace (device list - workspace - monitor).
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { actions, useApp } from '../lib/store-solid';
import { drawerOpen, setDrawerOpen, logOpen } from '../lib/ui';
import { slugFromPath, syncUrl } from '../lib/nav';
import { meta } from '../devices/registry';
import { registerServiceWorker } from '../lib/pwa';
import { installGlobalHotkeys, onCommand } from '../lib/hotkeys';
import TransportBar from './TransportBar';
import DeviceList from './DeviceList';
import DevicePanel from './DevicePanel';
import DeviceGallery from './DeviceGallery';
import SysexLog from './SysexLog';
import HelpModal from './HelpModal';
import CommandPalette from './CommandPalette';

export default function App(props: { initialSlug?: string }) {
  const selected = useApp((s) => s.selectedSlug);
  const [helpOpen, setHelpOpen] = createSignal(false);
  // fromPop: popstate selections must not push history; ready: hold URL sync
  // until the initial deep-link resolves
  let fromPop = false;
  let ready = false;

  // deep-link handling + Back/Forward re-select
  onMount(() => {
    const initial =
      slugFromPath(window.location.pathname) ?? props.initialSlug ?? null;
    if (initial && meta(initial)) actions().select(initial);
    ready = true;
    const onPop = () => {
      fromPop = true;
      const slug = slugFromPath(window.location.pathname);
      actions().select(slug && meta(slug) ? slug : null);
      fromPop = false;
    };
    window.addEventListener('popstate', onPop);
    onCleanup(() => window.removeEventListener('popstate', onPop));
  });

  // keep the address bar in sync without reloading; close the mobile drawer
  createEffect(() => {
    const slug = selected();
    setDrawerOpen(false);
    if (ready && !fromPop) syncUrl(slug);
  });

  onMount(() => {
    registerServiceWorker();
    // MIDI immediately; USB waits for an explicit user gesture
    actions().initTransports();
    const uninstall = installGlobalHotkeys();
    const subs = [
      onCommand('help:toggle', () => setHelpOpen((v) => !v)),
      onCommand('help:close', () => setHelpOpen(false)),
      onCommand('usb:connect', () => actions().requestUsb()),
      onCommand('midi:enable', () => actions().initTransports()),
      onCommand('scan', () => actions().refresh()),
    ];
    onCleanup(() => {
      uninstall();
      subs.forEach((u) => u());
    });
  });

  return (
    <div class={`workspace ${logOpen() ? '' : 'no-log'}`}>
      <div class="ws-top">
        <TransportBar />
      </div>
      {/* mobile-only drawer backdrop (toggle button lives in the TransportBar) */}
      <Show when={drawerOpen()}>
        <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      </Show>
      <aside class={`ws-left ${drawerOpen() ? 'open' : ''}`}>
        <DeviceList />
      </aside>
      <main class="ws-main">
        <Show
          when={selected()}
          fallback={
            <div class="panel">
              <div class="body muted stack">
                <p class="hot">// no device selected</p>
                <p>
                  Click <span class="hot">CONNECT USB</span> and pick your
                  Behringer synth, or choose any model from the catalogue to
                  explore its controls offline.
                </p>
                <p class="tiny dim">
                  71 models - 130 USB IDs - WebUSB discovery + WebMIDI SysEx
                  control. Everything runs locally in your browser.
                </p>
                <DeviceGallery />
              </div>
            </div>
          }
        >
          <DevicePanel slug={selected()!} />
        </Show>
      </main>
      <Show when={logOpen()}>
        <section class="ws-right">
          <SysexLog />
        </section>
      </Show>

      <button
        class="help-fab"
        onClick={() => setHelpOpen(true)}
        title="Keyboard shortcuts (press ?)"
        aria-label="Open keyboard shortcuts help"
      >
        ?
      </button>
      <HelpModal open={helpOpen()} onClose={() => setHelpOpen(false)} />
      <CommandPalette />
    </div>
  );
}
