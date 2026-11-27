// UB-Xa 16 librarian (SynthTribe 3.3.1 LibrarianController + CoreController
// dump-file protocol). Files move as `7f 74 07 <op>` frames without a cmd
// byte: 03 get, 01 header (size word + 16-char name), 02 data chunk; the
// receiver answers each step with a universal ACK (F0 7E id 7F) or NAK (7E),
// and F0 7E id 7B ends a file. Patch files stay raw 7-bit bytes plus the size
// word from their header; .stpreset and .syx files carry exactly that.
import type { DeviceVariant } from '../../lib/types';
import { buildNoPKTNoDevId, splitSysex, unpack87 } from '../../lib/midi/sysex';
import { midi } from '../../lib/midi/webmidi';

const FILE_OP = [0x7f, 0x74, 0x07];
const OP_HEADER = 0x01;
const OP_DATA = 0x02;
const OP_GET = 0x03;
const CHUNK = 0x80;
// slots an .stpreset may address (parseSTPresetData)
const MAX_SLOTS = 0x200;
export const FILE_EOF = Uint8Array.from([0xf0, 0x7e, 0x00, 0x7b, 0x00, 0xf7]);

export interface PresetFile {
  slot: number;
  name: string;
  // size word from the file header, echoed on write
  size: number;
  // raw 7-bit file bytes
  data: number[];
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
const pad16 = (s: string) => s.padEnd(16, ' ').slice(0, 16);

// slot tag: bank letter + 1-based slot in the bank ("A001")
export function slotTag(slot: number): string {
  return (
    String.fromCharCode(0x41 + (slot >> 7)) +
    String((slot & 0x7f) + 1).padStart(3, '0')
  );
}

function tagSlot(tag: string): number | null {
  const m = /^([A-Z])(\d{3})$/.exec(tag);
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 128) return null;
  return (m[1].charCodeAt(0) - 0x41) * 128 + n - 1;
}

export const NAMES_FILE = pad16('Patch Names');
export const patchFile = (slot: number) => pad16(`PatchX ${slotTag(slot)}`);

// firmware "1.2.3" -> the 3 version bytes UB-Xa file requests append
export function fwBytes(version: string | null | undefined): number[] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  return m ? [1, 2, 3].map((i) => Number(m[i]) & 0x7f) : [0, 0, 0];
}

export function buildFileGet(
  variant: DeviceVariant,
  name16: string,
  fw: number[],
): Uint8Array {
  return buildNoPKTNoDevId(variant, [
    ...FILE_OP,
    OP_GET,
    0x7f,
    ...ascii('BIN ' + name16),
    ...fw,
  ]);
}

// header + data chunks of one file write (the EOF frame follows them)
export function buildFileWrite(
  variant: DeviceVariant,
  name16: string,
  size: number,
  data: number[],
  fw: number[],
): Uint8Array[] {
  const out = [
    buildNoPKTNoDevId(variant, [
      ...FILE_OP,
      OP_HEADER,
      0x7f,
      ...ascii('BIN '),
      size & 0x7f,
      (size >> 8) & 0x7f,
      (size >> 16) & 0x7f,
      (size >>> 24) & 0x7f,
      ...ascii(name16),
      ...fw,
    ]),
  ];
  for (let o = 0, seq = 0; o < data.length; o += CHUNK, seq++) {
    const part = data.slice(o, o + CHUNK).map((b) => b & 0x7f);
    let x = (part.length - 1) ^ (seq & 0x7f);
    for (const b of part) x ^= b;
    out.push(
      buildNoPKTNoDevId(variant, [
        ...FILE_OP,
        OP_DATA,
        seq & 0x7f,
        part.length - 1,
        ...part,
        x,
      ]),
    );
  }
  return out;
}

const isEof = (d: ArrayLike<number>) =>
  d[0] === 0xf0 && d[1] === 0x7e && d[3] === 0x7b;

