// Framework-agnostic step-sequencer engine: drum + mono modes, per-step
// velocity/gate/probability/ratchet/accent/slide, playback directions, swing,
// pattern/bank slots, and MIDI recording from any input. Playback drives the
// synth via MIDI note on/off; device pattern SysEx sync is layered on top.
import { midi } from './midi/webmidi';

type SeqMode = 'drum' | 'mono';
export type Direction = 'fwd' | 'rev' | 'pingpong' | 'random';

export interface Step {
  on: boolean;
  note: number;
  velocity: number;
  gate: number; // fraction of a step (0.1..2); >1 ties into next
  probability: number; // 0..100
  ratchet: number; // 1..8
  accent: boolean;
  slide: boolean;
}

export interface DrumCell {
  on: boolean;
  velocity: number;
  ratchet: number;
  probability: number;
  accent: boolean;
}

export interface SeqRow {
  label: string;
  note: number;
  muted?: boolean;
}

export interface SequencerState {
  mode: SeqMode;
  length: number;
  maxSteps: number;
  tempo: number;
  swing: number;
  channel: number;
  direction: Direction;
  // current pattern slot within the bank (0-based) and how many exist
  pattern: number;
  patternCount: number;
  // current bank/song (0-based); 1 = no bank dimension
  bank: number;
  bankCount: number;
  // display labels from the device config (e.g. "PATTERN", "SONG")
  patternLabel: string;
  bankLabel?: string;
  // per-index display names (e.g. TD-3 "1A".."8B"); 1-based numbers if absent
  patternNames?: string[];
  bankNames?: string[];
  // true when the active slot has edits not yet synced with the device
  dirty: boolean;
  playing: boolean;
  recording: boolean;
  playhead: number;
  recCursor: number;
  outputId?: string;
  recInputId?: string;
  recInputName?: string;
  // timestamp (ms) of the last received MIDI note, for the activity LED
  recActivity: number;
  // last received MIDI note/velocity while recording
  recLastNote: number;
  recLastVelocity: number;
  rows: SeqRow[];
  drum: DrumCell[][]; // [row][step]
  steps: Step[]; // mono
}

type StateListener = (s: SequencerState) => void;

export function defaultStep(note = 48): Step {
  return {
    on: false,
    note,
    velocity: 100,
    gate: 0.6,
    probability: 100,
    ratchet: 1,
    accent: false,
    slide: false,
  };
}
function defaultCell(): DrumCell {
  return {
    on: false,
    velocity: 100,
    ratchet: 1,
    probability: 100,
    accent: false,
  };
}

const ACCENT_BOOST = 27;

