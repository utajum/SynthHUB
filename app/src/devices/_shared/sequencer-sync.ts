// Sequencer pattern sync over SysEx (SequencerController).
// Read: cmd 0x77 + slot header -> one 0x78 dump, [header..., nibble-packed body].
// Write: same body with cmd 0x78. Types 0/1 fully modeled;
// other types round-trip byte-exact via the raw payload.
import type { DeviceVariant } from '../../lib/types';
import { midi } from '../../lib/midi/webmidi';
import type { Step } from '../../lib/sequencer';
import { defaultStep } from '../../lib/sequencer';
import {
  buildPKT,
  buildPKT78,
  parseFrame,
  pack87,
  packNibbles,
  unpack87,
  unpackNibbles,
} from '../../lib/midi/sysex';

// labels for the sequencer `type` ids used in the device configs
export const SEQ_TYPE_NAMES: Record<number, string> = {
  0: 'Mono (Crave/MS-1/Odyssey)',
  1: 'TD-3 / TB-303',
  2: 'Poly D',
  3: 'RD-6',
  4: 'RD-9',
  5: 'RD-8 / RD-8 MKII',
  6: 'RD-78',
  7: 'LM-DRUM',
  8: 'RS-9',
  10: 'BMX',
  11: 'BMX (alt)',
  12: 'RD (alt)',
};

// types whose 0x78 body maps onto the mono step engine
export const MONO_SYNC_TYPES = new Set([0, 1]);

// Per-step fields the device pattern memory actually stores, per sequencer
// type (HW-verified for 0/1). The editor hides controls for fields a synced
// device cannot persist; unmapped/backup-only types keep the full local
// toolset since their grid never round-trips through the device.
export interface SeqCaps {
  velocity: boolean;
  gate: boolean;
  accent: boolean;
  slide: boolean;
  ratchet: boolean;
  probability: boolean;
}
const ALL_CAPS: SeqCaps = {
  velocity: true,
  gate: true,
  accent: true,
  slide: true,
  ratchet: true,
  probability: true,
};
export function seqCaps(type: number): SeqCaps {
  if (type === 0) {
    // MS-1 family: velocity + gate/slide (trig byte); accent = vel >= 112;
    // no ratchet, no probability
    return { ...ALL_CAPS, ratchet: false, probability: false };
  }
  if (type === 1) {
    // TD-3: accent/slide tracks + ties; velocity only as the accent proxy;
    // no ratchet, no probability
    return {
      velocity: false,
      gate: true,
      accent: true,
      slide: true,
      ratchet: false,
      probability: false,
    };
  }
  return ALL_CAPS;
}

// Song-based drum machines: their dumps address slots as
// `0x77 [sel, song, pattern]` (sel 0x41 unless noted below), not the bare
// 2-byte mono form.
export const SONG_PKT_TYPES = new Set([4, 5, 7, 8, 10, 12]);
const SONG_SLOT_SELECTOR = 0x41;
// type 12 (RD-765) uses selector 0x00 (ST 3.3.1 dumpSequencerData12)
const TYPE_SLOT_SELECTOR: Record<number, number> = { 12: 0x00 };

// Request a pattern. Mono family: `0x77 [bank, pattern]` (byte order
// HW-verified on MS-1 MK II: bank first). Song family: `0x77 [sel, song,
// pattern]`.
export function requestPattern(
  variant: DeviceVariant,
  bank: number,
  pattern = 0,
  opts: { song?: boolean; type?: number } = {},
): Uint8Array {
  const sel = TYPE_SLOT_SELECTOR[opts.type ?? -1] ?? SONG_SLOT_SELECTOR;
  const payload = opts.song
    ? [sel, bank & 0x7f, pattern & 0x7f]
    : [bank & 0x7f, pattern & 0x7f];
  return buildPKT(variant, 0x77, payload);
}

interface SequencerDump {
  // bank / group / song index from the dump header
  bank: number;
  // pattern within the bank
  pattern: number;
  // nibble-unpacked body bytes
  bytes: number[];
  // the complete 0x78 payload exactly as received, for byte-exact writes
  raw: number[];
}

// Decode an inbound 0x78 dump for `variant`, or null. Song-family dumps are
// recognized by the 0x41 selector (mono banks never reach 0x41).
export function decodeDump(
  variant: DeviceVariant,
  data: Uint8Array,
): SequencerDump | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x78) return null;
  const payload = f.payload;
  if (payload.length < 2) return null;
  const raw = Array.from(payload);
  if (payload[0] === SONG_SLOT_SELECTOR && payload.length >= 3) {
    return {
      bank: payload[1],
      pattern: payload[2],
      bytes: unpackNibbles(payload.slice(3)),
      raw,
    };
  }
  return {
    bank: payload[0],
    pattern: payload[1],
    bytes: unpackNibbles(payload.slice(2)),
    raw,
  };
}

