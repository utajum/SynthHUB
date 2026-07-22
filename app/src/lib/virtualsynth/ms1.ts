// Virtual MS-1: one osc into a source mixer (saw + square + sub + noise) ->
// 2x lowpass -> VCA. One ADSR drives amp and filter peak; LFO does vibrato
// and filter wobble; the glide knob is always-on portamento (SH-101 style).
import {
  MonoBase,
  type VirtualEngine,
  type VParam,
  audioCtx,
  midiHz,
  clamp,
  noiseSource,
} from './base';

const PARAMS: VParam[] = [
  { id: 'saw', label: 'saw mix', min: 0, max: 1, step: 0.01, value: 0.8 },
  { id: 'pulse', label: 'square mix', min: 0, max: 1, step: 0.01, value: 0.3 },
  { id: 'sub', label: 'sub mix', min: 0, max: 1, step: 0.01, value: 0.6 },
  {
    id: 'suboct',
    label: 'sub octave',
    min: 0,
    max: 1,
    step: 1,
    value: 0,
    options: ['-1 oct', '-2 oct'],
  },
  { id: 'noise', label: 'noise mix', min: 0, max: 1, step: 0.01, value: 0 },
  {
    id: 'cutoff',
    label: 'cutoff',
    min: 60,
    max: 8000,
    step: 10,
    value: 1200,
    unit: 'Hz',
  },
  { id: 'reso', label: 'resonance', min: 0.5, max: 20, step: 0.5, value: 4 },
  {
    id: 'envamt',
    label: 'env amount',
    min: 0,
    max: 5000,
    step: 25,
    value: 1500,
    unit: 'Hz',
  },
  {
    id: 'attack',
    label: 'attack',
    min: 0.001,
    max: 1.5,
    step: 0.001,
    value: 0.004,
    unit: 's',
  },
  {
    id: 'decay',
    label: 'decay',
    min: 0.02,
    max: 2,
    step: 0.01,
    value: 0.25,
    unit: 's',
  },
  { id: 'sustain', label: 'sustain', min: 0, max: 1, step: 0.01, value: 0.55 },
  {
    id: 'rel',
    label: 'release',
    min: 0.02,
    max: 3,
    step: 0.01,
    value: 0.18,
    unit: 's',
  },
  {
    id: 'lforate',
    label: 'lfo rate',
    min: 0.1,
    max: 20,
    step: 0.1,
    value: 5,
    unit: 'Hz',
  },
  {
    id: 'lfopitch',
    label: 'lfo>pitch',
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    unit: 'ct',
  },
  {
    id: 'lfofilter',
    label: 'lfo>filter',
    min: 0,
    max: 2500,
    step: 25,
    value: 0,
    unit: 'Hz',
  },
  {
    id: 'glide',
    label: 'glide',
    min: 0,
    max: 0.4,
    step: 0.005,
    value: 0.03,
    unit: 's',
  },
  { id: 'volume', label: 'volume', min: 0, max: 1, step: 0.01, value: 0.6 },
];

export class Ms1Engine extends MonoBase implements VirtualEngine {
  readonly analyser: AnalyserNode;
  private ac = audioCtx();
  private saw = this.ac.createOscillator();
  private sqr = this.ac.createOscillator();
  private subOsc = this.ac.createOscillator();
  private noise = noiseSource(this.ac);
  private gSaw = this.ac.createGain();
  private gSqr = this.ac.createGain();
  private gSub = this.ac.createGain();
  private gNoise = this.ac.createGain();
  private f1 = this.ac.createBiquadFilter();
  private f2 = this.ac.createBiquadFilter();
  private vca = this.ac.createGain();
  private master = this.ac.createGain();
  private lfo = this.ac.createOscillator();
  private lfoPitch = this.ac.createGain();
  private lfoFilter = this.ac.createGain();
  private curNote = 60;
  private baseCut = 0; // filter envelope floor while a note is held

  constructor() {
    super(PARAMS.map((p) => ({ ...p })));
    this.saw.type = 'sawtooth';
    this.sqr.type = 'square';
    this.subOsc.type = 'square';
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = this.get('lforate');
    this.gSaw.gain.value = this.get('saw') * 0.5;
    this.gSqr.gain.value = this.get('pulse') * 0.5;
    this.gSub.gain.value = this.get('sub') * 0.5;
    this.gNoise.gain.value = this.get('noise') * 0.4;
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

    this.saw.connect(this.gSaw);
    this.sqr.connect(this.gSqr);
    this.subOsc.connect(this.gSub);
    this.noise.connect(this.gNoise);
    for (const g of [this.gSaw, this.gSqr, this.gSub, this.gNoise]) {
      g.connect(this.f1);
    }
    this.f1.connect(this.f2);
    this.f2.connect(this.vca);
    this.vca.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.ac.destination);

