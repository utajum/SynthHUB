// AQ64L custom pad modes (Control Tribe 1.12.4 AQ64LCustomMode,
// AQ64LCustomSync::buildMessages, AQ64LDataAdapter). Frame:
// F0 00 20 32 00 01 6D 7F <cmd> <user slot> [pad] [data] F7.
//   17 <slot>                     start
//   1A <slot> 03 00 00 3D 43 40 34 4C <mode flags> 00
//   per pad: 16 <slot> <pad> <on colour r g b> (7-bit each), then
//     12 <slot> <pad> <colour r g b>, 13 <slot> <pad> <kind> <ch> <p1> <p2>
//     or 11 <slot> <pad> <note> <octave> <palette index>
//   1D <slot>                     end
// The device answers each frame (cmd 10-20); the host waits up to 100 ms,
// and after three misses stops waiting.
import { midi } from '../../lib/midi/webmidi';

export const AQ_HDR = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x6d, 0x7f];
export const AQ_PADS = 64;
export const AQ_GLOBAL = 16; // pad channel 16 = the global channel

// 0xAARRGGBB <-> the value of an <input type="color">
export const aqHex = (c: number) =>
  `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
export const aqFromHex = (s: string) =>
  (0xff000000 | parseInt(s.slice(1), 16)) >>> 0;

export const aqFrame = (...body: number[]) =>
  Uint8Array.from([...AQ_HDR, ...body.map((b) => b & 0x7f), 0xf7]);

// pad types (AQ64LCustomMode tool ids)
export const AQ_TYPES = [
  'none',
  'fader_v',
  'fader_v_bi',
  'fader_h',
  'fader_h_bi',
  'chromatic_keyboard',
  'scale_keyboard',
  'drum_grid',
  'midi_note',
  'cc_button',
  'pc_button',
  'key_stroke',
] as const;
export type AqType = (typeof AQ_TYPES)[number];

export const AQ_TYPE_LABEL: Record<AqType, string> = {
  none: 'None',
  fader_v: 'Fader (vertical)',
  fader_v_bi: 'Fader (vertical, bipolar)',
  fader_h: 'Fader (horizontal)',
  fader_h_bi: 'Fader (horizontal, bipolar)',
  chromatic_keyboard: 'Chromatic Keyboard',
  scale_keyboard: 'Scale Keyboard',
  drum_grid: 'Drum Grid',
  midi_note: 'Midi Note',
  cc_button: 'Control Change',
  pc_button: 'Program Change',
  key_stroke: 'Key Stroke',
};

// CC button modes (combo ids)
export const AQ_CC_MODES: [string, number][] = [
  ['Gate', 1],
  ['Hold', 2],
  ['Toggle', 4],
];

export interface AqPad {
  enabled: boolean;
  colour: number; // 0xAARRGGBB
  onColour: number;
  type: number; // index into AQ_TYPES
  note: number;
  octaves: number;
  mode: number;
  channel: number; // 0-15, 16 = global
  param1: number;
  param2: number;
}

export interface AqButton {
  enabled: boolean;
  colour: number;
  function?: number;
  group?: number;
}

export interface AqPreset {
  pads: AqPad[];
  modes: AqButton[];
  funcs: AqButton[];
}

export const aqPad = (p: Partial<AqPad> = {}): AqPad => ({
  enabled: false,
  colour: 0xff333333,
  onColour: 0xff00ff00,
  type: 0,
  note: 0,
  octaves: 0,
  mode: 0,
  channel: 0,
  param1: 0,
  param2: 0,
  ...p,
});

export const aqPreset = (): AqPreset => ({
  pads: Array.from({ length: AQ_PADS }, () => aqPad()),
  modes: Array.from({ length: 8 }, () => ({
    enabled: false,
    colour: 0xff333333,
    function: 0,
    group: 0,
  })),
  funcs: Array.from({ length: 8 }, () => ({
    enabled: false,
    colour: 0xff333333,
  })),
});

// the 17 colours the device knows by index (keyboards, drum grid)
const PALETTE: number[] = [
  0xffff80c0, 0xffc000c0, 0xffd0a0f0, 0xffb8b0ff, 0xff50b0ff, 0xff80d0ff,
  0xff00d8d8, 0xff70ffd0, 0xff90ff90, 0xffb0ff50, 0xffffff55, 0xfffff2a8,
  0xfff0e4c0, 0xffffc480, 0xffff7060, 0xffb0b0b0, 0xff333333,
];
export const aqPaletteIndex = (c: number) => PALETTE.indexOf(c >>> 0) + 1;

const rgb7 = (c: number) => [
  (c >> 17) & 0x7f,
  (c >> 9) & 0x7f,
  (c >> 1) & 0x7f,
];

// fader and button kinds in the 13 frame
const KIND: Record<number, number> = {
  1: 0x05,
  2: 0x0e,
  3: 0x0f,
  4: 0x10,
  10: 0x03,
};

// buildMessages: all frames of one preset for user slot `slot` (0 = User 1),
// pads on the global channel use `channel` (0 = ALL, 1-16)
export function aqCustomFrames(
  p: AqPreset,
  slot: number,
  channel: number,
): Uint8Array[] {
  const flags = (p.modes[0]?.function ? 1 : 0) | (p.modes[2]?.function ? 2 : 0);
  const out = [
    aqFrame(0x17, slot),
    aqFrame(0x1a, slot, 3, 0, 0, 0x3d, 0x43, 0x40, 0x34, 0x4c, flags, 0),
  ];
  p.pads.forEach((d, pad) => {
    const ch = d.channel < 16 ? d.channel : channel;
    const off = [
      aqFrame(0x12, slot, pad, 0, 0, 0),
      aqFrame(0x13, slot, pad, 0x0d, 0, 0, 0),
    ];
    out.push(aqFrame(0x16, slot, pad, ...rgb7(d.onColour)));
    const colour = aqFrame(0x12, slot, pad, ...rgb7(d.colour));
    const t = d.type;
    if (t === 0) out.push(...off);
    else if (t >= 1 && t <= 4)
      out.push(colour, aqFrame(0x13, slot, pad, KIND[t], ch, d.param1, 0));
    else if (t === 5 || t === 6)
      out.push(
        ...(d.param2
          ? off
          : [
              aqFrame(
                0x11,
                slot,
                pad,
                d.note,
                d.octaves,
                aqPaletteIndex(d.colour),
              ),
              colour,
            ]),
      );
    else if (t === 7 || t === 8)
      out.push(
        aqFrame(0x11, slot, pad, d.note, d.octaves, aqPaletteIndex(d.colour)),
        colour,
      );
    else if (t === 9)
      out.push(
        colour,
        aqFrame(0x13, slot, pad, d.mode, ch, d.param1, d.param2),
      );
    else if (t === 10)
      out.push(colour, aqFrame(0x13, slot, pad, KIND[10], ch, d.param1, 0));
    else if (t === 11)
      out.push(colour, aqFrame(0x13, slot, pad, 0x11, 0, d.param1, d.param2));
  });
  out.push(aqFrame(0x1d, slot));
  return out;
}

// device answer to a custom-mode frame (cmd 10-20)
export const isAqCustomReply = (d: ArrayLike<number>) =>
  d.length > 8 &&
  AQ_HDR.slice(0, 7).every((b, i) => d[i] === b) &&
  d[7] >= 0x10 &&
  d[7] <= 0x20;

// ---- .aq64l preset file (AQ64LDataAdapter::exportToFile) ------------------

const PAD_KEYS = [
  'note',
  'octaves',
  'mode',
  'channel',
  'param1',
  'param2',
] as const;

export function aqPresetToJson(p: AqPreset): string {
  const int = (c: number) => c | 0; // juce::var int: colours are signed
  return JSON.stringify(
    {
      format: 'AQ64LPreset',
      formatVersion: 1,
      device: 'AQ64L',
      pads: p.pads.map((d) => ({
        enabled: d.enabled ? 1 : 0,
        colour: int(d.colour),
        onColour: int(d.onColour),
        type: d.type,
        ...Object.fromEntries(PAD_KEYS.map((k) => [k, d[k]])),
      })),
      modes: p.modes.map((m) => ({
        enabled: m.enabled ? 1 : 0,
        colour: int(m.colour),
        function: m.function ?? 0,
        group: m.group ?? 0,
      })),
      funcs: p.funcs.map((m) => ({
        enabled: m.enabled ? 1 : 0,
        colour: int(m.colour),
      })),
    },
    null,
    2,
  );
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

// AQ64L::checkEnvelope: the Control Tribe error text, or null
export function aqCheckEnvelope(j: unknown, format: string): string | null {
  if (!isObj(j)) return 'It is not a valid JSON file.';
  if (j.device !== 'AQ64L') return 'It is not an AQ64L file.';
  if (j.format !== format)
    return typeof j.format === 'string'
      ? `It is a ${j.format} file, not a ${format} file.`
      : 'It is not an AQ64L file.';
  if (num(j.formatVersion) >= 2)
    return 'It was written by a newer version of this application.';
  return null;
}

export function aqPresetFromJson(text: string): AqPreset | string {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return 'It is not a valid JSON file.';
  }
  const bad = aqCheckEnvelope(j, 'AQ64LPreset');
  if (bad) return bad;
  const o = j as Obj;
  const p = aqPreset();
  const byte = (v: unknown) => num(v) & 0xff;
  if (Array.isArray(o.pads))
    o.pads.slice(0, AQ_PADS).forEach((x, i) => {
      if (!isObj(x)) return;
      const d = p.pads[i];
      d.type = num(x.type);
      d.enabled = num(x.enabled) > 0;
      d.colour = num(x.colour, d.colour) >>> 0;
      d.onColour = num(x.onColour, d.onColour) >>> 0;
      for (const k of PAD_KEYS) d[k] = byte(x[k]);
    });
  const buttons = (a: unknown, into: AqButton[], full: boolean) => {
    if (Array.isArray(a))
      a.slice(0, 8).forEach((x, i) => {
        if (!isObj(x)) return;
        into[i].enabled = num(x.enabled) > 0;
        into[i].colour = num(x.colour, into[i].colour) >>> 0;
        if (full) {
          into[i].function = num(x.function) > 0 ? 1 : 0;
          into[i].group = num(x.group);
        }
      });
  };
  buttons(o.modes, p.modes, true);
  buttons(o.funcs, p.funcs, false);
  return p;
}

// ---- tools: region layouts of AQ64LCustomMode::itemDropped ----------------

const COL = (pad: number) => pad & 7;
const ROW = (pad: number) => pad >> 3;
const KEY = 0xff80d0ff;
const ROOT = 0xffc000c0;
const GAP = 0xff333333;

// apply a tool at `pad`; returns the pads it changed
export function aqApplyTool(p: AqPreset, type: number, pad: number): number[] {
  const set = (i: number, d: Partial<AqPad>) => {
    p.pads[i] = aqPad({ enabled: true, type, ...d });
    return i;
  };
  const t = AQ_TYPES[type];
  if (t === 'fader_v' || t === 'fader_v_bi') {
    const colour = t === 'fader_v' ? 0xff90ff90 : 0xffb0ff50;
    return Array.from({ length: 8 }, (_, r) =>
      set(r * 8 + COL(pad), { colour, channel: AQ_GLOBAL }),
    );
  }
  if (t === 'fader_h' || t === 'fader_h_bi') {
    const colour = t === 'fader_h' ? 0xff90ff90 : 0xffb0ff50;
    return Array.from({ length: 8 }, (_, c) =>
      set(ROW(pad) * 8 + c, { colour, channel: AQ_GLOBAL }),
    );
  }
  if (t === 'chromatic_keyboard' || t === 'scale_keyboard') {
    // two rows: sharps above, naturals below (scale: natural minor)
    const r = Math.min(ROW(pad), 6);
    const top = t === 'chromatic_keyboard' ? [-1, 1, 3, -1, 6, 8, 10, -1] : [];
    const low =
      t === 'chromatic_keyboard'
        ? [0, 2, 4, 5, 7, 9, 11, 12]
        : [0, 2, 3, 5, 7, 8, 10, 12];
    const hi =
      t === 'chromatic_keyboard'
        ? low.map((n) => n + 12)
        : low.map((n) => n + 12);
    const out: number[] = [];
    for (let c = 0; c < 8; c++) {
      const n = top.length ? top[c] : hi[c];
      out.push(
        set(
          r * 8 + c,
          n < 0
            ? { colour: GAP, param2: 1 }
            : {
                note: n % 12,
                octaves: 5 + Math.floor(n / 12),
                colour: n % 12 ? KEY : ROOT,
              },
        ),
      );
      const m = low[c];
      out.push(
        set((r + 1) * 8 + c, {
          note: m % 12,
          octaves: 5 + Math.floor(m / 12),
          colour: m % 12 ? KEY : ROOT,
        }),
      );
    }
    return out;
  }
  if (t === 'drum_grid') {
    // 4 x 4 pads, notes upward from C 3
    const r0 = Math.min(ROW(pad), 4);
    const c0 = Math.min(COL(pad), 4);
    const out: number[] = [];
    for (let k = 0; k < 16; k++) {
      const n = 36 + k;
      out.push(
        set((r0 + 3 - (k >> 2)) * 8 + c0 + (k & 3), {
          note: n % 12,
          octaves: Math.floor(n / 12),
          colour: k ? KEY : ROOT,
          channel: 9,
        }),
      );
    }
    return out;
  }
  if (t === 'none') return [set(pad, { enabled: false, type: 0 })];
  const colour =
    t === 'cc_button'
      ? 0xffffc480
      : t === 'pc_button'
        ? 0xffd0a0f0
        : t === 'key_stroke'
          ? 0xfff0e4c0
          : KEY;
  return [
    set(pad, {
      colour,
      channel: AQ_GLOBAL,
      mode: t === 'cc_button' ? 1 : 0,
      param2: t === 'cc_button' ? 127 : 0,
      octaves: t === 'midi_note' ? 5 : 0,
    }),
  ];
}

// ---- key stroke: KeyboardEvent.code -> HID usage (KeyEditor::juceToHID),
// modifiers as HID bits (1 ctrl, 2 shift, 4 alt, 8 gui)
const HID: Record<string, number> = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .forEach((c, i) => (HID[`Key${c}`] = 0x04 + i));
'1234567890'.split('').forEach((c, i) => (HID[`Digit${c}`] = 0x1e + i));
Object.assign(HID, {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,
  Insert: 0x49,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
});
for (let i = 1; i <= 12; i++) HID[`F${i}`] = 0x39 + i;
const HID_NAME = Object.fromEntries(
  Object.entries(HID).map(([k, v]) => [v, k.replace(/^(Key|Digit)/, '')]),
);

export function aqKeyStroke(e: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): { key: number; mods: number } | null {
  const key = HID[e.code];
  if (key === undefined) return null;
  const mods =
    (e.ctrlKey ? 1 : 0) |
    (e.shiftKey ? 2 : 0) |
    (e.altKey ? 4 : 0) |
    (e.metaKey ? 8 : 0);
  return { key, mods };
}

export function aqKeyName(key: number, mods: number): string {
  if (!key) return '';
  const m = ['Ctrl', 'Shift', 'Alt', 'Cmd'].filter((_, i) => mods & (1 << i));
  return [...m, HID_NAME[key] ?? `0x${key.toString(16)}`].join('+');
}

// AQ64LCustomSync: one frame per reply (100 ms each); after three misses
// the rest go out 10 ms apart. Returns the number of missed replies.
export async function aqSendPaced(
  out: string,
  frames: Uint8Array[],
  progress: (i: number, n: number) => void = () => {},
): Promise<number> {
  let missed = 0;
  for (let i = 0; i < frames.length; i++) {
    const wait = missed < 3;
    const ok = await new Promise<boolean>((resolve) => {
      if (!wait) {
        midi.send(out, frames[i]);
        setTimeout(() => resolve(true), 10);
        return;
      }
      const off = midi.onMessage((d) => {
        if (!isAqCustomReply(d)) return;
        clearTimeout(t);
        off();
        resolve(true);
      });
      const t = setTimeout(() => {
        off();
        resolve(false);
      }, 100);
      midi.send(out, frames[i]);
    });
    if (!ok) missed++;
    progress(i + 1, frames.length);
  }
  return missed;
}

// ---- program page: paint the 80 LEDs (AQ64LProgramPage, AQ64L::fill*) ---
// LED ids: 0-7 the top buttons, then 8 rows of 9 (8 pads + the right
// button), as AQ64L::LightOutput maps grid codes 1-8, 11-19 .. 81-89. Frames: 66 <on> program mode, 68 <led> <c> erase / set,
// 6C <c> fill all, 6F <c> <loop> <text> scrolling text (6F 00 00 stops),
// 70 <specs> colours, 72 <0-100> brightness, 73 <0|1> save to USER1 / 2.
// <c> = index into the device's 128 colours.

export const AQ_LEDS = 80;
export const AQ_TOOLS = [
  'Paint',
  'Fill Row',
  'Fill Column',
  'Fill All',
  'Pick',
  'Erase',
];
export const AQ_EFFECTS = ['Static', 'Flash', 'Pulse'];

// 128 x 6-bit RGB (AQ64L colour table)
const PAL6 =
  '0000000707071f1f1f3f3f3f3f12123f00001500000600003f2e1a3f1400150700090600' +
  '3f3f123f3f00151500060600213f12143f00071500040a00123f12003f00001500000600' +
  '123f17003f06001503000600123f21003f15001507000704123f2d003f2500150d000604' +
  '12303f00293f00101400030612213f00153f00071500010612123f00003f000015000006' +
  '21123f14003f06001803000b3f123f3f003f1500150600063f12213f0014150007080004' +
  '3f0500250d001d1400101800000e0000150d00141f00003f0011130900321f1f1f070707' +
  '3f00002e3f0b2b3a01183f02032200003f2100293f000a3f0f003f1e003f2b061e0f0800' +
  '3f12002137011c3f05003f000e3f09153f1b0d3f3216223f0c1430211f3934073f3f0016' +
  '3f1f002d2b00233f002016010e0a0004120303130d05050a050716190e0629000236140f' +
  '351a063f370927370b192c0307070b363f1a1f3f2e26253f23193f0f0f0f1c1c1c373f3f' +
  '2700000d00000633000110002d2b000f0c002c1700120500';

// 6-bit -> 8-bit as Control Tribe expands it
const x8 = (c: number) => {
  const v = c * 0xff + 0x1f;
  const t = ((v & 0xffff) * 0x411) >> 16;
  return ((((v - t) & 0xffff) >> 1) + t) >> 5;
};
export const AQ_PALETTE: number[] = Array.from({ length: 128 }, (_, i) => {
  const [r, g, b] = [0, 1, 2].map((k) =>
    x8(parseInt(PAL6.slice((i * 3 + k) * 2, (i * 3 + k) * 2 + 2), 16)),
  );
  return (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
});

export function aqNearest(colour: number): number {
  let best = Infinity;
  let idx = 0;
  AQ_PALETTE.forEach((p, i) => {
    const d = [16, 8, 0].reduce(
      (s, k) => s + (((colour >> k) & 0xff) - ((p >> k) & 0xff)) ** 2,
      0,
    );
    if (d < best) [best, idx] = [d, i];
  });
  return idx;
}

export const aqLedRow = (led: number) =>
  led < 8 ? -1 : Math.floor((led - 8) / 9);
export const aqLedCol = (led: number) => (led < 8 ? led : (led - 8) % 9);

export const aqProgramMode = (on: boolean) => aqFrame(0x66, on ? 1 : 0);
export const aqBrightness = (pct: number) =>
  aqFrame(0x72, Math.max(0, Math.min(100, pct)));
export const aqSaveProgram = (user: 1 | 2) => aqFrame(0x73, user - 1);
export const aqProgramReset = () => aqFrame(0x6c, 0);
export const aqScrollStop = () => aqFrame(0x6f, 0, 0);
export const aqScrollText = (colour: number, loop: boolean, text: string) =>
  aqFrame(
    0x6f,
    aqNearest(colour),
    loop ? 1 : 0,
    ...Array.from(text, (c) => c.charCodeAt(0) & 0x7f),
  );

// sendButtonCommand: the frame of one click with tool / effect / colour,
// or null (Pick)
export function aqToolFrame(
  tool: number,
  effect: number,
  colour: number,
  led: number,
): Uint8Array | null {
  if (tool === 3) return aqFrame(0x6c, aqNearest(colour));
  if (tool === 4) return null;
  if (tool === 5) return aqFrame(0x68, led, 0);
  const leds = Array.from({ length: AQ_LEDS }, (_, i) => i).filter((i) =>
    tool === 1
      ? aqLedRow(i) === aqLedRow(led)
      : tool === 2
        ? aqLedCol(i) === aqLedCol(led)
        : i === led,
  );
  const r7 = (k: number) => Math.round((((colour >> k) & 0xff) * 127) / 255);
  const spec = (i: number) =>
    effect === 0
      ? [3, i, r7(16), r7(8), r7(0)]
      : effect === 1
        ? [1, i, aqNearest(colour), 0]
        : [2, i, aqNearest(colour)];
  return aqFrame(0x70, ...leds.flatMap(spec));
}
