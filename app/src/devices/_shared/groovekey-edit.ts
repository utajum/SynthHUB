// GROOVE KEY project editing (Control Tribe 1.12.4 GrooveKeyPatternMatrix,
// GrooveKey::Sequencer / SequencerGrid / SequencerLane, DrumSequencer,
// GrooveKeySongArranger, GrooveKeyInspector) on the ProjectData image of
// groovekey-seq.ts. Offsets and defaults are ProjectData::resetToDefault's.
import {
  DRUM_PATTERN as gkDrumPatternOff,
  DRUM_TRACK as GK_DRUM_OFF,
  GK_PATTERNS,
  GK_SIZE,
  GK_TRACKS,
  PATTERN as gkPatternOff,
  TRACK as gkTrackOff,
} from './groovekey-seq';

export { GK_DRUM_OFF, gkDrumPatternOff, gkPatternOff, gkTrackOff };

export const GK_STEPS = 64;
export const GK_NOTES = 128; // note slots per pattern
export const GK_PER_STEP = 8; // notes per step (SequencerGrid poly limit)
export const GK_VOICES = 10;
export const GK_SONGS = 16;
export const GK_SLOTS = 16;

// songs[row: track 1-4, drums][song][slot] = <pattern 0 empty | 1-16> <repeat 1-5>
export const gkSongOff = (row: number, song: number, slot: number) =>
  8 + row * 512 + song * 32 + slot * 2;

// TrackData bytes
export const GK_TRACK_AT = {
  curPattern: 0,
  mode: 1,
  muteSolo: 2,
  swing: 3,
  preset: 4,
};
// TrackPatternData bytes (stepPages: 4 x u16 step-on bits)
export const GK_PATTERN_AT = {
  stepPages: 0,
  length: 8,
  playMode: 9,
  style: 10,
  octave: 11,
  scale: 12,
  root: 13,
  timeDiv: 14,
  custStyle: 15, // 7 bytes
  notes: 22, // 128 x 12
};
// DrumTrackData bytes
export const GK_DRUM_TRACK_AT = { muteSolo: 0, swing: 1, curPattern: 10 };
// DrumPatternData bytes; hits[voice][step] at 130, micro-timing at 770
export const GK_DRUM_AT = {
  length: 0,
  polyLength: 1, // 10
  randomTrack: 11, // 10
  randomStep: 21, // 64 bits
  probability: 29,
  flam: 30,
  polymeter: 31,
  stepSize: 32,
  mute: 33, // 10 bits
  solo: 35, // 10 bits
  swing: 38,
  autoCV: 66, // 64
  hits: 130,
  micro: 770,
};

// drum hit bits (DrumSequencer::buildNoteMenu); bits 5-6 repeat x 1/2/4/8
export const GK_HIT = { on: 1, accent: 2, prob: 4, flam: 8, repeat: 0x10 };

export const GK_TRACK_MODES = ['Sequencer', 'Arpeggiator'];
export const GK_PLAY_MODES = ['<-', '->', '<->', 'WALK', 'RAND'];
// prettier-ignore
export const GK_STYLES = ['UP', 'DN', 'UP+DN', 'ORDER', 'RAND', 'POLY', 'CUSTOM'];
export const GK_OCTAVES = ['-1', '0', '1', '2'];
// prettier-ignore
export const GK_SCALES = [
  'MAJOR', 'MINOR', 'DORIAN', 'PHRYG', 'LYDIAN', 'MIXO', 'LOCRIAN', 'CHROM',
];
// prettier-ignore
export const GK_ROOTS = [
  'C', '#C', 'D', '#D', 'E', 'F', '#F', 'G', '#G', 'A', '#A', 'B',
];
// prettier-ignore
export const GK_DIVS = ['1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T'];
// prettier-ignore
export const GK_DRUMS = [
  'Bass', 'Snare', 'SideStick', 'ClHat', 'OpHat', 'HighTom', 'MidTom',
  'LowTom', 'Ride', 'Crash',
];
export const GK_NOTE_TYPES = ['Invalid', 'Note', 'Rest', 'Tie'];

