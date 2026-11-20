// BCR32 Zaquencer host link (Control Tribe 1.12.4 BCR32ZaqSync,
// BCR32::ZaqHost, BCR32ZaqLaneEditor, BCR32ZaqDrumGrid). Firmware 1.0.3+.
// Frame F0 00 20 32 7F 64 <cmd> <op> ..; op 00 state, 01 read, 02 write.
//   44 <op> <track> <step> <lane> [v]  one step: lane 0-8, 10-1F drum voice
//   45 01 <track> <lane>               a lane of 32 steps
//   46 <op> <track> <param> [v]        track param 00-2F
//   47 <op> <param> [v]                global param 0-F
//   48 00 | 48 02 <v>                  state | load preset (page * 16 + n)
// v = <flags> <hi> <lo>, signed 16-bit. A reply repeats the request, then a
// status (0 / 1 ok, 2 refused) and the value; 45 carries 32 big-endian
// int16 and 48 00 five bytes, 8-to-7 packed (a header byte, bit k = the
// MSB of data byte k).
import { midi } from '../../lib/midi/webmidi';
import { BCR_HDR } from './bcr32';

export const ZAQ_TRACKS = 4;
export const ZAQ_STEPS = 32;
export const ZAQ_LANES = 9;
export const ZAQ_VOICES = 16;
export const ZAQ_PAGES = 12;

// lane editor buttons (BCR32ZaqLaneEditor::lanes): label, lane
export const ZAQ_LANE_EDIT: [string, number][] = [
  ['Pitch', 0],
  ['Velocity', 1],
  ['Length', 4],
  ['Delay', 3],
  ['Ctrl A', 5],
  ['Ctrl B', 6],
  ['Chord', 7],
];
// toggle rows; on a drum track lane 7 is the voice mask (bit = voice)
export const LANE_MUTE = 2;
export const LANE_SKIP = 8;
export const LANE_DRUM = 7;

// track params (BCR32Zaquencer::buildTrack, BCR32ZaqSync::apply)
export const TP = {
  start: 0,
  length: 1,
  offset: 2,
  divider: 3,
  shuffleEven: 4,
  shuffleOdd: 5,
  direction: 6,
  mute: 7,
  ctrlA: 0x0b,
  ctrlB: 0x0c,
  mode: 0x0d, // 1 = drum track
  voiceNote: 0x10, // + voice
  voiceMute: 0x20, // + voice
} as const;
// global params (BCR32Zaquencer::buildGeneral, writeThru)
export const GP = { tempo: 0, thru: 3, noteDisplay: 4, chainPlay: 10 } as const;

// prettier-ignore
export const ZAQ_DIVIDERS = [
  '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/24', '1/12', '1/6', '1/3',
];
const DIVIDER_TICKS = [96, 48, 24, 12, 6, 3, 4, 8, 16, 32];
// prettier-ignore
export const ZAQ_DIRECTIONS = [
  'Forward', 'Reverse', 'Ping-Pong', 'Random', 'Pendulum',
];
// prettier-ignore
export const ZAQ_LENGTHS = [
  '1/96', '1/24', '1/32', '1/12', '1/16', '1/6', '1/8', '1/3', '1/4', '2/3',
  '1/2', '1/3', '1/1', '2/3', '2/1', '4/1',
];
// ctrl type: -6..-1 these, 0-127 a CC number
// prettier-ignore
export const ZAQ_CTRL_TYPES = [
  'DELAY', 'RATCHET', 'OFF', 'PROG CH', 'AFT TCH', 'PITCH BEND',
];
export const ZAQ_NOTE_DISPLAY = ['OcMi', 'OcNa', 'AlMi', 'AlNa'];
export const ZAQ_THRU_SOURCES = ['OFF', 'MIDI IN', 'USB IN'];
// prettier-ignore
export const ZAQ_THRU_DESTS: [string, number][] = [
  ['OFF', 0], ['F A', 1], ['F B', 2], ['F AB', 3], ['A', 9], ['B', 10],
  ['AB', 11],
];

export const zaqCtrlName = (v: number) =>
  v < 0 ? (ZAQ_CTRL_TYPES[v + 6] ?? String(v)) : `CC ${v}`;

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const zaqNote = (v: number) =>
  NOTES[((v % 12) + 12) % 12] + (Math.trunc(v / 12) - 2);

