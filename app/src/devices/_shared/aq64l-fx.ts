// AQ64L light effects engine (Control Tribe 1.12.4 AQ64LLightEffects and
// AQ64L::Device / Chain / Track / Screen, an Apollo Studio style engine).
// Pad presses become signals (index 0-100 on a 10 x 10 grid, colour 0-63
// per channel, layer, blending, macros) that run through each track's
// chain of devices; the screen blends the layers per pixel and the lit
// pixels go to the AQ64L LEDs.
// Files (serializeDevice / serializeChain / serializeTrack /
// serializeProject + writeEnvelope): JSON; colours packed 0xRRGGBB with
// 6-bit channels; time = {mode: synced, step: 1/128..4/1, free: ms}.
//   .aq64leff {bpm, macros, tracks, envelope}   .aq64ltra {name, enabled,
//   chain, envelope}   .aq64lcha {envelope, chain}   .aq64ldev {device,
//   envelope}

import { aqCheckEnvelope } from './aq64l';

// ---- data (the file JSON is the model) ------------------------------------

export type FxDevice = { type: string; enabled: boolean } & Record<
  string,
  unknown
>;
export interface FxTime {
  mode: boolean; // true: synced to bpm (step), false: free (ms)
  step: number;
  free: number;
}
export interface FxOffset {
  x: number;
  y: number;
  abs: boolean;
  ax: number;
  ay: number;
}
export interface FxFrame {
  time: FxTime;
  screen: number[]; // 101 packed colours
}
export interface FxTrack {
  name: string;
  enabled: boolean;
  chain: FxDevice[];
}
export interface FxProject {
  bpm: number;
  macros: number[];
  tracks: FxTrack[];
}

// prettier-ignore
export const FX_STEPS = [
  '1/128', '1/64', '1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1',
];
const time = (mode: boolean, free: number): FxTime => ({ mode, step: 5, free });
const base = (type: string): FxDevice => ({
  type,
  enabled: true,
  collapsed: false,
});

// makeDeviceByName + serializeDevice defaults (emulated)
const MAKE: Record<string, () => FxDevice> = {
  Pattern: () => ({
    ...base('pattern'),
    repeats: 1,
    gate: 1,
    pinch: 0,
    bilateral: false,
    mode: 0,
    infinite: false,
    rootKey: -1,
    wrap: false,
    frames: [{ time: time(true, 1000), screen: Array(101).fill(0) }],
  }),
  Fade: () => ({
    ...base('fade'),
    time: time(true, 1000),
    gate: 1,
    playMode: 0,
    colors: [0x3f3f3f, 0],
    positions: [0, 1],
    types: [0],
  }),
  Tone: () => ({
    ...base('tone'),
    hue: 0,
    satHigh: 1,
    satLow: 0,
    valHigh: 1,
    valLow: 0,
  }),
  Paint: () => ({ ...base('paint'), color: 0x3f3f3f }),
  'Color Filter': () => ({
    ...base('colorfilter'),
    hue: 0,
    saturation: 1,
    value: 1,
    hueT: 0.05,
    satT: 0.05,
    valT: 0.05,
  }),
  Move: () => ({
    ...base('move'),
    offset: { x: 0, y: 0, abs: false, ax: 5, ay: 5 },
    grid: 0,
    wrap: false,
  }),
  Flip: () => ({ ...base('flip'), mode: 0, bypass: false }),
  Rotate: () => ({ ...base('rotate'), mode: 0, bypass: false }),
  Copy: () => ({
    ...base('copy'),
    time: time(false, 500),
    gate: 1,
    pinch: 0,
    bilateral: false,
    reverse: false,
    infinite: false,
    copyMode: 0,
    grid: 0,
    wrap: false,
    offsets: [],
    angles: [],
  }),
  'Key Filter': () => ({
    ...base('keyfilter'),
    filter: Array(101).fill(false),
  }),
  'Layer Filter': () => ({ ...base('layerfilter'), target: 0, range: 0 }),
  'Macro Filter': () => ({
    ...base('macrofilter'),
    macro: 1,
    filter: Array(100).fill(false),
  }),
  Layer: () => ({ ...base('layer'), target: 0, blending: 0, range: 200 }),
  Group: () => ({ ...base('group'), chains: [] }),
  Multi: () => ({ ...base('multi'), mode: 0, preprocess: [], chains: [] }),
  Switch: () => ({ ...base('switch'), target: 1, value: 1 }),
  Refresh: () => ({ ...base('refresh'), macros: [false, false, false, false] }),
  Output: () => ({ ...base('output'), target: -1 }),
  Preview: () => base('preview'),
  Delay: () => ({ ...base('delay'), time: time(true, 1000), gate: 1 }),
  Loop: () => ({
    ...base('loop'),
    rate: time(true, 1000),
    gate: 1,
    repeats: 2,
    hold: false,
  }),
  Hold: () => ({
    ...base('hold'),
    time: time(true, 1000),
    gate: 1,
    holdMode: 0,
    release: false,
  }),
  Choke: () => ({ ...base('choke'), target: 1, chain: [] }),
  Clear: () => ({ ...base('clear'), mode: 0 }),
};
export const FX_NAMES = Object.keys(MAKE);
export const fxMake = (name: string) => MAKE[name]();
export const fxName = (d: FxDevice) =>
  FX_NAMES.find((n) => MAKE[n]().type === d.type) ?? d.type;

