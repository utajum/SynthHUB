// Generative sequencer tools: euclidean rhythms, scale-quantized random
// melodies, mutate/evolve and humanize. All pure - they return per-step
// patches that the engine applies in one batch.
import type { Step, DrumCell } from './sequencer';
import { type Scale, scaleNotes, quantizeToScale } from './scales';

// Bjorklund/euclidean: distribute `pulses` as evenly as possible over `steps`,
// first pulse on step 0 (rotate shifts the pattern right)
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
  if (steps <= 0) return [];
  if (pulses <= 0) return Array.from({ length: steps }, () => false);
  const out: boolean[] = [];
  let bucket = steps - pulses; // phase so a pulse fires at i=0
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      out.push(true);
    } else {
      out.push(false);
    }
  }
  const r = ((rotate % steps) + steps) % steps;
  return out.map((_, i) => out[(i - r + steps) % steps]);
}

// gate mask -> mono step patches (notes/velocities untouched)
export function gatesToMono(
  mask: boolean[],
  length: number,
): (Partial<Step> | null)[] {
  return mask.map((on, i) => (i < length ? { on } : { on: false }));
}

// gate mask -> drum row patches
export function gatesToRow(
  mask: boolean[],
  length: number,
): (Partial<DrumCell> | null)[] {
  return mask.map((on, i) => (i < length ? { on } : { on: false }));
}

export interface MelodyOpts {
  scale: Scale;
  root: number; // 0-11
  baseOctave: number; // MIDI octave start, e.g. 3 -> C3=48
  octaves: number; // range in octaves
  density: number; // 0..1 chance a step is on
  rest: boolean; // allow rests (off steps)
}

// random scale-quantized melody for the mono lane
export function randomMelody(
  length: number,
  maxSteps: number,
  o: MelodyOpts,
): (Partial<Step> | null)[] {
  const lo = (o.baseOctave + 1) * 12 + o.root;
  const hi = lo + o.octaves * 12;
  const pool = scaleNotes(o.scale, lo % 12, lo, hi);
  const notes = pool.length ? pool : [lo];
  const out: (Partial<Step> | null)[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (i >= length) {
      out.push({ on: false });
      continue;
    }
    const on = o.rest ? Math.random() < o.density : true;
    out.push({
      on,
      note: notes[Math.floor(Math.random() * notes.length)],
      velocity: 80 + Math.floor(Math.random() * 40),
      accent: Math.random() < 0.15,
      slide: Math.random() < 0.12,
    });
  }
  return out;
}

// mutate ~amount of the active steps: flip gates, nudge notes within scale
export function evolveMono(
  steps: Step[],
  length: number,
  amount: number,
  scale: Scale,
  root: number,
): (Partial<Step> | null)[] {
  return steps.map((s, i) => {
    if (i >= length || Math.random() > amount) return null;
    const roll = Math.random();
    if (roll < 0.3) return { on: !s.on };
    const dir = Math.random() < 0.5 ? -1 : 1;
    const jump = Math.random() < 0.7 ? 1 : 2;
    const note = quantizeToScale(
      Math.max(0, Math.min(127, s.note + dir * jump * 2)),
      scale,
      root,
    );
    return { note };
  });
}

export function evolveRow(
  row: DrumCell[],
  length: number,
  amount: number,
): (Partial<DrumCell> | null)[] {
  return row.map((c, i) => {
    if (i >= length || Math.random() > amount) return null;
    return { on: !c.on };
  });
}

// humanize: jitter velocity (and gate for mono) on active steps
export function humanizeMono(
  steps: Step[],
  length: number,
  amount: number,
): (Partial<Step> | null)[] {
  return steps.map((s, i) => {
    if (i >= length || !s.on) return null;
    return {
      velocity: jitter(s.velocity, 24 * amount, 1, 127),
      gate: Math.max(
        0.1,
        Math.min(2, s.gate + (Math.random() - 0.5) * 0.3 * amount),
      ),
      probability:
        Math.random() < 0.3 * amount
          ? 85 + Math.floor(Math.random() * 15)
          : s.probability,
    };
  });
}

export function humanizeRow(
  row: DrumCell[],
  length: number,
  amount: number,
): (Partial<DrumCell> | null)[] {
  return row.map((c, i) => {
    if (i >= length || !c.on) return null;
    return {
      velocity: jitter(c.velocity, 24 * amount, 1, 127),
      probability:
        Math.random() < 0.3 * amount
          ? 85 + Math.floor(Math.random() * 15)
          : c.probability,
    };
  });
}

function jitter(v: number, spread: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(max, Math.round(v + (Math.random() - 0.5) * spread)),
  );
}