// BCR32ZaqLaneEditor::format
export function zaqFormat(lane: number, v: number): string {
  if (lane === 0) return zaqNote(v);
  if (lane === 4) return ZAQ_LENGTHS[v] ?? String(v);
  if (lane === 5 || lane === 6) return v < 0 ? '--' : String(v);
  if (lane === 7) return v === 0 ? '--' : `#${v}`;
  return String(v);
}

export interface ZaqTrack {
  params: (number | undefined)[]; // 48
  lanes: (number[] | undefined)[]; // 9 x 32
}
export interface ZaqData {
  state?: number[]; // [?, preset, ?, ?, ?]
  globals: (number | undefined)[]; // 16
  tracks: ZaqTrack[];
}

export const zaqData = (): ZaqData => ({
  globals: Array(16).fill(undefined),
  tracks: Array.from({ length: ZAQ_TRACKS }, () => ({
    params: Array(0x30).fill(undefined),
    lanes: Array(ZAQ_LANES).fill(undefined),
  })),
});

export const zaqIsDrum = (t: ZaqTrack) => t.params[TP.mode] === 1;

// value range of a lane (BCR32ZaqLaneEditor::setFromY)
export function zaqLaneRange(t: ZaqTrack, lane: number): [number, number] {
  if (lane === LANE_MUTE || lane === LANE_SKIP) return [0, 1];
  if (lane === 4) return [0, 15];
  if (lane === 7) return [0, 55];
  if (lane === 3) {
    const d = t.params[TP.divider] ?? -1;
    const k = d >= 0 && d < 10 ? DIVIDER_TICKS[d] - 1 : 5;
    return [-k, k];
  }
  if (lane === 5 || lane === 6) {
    const c = t.params[lane === 5 ? TP.ctrlA : TP.ctrlB];
    return [-1, c === -6 ? 7 : c === -5 ? 8 : 127];
  }
  return [0, 127];
}

// a ctrl lane does nothing while its type is OFF
export const zaqLaneEditable = (t: ZaqTrack, lane: number) =>
  !(lane === 5 || lane === 6) ||
  t.params[lane === 5 ? TP.ctrlA : TP.ctrlB] !== -4;

// steps outside start / length play no part (paintToggleRow)
export function zaqInWindow(t: ZaqTrack, step: number): boolean {
  const s = t.params[TP.start];
  const n = t.params[TP.length];
  if (s === undefined || n === undefined) return true;
  return (((step - s + 1) % 32) + 32) % 32 < n;
}

// ---- frames -----------------------------------------------------------------

export type ZaqCmd = 0x44 | 0x45 | 0x46 | 0x47 | 0x48;
export interface ZaqReq {
  cmd: ZaqCmd;
  op: number;
  track: number; // -1 if none
  step: number; // -1 if none
  param: number; // lane / param; 0 for 48
  value?: number;
}

const frame = (...b: number[]) =>
  Uint8Array.from([...BCR_HDR, ...b.map((x) => x & 0x7f), 0xf7]);
const v3 = (v: number) => [
  ((v >> 6) & 2) | ((v >> 15) & 1),
  (v >> 8) & 0x7f,
  v & 0x7f,
];

export function zaqFrame(r: ZaqReq): Uint8Array {
  const v = r.op === 1 || r.value === undefined ? [] : v3(r.value);
  if (r.cmd === 0x44) return frame(0x44, r.op, r.track, r.step, r.param, ...v);
  if (r.cmd === 0x45) return frame(0x45, r.op, r.track, r.param);
  if (r.cmd === 0x46) return frame(0x46, r.op, r.track, r.param, ...v);
  if (r.cmd === 0x47) return frame(0x47, r.op, r.param, ...v);
  return frame(0x48, r.op, ...v);
}

const req = (
  cmd: ZaqCmd,
  op: number,
  track: number,
  step: number,
  param: number,
  value?: number,
): ZaqReq => ({ cmd, op, track, step, param, value });

export const zaqStepWrite = (t: number, s: number, lane: number, v: number) =>
  req(0x44, 2, t, s, lane, v);
