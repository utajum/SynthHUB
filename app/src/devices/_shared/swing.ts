// Behringer Swing: sequencer model + frames, a paced request link, and the
// ControlTribe file formats (docs/SWING-PROTOCOL.md):
//   .swingseq - one sequence, a JUCE ValueTree "Sequence" (CT's seq export)
//   .swing    - project JSON: settings + all 8 sequences (CT's "save"; CT's
//               loader is a stub, so import is ours)
// Frame: F0 00 20 32 7F 42 <cmd> [args] F7. Queries are answered with
// <cmd> + data, every write with an empty <cmd> echo.
import {
  jArr,
  jDouble,
  jInt,
  jNum,
  jProp,
  jStr,
  vtRead,
  vtWrite,
  type JVar,
} from './juce-valuetree';
import { ctDevice, ctOptionValue, type CtControl } from './controltribe';
import type { MidiIO, Progress } from './midi-io';

export const SW_HDR = [0xf0, 0x00, 0x20, 0x32, 0x7f, 0x42];
export const SW_STEPS = 64;
export const SW_POLY = 8; // note slots per step
export const SW_SEQS = 8;

// `len` is the per-note byte of 6E / 71 (the app's "length"); ControlTribe
// treats it as a note attribute (2 Legato, 3 Standard, 4 TieStart,
// 5 TieContinue, 6 TieEnd). Files keep the raw byte.
export interface SwNote {
  note: number;
  vel: number;
  len: number;
}
export interface SwStep {
  ratchet: number; // 1-4 (virgin steps read 0)
  notes: SwNote[];
}
export interface SwSeq {
  len: number; // 0-64 (0 = virgin)
  gate: number; // per-sequence gate % (6F byte 3 / 6D); 0 until first used
  swing: number; // % 50-80; reads 0 until first set (0 is writable)
  steps: SwStep[];
}

export const swFrame = (...body: number[]) =>
  Uint8Array.from([...SW_HDR, ...body.map((b) => b & 0x7f), 0xf7]);

export function swParse(d: Uint8Array): { cmd: number; data: number[] } | null {
  if (d.length < 8 || d[d.length - 1] !== 0xf7) return null;
  for (let i = 0; i < 6; i++) if (d[i] !== SW_HDR[i]) return null;
  return { cmd: d[6], data: Array.from(d.subarray(7, d.length - 1)) };
}

export const swEmptySteps = (): SwStep[] =>
  Array.from({ length: SW_STEPS }, () => ({ ratchet: 1, notes: [] }));
export const swEmptySeq = (): SwSeq => ({
  len: 0,
  gate: 0,
  swing: 0,
  steps: swEmptySteps(),
});

// 71 reply payload: s st ratchet n0..n7 v0..v7 l0..l7 (note 0 = empty slot)
export function swStepFromReply(p: number[]): SwStep {
  const notes: SwNote[] = [];
  for (let i = 0; i < SW_POLY; i++)
    if (p[3 + i] > 0)
      notes.push({ note: p[3 + i], vel: p[11 + i], len: p[19 + i] });
  return { ratchet: p[2], notes };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(v)));
const normRatchet = (r: number) => clamp(r || 1, 1, 4);
const sameNotes = (a: SwNote[], b: SwNote[]) =>
  a.length === b.length &&
  a.every(
    (n, i) => n.note === b[i].note && n.vel === b[i].vel && n.len === b[i].len,
  );

// differences between two sequences as the device sees them (a virgin
// step's ratchet 0 == 1); empty = equal
export function swSeqDiff(a: SwSeq, b: SwSeq): string[] {
  const d: string[] = [];
  if (a.len !== b.len) d.push(`length ${a.len} != ${b.len}`);
  if (a.gate !== b.gate) d.push(`gate ${a.gate} != ${b.gate}`);
  if (a.swing !== b.swing) d.push(`swing ${a.swing} != ${b.swing}`);
  for (let i = 0; i < SW_STEPS; i++) {
    const x = a.steps[i] ?? { ratchet: 1, notes: [] };
    const y = b.steps[i] ?? { ratchet: 1, notes: [] };
    if (!sameNotes(x.notes, y.notes)) d.push(`step ${i + 1} notes`);
    else if (x.notes.length && normRatchet(x.ratchet) !== normRatchet(y.ratchet))
      d.push(`step ${i + 1} ratchet ${x.ratchet} != ${y.ratchet}`);
  }
  return d;
}

