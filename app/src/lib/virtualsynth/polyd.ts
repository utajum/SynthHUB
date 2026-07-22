// Virtual Poly D: 4 oscillators, PARAPHONIC - up to 4 notes but one shared
// ladder-style filter + one shared envelope pair (multi-trigger), like the
// hardware. Detune spread + drive + a small chorus for the thickness.
import {
  ParamsBase,
  type VirtualEngine,
  type VParam,
  audioCtx,
  midiHz,
  clamp,
  driveCurve,
} from './base';

const SLOTS = 4;
const SLOT_LEVEL = 0.22;

const PARAMS: VParam[] = [
  {
    id: 'wave',
    label: 'waveform',
    min: 0,
    max: 2,
    step: 1,
    value: 1,
    options: ['tri', 'saw', 'square'],
  },
  {
    id: 'spread',
    label: 'osc spread',
    min: 0,
    max: 30,
    step: 1,
    value: 10,
    unit: 'ct',
  },
  {
    id: 'octave',
    label: 'octave',
    min: 0,
    max: 2,
    step: 1,
    value: 1,
    options: ['-1', '0', '+1'],
  },
  {
    id: 'glide',
    label: 'glide',
    min: 0,
    max: 0.4,
    step: 0.005,
    value: 0,
    unit: 's',
  },
  {
    id: 'cutoff',
    label: 'cutoff',
    min: 60,
    max: 8000,
    step: 10,
    value: 1100,
    unit: 'Hz',
  },
  { id: 'reso', label: 'emphasis', min: 0.5, max: 20, step: 0.5, value: 5 },
  {
    id: 'contour',
    label: 'contour amt',
    min: 0,
    max: 5000,
    step: 25,
    value: 1800,
    unit: 'Hz',
  },
  {
    id: 'fattack',
    label: 'filter attack',
    min: 0.001,
    max: 1,
    step: 0.001,
    value: 0.01,
    unit: 's',
  },
  {
    id: 'fdecay',
    label: 'filter decay',
    min: 0.02,
    max: 2,
    step: 0.01,
    value: 0.35,
    unit: 's',
  },
  {
    id: 'attack',
    label: 'attack',
    min: 0.001,
    max: 1.5,
    step: 0.001,
    value: 0.006,
    unit: 's',
  },
  {
    id: 'decay',
    label: 'decay/rel',
    min: 0.02,
    max: 3,
    step: 0.01,
    value: 0.5,
    unit: 's',
  },
  { id: 'sustain', label: 'sustain', min: 0, max: 1, step: 0.01, value: 0.6 },
  { id: 'drive', label: 'drive', min: 0, max: 1, step: 0.01, value: 0.12 },
  { id: 'chorus', label: 'chorus', min: 0, max: 1, step: 0.01, value: 0.3 },
  { id: 'volume', label: 'volume', min: 0, max: 1, step: 0.01, value: 0.55 },
];

interface Slot {
  osc: OscillatorNode;
  gain: GainNode;
  pitch: number | null;
  at: number; // allocation time for oldest-steal
}

export class PolyDEngine extends ParamsBase implements VirtualEngine {
  readonly analyser: AnalyserNode;
  private ac = audioCtx();
  private slots: Slot[] = [];
  private counts = new Map<number, number>();
  private mix = this.ac.createGain();
  private shaper = this.ac.createWaveShaper();
  private f1 = this.ac.createBiquadFilter();
  private f2 = this.ac.createBiquadFilter();
  private vca = this.ac.createGain();
  private master = this.ac.createGain();
  private chDelay = this.ac.createDelay(0.05);
  private chWet = this.ac.createGain();
  private chLfo = this.ac.createOscillator();
  private chDepth = this.ac.createGain();

  constructor() {
    super(PARAMS.map((p) => ({ ...p })));
    for (let i = 0; i < SLOTS; i++) {
      const osc = this.ac.createOscillator();
      const gain = this.ac.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.mix);
      osc.start();
      this.slots.push({ osc, gain, pitch: null, at: 0 });
    }
    this.applyWave();
    this.applySpread();
    this.shaper.curve = driveCurve(this.get('drive'));
    for (const f of [this.f1, this.f2]) {
      f.type = 'lowpass';
      f.frequency.value = this.get('cutoff');
    }
    this.f1.Q.value = this.get('reso');
    this.f2.Q.value = 0.5;
    this.vca.gain.value = 0;
    this.master.gain.value = this.get('volume') ** 2;
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 2048;