// labels of the enums (Control Tribe device editors)
export const FX_ENUMS = {
  patternMode: ['Mono', 'Poly', 'Loop'],
  fadeMode: ['Mono', 'Loop'],
  fadeType: ['Linear', 'Smooth', 'Sharp', 'Fast', 'Slow', 'Hold', 'Release'],
  flip: ['Horizontal', 'Vertical', 'Diagonal +', 'Diagonal -'],
  rotate: ['90', '180', '270'],
  grid: ['Full', 'Square'],
  copyMode: ['Static', 'Animate', 'Interpolate', 'Rand Single', 'Rand Loop'],
  blending: ['Normal', 'Screen', 'Multiply', 'Mask'],
  multiMode: ['Forward', 'Backward', 'Random', 'Random+', 'Route keys'],
  holdMode: ['Duration', 'Minimum', 'Infinite'],
  clear: ['Lights', 'Multi', 'Both'],
};

// ---- files ----------------------------------------------------------------

export const FX_FILES = {
  effect: { format: 'AQ64LLightEffect', ext: 'aq64leff' },
  track: { format: 'AQ64LLightTrack', ext: 'aq64ltra' },
  chain: { format: 'AQ64LLightChain', ext: 'aq64lcha' },
  device: { format: 'AQ64LLightDevice', ext: 'aq64ldev' },
};
type FileKind = keyof typeof FX_FILES;

const envelope = (format: string) => ({
  format,
  formatVersion: 1,
  device: 'AQ64L',
});

// writeEnvelope adds the envelope after the payload; a chain is wrapped
export function fxToFile(kind: FileKind, payload: unknown): string {
  const { format } = FX_FILES[kind];
  const j =
    kind === 'chain'
      ? { ...envelope(format), chain: payload }
      : { ...(payload as object), ...envelope(format) };
  return JSON.stringify(j, null, 2);
}

export function fxFromFile(
  kind: FileKind,
  text: string,
): FxProject | FxTrack | FxDevice[] | FxDevice | string {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return 'It is not a valid JSON file.';
  }
  const bad = aqCheckEnvelope(j, FX_FILES[kind].format);
  if (bad) return bad;
  const o = j as Record<string, unknown>;
  const strip = () => {
    const c = { ...o };
    for (const k of ['format', 'formatVersion', 'device']) delete c[k];
    return c;
  };
  if (kind === 'chain') return fxChain(o.chain);
  if (kind === 'device') return fxDevice(strip()) ?? 'It is not an effect.';
  if (kind === 'track') return fxTrack(strip());
  const p = strip();
  return {
    bpm: num(p.bpm, 120),
    macros: [0, 1, 2, 3].map((i) =>
      num((p.macros as unknown[] | undefined)?.[i], 1),
    ),
    tracks: Array.isArray(p.tracks) ? p.tracks.map(fxTrack) : [],
  };
}

const num = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

// deserializeDevice: known type, defaults for what the file leaves out
export function fxDevice(v: unknown): FxDevice | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = FX_NAMES.find((n) => MAKE[n]().type === o.type);
  if (!name) return null;
  const d = { ...MAKE[name](), ...o } as FxDevice;
  for (const k of ['chain', 'preprocess']) if (k in d) d[k] = fxChain(d[k]);
  if ('chains' in d)
    d.chains = Array.isArray(d.chains) ? d.chains.map(fxChain) : [];
  return d;
}
export const fxChain = (v: unknown): FxDevice[] =>
  Array.isArray(v) ? v.map(fxDevice).filter((d): d is FxDevice => !!d) : [];
export const fxTrack = (v: unknown): FxTrack => {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name : 'Track',
    enabled: o.enabled !== false,
    chain: fxChain(o.chain),
  };
};
export const fxProject = (): FxProject => ({
  bpm: 120,
  macros: [1, 1, 1, 1],
  tracks: [{ name: 'Track 1', enabled: true, chain: [] }],
});

// ---- colour ---------------------------------------------------------------

export type Rgb = [number, number, number]; // 0-63 each
export const unpack = (c: number): Rgb => [
  (c >> 16) & 0x3f,
  (c >> 8) & 0x3f,
  c & 0x3f,
];
export const pack = ([r, g, b]: Rgb) => (r << 16) | (g << 8) | b;
// 6-bit colour <-> 0xRRGGBB for the colour inputs and the LED output
export const fxTo24 = (c: number) =>
  unpack(c).reduce((a, x) => (a << 8) | ((x << 2) | (x >> 4)), 0);