// Store ACK (SynthTribe 3.3.x): types whose store waits for `01 <x> <status>`
// after each 0x78 write; status 0 = stored. No ACK within 3 s = not stored.
export const STORE_ACK_TYPES = new Set([6, 11, 12]);
const STORE_ACK_TIMEOUT_MS = 3000;

// status byte of an inbound store ACK for `variant`, or null
export function parseStoreAck(
  variant: DeviceVariant,
  data: Uint8Array,
): number | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x01 || f.payload.length < 2) return null;
  return f.payload[1];
}

// wait for `count` store ACKs (call before sending): the first non-zero
// status, 0 when all are 0, null when they miss the 3 s deadline
export function waitStoreAck(
  variant: DeviceVariant,
  count = 1,
): Promise<number | null> {
  return new Promise((resolve) => {
    let left = count;
    const done = (r: number | null) => {
      clearTimeout(timer);
      off();
      resolve(r);
    };
    const off = midi.onMessage((data) => {
      const st = parseStoreAck(variant, data);
      if (st !== null && (st !== 0 || --left === 0)) done(st);
    });
    const timer = setTimeout(() => done(null), STORE_ACK_TIMEOUT_MS);
  });
}

// byte-exact write: re-send a previously received 0x78 payload unchanged (the
// only safe write for unmodeled body formats)
export function buildRawPatternWrite(
  variant: DeviceVariant,
  rawPayload: number[],
): Uint8Array {
  return buildPKT78(variant, rawPayload);
}

// SynthTribe `.seq` pattern file (ST 3.3.1 import/exportSequencerData11/12):
// i32le magic, i32le byte length + UTF-16LE device name, the same for the
// firmware version, then data blocks as i32le length + bytes. Type 11: one
// block, the 0x78 payload byte for byte (size per type below).
const SEQ_FILE_MAGIC = 0x23985476;
export const SEQ_FILE_DATA_LEN: Record<number, number> = { 11: 0x45 };

// Type 12 (RD-765): global, song and pattern blocks in that file order, each
// 8-to-7 packed raw data; on the wire 0x77 / 0x78 [sel, song, pattern, ...]
export const SEQ12_BLOCKS = [
  { sel: 2, size: 0xe8 },
  { sel: 1, size: 0x8a },
  { sel: 0, size: 0x817 },
];

// .seq block from a type-12 0x78 payload, or null if it is too short
export function seq12Block(payload: number[], size: number): number[] | null {
  const raw = unpack87(payload.slice(3));
  return raw.length < size ? null : pack87(raw.slice(0, size));
}

// the three 0x78 frames that store type-12 .seq blocks in one slot
export function seq12Frames(
  variant: DeviceVariant,
  blocks: number[][],
  song: number,
  pattern: number,
): Uint8Array[] | null {
  if (blocks.length !== SEQ12_BLOCKS.length) return null;
  const out: Uint8Array[] = [];
  for (const [i, b] of SEQ12_BLOCKS.entries()) {
    const raw = unpack87(blocks[i]);
    if (raw.length < b.size) return null;
    const data = pack87(raw.slice(0, b.size));
    out.push(buildPKT78(variant, [b.sel, song, pattern, ...data]));
  }
  return out;
}

export function buildSeqFile(
  name: string,
  version: string,
  blocks: number[][],
): Uint8Array {
  const out: number[] = [];
  const i32 = (v: number) =>
    out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const str = (s: string) => {
    i32(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out.push(c & 0xff, c >> 8);
    }
  };
  i32(SEQ_FILE_MAGIC);
  str(name);
  str(version);
  for (const b of blocks) {
    i32(b.length);
    out.push(...b);
  }
  return Uint8Array.from(out);
}

// data blocks of a `.seq` file, or null if the file is malformed
export function parseSeqFile(bytes: Uint8Array): number[][] | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const i32 = () => {
    if (o + 4 > bytes.length) return -1;
    o += 4;
    return dv.getInt32(o - 4, true);
  };
  if (i32() !== SEQ_FILE_MAGIC) return null;
  for (let s = 0; s < 2; s++) {
    const n = i32();
    if (n < 0 || o + n > bytes.length) return null;
    o += n;
  }
  const blocks: number[][] = [];
  do {
    const len = i32();
    if (len < 0 || o + len > bytes.length) return null;
    blocks.push(Array.from(bytes.subarray(o, o + len)));
    o += len;
  } while (o < bytes.length);
  return blocks;
}