// Frames that turn device sequence `s` from `cur` into `next`. A step whose
// notes differ is rewritten (delete all, then add in order: 68 add, 6E len,
// 69 vel - ControlTribe's order). Length goes after the notes (adds
// auto-extend it), then swing and gate (an add to a virgin sequence sets
// gate 60). 6B/6C/6D take 0 too, so a virgin sequence restores exactly.
export function swSeqWriteFrames(s: number, cur: SwSeq, next: SwSeq): Uint8Array[] {
  const fr: Uint8Array[] = [];
  let added = false;
  for (let st = 0; st < SW_STEPS; st++) {
    const a = cur.steps[st] ?? { ratchet: 1, notes: [] };
    const b = next.steps[st] ?? { ratchet: 1, notes: [] };
    const touched = !sameNotes(a.notes, b.notes);
    if (touched) {
      for (const n of a.notes) fr.push(swFrame(0x6a, s, st, n.note));
      for (const n of b.notes.slice(0, SW_POLY)) {
        fr.push(swFrame(0x68, s, st, n.note));
        fr.push(swFrame(0x6e, s, st, n.note, n.len));
        fr.push(swFrame(0x69, s, st, n.note, clamp(n.vel, 1, 127)));
        added = true;
      }
    }
    const r = normRatchet(b.ratchet);
    if (r !== normRatchet(a.ratchet) || (touched && r > 1))
      fr.push(swFrame(0x58, s, st, r));
  }
  if (added || next.len !== cur.len)
    fr.push(swFrame(0x6b, s, clamp(next.len, 0, SW_STEPS)));
  if (next.swing !== cur.swing || added)
    fr.push(swFrame(0x6c, s, clamp(next.swing, 0, 100)));
  if (next.gate !== cur.gate || added)
    fr.push(swFrame(0x6d, s, clamp(next.gate, 0, 100)));
  return fr;
}

// ---- .swingseq (ControlTribe sequence export) -----------------------------
// ValueTree "Sequence" { Swing-0048 length (double), Swing-0049 swing
// (double), Swing-0050 gate ("90%"), name "SeqExp", notes [[row, beat,
// velocity, attr]...] } with row = 127 - note, beat = step (0-based),
// velocity = vel / 127, attr = the raw per-note byte. CT keeps no ratchets;
// ours ride along in an extra "ratchets" property (CT ignores it).

export const SW_SEQ_EXT = 'swingseq';

export function swSeqToFile(q: SwSeq): Uint8Array {
  const notes: JVar[] = [];
  q.steps.forEach((st, i) =>
    st.notes.forEach((n) =>
      notes.push(
        jArr([jInt(127 - n.note), jDouble(i), jDouble(n.vel / 127), jInt(n.len)]),
      ),
    ),
  );
  return vtWrite({
    type: 'Sequence',
    props: [
      ['Swing-0048', jDouble(q.len)],
      ['Swing-0049', jDouble(q.swing)],
      ['Swing-0050', jStr(`${q.gate}%`)],
      ['name', jStr('SeqExp')],
      ['notes', jArr(notes)],
      ['ratchets', jArr(q.steps.map((s) => jInt(s.ratchet)))],
    ],
    children: [],
  });
}

// add a note to a step (8 slots max); false when dropped
function pushNote(steps: SwStep[], st: number, n: SwNote): boolean {
  if (!(st >= 0 && st < SW_STEPS) || !(n.note >= 1 && n.note <= 127)) return false;
  if (steps[st].notes.length >= SW_POLY) return false;
  steps[st].notes.push(n);
  return true;
}

export function swSeqFromFile(bytes: Uint8Array): SwSeq & { dropped: number } {
  const t = vtRead(bytes);
  const q: SwSeq & { dropped: number } = { ...swEmptySeq(), dropped: 0 };
  q.len = clamp(jNum(jProp(t, 'Swing-0048')) ?? 0, 0, SW_STEPS);
  q.swing = clamp(jNum(jProp(t, 'Swing-0049')) ?? 0, 0, 100);
  q.gate = clamp(jNum(jProp(t, 'Swing-0050')) ?? 0, 0, 100);
  const notes = jProp(t, 'notes');
  if (notes?.t === 'array')
    for (const v of notes.v) {
      if (v.t !== 'array') continue;
      const [row, beat, vel, attr] = v.v.map((x) => jNum(x) ?? NaN);
      const ok = pushNote(q.steps, Math.round(beat), {
        note: 127 - Math.round(row),
        vel: clamp(vel * 127, 1, 127),
        len: Number.isFinite(attr) ? clamp(attr, 0, 127) : 3,
      });
      if (!ok) q.dropped++;
    }
  const rat = jProp(t, 'ratchets');
  if (rat?.t === 'array')
    rat.v.forEach((r, i) => {
      if (i < SW_STEPS) q.steps[i].ratchet = clamp(jNum(r) ?? 1, 0, 4);
    });
  return q;
}

