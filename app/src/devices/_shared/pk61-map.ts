// PK61 device map data (Control Tribe 1.12.4 PK61DeviceMap, PK61::hotspots,
// settingsPanelFactory, PAD_COLOURS) and the rules that pick an element's
// params.
import type { CtControl } from './controltribe';

// PK61::hotspots: x, y, w, h as fractions of the image
// prettier-ignore
export const HOTSPOTS: [number, number, number, number][] = [
  [0.1414, 0.253, 0.0234, 0.0585], [0.1703, 0.253, 0.0234, 0.0585],
  [0.1992, 0.253, 0.0234, 0.0585], [0.2281, 0.253, 0.0234, 0.0585],
  [0.257, 0.253, 0.0234, 0.0585], [0.2859, 0.253, 0.0234, 0.0585],
  [0.3148, 0.253, 0.0234, 0.0585], [0.3438, 0.253, 0.0234, 0.0585],
  [0.3727, 0.253, 0.0234, 0.0585], [0.1414, 0.3442, 0.0234, 0.1181],
  [0.1703, 0.3442, 0.0234, 0.1181], [0.1992, 0.3442, 0.0234, 0.1181],
  [0.2281, 0.3442, 0.0234, 0.1181], [0.257, 0.3442, 0.0234, 0.1181],
  [0.2859, 0.3442, 0.0234, 0.1181], [0.3148, 0.3442, 0.0234, 0.1181],
  [0.3438, 0.3442, 0.0234, 0.1181], [0.3727, 0.3442, 0.0234, 0.1181],
  [0.4045, 0.265, 0.022, 0.05], [0.4045, 0.315, 0.022, 0.05],
  [0.4045, 0.365, 0.022, 0.05], [0.4045, 0.415, 0.022, 0.05],
  [0.6832, 0.2738, 0.0293, 0.0744], [0.7207, 0.2738, 0.0293, 0.0744],
  [0.7582, 0.2738, 0.0293, 0.0744], [0.7957, 0.2738, 0.0293, 0.0744],
  [0.8332, 0.2738, 0.0293, 0.0744], [0.8707, 0.2738, 0.0293, 0.0744],
  [0.9082, 0.2738, 0.0293, 0.0744], [0.9457, 0.2738, 0.0293, 0.0744],
  [0.6832, 0.3839, 0.0293, 0.0744], [0.7207, 0.3839, 0.0293, 0.0744],
  [0.7582, 0.3839, 0.0293, 0.0744], [0.7957, 0.3839, 0.0293, 0.0744],
  [0.8332, 0.3839, 0.0293, 0.0744], [0.8707, 0.3839, 0.0293, 0.0744],
  [0.9082, 0.3839, 0.0293, 0.0744], [0.9457, 0.3839, 0.0293, 0.0744],
  [0.596, 0.41, 0.02, 0.046], [0.5745, 0.41, 0.02, 0.046],
  [0.5745, 0.362, 0.02, 0.036], [0.596, 0.362, 0.02, 0.036],
  [0.6175, 0.362, 0.02, 0.036], [0.639, 0.362, 0.02, 0.036],
  [0.639, 0.41, 0.02, 0.046], [0.6175, 0.41, 0.02, 0.046],
  [0.596, 0.317, 0.02, 0.036], [0.5745, 0.317, 0.02, 0.036],
  [0.5745, 0.272, 0.02, 0.036], [0.596, 0.272, 0.02, 0.036],
  [0.6175, 0.272, 0.02, 0.036], [0.639, 0.272, 0.02, 0.036],
  [0.639, 0.317, 0.02, 0.036], [0.6175, 0.317, 0.02, 0.036],
  [0.5265, 0.37, 0.025, 0.046], [0.5265, 0.4245, 0.025, 0.046],
  [0.4485, 0.4245, 0.025, 0.046], [0.4485, 0.37, 0.025, 0.046],
  [0.207, 0.495, 0.775, 0.073], [0.02, 0.59, 0.96, 0.4],
  [0.1295, 0.0465, 0.022, 0.05], [0.152, 0.0465, 0.022, 0.05],
  [0.1745, 0.0465, 0.022, 0.05], [0.32, 0.04, 0.025, 0.058],
];