const NOTE_NAMES = [
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

// "C#4" style display name for a MIDI note number
export function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export class Sequencer {
  private st: SequencerState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<StateListener>();
  private ppDir = 1; // ping-pong direction
  private recUnsub: (() => void) | null = null;
  // absolute time the next tick is due; scheduling against this (not chained
  // relative timeouts) keeps long playback from drifting
  private nextAt = 0;
  // pending note timers (ratchets / note-offs / record feedback), cleared on
  // stop so no note-on fires after "all notes off"
  private pending = new Set<ReturnType<typeof setTimeout>>();

  private schedule(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.pending.delete(id);
      fn();
    }, ms);
    this.pending.add(id);
  }
  private clearPending() {
    for (const id of this.pending) clearTimeout(id);
    this.pending.clear();
  }

  constructor(
    mode: SeqMode,
    maxSteps: number,
    rows: SeqRow[] = [],
    opts: {
      patternCount?: number;
      bankCount?: number;
      patternLabel?: string;
      bankLabel?: string;
      patternNames?: string[];
      bankNames?: string[];
    } = {},
  ) {
    this.st = {
      mode,
      length: Math.min(16, maxSteps),
      maxSteps,
      tempo: 120,
      swing: 0,
      channel: 0,
      direction: 'fwd',
      pattern: 0,
      patternCount: Math.max(1, opts.patternCount ?? 1),
      bank: 0,
      bankCount: Math.max(1, opts.bankCount ?? 1),
      patternLabel: opts.patternLabel ?? 'pattern',
      bankLabel: opts.bankLabel,
      patternNames: opts.patternNames,
      bankNames: opts.bankNames,
      dirty: false,
      playing: false,
      recording: false,
      playhead: -1,
      recCursor: 0,
      recActivity: 0,
      recLastNote: -1,
      recLastVelocity: 0,
      rows,
      drum: rows.map(() => Array.from({ length: maxSteps }, defaultCell)),
      steps: Array.from({ length: maxSteps }, () => defaultStep()),
    };
  }

  get snapshot(): SequencerState {
    return this.st;
  }
  subscribe(l: StateListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    this.st = { ...this.st };
    for (const l of this.listeners) l(this.st);
  }

  patch(p: Partial<SequencerState>) {
    // length is part of the wire body, so changing it is an edit;
    // tempo/swing/channel/direction are local playback settings
    if ('length' in p && p.length !== this.st.length) this.st.dirty = true;
    Object.assign(this.st, p);
    this.emit();
  }
  setOutput(id: string | undefined) {
    this.st.outputId = id;
  }

  // Pattern banks: content is stored per (bank, pattern) slot. The active
  // slot lives in st.drum/st.steps/st.length; others are stashed here.
  // Switching saves the active slot and loads the target.
  private slots = new Map<
    number,
    { drum: DrumCell[][]; steps: Step[]; length: number }
  >();
  private slotKey(bank = this.st.bank, pattern = this.st.pattern): number {
    return bank * this.st.patternCount + pattern;
  }
  private captureSlot() {
    return {
      drum: this.st.drum.map((row) => row.map((c) => ({ ...c }))),
      steps: this.st.steps.map((s) => ({ ...s })),
      length: this.st.length,
    };
  }
  private freshSlot() {
    return {
      drum: this.st.rows.map(() =>
        Array.from({ length: this.st.maxSteps }, defaultCell),
      ),
      steps: Array.from({ length: this.st.maxSteps }, () => defaultStep()),
      length: Math.min(16, this.st.maxSteps),
    };
  }
  // switch the active bank/pattern slot (stash current, load target)
  selectSlot(bank: number, pattern: number) {
    bank = Math.max(0, Math.min(this.st.bankCount - 1, bank));
    pattern = Math.max(0, Math.min(this.st.patternCount - 1, pattern));
    if (bank === this.st.bank && pattern === this.st.pattern) return;
    this.slots.set(this.slotKey(), this.captureSlot());
    const slot =
      this.slots.get(this.slotKey(bank, pattern)) ?? this.freshSlot();
    this.st.bank = bank;
    this.st.pattern = pattern;
    this.st.drum = slot.drum.map((row) => row.map((c) => ({ ...c })));
    this.st.steps = slot.steps.map((s) => ({ ...s }));
    this.st.length = slot.length;
    this.emit();
  }

  // editing

  private touch() {
    this.st.dirty = true;
  }
  // call after a device read/write so the dirty guard knows the slot is synced
  markClean() {
    if (!this.st.dirty) return;
    this.st.dirty = false;
    this.emit();
  }
  toggleCell(row: number, step: number) {
    const c = this.st.drum[row][step];
    this.st.drum[row][step] = { ...c, on: !c.on };
    this.touch();
    this.emit();
  }
  patchCell(row: number, step: number, p: Partial<DrumCell>) {
    this.st.drum[row][step] = { ...this.st.drum[row][step], ...p };
    this.touch();
    this.emit();
  }
  patchStep(step: number, p: Partial<Step>) {
    this.st.steps[step] = { ...this.st.steps[step], ...p };
    this.touch();
    this.emit();
  }
  // batch mono edit: per-step patches applied in one emit
  applyMono(patches: (Partial<Step> | null)[]) {
    this.st.steps = this.st.steps.map((s, i) =>
      patches[i] ? { ...s, ...patches[i] } : s,
    );
    this.touch();
    this.emit();
  }
  // batch drum-row edit: per-step patches applied in one emit
  applyRow(row: number, patches: (Partial<DrumCell> | null)[]) {
    if (!this.st.drum[row]) return;
    this.st.drum[row] = this.st.drum[row].map((c, i) =>
      patches[i] ? { ...c, ...patches[i] } : c,
    );
    this.touch();
    this.emit();
  }
  toggleMute(row: number) {
    this.st.rows = this.st.rows.map((r, i) =>
      i === row ? { ...r, muted: !r.muted } : r,
    );
    this.emit();
  }

  clear() {
    this.st.drum = this.st.rows.map(() =>
      Array.from({ length: this.st.maxSteps }, defaultCell),
    );
    this.st.steps = this.st.steps.map((s) => ({ ...s, on: false }));
    this.touch();
    this.emit();
  }

  randomize(density = 0.35) {
    if (this.st.mode === 'drum') {
      this.st.drum = this.st.drum.map((row) =>
        row.map((c, step) =>
          step < this.st.length
            ? { ...c, on: Math.random() < density }
            : { ...c, on: false },
        ),
      );
    } else {
      const scale = [0, 2, 3, 5, 7, 8, 10];
      this.st.steps = this.st.steps.map((s, step) => {
        if (step >= this.st.length) return { ...s, on: false };
        const on = Math.random() < density + 0.25;
        const oct = 36 + 12 * Math.floor(Math.random() * 3);
        return {
          ...s,
          on,
          note: oct + scale[Math.floor(Math.random() * scale.length)],
          accent: Math.random() < 0.2,
          slide: Math.random() < 0.15,
        };
      });
    }
    this.touch();
    this.emit();
  }

  shift(dir: -1 | 1) {
    const n = this.st.length;
    const rot = <T>(arr: T[]) => {
      const head = arr.slice(0, n);
      const tail = arr.slice(n);
      const shifted =
        dir === 1
          ? [head[n - 1], ...head.slice(0, n - 1)]
          : [...head.slice(1), head[0]];
      return [...shifted, ...tail];
    };
    if (this.st.mode === 'drum') this.st.drum = this.st.drum.map(rot);
    else this.st.steps = rot(this.st.steps);
    this.touch();
    this.emit();
  }

  // timing
  private stepMs(step: number): number {
    const quarter = 60000 / this.st.tempo;
    const base = quarter / 4; // 16th
    const s = this.st.swing;
    return step % 2 === 1 ? base * (1 + s) : base * (1 - s);
  }

  private advance(): number {
    const n = this.st.length;
    let h = this.st.playhead;
    switch (this.st.direction) {
      case 'fwd':
        return (h + 1) % n;
      case 'rev':
        return (h - 1 + n) % n;
      case 'random':
        return Math.floor(Math.random() * n);
      case 'pingpong': {
        if (h + this.ppDir >= n) this.ppDir = -1;
        else if (h + this.ppDir < 0) this.ppDir = 1;
        return h + this.ppDir;
      }
    }
  }

  // MIDI out
  private out(bytes: number[]) {
    if (this.st.outputId) midi.send(this.st.outputId, Uint8Array.from(bytes));
  }
  private noteOn(n: number, v: number) {
    this.out([0x90 | this.st.channel, n & 0x7f, v & 0x7f]);
  }
  private noteOff(n: number) {
    this.out([0x80 | this.st.channel, n & 0x7f, 0]);
  }

  private fireRatchet(
    note: number,
    vel: number,
    count: number,
    stepDur: number,
  ) {
    const slice = stepDur / count;
    for (let i = 0; i < count; i++) {
      this.schedule(() => this.noteOn(note, vel), i * slice);
      this.schedule(
        () => this.noteOff(note),
        i * slice + Math.min(slice * 0.8, 40),
      );
    }
  }

  // transport
  start() {
    if (this.st.playing) return;
    this.st.playing = true;
    this.st.playhead = this.st.direction === 'rev' ? this.st.length : -1;
    this.ppDir = 1;
    this.nextAt = performance.now();
    this.emit();
    this.tick();
  }
  stop() {
    this.st.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // kill scheduled note events BEFORE all-notes-off, or a late ratchet
    // timer re-triggers a stuck note
    this.clearPending();
    this.out([0xb0 | this.st.channel, 0x7b, 0x00]); // all notes off
    this.st.playhead = -1;
    this.emit();
  }
  toggle() {
    this.st.playing ? this.stop() : this.start();
  }

  private tick = () => {
    if (!this.st.playing) return;
    const step = this.advance();
    this.st.playhead = step;
    const dur = this.stepMs(step);

    if (this.st.mode === 'drum') {
      this.st.rows.forEach((row, r) => {
        if (row.muted) return;
        const c = this.st.drum[r][step];
        if (!c.on) return;
        if (Math.random() * 100 > c.probability) return;
        const vel = Math.min(127, c.velocity + (c.accent ? ACCENT_BOOST : 0));
        this.fireRatchet(row.note, vel, c.ratchet, dur);
      });
    } else {
      const s = this.st.steps[step];
      if (s.on && Math.random() * 100 <= s.probability) {
        const vel = Math.min(127, s.velocity + (s.accent ? ACCENT_BOOST : 0));
        // slide holds the note past the next step's note-on so mono synths
        // (hardware and virtual) play legato and glide the pitch
        const gate = s.slide ? Math.max(s.gate, 1.3) : s.gate;
        if (s.ratchet > 1) {
          this.fireRatchet(s.note, vel, s.ratchet, dur);
        } else {
          // single hit: the gate note-off rules (no fixed ratchet cutoff)
          this.noteOn(s.note, vel);
        }
        this.schedule(() => this.noteOff(s.note), Math.max(20, dur * gate));
      }
    }
    this.emit();
    // drift-free: aim at the absolute next-step time
    this.nextAt += dur;
    const delay = Math.max(0, this.nextAt - performance.now());
    this.timer = setTimeout(this.tick, delay);
  };

  // live input (on-screen / QWERTY piano): plays through the output and is
  // captured by the recorder when armed, exactly like an external MIDI input
  playNote(note: number, velocity = 100) {
    if (this.st.recording) this.recordNote(note, velocity);
    else this.noteOn(note, velocity);
  }
  releaseNote(note: number) {
    if (this.st.recording) this.recordNoteOff(note);
    this.noteOff(note);
  }

  // recording (any MIDI input)
  private noteStart = new Map<number, { t: number; step: number }>();

  armRecord(inputId: string, inputName: string) {
    this.disarmRecord();
    this.st.recInputId = inputId;
    this.st.recInputName = inputName;
    this.st.recording = true;
    this.st.recCursor = 0;
    this.noteStart.clear();
    this.recUnsub = midi.onMessage((data, src) => {
      if (src.id !== inputId) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const vel = data[2];
      if (status === 0x90 && vel > 0) {
        this.recordNote(note, vel);
      } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
        this.recordNoteOff(note);
      }
    });
    this.emit();
  }
  // arm step-recording from the on-screen/QWERTY piano (no MIDI input tap)
  armLocalRecord() {
    this.disarmRecord();
    this.st.recInputId = undefined;
    this.st.recInputName = 'KEYS';
    this.st.recording = true;
    this.st.recCursor = 0;
    this.noteStart.clear();
    this.emit();
  }
  disarmRecord() {
    if (this.recUnsub) this.recUnsub();
    this.recUnsub = null;
    this.st.recording = false;
    this.emit();
  }

  private recordNote(note: number, velocity: number) {
    const target = this.st.playing ? this.st.playhead : this.st.recCursor;
    if (target < 0) return;
    // activity indicator
    this.st.recActivity = Date.now();
    this.st.recLastNote = note;
    this.st.recLastVelocity = velocity;
    this.noteStart.set(note, { t: performance.now(), step: target });

    if (this.st.mode === 'drum') {
      // map the note to its voice row; unmatched notes are ignored (activity
      // still shows) instead of being dumped onto row 0
      const r = this.st.rows.findIndex((row) => row.note === note);
      if (r < 0) {
        this.emit();
        return;
      }
      this.st.drum[r][target] = {
        ...this.st.drum[r][target],
        on: true,
        velocity,
        accent: velocity > 110,
      };
    } else {
      this.st.steps[target] = {
        ...this.st.steps[target],
        on: true,
        note,
        velocity,
        accent: velocity > 110,
      };
    }
    this.touch();
    // audible feedback through the output
    this.noteOn(note, velocity);
    this.schedule(() => this.noteOff(note), 120);
    if (!this.st.playing) {
      this.st.recCursor = (this.st.recCursor + 1) % this.st.length;
    }
    this.emit();
  }

  // on note-off, translate the held duration into the step's gate length
  private recordNoteOff(note: number) {
    const info = this.noteStart.get(note);
    this.noteStart.delete(note);
    if (!info || this.st.mode !== 'mono') return;
    const heldMs = performance.now() - info.t;
    const stepMs = this.stepMs(info.step) || 125;
    const gate = Math.max(0.1, Math.min(2, heldMs / stepMs));
    const s = this.st.steps[info.step];
    if (s && s.on) {
      this.st.steps[info.step] = { ...s, gate };
      this.touch();
      this.emit();
    }
  }

  // pattern-library interchange: deep-copy of the active slot's content
  contentSnapshot(): SlotContent {
    return this.captureSlot();
  }
  // load slot content (sanitized against the current geometry) into the
  // active slot; ignores content that does not fit
  loadContent(c: Partial<SlotContent>) {
    const clean = this.sanitizeSlot({
      drum: c.drum ?? [],
      steps: c.steps ?? [],
      length: c.length ?? this.st.length,
    });
    if (!clean) return;
    this.st.drum = clean.drum;
    this.st.steps = clean.steps;
    this.st.length = clean.length;
    this.touch();
    this.emit();
  }

  // persistence

  // snapshot playback settings + slot contents (ports/transport excluded)
  serialize(): PersistedSequence {
    const slots: PersistedSequence['slots'] = {};
    for (const [key, slot] of this.slots) slots[key] = slot;
    // include the ACTIVE slot's live content
    slots[this.slotKey()] = this.captureSlot();
    return {
      v: 1,
      tempo: this.st.tempo,
      swing: this.st.swing,
      channel: this.st.channel,
      direction: this.st.direction,
      bank: this.st.bank,
      pattern: this.st.pattern,
      dirty: this.st.dirty,
      slots,
    };
  }

  // restore a serialize() snapshot; content is validated against the current
  // geometry so stale saves cannot corrupt the grid
  restore(p: PersistedSequence) {
    if (!p || p.v !== 1) return;
    this.st.tempo = clampNum(p.tempo, 30, 300, 120);
    this.st.swing = clampNum(p.swing, 0, 0.75, 0);
    this.st.channel = clampNum(p.channel, 0, 15, 0);
    if (['fwd', 'rev', 'pingpong', 'random'].includes(p.direction)) {
      this.st.direction = p.direction;
    }
    this.slots.clear();
    for (const [key, slot] of Object.entries(p.slots ?? {})) {
      const k = Number(key);
      if (!Number.isInteger(k) || k < 0) continue;
      if (k >= this.st.bankCount * this.st.patternCount) continue;
      const clean = this.sanitizeSlot(slot);
      if (clean) this.slots.set(k, clean);
    }
    const bank = clampNum(p.bank, 0, this.st.bankCount - 1, 0);
    const pattern = clampNum(p.pattern, 0, this.st.patternCount - 1, 0);
    this.st.bank = bank;
    this.st.pattern = pattern;
    const active = this.slots.get(this.slotKey()) ?? this.freshSlot();
    this.st.drum = active.drum.map((row) => row.map((c) => ({ ...c })));
    this.st.steps = active.steps.map((s) => ({ ...s }));
    this.st.length = active.length;
    this.st.dirty = !!p.dirty;
    this.emit();
  }

  // shape-check one persisted slot against the current grid geometry
  private sanitizeSlot(
    slot: PersistedSequence['slots'][number],
  ): { drum: DrumCell[][]; steps: Step[]; length: number } | null {
    if (!slot || !Array.isArray(slot.steps) || !Array.isArray(slot.drum)) {
      return null;
    }
    const n = this.st.maxSteps;
    const steps = Array.from({ length: n }, (_, i) => ({
      ...defaultStep(),
      ...(slot.steps[i] ?? {}),
    }));
    const drum = this.st.rows.map((_, r) =>
      Array.from({ length: n }, (_, i) => ({
        ...defaultCell(),
        ...(slot.drum[r]?.[i] ?? {}),
      })),
    );
    return {
      drum,
      steps,
      length: clampNum(slot.length, 1, n, Math.min(16, n)),
    };
  }

  dispose() {
    this.stop();
    this.disarmRecord();
    this.clearPending();
    this.listeners.clear();
  }
}

// one slot's editable content (pattern-library interchange unit)
export interface SlotContent {
  drum: DrumCell[][];
  steps: Step[];
  length: number;
}

// JSON-safe snapshot of a sequencer's editable content
interface PersistedSequence {
  v: 1;
  tempo: number;
  swing: number;
  channel: number;
  direction: Direction;
  bank: number;
  pattern: number;
  dirty: boolean;
  slots: Record<number, { drum: DrumCell[][]; steps: Step[]; length: number }>;
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.max(min, Math.min(max, n));
}