// TD-3 (type 1) body: 303-style split tracks (HW-verified by clock-driven
// playback capture). Time track: count@0x32, gate u16le@0x34 (note starts),
// rest u16le@0x36 (silent steps); a step with neither bit ties (extends the
// previous note). Pitch track bytes[1..16] is consumed one entry per NOTE
// step, not per step; accents@0x11 and slides@0x21 are consumed the same
// way. Played MIDI note = pitch byte + 12; accent plays velocity 112, plain
// 80. Velocity is not stored per step - only the accent bit survives.
function decodeTD3(bytes: number[]): { length: number; steps: Step[] } | null {
  if (bytes.length < 0x38) return null;
  const count = Math.max(1, Math.min(16, bytes[0x32] || 16));
  const gate = bytes[0x34] | (bytes[0x35] << 8);
  const rest = bytes[0x36] | (bytes[0x37] << 8);
  const steps: Step[] = [];
  let k = 0; // pitch-track cursor
  let lastOn = -1;
  for (let i = 0; i < 16; i++) {
    const s = defaultStep();
    const isNote = ((gate >> i) & 1) === 1 && ((rest >> i) & 1) === 0;
    const isRest = ((rest >> i) & 1) === 1;
    if (isNote && k < 16) {
      s.note = Math.max(0, Math.min(127, (bytes[1 + k] & 0x7f) + 12));
      s.accent = (bytes[0x11 + k] & 0x7f) !== 0;
      s.slide = (bytes[0x21 + k] & 0x7f) !== 0;
      s.velocity = s.accent ? 112 : 80;
      s.on = true;
      lastOn = i;
      k++;
    } else if (!isRest && i < count && lastOn >= 0) {
      // tie: extend the previous note's gate (engine gate > 1 holds over)
      steps[lastOn].gate = Math.min(2, steps[lastOn].gate + 1);
    }
    steps.push(s);
  }
  return { length: count, steps };
}

// steps -> TD-3 body (inverse of decodeTD3). `template` preserves unmodeled
// bytes (0x00 bank echo, 0x30/0x31/0x33, trailing pitch slots). A step with
// gate >= 1.5 followed by an off step emits a tie instead of a rest.
export function encodeTD3(
  steps: Step[],
  length = 16,
  bank = 0,
  template?: number[],
): number[] {
  const out = template ? template.slice() : new Array(0x38).fill(0);
  while (out.length < 0x38) out.push(0);
  if (!template) out[0] = bank & 0x7f;
  const count = Math.max(1, Math.min(16, length));
  let gate = 0;
  let rest = 0;
  let k = 0; // pitch-track cursor
  let tieBudget = 0;
  for (let i = 0; i < 16; i++) {
    const s = steps[i] ?? defaultStep();
    if (i < count && s.on && k < 16) {
      gate |= 1 << i;
      out[1 + k] = (s.note - 12) & 0x7f;
      out[0x11 + k] = s.accent || s.velocity >= 112 ? 1 : 0;
      out[0x21 + k] = s.slide ? 1 : 0;
      tieBudget = s.gate >= 1.5 ? 1 : 0;
      k++;
    } else if (i < count && tieBudget > 0) {
      tieBudget--; // neither bit = tie
    } else {
      rest |= 1 << i;
      tieBudget = 0;
    }
  }
  out[0x32] = count;
  out[0x34] = gate & 0xff;
  out[0x35] = (gate >> 8) & 0xff;
  out[0x36] = rest & 0xff;
  out[0x37] = (rest >> 8) & 0xff;
  return out;
}

// Type-0 mono body -> steps (HW-verified on MS-1 MK II by live playback).
// length = bytes[1]*8 + bytes[2] + 1; step group [note, trig, vel, flags] at
// 3+4i. note = the raw byte (identity - no mirror, no transpose). trig:
// gate time in 1/48-step units (0x30 = full step); 0x54..0x7e = held into
// the next step (SH-101-style slide/legato); >= 0x7f = filler on virgin
// steps (plays as a v64 retrigger roll - not a panel feature, decoded as a
// plain full gate). vel = MIDI velocity (0xff virgin -> device plays 64).
// flags: bit7 = REST; other bits have no audible effect and are preserved.
// The format has no accent/slide flags: accent = high velocity (>= 112,
// same convention as the TD-3), slide = long trig. No ratchet.
const MONO0_SLIDE_TRIG = 0x60; // hold through the next step