// GATE_PARAMS: gate length / start in steps, by index
// prettier-ignore
export const GK_GATE = [
  0.06, 0.12, 0.19, 0.25, 0.31, 0.38, 0.44, 0.5, 0.62, 0.75, 0.88, 1, 1.12, 1.25, 1.38, 1.5, 1.62, 1.75, 1.88, 2, 2.12, 2.25, 2.38, 2.5, 2.62, 2.75, 2.88, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 24, 24.5, 25, 25.5, 26, 26.5, 27, 27.5, 28, 28.5, 29, 29.5, 30, 30.5, 31, 31.5, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
];

// NoteData (12 bytes): 0 pitch, 1 velocity, 2 gate start (FF none, else a
// GK_GATE index), 3 gate length (GK_GATE index), 4 time shift (50 = 0),
// 5 rand gate, 6 rand pitch, 7 type (0 = free slot), 8 step, 9 order in step
export interface GkLane {
  name: string;
  min: number;
  max: number;
  get: (n: Uint8Array) => number;
  set: (n: Uint8Array, v: number) => void;
  show: (v: number) => string;
}
const byteLane = (
  name: string,
  b: number,
  min: number,
  max: number,
  show: (v: number) => string = String,
): GkLane => ({
  name,
  min,
  max,
  get: (n) => n[b],
  set: (n, v) => void (n[b] = Math.max(min, Math.min(max, v))),
  show,
});
// SequencerLane params 0-6 (paramValue / setParamValue / valueString)
export const GK_LANES: GkLane[] = [
  byteLane('Velocity', 1, 0, 127),
  byteLane('Gate Len', 3, 0, 127, (v) => GK_GATE[v].toFixed(2)),
  {
    name: 'Gate Start',
    min: 0,
    max: 12,
    get: (n) => (n[2] === 0xff ? 0 : n[2] + 1),
    set: (n, v) => void (n[2] = v <= 0 ? 0xff : Math.min(v, 12) - 1),
    show: (v) => (v ? GK_GATE[v - 1].toFixed(2) : '0.00'),
  },
  byteLane('Time Shift', 4, 0, 100, (v) => String(v - 50)),
  byteLane('Rand Pitch', 6, 0, 100),
  byteLane('Rand Gate', 5, 0, 1, (v) => (v ? 'ON' : 'OFF')),
  byteLane('Type', 7, 1, 3, (v) => GK_NOTE_TYPES[v]),
];

const NOTE_DEFAULT = [0x00, 0x7f, 0xff, 0x0b, 0x32, 0x00, 0x64, 0, 0, 0, 0, 0];

export const gkNote = (img: Uint8Array, t: number, p: number, slot: number) =>
  img.subarray(
    gkPatternOff(t, p) + GK_PATTERN_AT.notes + slot * 12,
    gkPatternOff(t, p) + GK_PATTERN_AT.notes + slot * 12 + 12,
  );

export interface GkNoteRef {
  slot: number;
  pitch: number;
  step: number;
  order: number;
}

export function gkNotes(img: Uint8Array, t: number, p: number): GkNoteRef[] {
  const out: GkNoteRef[] = [];
  for (let s = 0; s < GK_NOTES; s++) {
    const n = gkNote(img, t, p, s);
    if (n[7]) out.push({ slot: s, pitch: n[0], step: n[8], order: n[9] });
  }
  return out;
}

// order notes of one step by order then slot (SequencerGrid::reindexStep)
function reindexStep(img: Uint8Array, t: number, p: number, step: number) {
  const at = gkNotes(img, t, p)
    .filter((n) => n.step === step)
    .sort((a, b) => a.order - b.order || a.slot - b.slot);
  at.forEach((n, i) => (gkNote(img, t, p, n.slot)[9] = i));
}

