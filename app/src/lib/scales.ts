// Musical scales as semitone offsets from the root. Used by the generative
// sequencer tools (melody, quantize, evolve).

export interface Scale {
  id: string;
  name: string;
  steps: number[];
}

export const SCALES: Scale[] = [
  { id: 'major', name: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
  {
    id: 'minor',
    name: 'Natural Minor (Aeolian)',
    steps: [0, 2, 3, 5, 7, 8, 10],
  },
  { id: 'harm-minor', name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'mel-minor', name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'maj-pent', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'min-pent', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  {
    id: 'dbl-harm-major',
    name: 'Double Harmonic Major',
    steps: [0, 1, 4, 5, 7, 8, 11],
  },
  {
    id: 'hungarian-minor',
    name: 'Hungarian Minor',
    steps: [0, 2, 3, 6, 7, 8, 11],
  },
  {
    id: 'phrygian-dom',
    name: 'Phrygian Dominant',
    steps: [0, 1, 4, 5, 7, 8, 10],
  },
  { id: 'whole-tone', name: 'Whole Tone', steps: [0, 2, 4, 6, 8, 10] },
  {
    id: 'chromatic',
    name: 'Chromatic',
    steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
];

export const ROOT_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

export function scaleById(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

// all MIDI notes of a scale inside [lo, hi]
export function scaleNotes(
  scale: Scale,
  root: number,
  lo: number,
  hi: number,
): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) {
    if (scale.steps.includes((((n - root) % 12) + 12) % 12)) out.push(n);
  }
  return out;
}

// snap a note to the nearest note of the scale
export function quantizeToScale(
  note: number,
  scale: Scale,
  root: number,
): number {
  for (let d = 0; d < 12; d++) {
    const up = note + d;
    const dn = note - d;
    if (scale.steps.includes((((dn - root) % 12) + 12) % 12)) return dn;
    if (scale.steps.includes((((up - root) % 12) + 12) % 12)) return up;
  }
  return note;
}
