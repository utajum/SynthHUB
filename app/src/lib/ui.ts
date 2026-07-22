// App-wide UI signals shared across islands (module-singleton Solid signals).
import { createSignal } from 'solid-js';

// mobile device-list drawer state
export const [drawerOpen, setDrawerOpen] = createSignal(false);

export const toggleDrawer = () => setDrawerOpen((v) => !v);

// monitor/log column visibility (persisted); hidden = device panel goes wide
const LOG_KEY = 'ui:log-open';
export const [logOpen, setLogOpen] = createSignal(
  typeof localStorage === 'undefined' || localStorage.getItem(LOG_KEY) !== '0',
);
export const toggleLog = () =>
  setLogOpen((v) => {
    try {
      localStorage.setItem(LOG_KEY, v ? '0' : '1');
    } catch {
      // best-effort persistence
    }
    return !v;
  });