export const fxFrom24 = (c: number) =>
  pack([(c >> 18) & 0x3f, (c >> 10) & 0x3f, (c >> 2) & 0x3f]);

function rgbToHsv([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 63, g / 63, b / 63];
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
    else if (mx === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const k = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][k];
  const q = (y: number) => Math.max(0, Math.min(63, Math.round((y + m) * 63)));
  return [q(r), q(g), q(b)];
}

// ---- signals and time -----------------------------------------------------

export interface Sig {
  index: number; // 0-100
  rgb: Rgb;
  layer: number;
  blend: number;
  range: number;
  macros: number[];
}
export const lit = (s: Sig) => s.rgb[0] > 0 || s.rgb[1] > 0 || s.rgb[2] > 0;
const clone = (s: Sig, p: Partial<Sig> = {}): Sig => ({
  ...s,
  rgb: [...s.rgb] as Rgb,
  macros: [...s.macros],
  ...p,
});
const off = (s: Sig) => clone(s, { rgb: [0, 0, 0] });

export interface Clock {
  now(): number;
  after(ms: number, fn: () => void): () => void; // returns cancel
}
export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const t = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(t);
  },
};

export const fxMs = (t: FxTime, bpm: number) =>
  t.mode ? (2 ** (t.step - 7) * 240000) / bpm : t.free;

// Pattern::applyPinch (Apollo pinch / bilateral time warp)
export function fxPinch(
  t: number,
  total: number,
  pinch: number,
  bilateral: boolean,
): number {
  if (total <= 0) return t;
  const p = (pinch >= 0 ? (pinch * 4) / 3 : (1 / (1 - pinch) - 1) * 0.9) + 1;
  const x = Math.min(1, t / total);
  const f = (u: number) => 1 - (1 - u ** p) ** (1 / p);
  if (!bilateral) return total * f(x);
  return total * (x >= 0.5 ? 1 - 0.5 * f(2 - 2 * x) : 0.5 * f(2 * x));
}

// Offset::apply: target index or null (Full = 10 x 10, Square = pads)
export function fxOffset(
  o: FxOffset,
  index: number,
  grid: number,
  wrap: boolean,
): number | null {
  let x: number;
  let y: number;
  if (!o.abs) {
    x = index % 10;
    y = Math.floor(index / 10);
    if (grid === 1 && (x === 0 || x === 9 || index < 10 || index >= 90))
      return null;
    x += o.x;
    y += o.y;
  } else {
    x = o.ax;
    y = o.ay;
  }
  if (wrap) {
    if (grid === 1)
      [x, y] = [((((x + 7) % 8) + 8) % 8) + 1, ((((y + 7) % 8) + 8) % 8) + 1];
    else [x, y] = [((x % 10) + 10) % 10, ((y % 10) + 10) % 10];
  }
  if (grid === 1)
    return x >= 1 && x <= 8 && y >= 1 && y <= 8 ? x + y * 10 : null;
  if (x >= 0 && x <= 9 && y >= 0 && y <= 9) return x + y * 10;
  return y === -1 && x >= 4 && x <= 5 ? 100 : null;
}

const flip = (i: number, mode: number) => {
  const [x, y] = [i % 10, Math.floor(i / 10)];
  return (
    [9 - x + y * 10, x + (9 - y) * 10, y + x * 10, 9 - y + (9 - x) * 10][
      mode
    ] ?? i
  );
};
const rotate = (i: number, mode: number) => {
  const [x, y] = [i % 10, Math.floor(i / 10)];
  return [y + (9 - x) * 10, 99 - i, 9 - y + x * 10][mode] ?? i;
};

// Copy::interpolatePath: grid points from a to b, arcs for an angle
function pathPoints(
  a: [number, number],
  b: [number, number],
  angle: number,
): [number, number][] {
  const out: [number, number][] = [];
  const t = (angle / 90) * Math.PI;
  if (Math.abs(t) >= 1e-9) {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < 1e-9) return out;
    const dy = b[1] - a[1];
    const ang = Math.atan((a[0] - b[0]) / (dy === 0 ? 1e-9 : dy));
    const half = Math.PI - t / 2;
    const r0 = (d / (2 * Math.tan(half))) * (dy >= 0 ? 1 : -1);
    const cx = r0 * Math.cos(ang) + (a[0] + b[0]) / 2;
    const cy = r0 * Math.sin(ang) + (a[1] + b[1]) / 2;
    const r = d / (2 * Math.sin(half));
    const o = t < 0 ? Math.PI : 0;
    let s = Math.atan2(a[1] - cy, a[0] - cx) + o;
    let e = Math.atan2(b[1] - cy, b[0] - cx) + o;
    if (e < s) e += 2 * Math.PI;
    if (t >= 0) [s, e] = [e, s];
    const n = Math.floor(Math.abs(r * (e - s)) * 1.5);
    for (let k = 1; k <= n; k++) {
      const th = s + (k * (e - s)) / n;
      out.push([Math.cos(th) * r + cx, Math.sin(th) * r + cy]);
    }
  } else {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let k = 1; k <= n; k++)
      out.push([
        a[0] + ((b[0] - a[0]) * k) / n,
        a[1] + ((b[1] - a[1]) * k) / n,
      ]);
  }
  return out;
}