// collects one file sent by the device (or read from a .syx)
export class FileReceiver {
  name = '';
  size = 0;
  data: number[] = [];
  // false once a chunk fails its XOR check
  ok = true;
  private readonly head: number[];

  constructor(variant: DeviceVariant) {
    this.head = Array.from(buildNoPKTNoDevId(variant, FILE_OP).slice(0, 10));
  }

  // 'eof' when the file is complete, true when the frame was consumed
  feed(d: ArrayLike<number>): 'eof' | boolean {
    if (isEof(d)) return 'eof';
    if (d.length < 14 || this.head.some((b, i) => d[i] !== b)) return false;
    if (d[10] === OP_HEADER && d.length >= 37) {
      this.size = d[16] | (d[17] << 8) | (d[18] << 16) | (d[19] << 24);
      this.name = String.fromCharCode(...Array.from(d).slice(20, 36));
      this.data = [];
      this.ok = true;
      return true;
    }
    if (d[10] !== OP_DATA) return false;
    const end = d.length - 2;
    let x = 0;
    for (let i = 11; i < end; i++) x ^= d[i];
    if (x !== d[end]) this.ok = false;
    for (let i = 13; i < 13 + d[12] + 1 && i < end; i++) this.data.push(d[i]);
    return true;
  }
}

// "Patch Names" file: 16 bytes per name after 8-to-7 unpacking; each u16le
// word holds two 7-bit chars, high one first
export function parseNames(file: number[]): string[] {
  const b = unpack87(file.slice(0, file.length - (file.length % 8)));
  const out: string[] = [];
  for (let i = 0; i < b.length; i += 16) {
    let s = '';
    for (let j = i; j < i + 16; j += 2) {
      const w = (b[j] ?? 0) | ((b[j + 1] ?? 0) << 8);
      for (const c of [(w >> 7) & 0x7f, w & 0x7f])
        s += String.fromCharCode(c < 0x21 || c === 0x7f ? 0x20 : c);
    }
    out.push(s.trim());
  }
  return out;
}

// .stpreset (format 3): "STPRESET", i32 3, u8 1 (UB-Xa; 0 = PRO 16), i32
// count, then per preset i32 slot, UTF-8 name + NUL, i32 length + bytes,
// i32 size word. All i32 little-endian.
export function buildStPreset(presets: PresetFile[]): Uint8Array {
  const out: number[] = [];
  const i32 = (v: number) =>
    out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  out.push(...ascii('STPRESET'));
  i32(3);
  out.push(1);
  i32(presets.length);
  for (const p of presets) {
    i32(p.slot);
    out.push(...new TextEncoder().encode(p.name), 0);
    i32(p.data.length);
    out.push(...p.data);
    i32(p.size);
  }
  return Uint8Array.from(out);
}

export function parseStPreset(bytes: Uint8Array): PresetFile[] | string {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const bad = 'This preset file is corrupted or truncated.';
  const i32 = () => {
    if (o + 4 > bytes.length) throw bad;
    o += 4;
    return dv.getInt32(o - 4, true);
  };
  try {
    if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'STPRESET') throw bad;
    o = 8;
    if (i32() !== 3)
      return 'This preset file uses an unsupported format version.';
    if (bytes[o++] !== 1) return 'This preset file is for PRO 16, not UB-Xa.';
    const n = i32();
    if (n < 1 || n > MAX_SLOTS) throw bad;
    const out: PresetFile[] = [];
    for (let k = 0; k < n; k++) {
      const slot = i32();
      if (slot < 0 || slot >= MAX_SLOTS) throw bad;
      const z = bytes.indexOf(0, o);
      if (z < 0) throw bad;
      const name = new TextDecoder().decode(bytes.subarray(o, z));
      o = z + 1;
      const len = i32();
      if (len < 0 || o + len > bytes.length) throw bad;
      const data = Array.from(bytes.subarray(o, o + len));
      o += len;
      const size = i32();
      if (size < 1 || size > 0x100000) throw bad;
      out.push({ slot, name, size, data });
    }
    return out;
  } catch (e) {
    return typeof e === 'string' ? e : bad;
  }
}