const DAW = [
  'Stop',
  'Record',
  'Loop',
  'Rewind',
  'Fast Forward',
  'Metro',
  'Shift',
  'Play',
  'Punch Out',
  'Punch In',
  'Save',
  'Quant',
  'View',
  'Undo',
  'Hold',
  'Chord',
  'Right',
  'Bank',
  'Prog',
  'Left',
];

// PAD_COLOURS and the colour box items
// prettier-ignore
export const COLOURS: [string, string][] = [
  ['#cd0000', 'Crimson Red'], ['#d7005f', 'Deep Rose'],
  ['#e90ab9', 'Hot Magenta'], ['#ce96a5', 'Dusty Rose'],
  ['#fe9372', 'Coral Pink'], ['#cd6a00', 'Burnt Orange'],
  ['#c3b632', 'Golden Yellow'], ['#b9f53c', 'Lime Green'],
  ['#63ff6e', 'Spring Green'], ['#03d700', 'Emerald Green'],
  ['#92c97e', 'Sage Green'], ['#08dfaf', 'Mint Green'],
  ['#2ec9d1', 'Turquoise Cyan'], ['#0e78ff', 'Azure Blue'],
  ['#780eff', 'Deep Purple'], ['#aa00ff', 'Vivid Purple'],
];

// hotspot -> label and the param prefixes it edits (settingsPanelFactory)
export function pk61Element(i: number): { label: string; prefix: RegExp } {
  const n = (k: number, p: string) => new RegExp(`^(${p})${k}(?!\\d)`);
  if (i < 9) return { label: `Knob ${i + 1}`, prefix: n(i + 1, 'Knob') };
  if (i < 18)
    return { label: `Fader ${i - 8}`, prefix: n(i - 8, 'Fader|Drawbar') };
  if (i < 22) return { label: `Part ${i - 17}`, prefix: n(i - 17, 'Part') };
  if (i < 38) return { label: `Pad ${i - 21}`, prefix: n(i - 21, 'Pad') };
  if (i < 58) return { label: `DAW ${DAW[i - 38]}`, prefix: n(i - 37, 'Daw') };
  return [
    { label: 'Ribbon', prefix: /^Ribbon/ },
    { label: 'Keyboard', prefix: /^(KeyBoard|Velocity|AfterTouch)/ },
    { label: 'Mod CV', prefix: /^ModCV/ },
    { label: 'Gate', prefix: /^Gate/ },
    { label: 'KB CV', prefix: /^KBCV/ },
    { label: 'Pedal', prefix: /^Pedal/ },
  ][i - 58];
}

// PK61DeviceMap::isClickable: preset 0 fixes knobs, faders and most DAW
// buttons; two hotspots never open
export function pk61Clickable(i: number, preset: number): boolean {
  if (i === 44 || i === 53) return false;
  if ((i >= 18 && i <= 37) || preset !== 0) return true;
  return i === 49 || i === 50 || i === 52 || i > 53;
}

// params of the current mode only (Midi*, Switched*, Patch*, MMC*, Hold*,
// Rel1-3*, Drawbar*)
const MODE_PART: Record<string, string> = {
  'Midi Note': 'Midi',
  'Switched Control': 'Switched',
  'Patch Change': 'Patch',
  MMC: 'MMC',
  'RELATIVE 1': 'Rel1',
  'RELATIVE 2': 'Rel2',
  'RELATIVE 3': 'Rel3',
};
const PARTS = /^(Midi|Switched|Patch|MMC|Hold|Rel[123])/;

export function pk61Shown(
  el: { prefix: RegExp },
  c: CtControl,
  modeLabel: string | undefined,
): boolean {
  const m = el.prefix.exec(c.method);
  if (!m) return false;
  const rest = c.method.slice(m[0].length);
  if (/^Char[2-8]$/.test(rest)) return false;
  if (m[1] === 'Drawbar')
    return modeLabel === undefined || modeLabel === 'Drawbar';
  const part = PARTS.exec(rest)?.[1];
  if (!part || modeLabel === undefined) return true;
  return MODE_PART[modeLabel] === part;
}