// ---- .swing (ControlTribe project JSON) -----------------------------------
// { model "Swing", version "01.00.00", MidiControllerSettings { Swing-00NN:
// combobox text | slider number }, SeqSettings { Seq0..Seq7: { tabindex,
// Swing-0048/49/50, Grid { notes [{ note, beat, velocity 0-127, attribute
// name }] } } } }. Extras CT does not write: per-note "len" (raw byte),
// per-sequence "ratchets", and the two settings CT has no field for.

export const SW_PROJECT_EXT = 'swing';
const ATTR_NAMES = ['Legato', 'Standard', 'TieStart', 'TieContinue', 'TieEnd'];

// CT settings id -> wire cmd, matched by meaning (CT's own GUI enum codes
// are NOT wire commands; the wire map is the hardware-validated one in
// data/controltribe.json). Swing-0008 (sustain "Channel") has no SysEx
// backing; Swing-0034 (SynClockOut) is not exposed by the app.
export const SW_CT_IDS: [string, number][] = [
  ['Swing-0001', 0x07], // UserChannel
  ['Swing-0002', 0x08], // MidiInputChannel
  ['Swing-0003', 0x16], // MidiThru
  ['Swing-0004', 0x09], // SustainPedalMode
  ['Swing-0005', 0x0f], // SustainPedalFunction
  ['Swing-0006', 0x0e], // HoldSwitchMode
  ['Swing-0007', 0x10], // HoldSwitchFunction
  ['Swing-0009', 0x13], // ModWheelMidiCh
  ['Swing-0010', 0x15], // PitchBendMidiCh
  ['Swing-0011', 0x19], // VelocityCurve
  ['Swing-0012', 0x1a], // AftertouchCurve
  ['Swing-0013', 0x20], // SynClockIn (clock mode)
  ['Swing-0014', 0x22], // TapTempoAverage
  ['Swing-0015', 0x25], // ArmToStart
  ['Swing-0016', 0x2c], // TieMode
  ['Swing-0017', 0x2d], // ArpRandom
  ['Swing-0018', 0x23], // SynClockStart
  ['Swing-0019', 0x24], // NextSeq
  ['Swing-0020', 0x28], // TempoKnobMode
  ['Swing-0021', 0x29], // Velocity (as recorded / fixed)
  ['Swing-0022', 0x2a], // FixedVelocity
  ['Swing-0023', 0x27], // TranspInputPort
  ['Swing-0024', 0x21], // TranspInputChannel
  ['Swing-0025', 0x26], // TranspositionLatch
  ['Swing-0026', 0x2b], // TranspCenterPitch
  ['Swing-0027', 0x46], // PitchCvOutput
  ['Swing-0028', 0x4c], // ZvMidiNote (0 V)
  ['Swing-0029', 0x4a], // OvMidiNote (1 V)
  ['Swing-0030', 0x4d], // NotePriority
  ['Swing-0031', 0x4e], // ModCvSource
  ['Swing-0032', 0x4f], // ModCvMaxVoltage
  ['Swing-0033', 0x47], // GateCvOut
  ['Swing-0035', 0x67], // PlayPause
  ['Swing-0036', 0x60], // TransportMode
  ['Swing-0037', 0x61], // StopChannel
  ['Swing-0038', 0x63], // PlayChannel
  ['Swing-0039', 0x62], // RecChannel
  ['Swing-0040', 0x0b], // SustainMessageRangeLow
  ['Swing-0041', 0x0c], // SustainMessageRangeHigh
  ['Swing-0042', 0x0d], // SustainMessageCC
  ['Swing-0043', 0x14], // ModWheelCC
  ['Swing-0044', 0x50], // PitchBendRange (CV pitch range)
  ['Swing-0045', 0x64], // StopCC
  ['Swing-0046', 0x65], // RecCC
  ['Swing-0047', 0x66], // PlayCC
];

const controls = (): CtControl[] => ctDevice('swing')?.controls ?? [];