export const zaqTrackWrite = (t: number, p: number, v: number) =>
  req(0x46, 2, t, -1, p, v);
export const zaqGlobalWrite = (p: number, v: number) =>
  req(0x47, 2, -1, -1, p, v);
export const zaqLoadPreset = (n: number) => req(0x48, 2, -1, -1, 0, n);

// drum voice notes and mutes (enqueueDrumParameters)
export const zaqDrumReads = (t: number) =>
  Array.from({ length: ZAQ_VOICES }, (_, i) => [
    req(0x46, 1, t, -1, TP.voiceNote + i),
    req(0x46, 1, t, -1, TP.voiceMute + i),
  ]).flat();

// BCR32ZaqSync::readAll order
export function zaqReadAll(): ZaqReq[] {
  const out = [req(0x48, 0, -1, -1, 0)];
  for (const p of [0, 3, 4, 10]) out.push(req(0x47, 1, -1, -1, p));
  for (let t = 0; t < ZAQ_TRACKS; t++) {
    out.push(req(0x46, 1, t, -1, TP.mode));
    for (const p of [0, 1, 2, 3, 4, 5, 6, 7, 0x0b, 0x0c])
      out.push(req(0x46, 1, t, -1, p));
    for (let l = 0; l < ZAQ_LANES; l++) out.push(req(0x45, 1, t, -1, l));
  }
  return out;
}

// ---- replies (ZaqHost::parse) ---------------------------------------------

export interface ZaqReply {
  cmd: ZaqCmd;
  op: number;
  track: number;
  step: number;
  param: number;
  status: number;
  values: number[];
}

export function zaqUnpack(d: ArrayLike<number>, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length && out.length < max; i += 8)
    for (let k = 1; k < 8 && i + k < d.length && out.length < max; k++)
      out.push((((d[i] >> (k - 1)) & 1) << 7) | (d[i + k] & 0x7f));
  return out;
}

export function zaqPack(d: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 7) {
    const g = Array.from(d).slice(i, i + 7);
    out.push(g.reduce((h, b, k) => h | (((b >> 7) & 1) << k), 0));
    out.push(...g.map((b) => b & 0x7f));
  }
  return out;
}

const s16 = (v: number) => (v & 0x8000 ? (v & 0xffff) - 0x10000 : v & 0xffff);
const unv3 = (f: number, hi: number, lo: number) =>
  s16(((((f & 1) << 7) | (hi & 0x7f)) << 8) | ((f & 2) << 6) | (lo & 0x7f));

export function zaqParse(d: ArrayLike<number>): ZaqReply | null {
  if (d.length < 9 || d[0] !== 0xf0 || d[1] !== 0 || d[2] !== 0x20) return null;
  if (d[3] !== 0x32 || d[5] !== 0x64) return null;
  const cmd = d[6] as ZaqCmd;
  if (cmd < 0x44 || cmd > 0x48) return null;
  const p = Array.from(d).slice(7, d[d.length - 1] === 0xf7 ? -1 : undefined);
  if (p.length < 2) return null;
  const r: ZaqReply = {
    cmd,
    op: p[0],
    track: -1,
    step: -1,
    param: 0,
    status: 0,
    values: [],
  };
  if (cmd === 0x48) {
    r.status = p[1];
    if (r.op === 0 && r.status === 0) r.values = zaqUnpack(p.slice(2), 5);
    return r;
  }
  if (p.length < 4 + (cmd === 0x44 ? 1 : 0) - (cmd === 0x47 ? 1 : 0))
    return null;
  const k = cmd === 0x47 ? 1 : cmd === 0x44 ? 3 : 2;
  if (cmd !== 0x47) r.track = p[1];
  if (cmd === 0x44) r.step = p[2];
  r.param = p[k];
  r.status = p[k + 1];
  if (r.status !== 0 && (cmd === 0x45 || r.status !== 1)) return r;
  if (cmd === 0x45) {
    if (r.op !== 1) return r;
    const b = zaqUnpack(p.slice(k + 2), 64);
    if (b.length < 64) return null;
    for (let i = 0; i < 64; i += 2) r.values.push(s16((b[i] << 8) | b[i + 1]));
    return r;
  }
  if (p.length < k + 5) return null;
  r.values = [unv3(p[k + 2], p[k + 3], p[k + 4])];
  return r;
}