export function decodeMono0(
  bytes: number[],
): { length: number; steps: Step[] } | null {
  if (bytes.length < 7) return null;
  const length = Math.max(1, Math.min(64, bytes[2] + bytes[1] * 8 + 1));
  const steps: Step[] = [];
  for (let i = 0; i < length; i++) {
    const off = 3 + 4 * i;
    if (off + 3 >= bytes.length) break;
    const s = defaultStep();
    s.note = Math.max(0, Math.min(127, bytes[off] & 0x7f));
    const trig = bytes[off + 1];
    if (trig >= 0x7f) {
      s.gate = 1; // virgin filler - normalize to a full gate
    } else if (trig >= 0x54) {
      s.slide = true; // held into the next note
      s.gate = 1;
    } else if (trig > 0) {
      s.gate = Math.max(0.1, Math.min(2, trig / 0x30));
    }
    const vel = bytes[off + 2];
    s.velocity = vel > 0x7f ? 64 : Math.max(1, vel);
    s.accent = s.velocity >= 112;
    s.on = ((bytes[off + 3] >> 7) & 1) === 0; // bit7 REST
    steps.push(s);
  }
  return { length: steps.length || length, steps };
}

// steps -> type-0 body (inverse of decodeMono0). Always read the pattern
// first and pass its raw body as `template` so unmodeled bytes (body[0],
// flag bits 0-6, trailing groups) are preserved. Accent bumps velocity to
// >= 112; slide writes the long trig; both round-trip through decodeMono0.
export function encodeMono0(
  steps: Step[],
  length: number,
  bank = 0,
  template?: number[],
): number[] {
  const n = Math.max(1, Math.min(64, length));
  const out = template ? template.slice() : [];
  const need = 3 + 4 * n;
  while (out.length < need) out.push(0);
  if (!template) out[0] = bank & 0x7f;
  const value = n - 1; // bytes[1]*8 + bytes[2] == length-1
  out[1] = (value >> 3) & 0x7f;
  out[2] = value & 7;
  for (let i = 0; i < n; i++) {
    const off = 3 + 4 * i;
    const s = steps[i] ?? defaultStep();
    out[off] = s.note & 0x7f;
    out[off + 1] = s.slide
      ? MONO0_SLIDE_TRIG
      : Math.max(6, Math.min(0x48, Math.round(s.gate * 0x30)));
    out[off + 2] = Math.max(
      1,
      Math.min(127, s.accent ? Math.max(112, s.velocity) : s.velocity),
    );
    let f = out[off + 3] & 0x7f; // keep unmodeled bits 0-6
    if (!s.on) f |= 0x80; // bit7 REST
    out[off + 3] = f & 0xff;
  }
  return out;
}

// dump -> engine steps for supported mono types
export function dumpToSteps(
  type: number,
  dump: SequencerDump,
): { length: number; steps: Step[] } | null {
  if (type === 1) return decodeTD3(dump.bytes);
  if (type === 0) return decodeMono0(dump.bytes);
  return null;
}

// Merge a decoded dump into the local grid: a decoded step that is
// wire-equivalent to the local one keeps the local object, so fields the
// device cannot store (ratchet count, probability, exact velocity, gate
// nuance) survive a write -> read round-trip. Steps that genuinely differ
// on the device replace the local ones.
export function mergeSteps(
  type: number,
  decoded: Step[],
  local: Step[],
): Step[] {
  const clampVel = (v: number) => Math.max(1, Math.min(127, v));
  return decoded.map((d, i) => {
    const l = local[i];
    if (!l || d.on !== l.on) return d;
    if (type === 1) {
      // TD-3 stores note/accent/slide per note-on + tie band
      if (d.on && (d.note !== l.note || d.slide !== l.slide)) return d;
      if (d.on && d.accent !== (l.accent || l.velocity >= 112)) return d;
      if (d.on && d.gate >= 1.5 !== l.gate >= 1.5) return d;
      return l;
    }
    if (type === 0) {
      // MS-1 stores note/velocity(accent)/trig(gate|slide)/rest
      if (d.note !== l.note || d.slide !== l.slide) return d;
      const lWireVel = clampVel(
        l.accent ? Math.max(112, l.velocity) : l.velocity,
      );
      if (d.velocity !== lWireVel) return d;
      if (
        !l.slide &&
        Math.abs(d.gate * 0x30 - Math.max(6, Math.min(0x48, l.gate * 0x30))) > 1
      )
        return d;
      return l;
    }
    return d;
  });
}

// Write a pattern: `0x78 [bank, pattern, <nibble-packed body>]` - the raw
// header must be prepended or the device cannot route the write (HW-verified
// on MS-1 MK II).
export function buildPatternWrite(
  variant: DeviceVariant,
  bank: number,
  pattern: number,
  body: number[],
): Uint8Array {
  return buildPKT78(variant, [
    bank & 0x7f,
    pattern & 0x7f,
    ...packNibbles(body),
  ]);
}
