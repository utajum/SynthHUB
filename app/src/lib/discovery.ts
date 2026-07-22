// Device discovery: MIDI port names match against device aliases; USB product
// ids against the pid map, falling back to the USB product NAME for units with
// no known PID (e.g. Swing - the live descriptor then reveals the real PID).
// Both signals merge by slug so a unit seen over both transports appears once.
import aliasMap from '../data/alias-map.json';
import pidMap from '../data/pid-map.json';
import type { MidiPortInfo } from './midi/webmidi';
import type { UsbDeviceInfo } from './usb/webusb';
import type { ProtocolId } from './types';

interface AliasEntry {
  alias: string;
  slug: string;
  variant: string;
  protocol: number;
}
interface PidEntry {
  slug: string;
  variant: string;
  protocol: number;
}

const ALIASES = aliasMap as AliasEntry[];
const PIDS = pidMap as Record<string, PidEntry>;

// Aliases sorted longest first: the substring pass must try the most specific
// alias so "MS-1 MK II" never resolves to ms-1 (wrong model id = wrong device).
const ALIASES_BY_LEN = [...ALIASES].sort(
  (a, b) => normalize(b.alias).length - normalize(a.alias).length,
);

// a device detected on one or both transports
export interface DetectedDevice {
  slug: string;
  variant: string;
  protocol: ProtocolId;
  via: Array<'midi' | 'usb'>;
  midiInputId?: string;
  midiOutputId?: string;
  midiPortName?: string;
  usbPid?: string;
  usbProductName?: string;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// resolve a raw MIDI port name to a catalogue entry, longest-alias-first
function matchMidiName(
  name: string,
): { slug: string; variant: string; protocol: number } | null {
  const n = normalize(name);
  if (!n) return null;
  // exact alias match first
  for (const e of ALIASES) {
    if (normalize(e.alias) === n) return e;
  }
  // then substring, longest alias first (port names carry "MIDI 1" suffixes)
  for (const e of ALIASES_BY_LEN) {
    if (n.includes(normalize(e.alias))) return e;
  }
  return null;
}

// resolve a USB product id (e.g. "0x1240") to a catalogue entry
function matchUsbPid(pidHex: string): PidEntry | null {
  return PIDS[pidHex.toLowerCase()] ?? null;
}

// merge MIDI ports + USB devices into a deduplicated detected-device list
export function discover(
  inputs: MidiPortInfo[],
  outputs: MidiPortInfo[],
  usbDevices: UsbDeviceInfo[],
): DetectedDevice[] {
  const bySlug = new Map<string, DetectedDevice>();

  const ensure = (
    slug: string,
    variant: string,
    protocol: number,
  ): DetectedDevice => {
    let d = bySlug.get(slug);
    if (!d) {
      d = { slug, variant, protocol: protocol as ProtocolId, via: [] };
      bySlug.set(slug, d);
    }
    return d;
  };

  // MIDI inputs (virtual in-app ports are never hardware - skip them)
  for (const p of inputs) {
    if (p.id.startsWith('virtual:')) continue;
    const m = matchMidiName(p.name);
    if (!m) continue;
    const d = ensure(m.slug, m.variant, m.protocol);
    d.midiInputId = p.id;
    d.midiPortName = p.name;
    if (!d.via.includes('midi')) d.via.push('midi');
  }
  // MIDI outputs
  for (const p of outputs) {
    if (p.id.startsWith('virtual:')) continue;
    const m = matchMidiName(p.name);
    if (!m) continue;
    const d = ensure(m.slug, m.variant, m.protocol);
    d.midiOutputId = p.id;
    if (!d.via.includes('midi')) d.via.push('midi');
  }
  // USB: prefer the PID map; fall back to the USB product name (alias match)
  // for units whose PID we do not know ahead of time (e.g. Swing). Matching by
  // name also captures the real PID in `usbPid` so it can be reported/pinned.
  for (const u of usbDevices) {
    const m =
      matchUsbPid(u.pidHex) ??
      (u.productName ? matchMidiName(u.productName) : null);
    if (!m) continue;
    const d = ensure(m.slug, m.variant, m.protocol);
    d.usbPid = u.pidHex;
    d.usbProductName = u.productName;
    if (!d.via.includes('usb')) d.via.push('usb');
  }

  return [...bySlug.values()];
}