    // LFO -> vibrato (cents) and filter wobble (Hz)
    this.lfoPitch.gain.value = this.get('lfopitch');
    this.lfoFilter.gain.value = this.get('lfofilter');
    this.lfo.connect(this.lfoPitch);
    this.lfo.connect(this.lfoFilter);
    for (const o of [this.saw, this.sqr, this.subOsc]) {
      this.lfoPitch.connect(o.detune);
    }
    this.lfoFilter.connect(this.f1.frequency);
    this.lfoFilter.connect(this.f2.frequency);

    for (const o of [this.saw, this.sqr, this.subOsc, this.lfo]) o.start();
  }

  protected apply(id: string): void {
    const t = this.ac.currentTime;
    switch (id) {
      case 'saw':
        this.gSaw.gain.setTargetAtTime(this.get('saw') * 0.5, t, 0.01);
        break;
      case 'pulse':
        this.gSqr.gain.setTargetAtTime(this.get('pulse') * 0.5, t, 0.01);
        break;
      case 'sub':
        this.gSub.gain.setTargetAtTime(this.get('sub') * 0.5, t, 0.01);
        break;
      case 'suboct':
        this.setPitch(this.curNote, 0.01);
        break;
      case 'noise':
        this.gNoise.gain.setTargetAtTime(this.get('noise') * 0.4, t, 0.01);
        break;
      case 'cutoff':
        this.baseCut = this.get('cutoff');
        for (const f of [this.f1, this.f2]) {
          f.frequency.setTargetAtTime(clamp(this.baseCut, 30, 14000), t, 0.01);
        }
        break;
      case 'reso':
        this.f1.Q.setTargetAtTime(this.get('reso'), t, 0.01);
        break;
      case 'lforate':
        this.lfo.frequency.setTargetAtTime(this.get('lforate'), t, 0.01);
        break;
      case 'lfopitch':
        this.lfoPitch.gain.setTargetAtTime(this.get('lfopitch'), t, 0.01);
        break;
      case 'lfofilter':
        this.lfoFilter.gain.setTargetAtTime(this.get('lfofilter'), t, 0.01);
        break;
      case 'volume':
        this.master.gain.setTargetAtTime(this.get('volume') ** 2, t, 0.01);
        break;
    }
  }

  // move all sources to a note; tc = glide time constant
  private setPitch(note: number, tc: number): void {
    this.curNote = note;
    const t = this.ac.currentTime;
    const hz = midiHz(note);
    const sub = midiHz(note - 12 * (this.get('suboct') + 1));
    for (const [o, f] of [
      [this.saw, hz],
      [this.sqr, hz],
      [this.subOsc, sub],
    ] as const) {
      if (tc <= 0.001) {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(f, t);
      } else {
        o.frequency.setTargetAtTime(f, t, tc);
      }
    }
  }

  protected trigger(note: number, vel: number, legato: boolean): void {
    // SH-101 portamento applies to every note change; legato skips retrigger
    this.setPitch(note, Math.max(this.get('glide') / 3, legato ? 0.02 : 0));
    if (legato) return;
    const t = this.ac.currentTime;
    const a = this.get('attack');
    const d = this.get('decay');
    const s = this.get('sustain');
    const level = clamp(vel / 127, 0.05, 1);
    const g = this.vca.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + a);
    g.setTargetAtTime(level * s, t + a, d / 3);
    // filter follows the same ADSR shape scaled by env amount
    this.baseCut = this.get('cutoff');
    const peak = clamp(this.baseCut + this.get('envamt'), 30, 14000);
    const susF = clamp(this.baseCut + this.get('envamt') * s, 30, 14000);
    for (const f of [this.f1, this.f2]) {
      f.frequency.cancelScheduledValues(t);
      f.frequency.setValueAtTime(f.frequency.value, t);
      f.frequency.linearRampToValueAtTime(peak, t + a);
      f.frequency.setTargetAtTime(susF, t + a, d / 3);
    }
  }

  protected release(): void {
    const t = this.ac.currentTime;
    const r = this.get('rel');
    this.vca.gain.cancelScheduledValues(t);
    this.vca.gain.setValueAtTime(this.vca.gain.value, t);
    this.vca.gain.setTargetAtTime(0, t, r / 3);
    for (const f of [this.f1, this.f2]) {
      f.frequency.cancelScheduledValues(t);
      f.frequency.setValueAtTime(f.frequency.value, t);
      f.frequency.setTargetAtTime(
        clamp(this.get('cutoff'), 30, 14000),
        t,
        r / 3,
      );
    }
  }

  protected returnTo(note: number): void {
    this.setPitch(note, Math.max(this.get('glide') / 3, 0.02));
  }

  dispose(): void {
    this.allOff();
    for (const o of [this.saw, this.sqr, this.subOsc, this.lfo, this.noise]) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    this.master.disconnect();
    this.analyser.disconnect();
  }
}