// ---- runtime --------------------------------------------------------------

type Out = (s: Sig[]) => void;

export class FxContext {
  bpm = 120;
  macros = [1, 1, 1, 1];
  clock: Clock;
  screen = new FxScreen();
  chokes = new Set<ChokeRT>();
  multis = new Set<MultiRT>();
  previews = new Set<(s: Sig[]) => void>();
  constructor(clock: Clock = realClock) {
    this.clock = clock;
  }
}

abstract class Dev {
  d: FxDevice;
  ctx: FxContext;
  exit: Out = () => {};
  private cancels = new Set<() => void>();
  constructor(d: FxDevice, ctx: FxContext) {
    this.d = d;
    this.ctx = ctx;
  }
  enter(s: Sig[]) {
    if (!s.length) return;
    if (this.d.enabled === false) this.exit(s);
    else this.process(s);
  }
  abstract process(s: Sig[]): void;
  later(ms: number, fn: () => void) {
    const c = this.ctx.clock.after(ms, () => {
      this.cancels.delete(c);
      fn();
    });
    this.cancels.add(c);
  }
  stop() {
    this.cancels.forEach((c) => c());
    this.cancels.clear();
  }
  get bpm() {
    return this.ctx.bpm;
  }
  ms(t: unknown, gate = 1) {
    return fxMs(t as FxTime, this.bpm) * gate;
  }
  n(k: string) {
    return Number(this.d[k] ?? 0);
  }
}

export class ChainRT {
  devs: Dev[];
  exit: Out = () => {};
  constructor(chain: FxDevice[], ctx: FxContext) {
    this.devs = chain.map((d) => makeRT(d, ctx));
    this.devs.forEach((d, i) => {
      d.exit = (s) =>
        i + 1 < this.devs.length ? this.devs[i + 1].enter(s) : this.exit(s);
    });
  }
  enter(s: Sig[]) {
    if (this.devs.length) this.devs[0].enter(s);
    else this.exit(s);
  }
  stop() {
    this.devs.forEach((d) => d.stop());
  }
}

class Pass extends Dev {
  map(_s: Sig): Sig | Sig[] | null {
    return _s;
  }
  process(s: Sig[]) {
    this.exit(s.flatMap((x) => this.map(x) ?? []));
  }
}

class Paint extends Pass {
  map(s: Sig) {
    return lit(s) ? clone(s, { rgb: unpack(this.n('color')) }) : s;
  }
}

class Tone extends Pass {
  map(s: Sig) {
    if (!lit(s)) return s;
    const [h, sa, v] = rgbToHsv(s.rgb);
    const hue = (((h + this.n('hue')) % 360) + 360) % 360;
    const sat = sa * (this.n('satHigh') - this.n('satLow')) + this.n('satLow');
    const val = v * (this.n('valHigh') - this.n('valLow')) + this.n('valLow');
    return clone(s, {
      rgb: hsvToRgb(
        hue,
        Math.min(1, Math.max(0, sat)),
        Math.min(1, Math.max(0, val)),
      ),
    });
  }
}

class ColorFilter extends Pass {
  map(s: Sig) {
    if (!lit(s)) return s;
    const [h, sa, v] = rgbToHsv(s.rgb);
    const dh = Math.abs(h - ((this.n('hue') + 360) % 360));
    const hue = Math.min(dh, 360 - dh) / 180;
    return hue <= this.n('hueT') &&
      Math.abs(sa - this.n('saturation')) <= this.n('satT') &&
      Math.abs(v - this.n('value')) <= this.n('valT')
      ? s
      : null;
  }
}

class Move extends Pass {
  map(s: Sig) {
    const i = fxOffset(
      this.d.offset as FxOffset,
      s.index,
      this.n('grid'),
      !!this.d.wrap,
    );
    return i === null ? null : clone(s, { index: i });
  }
}

class Flip extends Pass {
  map(s: Sig) {
    const m =
      s.index === 100 ? s : clone(s, { index: flip(s.index, this.n('mode')) });
    return this.d.bypass ? [s, m] : m;
  }
}

class Rotate extends Pass {
  map(s: Sig) {
    const m =
      s.index === 100
        ? s
        : clone(s, { index: rotate(s.index, this.n('mode')) });
    return this.d.bypass ? [s, m] : m;
  }
}

class KeyFilter extends Pass {
  map(s: Sig) {
    return (this.d.filter as boolean[])[s.index] ? s : null;
  }
}

class LayerFilter extends Pass {
  map(s: Sig) {
    return Math.abs(s.layer - this.n('target')) <= this.n('range') ? s : null;
  }
}

class MacroFilter extends Pass {
  map(s: Sig) {
    const m = this.n('macro');
    const v = m >= 1 && m <= 4 ? s.macros[m - 1] - 1 : 0;
    return (this.d.filter as boolean[])[v] ? s : null;
  }
}

