// Virtual synth foundation: one shared AudioContext, param descriptors, and
// the mono voice logic (last-note priority, per-pitch refcounts so ties and
// slides never cut a still-held note). Engines are approximations for fun -
// the app's job is managing the hardware, not replacing it.

export interface VParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number; // default
  unit?: string;
  options?: string[]; // discrete choice (value = index)
}

export interface VirtualEngine {
  readonly params: VParam[];
  get(id: string): number;
  set(id: string, v: number): void;
  noteOn(note: number, vel: number): void;
  noteOff(note: number): void;
  allOff(): void;
  readonly analyser: AnalyserNode;
  dispose(): void;
}

// lazy shared context; created/resumed on user gestures only
let ctx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function midiHz(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// looping white-noise source, already started
export function noiseSource(ac: AudioContext): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start();
  return src;
}

// symmetric soft-clip curve for WaveShaper drive
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = 1 + amount * 24;
  const n = 257;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

// param plumbing shared by all engines
export abstract class ParamsBase {
  readonly params: VParam[];
  private values = new Map<string, number>();
  constructor(params: VParam[]) {
    this.params = params;
    for (const p of params) this.values.set(p.id, p.value);
  }
  get(id: string): number {
    return this.values.get(id) ?? 0;
  }
  set(id: string, v: number): void {
    const p = this.params.find((x) => x.id === id);
    if (!p) return;
    this.values.set(id, clamp(v, p.min, p.max));
    this.apply(id);
  }
  // react to a param change (live nodes)
  protected abstract apply(id: string): void;
}

// Monophonic note tracking: last-note priority; a pitch is released only when
// every overlapping note-on for it has seen its note-off (ties/slides from
// the sequencer produce exactly that overlap).
export abstract class MonoBase extends ParamsBase {
  private order: number[] = [];
  private counts = new Map<number, number>();

  noteOn(note: number, vel: number): void {
    audioCtx();
    const legato = this.order.length > 0;
    this.counts.set(note, (this.counts.get(note) ?? 0) + 1);
    this.order = [...this.order.filter((n) => n !== note), note];
    this.trigger(note, vel, legato);
  }

  noteOff(note: number): void {
    const c = (this.counts.get(note) ?? 0) - 1;
    if (c > 0) {
      this.counts.set(note, c);
      return;
    }
    this.counts.delete(note);
    const wasCurrent = this.order[this.order.length - 1] === note;
    this.order = this.order.filter((n) => n !== note);
    if (this.order.length === 0) this.release();
    else if (wasCurrent) this.returnTo(this.order[this.order.length - 1]);
  }

  allOff(): void {
    this.order = [];
    this.counts.clear();
    this.release();
  }

  // start/retrigger the voice; legato = a note was already held
  protected abstract trigger(note: number, vel: number, legato: boolean): void;
  // last note released - close the voice
  protected abstract release(): void;
  // current note released while older notes are held - glide back, no retrig
  protected abstract returnTo(note: number): void;
}
