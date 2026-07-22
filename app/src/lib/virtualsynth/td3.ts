// Virtual TD-3: single osc (saw/square) -> 2x lowpass ladder stand-in ->
// VCA -> distortion. Accent (velocity >= 105, the wire's 112) boosts level
// and env depth and shortens the sweep; overlapping notes glide (slide).
import {
  MonoBase,
  type VirtualEngine,
  type VParam,
  audioCtx,
  midiHz,
  clamp,
  driveCurve,
} from './base';

const ACCENT_VEL = 105;
const SLIDE_TC = 0.02; // ~60 ms constant-time glide

const PARAMS: VParam[] = [
  {
    id: 'wave',
    label: 'waveform',
    min: 0,
    max: 1,
    step: 1,
    value: 0,
    options: ['saw', 'square'],
  },
  {
    id: 'tune',
    label: 'tuning',
    min: -12,
    max: 12,
    step: 1,
    value: 0,
    unit: 'st',
  },
  {
    id: 'cutoff',
    label: 'cutoff',
    min: 80,
    max: 5000,
    step: 10,
    value: 700,
    unit: 'Hz',
  },
  { id: 'reso', label: 'resonance', min: 0.5, max: 22, step: 0.5, value: 9 },
  {
    id: 'envmod',
    label: 'env mod',
    min: 0,
    max: 4500,
    step: 25,
    value: 2400,
    unit: 'Hz',
  },
  {
    id: 'decay',
    label: 'decay',
    min: 0.05,
    max: 2,
    step: 0.01,
    value: 0.35,
    unit: 's',
  },
  { id: 'accent', label: 'accent', min: 0, max: 1, step: 0.01, value: 0.8 },
  { id: 'dist', label: 'distortion', min: 0, max: 1, step: 0.01, value: 0.15 },
  { id: 'volume', label: 'volume', min: 0, max: 1, step: 0.01, value: 0.6 },
];

export class Td3Engine extends MonoBase implements VirtualEngine {
  readonly analyser: AnalyserNode;
  private ac = audioCtx();
  private osc = this.ac.createOscillator();
  private f1 = this.ac.createBiquadFilter();
  private f2 = this.ac.createBiquadFilter();
  private vca = this.ac.createGain();
  private shaper = this.ac.createWaveShaper();
  private master = this.ac.createGain();

  constructor() {
    super(PARAMS.map((p) => ({ ...p })));
    this.osc.type = 'sawtooth';
    for (const f of [this.f1, this.f2]) {
      f.type = 'lowpass';
      f.frequency.value = this.get('cutoff');
    }
    this.f1.Q.value = this.get('reso');
    this.f2.Q.value = 0.5; // second pole adds slope, not double resonance
    this.vca.gain.value = 0;
    this.shaper.curve = driveCurve(this.get('dist'));
    this.master.gain.value = this.get('volume') ** 2;
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 2048;
    this.osc.connect(this.f1);
    this.f1.connect(this.f2);
    this.f2.connect(this.vca);
    this.vca.connect(this.shaper);
    this.shaper.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.ac.destination);
    this.osc.start();
  }

  protected apply(id: string): void {
    const t = this.ac.currentTime;
    switch (id) {
      case 'wave':
        this.osc.type = this.get('wave') ? 'square' : 'sawtooth';
        break;
      case 'cutoff':
        this.setFilter(this.get('cutoff'), t, 0.01);
        break;
      case 'reso':
        this.f1.Q.setTargetAtTime(this.get('reso'), t, 0.01);
        break;
      case 'dist':
        this.shaper.curve = driveCurve(this.get('dist'));
        break;
      case 'volume':
        this.master.gain.setTargetAtTime(this.get('volume') ** 2, t, 0.01);
        break;
    }
  }

  private setFilter(hz: number, at: number, tc: number): void {
    const v = clamp(hz, 30, 12000);
    this.f1.frequency.setTargetAtTime(v, at, tc);
    this.f2.frequency.setTargetAtTime(v, at, tc);
  }

  private pitch(note: number): number {
    return midiHz(note + this.get('tune'));
  }

  protected trigger(note: number, vel: number, legato: boolean): void {
    const t = this.ac.currentTime;
    const hz = this.pitch(note);
    if (legato) {
      // slide: glide the pitch, keep the envelopes running
      this.osc.frequency.setTargetAtTime(hz, t, SLIDE_TC);
      return;
    }
    this.osc.frequency.cancelScheduledValues(t);
    this.osc.frequency.setValueAtTime(hz, t);
    const acc = vel >= ACCENT_VEL;
    const amt = this.get('accent');
    // VCA: fast attack to a velocity level; accent punches above it
    const level = clamp((vel / 127) * (acc ? 1 + amt * 0.6 : 1), 0, 1.4);
    const g = this.vca.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + 0.004);
    // filter env: jump to peak, decay back to cutoff; accent = higher + faster
    const cutoff = this.get('cutoff');
    const peak = cutoff + this.get('envmod') * (acc ? 1 + amt : 1);
    const dec = acc
      ? Math.max(0.05, this.get('decay') * (1 - amt * 0.6))
      : this.get('decay');
    const f = clamp(peak, 30, 12000);
    for (const flt of [this.f1, this.f2]) {
      flt.frequency.cancelScheduledValues(t);
      flt.frequency.setValueAtTime(flt.frequency.value, t);
      flt.frequency.linearRampToValueAtTime(f, t + 0.005);
      flt.frequency.setTargetAtTime(
        clamp(cutoff, 30, 12000),
        t + 0.005,
        dec / 3,
      );
    }
  }

  protected release(): void {
    const t = this.ac.currentTime;
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(this.vca.gain.value, t);
    this.vca.gain.setTargetAtTime(0, t, 0.015);
  }

  protected returnTo(note: number): void {
    this.osc.frequency.setTargetAtTime(
      this.pitch(note),
      this.ac.currentTime,
      SLIDE_TC,
    );
  }

  dispose(): void {
    this.allOff();
    try {
      this.osc.stop();
    } catch {
      // already stopped
    }
    this.master.disconnect();
    this.analyser.disconnect();
  }
}