// CT stores comboboxes as their item text, sliders as numbers
function settingOut(c: CtControl, v: number): string | number {
  if (c.kind !== 'enum' || !c.options) return v;
  const i = c.options.findIndex((_, k) => ctOptionValue(c, k) === v);
  return i >= 0 ? c.options[i] : v;
}

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteFromName(s: string): number | undefined {
  const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(s.trim());
  if (!m) return undefined;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const n = (Number(m[3]) + 2) * 12 + NOTE_PC[m[1].toLowerCase()] + acc;
  return n >= 0 && n <= 127 ? n : undefined;
}

function settingIn(c: CtControl, raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clamp(raw, 0, 127);
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  const i = c.options?.findIndex((o) => o.trim().toLowerCase() === key) ?? -1;
  if (i >= 0) return ctOptionValue(c, i);
  if (c.options?.length === 128) return noteFromName(raw);
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== '' ? clamp(n, 0, 127) : undefined;
}

export interface SwProject {
  settings: Record<number, number>; // wire cmd -> value
  seqs: SwSeq[];
}

export function swProjectToJson(p: SwProject): string {
  const byCmd = new Map(controls().map((c) => [c.cmd, c]));
  const mapped = new Set(SW_CT_IDS.map(([, cmd]) => cmd));
  const mcs: Record<string, string | number> = {};
  for (const [id, cmd] of SW_CT_IDS) {
    const c = byCmd.get(cmd);
    const v = p.settings[cmd];
    if (c && v !== undefined) mcs[id] = settingOut(c, v);
  }
  const extra: Record<string, number> = {};
  for (const [cmd, v] of Object.entries(p.settings))
    if (!mapped.has(+cmd)) extra[`0x${(+cmd).toString(16).padStart(2, '0')}`] = v;
  const seqSettings: Record<string, unknown> = {};
  p.seqs.forEach((q, k) => {
    const notes: unknown[] = [];
    q.steps.forEach((st, i) =>
      st.notes.forEach((n) =>
        notes.push({
          note: n.note,
          beat: i,
          velocity: n.vel,
          attribute: ATTR_NAMES[n.len - 2] ?? '',
          len: n.len,
        }),
      ),
    );
    seqSettings[`Seq${k}`] = {
      tabindex: k,
      'Swing-0048': q.len,
      'Swing-0049': q.swing,
      'Swing-0050': `${q.gate}%`,
      Grid: { notes },
      ratchets: q.steps.map((s) => s.ratchet),
    };
  });
  return JSON.stringify(
    {
      model: 'Swing',
      version: '01.00.00',
      MidiControllerSettings: mcs,
      SeqSettings: seqSettings,
      extraSettings: extra,
    },
    null,
    2,
  );
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function swProjectFromJson(text: string): SwProject & { dropped: number } {
  const j: unknown = JSON.parse(text);
  if (!isObj(j) || (j.model !== undefined && j.model !== 'Swing'))
    throw new Error('not a Swing project (.swing)');
  const byCmd = new Map(controls().map((c) => [c.cmd, c]));
  const settings: Record<number, number> = {};
  const mcs = isObj(j.MidiControllerSettings) ? j.MidiControllerSettings : {};
  for (const [id, cmd] of SW_CT_IDS) {
    const c = byCmd.get(cmd);
    const v = c && id in mcs ? settingIn(c, mcs[id]) : undefined;
    if (v !== undefined) settings[cmd] = v;
  }
  if (isObj(j.extraSettings))
    for (const [k, v] of Object.entries(j.extraSettings)) {
      const cmd = parseInt(k, 16);
      const n = num(v);
      if (byCmd.has(cmd) && n !== undefined) settings[cmd] = clamp(n, 0, 127);
    }
  const seqs: SwSeq[] = [];
  let dropped = 0;
  const ss = isObj(j.SeqSettings) ? j.SeqSettings : {};
  for (let k = 0; k < SW_SEQS; k++) {
    const o = ss[`Seq${k}`];
    const q = swEmptySeq();
    if (isObj(o)) {
      q.len = clamp(num(o['Swing-0048']) ?? 0, 0, SW_STEPS);
      q.swing = clamp(num(o['Swing-0049']) ?? 0, 0, 100);
      q.gate = clamp(num(o['Swing-0050']) ?? 0, 0, 100);
      const notes = isObj(o.Grid) && Array.isArray(o.Grid.notes) ? o.Grid.notes : [];
      for (const n of notes) {
        if (!isObj(n)) continue;
        const attr = ATTR_NAMES.indexOf(String(n.attribute ?? ''));
        const ok = pushNote(q.steps, Math.round(num(n.beat) ?? -1), {
          note: Math.round(num(n.note) ?? 0),
          vel: clamp(num(n.velocity) ?? 100, 1, 127),
          len: clamp(num(n.len) ?? (attr >= 0 ? attr + 2 : 3), 0, 127),
        });
        if (!ok) dropped++;
      }
      if (Array.isArray(o.ratchets))
        o.ratchets.forEach((r, i) => {
          if (i < SW_STEPS) q.steps[i].ratchet = clamp(num(r) ?? 1, 0, 4);
        });
    }
    seqs.push(q);
  }
  return { settings, seqs, dropped };
}

// ---- paced link -------------------------------------------------------------

export interface SwOpts {
  progress?: Progress;
  signal?: AbortSignal;
}

export class SwingLink {
  private tail: Promise<unknown> = Promise.resolve();
  private io: MidiIO;
  private timeoutMs: number;

  constructor(io: MidiIO, timeoutMs = 400) {
    this.io = io;
    this.timeoutMs = timeoutMs;
  }

  // Send one frame; resolve with the payload (bytes after <cmd>) of the first
  // reply echoing <cmd> that satisfies `match`. Strictly serialised.
  request(frame: Uint8Array, match: (p: number[]) => boolean): Promise<number[]> {
    const cmd = frame[6];
    const run = () =>
      new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error(`swing: no reply to ${cmd.toString(16)}`));
        }, this.timeoutMs);
        const off = this.io.listen((b) => {
          const m = swParse(b);
          if (!m || m.cmd !== cmd || !match(m.data)) return;
          clearTimeout(timer);
          off();
          resolve(m.data);
        });
        this.io.send(frame);
      });
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => undefined);
    return p;
  }

  // query: the reply echoes the arguments, then carries data (one retry)
  async query(cmd: number, ...args: number[]): Promise<number[]> {
    const f = swFrame(cmd, ...args);
    const m = (p: number[]) =>
      p.length > args.length && args.every((a, i) => p[i] === a);
    try {
      return await this.request(f, m);
    } catch {
      return this.request(f, m);
    }
  }

  // write: acked by an empty echo. No retry - a note add is not idempotent.
  async write(frame: Uint8Array): Promise<void> {
    await this.request(frame, (p) => p.length === 0);
  }

  // unacknowledged frame (72 store): send in turn, then give it `ms`
  send(frame: Uint8Array, ms = 100): Promise<void> {
    const run = () =>
      new Promise<void>((resolve) => {
        this.io.send(frame);
        setTimeout(resolve, ms);
      });
    const p = this.tail.then(run, run);
    this.tail = p;
    return p;
  }

  async readSeq(s: number, o: SwOpts = {}): Promise<SwSeq> {
    const [, len, gate, swing] = await this.query(0x6f, s);
    const steps: SwStep[] = [];
    for (let st = 0; st < SW_STEPS; st++) {
      o.signal?.throwIfAborted();
      steps.push(swStepFromReply(await this.query(0x71, s, st)));
      o.progress?.(st + 1, SW_STEPS);
    }
    return { len, gate, swing, steps };
  }

  // rewrite sequence `s` (currently `cur`) as `next`; returns frames sent
  async writeSeq(s: number, cur: SwSeq, next: SwSeq, o: SwOpts = {}): Promise<number> {
    const frames = swSeqWriteFrames(s, cur, next);
    for (let i = 0; i < frames.length; i++) {
      o.signal?.throwIfAborted();
      await this.write(frames[i]);
      o.progress?.(i + 1, frames.length);
    }
    return frames.length;
  }

  async readSettings(cmds: number[], o: SwOpts = {}): Promise<Record<number, number>> {
    const out: Record<number, number> = {};
    for (let i = 0; i < cmds.length; i++) {
      o.signal?.throwIfAborted();
      out[cmds[i]] = (await this.query(cmds[i]))[0];
      o.progress?.(i + 1, cmds.length);
    }
    return out;
  }

  // write settings that differ from `cur`, then store them to flash (72 00,
  // never acknowledged); returns the number written
  async writeSettings(
    next: Record<number, number>,
    cur: Record<number, number>,
    o: SwOpts = {},
  ): Promise<number> {
    const todo = Object.keys(next)
      .map(Number)
      .filter((c) => next[c] !== cur[c]);
    for (let i = 0; i < todo.length; i++) {
      o.signal?.throwIfAborted();
      await this.write(swFrame(todo[i], next[todo[i]]));
      o.progress?.(i + 1, todo.length);
    }
    if (todo.length) await this.send(swFrame(0x72, 0));
    return todo.length;
  }
}