class Layer extends Pass {
  map(s: Sig) {
    const r = this.n('range');
    return clone(s, {
      layer: this.n('target'),
      blend: this.n('blending'),
      range: r >= 1 && r <= 200 ? r : s.range,
    });
  }
}

class Refresh extends Pass {
  map(s: Sig) {
    const m = this.d.macros as boolean[];
    return clone(s, {
      macros: s.macros.map((v, i) => (m[i] ? this.ctx.macros[i] : v)),
    });
  }
}

// Switch / Clear act on a release (an unlit signal) in the batch
class Switch extends Dev {
  process(s: Sig[]) {
    const t = this.n('target');
    const v = this.n('value');
    if (s.some((x) => !lit(x)) && t >= 1 && t <= 4 && v >= 1 && v <= 100)
      this.ctx.macros[t - 1] = v;
    this.exit(s);
  }
}

class Clear extends Dev {
  process(s: Sig[]) {
    if (s.some((x) => !lit(x))) {
      const m = this.n('mode');
      if (m !== 1) this.ctx.screen.clear();
      if (m !== 0) this.ctx.multis.forEach((x) => (x.cur = -1));
    }
    this.exit(s);
  }
}

class Preview extends Dev {
  process(s: Sig[]) {
    this.ctx.previews.forEach((f) => f(s));
    this.exit(s);
  }
}

class Delay extends Dev {
  process(s: Sig[]) {
    this.later(this.ms(this.d.time, this.n('gate')), () => this.exit(s));
  }
}

// each signal again `repeats` times, `rate` apart; hold: repeat the press
// until its release
class Loop extends Dev {
  held = new Map<number, () => void>();
  process(s: Sig[]) {
    const rate = this.ms(this.d.rate, this.n('gate'));
    for (const x of s) {
      if (!this.d.hold) {
        for (let k = 0; k < Math.max(1, this.n('repeats')); k++)
          if (k) this.later(rate * k, () => this.exit([clone(x)]));
          else this.exit([x]);
        continue;
      }
      this.held.get(x.index)?.();
      this.held.delete(x.index);
      this.exit([x]);
      if (!lit(x) || rate <= 0) continue;
      let alive = true;
      const tick = () => {
        if (!alive) return;
        this.exit([clone(x)]);
        this.later(rate, tick);
      };
      this.later(rate, tick);
      this.held.set(x.index, () => (alive = false));
    }
  }
}

// Duration: lit for the time; Minimum: at least the time; Infinite: until
// cleared. Release: the note-off triggers.
class Hold extends Dev {
  since = new Map<number, number>();
  last = new Map<number, Sig>();
  process(s: Sig[]) {
    const ms = this.ms(this.d.time, this.n('gate'));
    const mode = this.n('holdMode');
    for (const x of s) {
      if (lit(x)) this.last.set(x.index, x);
      if (mode === 1) {
        if (lit(x)) {
          this.since.set(x.index, this.ctx.clock.now());
          this.exit([x]);
        } else {
          const left =
            ms - (this.ctx.clock.now() - (this.since.get(x.index) ?? 0));
          if (left > 0) this.later(left, () => this.exit([x]));
          else this.exit([x]);
        }
        continue;
      }
      if (lit(x) === !!this.d.release) continue;
      const on = lit(x) ? x : this.last.get(x.index);
      if (!on) continue;
      this.exit([on]);
      if (mode === 0) this.later(ms, () => this.exit([off(on)]));
    }
  }
}

// gradient from the colour stops (Fade::generate): one step per colour
// change of the widest channel; Loop repeats while held
const EASE = [
  (x: number) => x,
  (x: number) => x * x * (3 - 2 * x),
  (x: number) =>
    x < 0.5 ? 0.5 * Math.sqrt(2 * x) : 1 - 0.5 * Math.sqrt(2 - 2 * x),
  (x: number) => 1 - (1 - x) ** 2,
  (x: number) => x * x,
];
export function fxFadeSteps(d: FxDevice): { t: number; rgb: Rgb }[] {
  const cs = (d.colors as number[]).map(unpack);
  const ps = d.positions as number[];
  const ts = d.types as number[];
  const out: { t: number; rgb: Rgb }[] = [];
  for (let i = 0; i + 1 < cs.length; i++) {
    const [a, b] = [cs[i], cs[i + 1]];
    const type = ts[i] ?? 0;
    if (type >= 5) {
      out.push({ t: ps[i], rgb: a });
      continue;
    }
    const n = Math.max(1, ...a.map((v, k) => Math.abs(b[k] - v)));
    for (let j = 0; j < n; j++) {
      const f = j / n;
      const rgb = a.map((v, k) => Math.round(v + (b[k] - v) * f)) as Rgb;
      out.push({ t: ps[i] + (ps[i + 1] - ps[i]) * EASE[type](f), rgb });
    }
  }
  if (cs.length)
    out.push({ t: ps[cs.length - 1] ?? 1, rgb: cs[cs.length - 1] });
  return out;
}