// the reply that answers `q` (BCR32ZaqSync::handleIncoming)
export const zaqAnswers = (r: ZaqReply, q: ZaqReq) =>
  r.cmd === q.cmd &&
  r.op === q.op &&
  (r.cmd === 0x48 ||
    (r.param === q.param && r.track === q.track && r.step === q.step));

// fold a reply into the data (BCR32ZaqSync::apply); returns follow-up reads
export function zaqApply(z: ZaqData, r: ZaqReply): ZaqReq[] {
  if (r.status > 1) return [];
  const v = r.values[0];
  const t = r.track >= 0 && r.track < ZAQ_TRACKS ? z.tracks[r.track] : null;
  if (r.cmd === 0x48) {
    if (r.op === 0 && r.values.length > 4) z.state = r.values;
    return [];
  }
  if (r.cmd === 0x47) {
    if (v !== undefined && r.param < 16) z.globals[r.param] = v;
    return [];
  }
  if (!t) return [];
  if (r.cmd === 0x45) {
    if (r.values.length === ZAQ_STEPS && r.param < ZAQ_LANES)
      t.lanes[r.param] = r.values;
    return [];
  }
  if (v === undefined) return [];
  if (r.cmd === 0x46) {
    if (r.param >= 0x30) return [];
    t.params[r.param] = v;
    // a drum track also carries its voice notes and mutes
    if (r.param === TP.mode && v === 1 && t.params[TP.voiceNote] === undefined)
      return zaqDrumReads(r.track);
    return [];
  }
  if (r.step >= ZAQ_STEPS) return [];
  if ((r.param & 0xf0) === 0x10) {
    const lane = (t.lanes[LANE_DRUM] ??= Array(ZAQ_STEPS).fill(0));
    const bit = 1 << (r.param - 0x10);
    lane[r.step] = v
      ? (lane[r.step] & 0xffff) | bit
      : lane[r.step] & ~bit & 0xffff;
  } else if (r.param < ZAQ_LANES) {
    (t.lanes[r.param] ??= Array(ZAQ_STEPS).fill(0))[r.step] = v;
  }
  return [];
}

// ---- link: one request at a time (BCR32ZaqSync::sendNext, timerCallback) --
// The device answers each request; no answer in 200 ms resends it, twice,
// then the request is dropped. Writes to the same target merge.

export class ZaqLink {
  private q: ZaqReq[] = [];
  private running = false;
  private idleWait: (() => void)[] = [];
  missed = 0;

  private out: string;
  private onReply: (r: ZaqReply) => void;

  constructor(out: string, onReply: (r: ZaqReply) => void) {
    this.out = out;
    this.onReply = onReply;
  }

  push(...rs: ZaqReq[]) {
    for (const r of rs) {
      const i = this.q.findIndex(
        (x) =>
          r.op === 2 &&
          x.cmd === r.cmd &&
          x.op === r.op &&
          x.track === r.track &&
          x.step === r.step &&
          x.param === r.param,
      );
      if (i >= 0) this.q[i] = r;
      else this.q.push(r);
    }
    void this.pump();
  }

  get pending() {
    return this.q.length + (this.running ? 1 : 0);
  }

  idle(): Promise<void> {
    if (!this.running && !this.q.length) return Promise.resolve();
    return new Promise((r) => this.idleWait.push(r));
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.q.length) {
      const r = this.q.shift()!;
      const rep = await this.one(r);
      if (rep) this.onReply(rep);
      else this.missed++;
    }
    this.running = false;
    this.idleWait.splice(0).forEach((f) => f());
  }

  private one(q: ZaqReq): Promise<ZaqReply | null> {
    return new Promise((resolve) => {
      let tries = 0;
      let timer: ReturnType<typeof setTimeout>;
      const off = midi.onMessage((d) => {
        const r = zaqParse(d);
        if (!r || !zaqAnswers(r, q)) return;
        clearTimeout(timer);
        off();
        resolve(r);
      });
      const send = () => {
        if (tries++ > 2) {
          off();
          return resolve(null);
        }
        midi.send(this.out, zaqFrame(q));
        timer = setTimeout(send, 200);
      };
      send();
    });
  }
}
