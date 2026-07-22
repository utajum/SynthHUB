// Wire-encoding map: (setting type, subtype) -> bespoke serialization.
// Setting types NOT sent via the generic pkt+values frame
// (SettingRow change handlers). Keyed by type+subtype;
// unlisted types fall back to the generic frame.
import type { DeviceSetting } from '../../lib/types';

// one byte of a `single`-frame payload
interface WireItem {
  // emit this literal byte
  const?: number;
  // emit the (clamped) value of this sub-control id
  sub?: string;
  // wire = value - offset
  offset?: number;
  // wire = value ? 0 : 1
  invert?: boolean;
  // wire = values[value] (e.g. clock division)
  values?: number[];
}

// a sub-control sent as its own message in a perSub spec
interface WireSubSpec {
  id: string;
  pkt: number;
  spkt?: number;
  offset?: number;
  values?: number[];
}

interface WireSpec {
  // single = one message (header + pkt + [spkt] + items); perSub = one
  // message per listed sub
  kind: 'single' | 'perSub';
  // single: command byte; defaults to the setting's own sysex.pkt
  pkt?: number;
  spkt?: number;
  items?: WireItem[];
  subs?: WireSubSpec[];
}

// clock division index -> wire value (subtype 5, Model 15 / SPICE family)
const CLOCK_DIVISION_SUBTYPE5 = [5, 7, 8, 10, 11, 13, 14, 16];

export const WIRE_MAP: Record<string, Record<string, WireSpec>> = {
  // glide + legato share pkt 0x74, addressed by sub-selector 4/5
  glide: {
    '*': {
      kind: 'perSub',
      subs: [
        { id: 'glide', pkt: 0x74, spkt: 4 },
        { id: 'legato', pkt: 0x74, spkt: 5 },
      ],
    },
  },

  // clock has no pkt; each field is its own command byte: source 0x1b,
  // rate 0x1a, polarity 0x19, division 0x13 (raw combo index unless noted)
  clock: {
    '0': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a },
        { id: 'polarity', pkt: 0x19 },
      ],
    },
    '1': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a },
        { id: 'polarity', pkt: 0x19 },
      ],
    },
    // subtype 2: source only
    '2': {
      kind: 'perSub',
      subs: [{ id: 'source', pkt: 0x1b }],
    },
    // subtype 3 (RD-8/9 family): rate has a +99 wire offset
    '3': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a, offset: -99 },
      ],
    },
    // subtype 4: source only
    '4': {
      kind: 'perSub',
      subs: [{ id: 'source', pkt: 0x1b }],
    },
    '5': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a },
        { id: 'division', pkt: 0x13, values: CLOCK_DIVISION_SUBTYPE5 },
      ],
    },
    // subtypes 6/7: in/out polarity is a two-value message (0x19 <in> <out>)
    // not yet modeled - source+rate only until hardware is available
    '6': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a },
      ],
    },
    '7': {
      kind: 'perSub',
      subs: [
        { id: 'source', pkt: 0x1b },
        { id: 'rate', pkt: 0x1a },
      ],
    },
  },

  // pitchbend: subtypes 1/2 use pkt 0x11 with a trailing 0 byte
  pitchbend: {
    // subtype 0 (Model D): one frame `<pkt> <value> <!mode>`
    '0': {
      kind: 'single',
      items: [{ sub: 'value' }, { sub: 'mode', invert: true }],
    },
    '1': {
      kind: 'single',
      pkt: 0x11,
      items: [{ sub: 'value' }, { const: 0 }],
    },
    '2': {
      kind: 'single',
      pkt: 0x11,
      items: [{ sub: 'value' }, { const: 0 }],
    },
  },

  // velocity: three-byte payload on/off/curve; devices without off-constant
  // still send the middle byte (0)
  velocity: {
    '*': {
      kind: 'single',
      pkt: 0x10,
      items: [{ sub: 'onconstant' }, { sub: 'offconstant' }, { sub: 'curve' }],
    },
  },

  // MIDI thru routing: three toggles in fixed order m2u, mst, u2m (JSON key
  // order is not guaranteed, so pin it)
  midithrough: {
    '*': {
      kind: 'single',
      items: [{ sub: 'm2u' }, { sub: 'mst' }, { sub: 'u2m' }],
    },
  },

  // local keyboard mode (MonoPoly): one message `<pkt> <lkm> <din> <usb>`
  localkeyboardmodeex: {
    '*': {
      kind: 'single',
      items: [{ sub: 'value' }, { sub: 'din' }, { sub: 'usb' }],
    },
  },

  // MIDI channel: one message, leading 0x01, channels in fixed order
  channel: {
    // subtype 0: inverted mode toggle, in-channel sent twice
    '0': {
      kind: 'single',
      items: [{ sub: 'mode', invert: true }, { sub: 'in' }, { sub: 'in' }],
    },
    // subtype 1: 01, out, in
    '1': {
      kind: 'single',
      items: [{ const: 1 }, { sub: 'out' }, { sub: 'in' }],
    },
    // subtype 4: same wire shape as subtype 0
    '4': {
      kind: 'single',
      items: [{ sub: 'mode', invert: true }, { sub: 'in' }, { sub: 'in' }],
    },
    // subtype 2: 01, in, in
    '2': {
      kind: 'single',
      items: [{ const: 1 }, { sub: 'in' }, { sub: 'in' }],
    },
    // subtype 3: 01, out, in, usbout, usbin
    '3': {
      kind: 'single',
      items: [
        { const: 1 },
        { sub: 'out' },
        { sub: 'in' },
        { sub: 'usbout' },
        { sub: 'usbin' },
      ],
    },
  },
};

// wire spec for a setting, or null to use the generic frame
export function wireSpecFor(setting: DeviceSetting): WireSpec | null {
  const byType = WIRE_MAP[setting.type];
  if (!byType) return null;
  const sub = setting.sysex?.subtype;
  if (sub !== undefined && byType[String(sub)]) return byType[String(sub)];
  return byType['*'] ?? null;
}