class Fade extends Dev {
  playing = new Map<number, () => void>();
  process(s: Sig[]) {
    const total = this.ms(this.d.time, this.n('gate'));
    const steps = fxFadeSteps(this.d);
    const loop = this.n('playMode') === 1;
    for (const x of s) {
      if (!lit(x)) {
        if (loop) {
          this.playing.get(x.index)?.();
          this.playing.delete(x.index);
          this.exit([off(x)]);
        }
        continue;
      }
      this.playing.get(x.index)?.();
      let alive = true;
      this.playing.set(x.index, () => (alive = false));
      const run = () => {
        for (const st of steps)
          this.later(
            st.t * total,
            () => alive && this.exit([clone(x, { rgb: st.rgb })]),
          );
        if (loop) this.later(total, () => alive && run());
      };
      run();
    }
  }
}

class Copy extends Dev {
  chosen = new Map<number, number>();
  process(s: Sig[]) {
    const mode = this.n('copyMode');
    const grid = this.n('grid');
    const wrap = !!this.d.wrap;
    const offs = this.d.offsets as FxOffset[];
    for (const x of s) {
      const pts = [x.index];
      for (const o of offs) {
        const i = fxOffset(o, x.index, grid, wrap);
        if (i !== null) pts.push(i);
      }
      if (mode === 0) {
        this.exit(pts.map((i) => clone(x, { index: i })));
        continue;
      }
      if (mode === 3) {
        if (lit(x))
          this.chosen.set(x.index, pts[Math.floor(Math.random() * pts.length)]);
        const i = this.chosen.get(x.index) ?? x.index;
        this.exit([clone(x, { index: i })]);
        continue;
      }
      if (!lit(x)) continue;
      let path = pts;
      if (mode === 2) {
        path = [x.index];
        let cur: [number, number] = [x.index % 10, Math.floor(x.index / 10)];
        offs.forEach((o, k) => {
          const i = fxOffset(o, x.index, grid, wrap);
          if (i === null) return;
          const to: [number, number] = [i % 10, Math.floor(i / 10)];
          for (const [px, py] of pathPoints(
            cur,
            to,
            Number((this.d.angles as number[])[k] ?? 0),
          )) {
            const j = Math.round(px) + Math.round(py) * 10;
            if (j >= 0 && j < 100 && path[path.length - 1] !== j) path.push(j);
          }
          cur = to;
        });
      } else if (mode === 4) {
        path = Array.from(
          { length: pts.length },
          () => pts[Math.floor(Math.random() * pts.length)],
        );
      }
      if (this.d.reverse) path = [...path].reverse();
      const rate = this.ms(this.d.time);
      const gate = this.n('gate');
      const total = rate * path.length;
      const at = (k: number) =>
        fxPinch(k * rate, total, this.n('pinch'), !!this.d.bilateral);
      path.forEach((i, k) => {
        const m = clone(x, { index: i });
        this.later(at(k), () => this.exit([m]));
        if (!(this.d.infinite && k === path.length - 1))
          this.later(at(k) + rate * gate, () => this.exit([off(m)]));
      });
    }
  }
}

// frames of 101 colours; rootKey moves them with the pressed pad
class Pattern extends Dev {
  plays = new Map<number, () => void>();
  frameAt(f: FxFrame, x: Sig): Map<number, Rgb> {
    const out = new Map<number, Rgb>();
    const root = this.n('rootKey');
    f.screen.forEach((c, i) => {
      if (!c) return;
      let j: number | null = i;
      if (root >= 0 && i < 100) {
        let px = (i % 10) + (x.index % 10) - (root % 10);
        let py =
          Math.floor(i / 10) + Math.floor(x.index / 10) - Math.floor(root / 10);
        if (this.d.wrap) [px, py] = [(px + 10) % 10, (py + 10) % 10];
        j =
          px >= 0 && px < 10 && py >= 0 && py < 10
            ? px + py * 10
            : py === -1 && (px === 4 || px === 5)
              ? 100
              : null;
      }
      if (j !== null) out.set(j, unpack(c));
    });
    return out;
  }
  process(s: Sig[]) {
    const frames = this.d.frames as FxFrame[];
    const mode = this.n('mode');
    for (const x of s) {
      if (!lit(x)) {
        if (mode === 2) this.stopPlay(x.index);
        continue;
      }
      if (mode !== 1) this.plays.forEach((_, k) => this.stopPlay(k));
      else this.stopPlay(x.index);
      this.play(x, frames, mode);
    }
  }
  stopPlay(k: number) {
    this.plays.get(k)?.();
    this.plays.delete(k);
  }
  play(x: Sig, frames: FxFrame[], mode: number) {
    const gate = this.n('gate');
    const times = frames.map((f) => this.ms(f.time, gate));
    const one = times.reduce((a, b) => a + b, 0);
    const reps = mode === 2 ? 1 : Math.max(1, this.n('repeats'));
    const total = one * reps;
    let shown = new Map<number, Rgb>();
    let alive = true;
    const send = (next: Map<number, Rgb>) => {
      if (!alive) return;
      const out: Sig[] = [];
      for (const [i, rgb] of next)
        if (shown.get(i)?.join() !== rgb.join())
          out.push(clone(x, { index: i, rgb }));
      for (const i of shown.keys())
        if (!next.has(i)) out.push(clone(x, { index: i, rgb: [0, 0, 0] }));
      shown = next;
      if (out.length) this.exit(out);
    };
    const run = () => {
      let t = 0;
      for (let r = 0; r < reps; r++)
        frames.forEach((f, k) => {
          const at = fxPinch(t, total, this.n('pinch'), !!this.d.bilateral);
          this.later(at, () => send(this.frameAt(f, x)));
          t += times[k];
        });
      this.later(total, () => {
        if (mode === 2 && alive) return run();
        if (!this.d.infinite) send(new Map());
        this.plays.delete(x.index);
      });
    };
    this.plays.set(x.index, () => {
      send(new Map());
      alive = false;
    });
    run();
  }
}