// SequencerGrid::addNote: a free slot with the default note; null if the
// step is full or the note is there
export function gkAddNote(
  img: Uint8Array,
  t: number,
  p: number,
  step: number,
  pitch: number,
): number | null {
  const notes = gkNotes(img, t, p);
  if (notes.some((n) => n.step === step && n.pitch === pitch)) return null;
  const count = notes.filter((n) => n.step === step).length;
  if (count >= GK_PER_STEP) return null;
  for (let s = 0; s < GK_NOTES; s++) {
    const n = gkNote(img, t, p, s);
    if (n[7]) continue;
    n.set(NOTE_DEFAULT);
    n[0] = pitch;
    n[7] = 1;
    n[8] = step;
    n[9] = count;
    reindexStep(img, t, p, step);
    return s;
  }
  return null;
}

// SequencerGrid::deleteNote: the slot back to the default, step reordered
export function gkDeleteNote(
  img: Uint8Array,
  t: number,
  p: number,
  slot: number,
) {
  const n = gkNote(img, t, p, slot);
  const step = n[8];
  n.set(NOTE_DEFAULT);
  reindexStep(img, t, p, step);
}

// move a note to another step / pitch; false if the target is taken or full
export function gkMoveNote(
  img: Uint8Array,
  t: number,
  p: number,
  slot: number,
  step: number,
  pitch: number,
): boolean {
  const n = gkNote(img, t, p, slot);
  const from = n[8];
  const others = gkNotes(img, t, p).filter((x) => x.slot !== slot);
  if (others.some((x) => x.step === step && x.pitch === pitch)) return false;
  if (
    step !== from &&
    others.filter((x) => x.step === step).length >= GK_PER_STEP
  )
    return false;
  n[0] = pitch;
  if (step !== from) {
    n[8] = step;
    n[9] = GK_PER_STEP;
    reindexStep(img, t, p, from);
    reindexStep(img, t, p, step);
  }
  return true;
}

// the note a lane shows for a step: highest pitch (noteAtStepColumn)
export function gkNoteAtStep(
  img: Uint8Array,
  t: number,
  p: number,
  step: number,
): number | null {
  let best: GkNoteRef | null = null;
  for (const n of gkNotes(img, t, p))
    if (n.step === step && (!best || n.pitch > best.pitch)) best = n;
  return best ? best.slot : null;
}

// step on bits (SequencerIndex)
export function gkStepOn(img: Uint8Array, t: number, p: number, step: number) {
  const o = gkPatternOff(t, p) + GK_PATTERN_AT.stepPages + (step >> 4) * 2;
  return (((img[o] | (img[o + 1] << 8)) >> (step & 15)) & 1) === 1;
}
export function gkToggleStep(
  img: Uint8Array,
  t: number,
  p: number,
  step: number,
) {
  const o =
    gkPatternOff(t, p) +
    GK_PATTERN_AT.stepPages +
    (step >> 4) * 2 +
    ((step & 15) >> 3);
  img[o] ^= 1 << (step & 7);
}

// drum hits
export const gkHitOff = (p: number, voice: number, step: number) =>
  gkDrumPatternOff(p) + GK_DRUM_AT.hits + voice * 64 + step;
export const gkMicroOff = (p: number, voice: number, step: number) =>
  gkDrumPatternOff(p) + GK_DRUM_AT.micro + voice * 64 + step;
export const gkBit = (img: Uint8Array, o: number, i: number) =>
  ((img[o + (i >> 3)] >> (i & 7)) & 1) === 1;
export const gkFlipBit = (img: Uint8Array, o: number, i: number) =>
  void (img[o + (i >> 3)] ^= 1 << (i & 7));