// .syx export: per preset the exact write stream (header, chunks, EOF)
export function buildPresetSyx(
  variant: DeviceVariant,
  presets: PresetFile[],
  fw: number[],
): Uint8Array {
  const frames = presets.flatMap((p) => [
    ...buildFileWrite(variant, patchFile(p.slot), p.size, p.data, fw),
    FILE_EOF,
  ]);
  const out = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

export function parsePresetSyx(
  variant: DeviceVariant,
  bytes: Uint8Array,
): PresetFile[] {
  const out: PresetFile[] = [];
  let rx: FileReceiver | null = null;
  for (const m of splitSysex(bytes)) {
    if (!rx) rx = new FileReceiver(variant);
    if (rx.feed(m) !== 'eof') continue;
    const tag = rx.name.trim().split(' ').pop() ?? '';
    const slot = tagSlot(tag);
    if (rx.ok && slot !== null && rx.data.length)
      out.push({ slot, name: tag, size: rx.size, data: rx.data });
    rx = null;
  }
  return out;
}

// transfers over WebMIDI

type Universal = 'ack' | 'nak';

function universal(d: ArrayLike<number>): Universal | null {
  if (d[0] !== 0xf0 || d[1] !== 0x7e) return null;
  return d[3] === 0x7f ? 'ack' : d[3] === 0x7e ? 'nak' : null;
}

// read one file; null on NAK, timeout or a bad checksum. The device ACKs
// the get, the host closes it with EOF, then the file follows.
export function readFile(
  variant: DeviceVariant,
  out: string,
  name16: string,
  fw: number[],
  timeoutMs = 10000,
): Promise<{ size: number; data: number[] } | null> {
  return new Promise((resolve) => {
    const rx = new FileReceiver(variant);
    let acked = false;
    const done = (r: { size: number; data: number[] } | null) => {
      clearTimeout(timer);
      off();
      resolve(r);
    };
    const off = midi.onMessage((d) => {
      const u = universal(d);
      if (u === 'nak') return done(null);
      if (u === 'ack') {
        if (!acked) midi.send(out, FILE_EOF);
        acked = true;
        return;
      }
      if (rx.feed(d) !== 'eof') return;
      done(rx.ok ? { size: rx.size, data: rx.data } : null);
    });
    const timer = setTimeout(() => {
      off();
      resolve(null);
    }, timeoutMs);
    midi.send(out, buildFileGet(variant, name16, fw));
  });
}

function nextReply(timeoutMs: number): Promise<Universal | null> {
  return new Promise((resolve) => {
    const off = midi.onMessage((d) => {
      const u = universal(d);
      if (!u) return;
      clearTimeout(timer);
      off();
      resolve(u);
    });
    const timer = setTimeout(() => {
      off();
      resolve(null);
    }, timeoutMs);
  });
}

// write one file, one ACK per frame; a NAK restarts it after 300 ms, at most
// 3 times. The EOF ACK is optional: no reply within 500 ms counts as stored.
export async function writeFile(
  variant: DeviceVariant,
  out: string,
  name16: string,
  size: number,
  data: number[],
  fw: number[],
): Promise<boolean> {
  const frames = [...buildFileWrite(variant, name16, size, data, fw), FILE_EOF];
  for (let attempt = 0; attempt < 4; attempt++) {
    let nak = false;
    for (const f of frames) {
      const last = f === FILE_EOF;
      const reply = nextReply(last ? 500 : 3000);
      midi.send(out, f);
      const r = await reply;
      if (r === 'ack' || (last && r === null)) continue;
      if (r !== 'nak') return false;
      nak = true;
      break;
    }
    if (!nak) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