class Group extends Dev {
  chains: ChainRT[];
  constructor(d: FxDevice, ctx: FxContext) {
    super(d, ctx);
    this.chains = (d.chains as FxDevice[][]).map((c) => new ChainRT(c, ctx));
    this.chains.forEach((c) => (c.exit = (s) => this.exit(s)));
  }
  process(s: Sig[]) {
    this.chains.forEach((c) => c.enter(s.map((x) => clone(x))));
  }
  stop() {
    super.stop();
    this.chains.forEach((c) => c.stop());
  }
}

class MultiRT extends Dev {
  pre: ChainRT;
  chains: ChainRT[];
  cur = -1;
  route = new Map<number, number>();
  constructor(d: FxDevice, ctx: FxContext) {
    super(d, ctx);
    this.pre = new ChainRT(d.preprocess as FxDevice[], ctx);
    this.chains = (d.chains as FxDevice[][]).map((c) => new ChainRT(c, ctx));
    this.chains.forEach((c) => (c.exit = (s) => this.exit(s)));
    this.pre.exit = (s) => this.route1(s);
    ctx.multis.add(this);
  }
  process(s: Sig[]) {
    this.pre.enter(s);
  }
  pick(index: number): number {
    const n = this.chains.length;
    const mode = this.n('mode');
    if (mode === 4) return index % n;
    if (mode === 2) return Math.floor(Math.random() * n);
    if (mode === 3 && n > 1) {
      let k = this.cur;
      while (k === this.cur) k = Math.floor(Math.random() * n);
      return k;
    }
    return mode === 1 ? (this.cur - 1 + n * 2) % n : (this.cur + 1) % n;
  }
  route1(s: Sig[]) {
    if (!this.chains.length) return this.exit(s);
    for (const x of s) {
      if (lit(x)) {
        this.cur = this.pick(x.index);
        this.route.set(x.index, this.cur);
      }
      const k = this.route.get(x.index) ?? Math.max(0, this.cur);
      this.chains[k].enter([x]);
    }
  }
  stop() {
    super.stop();
    this.pre.stop();
    this.chains.forEach((c) => c.stop());
  }
}

class ChokeRT extends Dev {
  chain: ChainRT;
  shown = new Map<string, Sig>();
  choked = false;
  constructor(d: FxDevice, ctx: FxContext) {
    super(d, ctx);
    this.chain = new ChainRT(d.chain as FxDevice[], ctx);
    this.chain.exit = (s) => {
      for (const x of s) {
        const k = `${x.index}/${x.layer}`;
        if (lit(x)) this.shown.set(k, x);
        else this.shown.delete(k);
      }
      this.exit(s);
    };
    ctx.chokes.add(this);
  }
  process(s: Sig[]) {
    if (s.some(lit)) {
      this.choked = false;
      this.ctx.chokes.forEach(
        (c) => c !== this && c.n('target') === this.n('target') && c.choke(),
      );
    }
    if (!this.choked) this.chain.enter(s);
  }
  choke() {
    if (this.choked) return;
    this.choked = true;
    this.chain.stop();
    const offs = [...this.shown.values()].map(off);
    this.shown.clear();
    if (offs.length) this.exit(offs);
  }
  stop() {
    super.stop();
    this.chain.stop();
  }
}

const RT: Record<string, new (d: FxDevice, ctx: FxContext) => Dev> = {
  pattern: Pattern,
  fade: Fade,
  tone: Tone,
  paint: Paint,
  colorfilter: ColorFilter,
  move: Move,
  flip: Flip,
  rotate: Rotate,
  copy: Copy,
  keyfilter: KeyFilter,
  layerfilter: LayerFilter,
  macrofilter: MacroFilter,
  layer: Layer,
  group: Group,
  multi: MultiRT,
  switch: Switch,
  refresh: Refresh,
  output: Pass,
  preview: Preview,
  delay: Delay,
  loop: Loop,
  hold: Hold,
  choke: ChokeRT,
  clear: Clear,
};
const makeRT = (d: FxDevice, ctx: FxContext): Dev =>
  new (RT[d.type] ?? Pass)(d, ctx);