// DrumGrid::applyPaint: a new hit has no micro-timing
export function gkToggleHit(
  img: Uint8Array,
  p: number,
  voice: number,
  step: number,
) {
  const o = gkHitOff(p, voice, step);
  img[o] = img[o] & 1 ? 0 : 1;
  img[gkMicroOff(p, voice, step)] = 0;
}

// matrix: does a pattern hold anything
export function gkPatternUsed(img: Uint8Array, t: number, p: number): boolean {
  if (t === GK_TRACKS) {
    const o = gkDrumPatternOff(p) + GK_DRUM_AT.hits;
    return img.subarray(o, o + GK_VOICES * 64).some((b) => b & 1);
  }
  return gkNotes(img, t, p).length > 0;
}

const patternRange = (t: number, p: number): [number, number] =>
  t === GK_TRACKS
    ? [gkDrumPatternOff(p), gkDrumPatternOff(p) + 1410]
    : [gkPatternOff(t, p), gkPatternOff(t, p) + 1558];

export const gkCopyPattern = (img: Uint8Array, t: number, p: number) =>
  img.slice(...patternRange(t, p));
export function gkPastePattern(
  img: Uint8Array,
  t: number,
  p: number,
  d: Uint8Array,
) {
  const [a, b] = patternRange(t, p);
  if (d.length === b - a) img.set(d, a);
}
export function gkClearPattern(img: Uint8Array, t: number, p: number) {
  const [a] = patternRange(t, p);
  img.set(
    t === GK_TRACKS ? DRUM_PATTERN_DEFAULT() : TRACK_PATTERN_DEFAULT(),
    a,
  );
}

// ---- ProjectData::resetToDefault ------------------------------------------

function TRACK_PATTERN_DEFAULT(): Uint8Array {
  const d = new Uint8Array(1558);
  d.set([0x10, 1, 0, 1, 7, 0, 4], GK_PATTERN_AT.length);
  for (let s = 0; s < GK_NOTES; s++)
    d.set(NOTE_DEFAULT, GK_PATTERN_AT.notes + s * 12);
  return d;
}

function DRUM_PATTERN_DEFAULT(): Uint8Array {
  const d = new Uint8Array(1410);
  d.fill(0x10, 0, 11); // length, poly lengths
  d[GK_DRUM_AT.probability] = 100;
  d[GK_DRUM_AT.stepSize] = 4;
  d.fill(0xff, GK_DRUM_AT.mute, GK_DRUM_AT.mute + 4);
  d[GK_DRUM_AT.swing] = 50;
  return d;
}

export function gkDefault(): Uint8Array {
  const img = new Uint8Array(GK_SIZE);
  img.set([1, 0, 100, 0, 50, 0], 2); // version 1, bpm 100, swing 50
  for (let r = 0; r < GK_TRACKS + 1; r++)
    for (let s = 0; s < GK_SONGS; s++)
      for (let k = 0; k < GK_SLOTS; k++) img[gkSongOff(r, s, k) + 1] = 1;
  const config = [0x7f, 0, 0, 0, 0, 0, 0x40, 0x40];
  for (let t = 0; t < GK_TRACKS; t++) {
    img[gkTrackOff(t) + GK_TRACK_AT.swing] = 50;
    img.set(config, gkTrackOff(t) + 5);
    for (let p = 0; p < GK_PATTERNS; p++)
      img.set(TRACK_PATTERN_DEFAULT(), gkPatternOff(t, p));
  }
  img[GK_DRUM_OFF + GK_DRUM_TRACK_AT.swing] = 50;
  img.set(config, GK_DRUM_OFF + 2);
  for (let p = 0; p < GK_PATTERNS; p++)
    img.set(DRUM_PATTERN_DEFAULT(), gkDrumPatternOff(p));
  return img;
}

// write item of a pattern / track (GK_ITEMS order of groovekey-seq.ts)
export const gkPatternItem = (t: number, p: number) => 6 + t * 16 + p;
export const gkTrackItem = (t: number) => 1 + t;
