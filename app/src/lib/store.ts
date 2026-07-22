// Global app state (Zustand vanilla store, framework-neutral). Solid
// components subscribe via store-solid.ts. State stays flat and serializable.
import { createStore } from 'zustand/vanilla';
import { midi, type MidiPortInfo } from './midi/webmidi';
import { usb, type UsbDeviceInfo } from './usb/webusb';
import { discover, type DetectedDevice } from './discovery';

type TransportState =
  'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

interface LogEntry {
  ts: number;
  dir: 'out' | 'in' | 'info';
  text: string;
}

export interface AppState {
  // transports
  midiState: TransportState;
  usbState: TransportState;
  midiInputs: MidiPortInfo[];
  midiOutputs: MidiPortInfo[];
  usbDevices: UsbDeviceInfo[];

  // discovery
  detected: DetectedDevice[];
  selectedSlug: string | null;

  // per-device parameter cache: slug -> paramKey -> value
  params: Record<string, Record<string, number>>;

  // rolling SysEx / activity log (newest last, capped)
  log: LogEntry[];

  // actions
  initTransports: () => Promise<void>;
  requestUsb: () => Promise<void>;
  requestUsbSilent: () => Promise<void>;
  disconnectMidi: () => void;
  forgetUsb: (pidHex?: string) => Promise<void>;
  refresh: () => void;
  select: (slug: string | null) => void;
  setParam: (slug: string, key: string, value: number) => void;
  pushLog: (entry: Omit<LogEntry, 'ts'>) => void;
  clearLog: () => void;
  panic: () => void;
}

const LOG_CAP = 500;

export const appStore = createStore<AppState>((set, get) => ({
  midiState: MidiEngineSupported() ? 'idle' : 'unsupported',
  usbState: UsbEngineSupported() ? 'idle' : 'unsupported',
  midiInputs: [],
  midiOutputs: [],
  usbDevices: [],
  detected: [],
  selectedSlug: null,
  params: {},
  log: [],

  async initTransports() {
    // MIDI (SysEx management channel over USB-MIDI)
    if (MidiEngineSupported()) {
      set({ midiState: 'requesting' });
      try {
        const ok = await midi.init();
        set({ midiState: ok ? 'ready' : 'denied' });
        midi.onPorts(({ inputs, outputs }) => {
          set({ midiInputs: inputs, midiOutputs: outputs });
          get().refresh();
        });
        midi.onMessage((data, src) => {
          // never log system-realtime traffic (MIDI clock is ~48 msg/s and
          // would flood the ring + trigger store updates per message)
          if (data.length === 1 && data[0] >= 0xf8) return;
          get().pushLog({
            dir: 'in',
            text: `${src.name}: ${hexShort(data)}`,
          });
        });
      } catch {
        set({ midiState: 'denied' });
      }
    }
    // USB (discovery / identification by VID 0x1397)
    if (UsbEngineSupported()) {
      try {
        const granted = await usb.listGranted();
        set({
          usbDevices: granted,
          usbState: granted.length ? 'ready' : 'idle',
        });
        usb.onConnect(() => get().requestUsbSilent());
        usb.onDisconnect(() => get().requestUsbSilent());
      } catch {
        // ignore
      }
    }
    get().refresh();
    get().pushLog({ dir: 'info', text: 'Transports initialized.' });
  },

  async requestUsb() {
    if (!UsbEngineSupported()) return;
    set({ usbState: 'requesting' });
    const picked = await usb.requestDevice();
    const granted = await usb.listGranted();
    set({
      usbDevices: granted,
      usbState: granted.length ? 'ready' : 'idle',
    });
    if (picked) {
      get().pushLog({
        dir: 'info',
        text: `USB granted: ${picked.productName ?? picked.pidHex} (${picked.pidHex})`,
      });
    }
    get().refresh();
  },

  // internal helper reused by hot-plug handlers (no user prompt)
  async requestUsbSilent() {
    const granted = await usb.listGranted();
    set({ usbDevices: granted });
    get().refresh();
  },

  // Release the MIDI session the PWA opened (all ports); user can ENABLE again.
  disconnectMidi() {
    midi.disconnect();
    set({ midiState: 'idle', midiInputs: [], midiOutputs: [] });
    get().refresh();
    get().pushLog({
      dir: 'info',
      text: 'MIDI disconnected - all ports released.',
    });
  },

  // Revoke a granted USB device (by pid) or all of them when pid is omitted.
  async forgetUsb(pidHex) {
    if (!UsbEngineSupported()) return;
    const gone = get().usbDevices.find((d) => d.pidHex === pidHex);
    await usb.forget(pidHex);
    const granted = await usb.listGranted();
    set({ usbDevices: granted, usbState: granted.length ? 'ready' : 'idle' });
    get().refresh();
    get().pushLog({
      dir: 'info',
      text: pidHex
        ? `USB disconnected: ${gone?.productName ?? pidHex} (${pidHex})`
        : 'USB disconnected - all devices forgotten.',
    });
  },

  refresh() {
    const s = get();
    const detected = discover(s.midiInputs, s.midiOutputs, s.usbDevices);
    // the URL is the source of truth - never auto-select a connected unit
    // (that would hijack `/` and rewrite the address bar)
    set({ detected });
  },

  select(slug) {
    set({ selectedSlug: slug });
  },

  setParam(slug, key, value) {
    set((s) => ({
      params: {
        ...s.params,
        [slug]: { ...(s.params[slug] ?? {}), [key]: value },
      },
    }));
  },

  pushLog(entry) {
    set((s) => {
      const log = [...s.log, { ...entry, ts: Date.now() }];
      if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
      return { log };
    });
  },

  clearLog() {
    set({ log: [] });
  },

  // MIDI panic: all-notes-off + all-sound-off on all 16 channels of every
  // open output (kills stuck notes everywhere)
  panic() {
    const outs = get().midiOutputs;
    let sent = 0;
    for (const o of outs) {
      for (let ch = 0; ch < 16; ch++) {
        if (midi.send(o.id, Uint8Array.from([0xb0 | ch, 0x7b, 0x00]))) sent++;
        if (midi.send(o.id, Uint8Array.from([0xb0 | ch, 0x78, 0x00]))) sent++;
      }
    }
    get().pushLog({
      dir: sent ? 'out' : 'info',
      text: sent
        ? `MIDI panic: notes-off sent to ${outs.length} output(s)`
        : 'MIDI panic: no open outputs',
    });
  },
}));

function MidiEngineSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
function UsbEngineSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}
function hexShort(data: Uint8Array): string {
  const s = Array.from(data.slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join(' ');
  return data.length > 16 ? `${s} ...(${data.length})` : s;
}