// ---- screen: per pixel the signals by layer (Pixel::getColor) -------------

export class FxScreen {
  px: Map<number, Sig>[] = Array.from({ length: 101 }, () => new Map());
  onChange: (i: number) => void = () => {};
  enter(s: Sig) {
    const p = this.px[s.index];
    if (!p) return;
    if (lit(s)) p.set(s.layer, s);
    else p.delete(s.layer);
    this.onChange(s.index);
  }
  clear() {
    this.px.forEach((p, i) => {
      if (p.size) {
        p.clear();
        this.onChange(i);
      }
    });
  }
  // top layer down: Normal covers; Screen / Multiply / Mask blend with the
  // next layer while it is within the blending range
  color(i: number): Rgb {
    const sigs = [...this.px[i].values()].sort((a, b) => b.layer - a.layer);
    if (!sigs.length) return [0, 0, 0];
    let c = [...sigs[0].rgb] as Rgb;
    for (let k = 1; k < sigs.length; k++) {
      const top = sigs[k - 1];
      const low = sigs[k];
      if (top.blend === 0 || top.layer - low.layer > top.range) break;
      if (top.blend === 2)
        c = c.map((v, j) => Math.round((v * low.rgb[j]) / 63)) as Rgb;
      else if (top.blend === 3) c = [...low.rgb] as Rgb;
      else
        c = c.map((v, j) =>
          Math.round(63 - ((63 - v) * (63 - low.rgb[j])) / 63),
        ) as Rgb;
    }
    if (sigs[0].blend === 3 && sigs.length === 1) return [0, 0, 0];
    return c;
  }
}

// signal index <-> AQ64L LED (AQ64LLightEffects::processIncomingMidi,
// LightOutput): 1-8 top buttons, rows 1-8 x columns 1-9
export function fxIndexToLed(i: number): number | null {
  if (i >= 1 && i <= 8) return i - 1;
  const [x, y] = [i % 10, Math.floor(i / 10)];
  return y >= 1 && y <= 8 && x >= 1 ? 8 + (y - 1) * 9 + (x - 1) : null;
}
export const fxLedToIndex = (led: number) =>
  led < 8 ? led + 1 : 11 + Math.floor((led - 8) / 9) * 10 + ((led - 8) % 9);

// the pad press as a signal: grey level from the velocity
export function fxPadSignal(
  index: number,
  velocity: number,
  macros: number[],
): Sig {
  const v = velocity ? Math.max(1, Math.min(63, velocity >> 1)) : 0;
  return {
    index,
    rgb: [v, v, v],
    layer: 0,
    blend: 0,
    range: 200,
    macros: [...macros],
  };
}

// the AQ64L note / CC of a pad (notes 11-89 bottom-up, CC 104-111 top)
export function fxMidiToIndex(d: ArrayLike<number>): [number, number] | null {
  const st = d[0] & 0xf0;
  if (st === 0xb0 && d[1] >= 104 && d[1] <= 111)
    return [d[1] - 103, d[2] ? 127 : 0];
  if (st !== 0x90 && st !== 0x80) return null;
  const note = d[1];
  const r = Math.trunc((89 - note) / 10);
  const c = note + r * 10 - 81;
  if (note < 9 || note > 98 || c < 0 || c > 8) return null;
  return [fxLedToIndex(8 + r * 9 + c), st === 0x90 ? d[2] : 0];
}

export class FxEngine {
  ctx: FxContext;
  tracks: { chain: ChainRT; enabled: boolean }[] = [];
  constructor(p: FxProject, clock: Clock = realClock) {
    this.ctx = new FxContext(clock);
    this.load(p);
  }
  load(p: FxProject) {
    this.stop();
    this.ctx.chokes.clear();
    this.ctx.multis.clear();
    this.ctx.bpm = p.bpm > 0 ? p.bpm : 120;
    this.ctx.macros = [...p.macros];
    this.tracks = p.tracks.map((t) => {
      const chain = new ChainRT(t.chain, this.ctx);
      chain.exit = (s) => s.forEach((x) => this.ctx.screen.enter(x));
      return { chain, enabled: t.enabled };
    });
  }
  input(index: number, velocity: number) {
    for (const t of this.tracks)
      if (t.enabled)
        t.chain.enter([fxPadSignal(index, velocity, this.ctx.macros)]);
  }
  stop() {
    this.tracks.forEach((t) => t.chain.stop());
    this.ctx.screen.clear();
  }
  // the 80 LED colours (0xRRGGBB) of the screen
  leds(): number[] {
    const out = Array(80).fill(0);
    for (let i = 0; i < 101; i++) {
      const l = fxIndexToLed(i);
      if (l !== null) out[l] = fxTo24(pack(this.ctx.screen.color(i)));
    }
    return out;
  }
}