    this.mix.connect(this.shaper);
    this.shaper.connect(this.f1);
    this.f1.connect(this.f2);
    this.f2.connect(this.vca);
    this.vca.connect(this.master);
    // chorus: modulated short delay mixed alongside the dry path
    this.chDelay.delayTime.value = 0.012;
    this.chLfo.type = 'sine';
    this.chLfo.frequency.value = 0.6;
    this.chDepth.gain.value = 0.004;
    this.chLfo.connect(this.chDepth);
    this.chDepth.connect(this.chDelay.delayTime);
    this.chLfo.start();
    this.vca.connect(this.chDelay);
    this.chDelay.connect(this.chWet);
    this.chWet.gain.value = this.get('chorus') * 0.6;
    this.chWet.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.ac.destination);
  }

  private applyWave(): void {
    const types: OscillatorType[] = ['triangle', 'sawtooth', 'square'];
    const w = types[this.get('wave')] ?? 'sawtooth';
    for (const s of this.slots) s.osc.type = w;
  }

  private applySpread(): void {
    const spread = this.get('spread');
    this.slots.forEach((s, i) => {
      s.osc.detune.value = spread * ((i - (SLOTS - 1) / 2) / ((SLOTS - 1) / 2));
    });
  }

  private hz(note: number): number {
    return midiHz(note + 12 * (this.get('octave') - 1));
  }

  protected apply(id: string): void {
    const t = this.ac.currentTime;
    switch (id) {
      case 'wave':
        this.applyWave();
        break;
      case 'spread':
        this.applySpread();
        break;
      case 'octave':
        for (const s of this.slots) {
          if (s.pitch !== null) {
            s.osc.frequency.setTargetAtTime(this.hz(s.pitch), t, 0.01);
          }
        }
        break;
      case 'cutoff':
        for (const f of [this.f1, this.f2]) {
          f.frequency.setTargetAtTime(
            clamp(this.get('cutoff'), 30, 14000),
            t,
            0.01,
          );
        }
        break;
      case 'reso':
        this.f1.Q.setTargetAtTime(this.get('reso'), t, 0.01);
        break;
      case 'drive':
        this.shaper.curve = driveCurve(this.get('drive'));
        break;
      case 'chorus':
        this.chWet.gain.setTargetAtTime(this.get('chorus') * 0.6, t, 0.01);
        break;
      case 'volume':
        this.master.gain.setTargetAtTime(this.get('volume') ** 2, t, 0.01);
        break;
    }
  }

  private activeCount(): number {
    return this.slots.filter((s) => s.pitch !== null).length;
  }

  // retrigger the SHARED envelopes (paraphonic multi-trigger)
  private retrigger(vel: number): void {
    const t = this.ac.currentTime;
    const level = clamp(vel / 127, 0.05, 1);
    const a = this.get('attack');
    const g = this.vca.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + a);
    g.setTargetAtTime(
      level * this.get('sustain'),
      t + a,
      this.get('decay') / 3,
    );
    const cutoff = clamp(this.get('cutoff'), 30, 14000);
    const peak = clamp(cutoff + this.get('contour'), 30, 14000);
    const fa = this.get('fattack');
    for (const f of [this.f1, this.f2]) {
      f.frequency.cancelScheduledValues(t);
      f.frequency.setValueAtTime(f.frequency.value, t);
      f.frequency.linearRampToValueAtTime(peak, t + fa);
      f.frequency.setTargetAtTime(cutoff, t + fa, this.get('fdecay') / 3);
    }
  }

  noteOn(note: number, vel: number): void {
    audioCtx();
    this.counts.set(note, (this.counts.get(note) ?? 0) + 1);
    const t = this.ac.currentTime;
    let slot = this.slots.find((s) => s.pitch === note);
    if (!slot) {
      // free slot first, else steal the oldest (osc count = note count)
      slot =
        this.slots.find((s) => s.pitch === null) ??
        this.slots.reduce((a, b) => (a.at <= b.at ? a : b));
      if (slot.pitch !== null) this.counts.delete(slot.pitch);
      slot.pitch = note;
      const glide = this.get('glide');
      if (glide > 0.001) {
        slot.osc.frequency.setTargetAtTime(this.hz(note), t, glide / 3);
      } else {
        slot.osc.frequency.cancelScheduledValues(t);
        slot.osc.frequency.setValueAtTime(this.hz(note), t);
      }
      slot.gain.gain.setTargetAtTime(SLOT_LEVEL, t, 0.004);
    }
    slot.at = t;
    this.retrigger(vel);
  }

  noteOff(note: number): void {
    const c = (this.counts.get(note) ?? 0) - 1;
    if (c > 0) {
      this.counts.set(note, c);
      return;
    }
    this.counts.delete(note);
    const t = this.ac.currentTime;
    const slot = this.slots.find((s) => s.pitch === note);
    if (slot) {
      slot.pitch = null;
      slot.gain.gain.setTargetAtTime(0, t, 0.012);
    }
    if (this.activeCount() === 0) {
      // decay knob doubles as release (Model D style)
      this.vca.gain.cancelScheduledValues(t);
      this.vca.gain.setValueAtTime(this.vca.gain.value, t);
      this.vca.gain.setTargetAtTime(0, t, this.get('decay') / 3);
    }
  }

  allOff(): void {
    this.counts.clear();
    const t = this.ac.currentTime;
    for (const s of this.slots) {
      s.pitch = null;
      s.gain.gain.setTargetAtTime(0, t, 0.01);
    }
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(this.vca.gain.value, t);
    this.vca.gain.setTargetAtTime(0, t, 0.02);
  }

  dispose(): void {
    this.allOff();
    for (const s of this.slots) {
      try {
        s.osc.stop();
      } catch {
        // already stopped
      }
    }
    try {
      this.chLfo.stop();
    } catch {
      // already stopped
    }
    this.master.disconnect();
    this.analyser.disconnect();
  }
}
