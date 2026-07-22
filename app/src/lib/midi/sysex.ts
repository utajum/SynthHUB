// Music Tribe SysEx codec: frame builders, parser, payload encodings.
// Wire: F0 00 20 32 <model[3]> [deviceId] <cmd> <payload...> F7
// deviceId only for protocol family >= 3; families 0-2 put cmd
// straight after model bytes (Behringer::Tool::buildSysexMessage_* +
// handleSysexMessage dispatcher).
import type { DeviceVariant, SysexAddress } from '../types';
import { MUSIC_TRIBE_MFR } from '../types';

const SOX = 0xf0;
export const EOX = 0xf7;

// device -> host: full parameter dump (reply to a 0x75 request)
export const CMD_ENTIRE_PARAMS = 0x76;

// "0x1e" | "30" | 30 -> byte
function toByte(v: string | number): number {
  if (typeof v === 'number') return v & 0xff;
  const s = String(v).trim();
  if (!s) return 0;
  return (
    (s.startsWith('0x') || s.startsWith('0X')
      ? parseInt(s, 16)
      : parseInt(s, 10)) & 0xff
  );
}

// the three model bytes of a variant
function modelBytes(variant: DeviceVariant): [number, number, number] {
  const m = variant.modelId.map(toByte);
  return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
}

// proto>=3 device-id byte: 0x7f iff m1==1 && m2<0x3f && bit m2 set in
// 0x4400000200000000 (only UB-Xa 16 / UB-Xa 16 Desktop), else 0x00
function deviceIdByte(variant: DeviceVariant): number {
  const [, m1, m2] = modelBytes(variant);
  const MASK = 0x4400000200000000n;
  if (m1 === 1 && m2 < 0x3f && (MASK & (1n << BigInt(m2 & 0x3f))) !== 0n)
    return 0x7f;
  return 0x00;
}

function hasDeviceId(variant: DeviceVariant): boolean {
  return variant.protocol >= 3;
}

// F0 00 20 32 m0 m1 m2 [devId]
export function frameHeader(variant: DeviceVariant): number[] {
  const [m0, m1, m2] = modelBytes(variant);
  const h = [SOX, ...MUSIC_TRIBE_MFR, m0, m1, m2];
  if (hasDeviceId(variant)) h.push(deviceIdByte(variant));
  return h;
}

// command byte index in a frame: 7 (proto 0-2) or 8 (proto 3+)
function cmdIndex(variant: DeviceVariant): number {
  return hasDeviceId(variant) ? 8 : 7;
}

const finish = (bytes: number[]): Uint8Array => {
  bytes.push(EOX);
  return Uint8Array.from(bytes.map((b) => b & 0xff));
};

// builders (mirror Behringer::Tool::buildSysexMessage_*)

// header + cmd + F7
export function buildPKTNoValue(
  variant: DeviceVariant,
  cmd: number,
): Uint8Array {
  return finish([...frameHeader(variant), cmd & 0x7f]);
}

// header + flag(=cmd) + array + F7
export function buildPKT(
  variant: DeviceVariant,
  flag: number,
  array: number[] = [],
): Uint8Array {
  return finish([
    ...frameHeader(variant),
    flag & 0x7f,
    ...array.map((b) => b & 0x7f),
  ]);
}

// header + 0x77 + p5 + p6 + F7
export function buildPKT77(
  variant: DeviceVariant,
  p5: number,
  p6: number,
): Uint8Array {
  return finish([...frameHeader(variant), 0x77, p5 & 0x7f, p6 & 0x7f]);
}

// header + 0x78 + array + F7
export function buildPKT78(
  variant: DeviceVariant,
  array: number[],
): Uint8Array {
  return finish([...frameHeader(variant), 0x78, ...array.map((b) => b & 0x7f)]);
}

// F0 00 20 32 m0 m1 m2 + array + F7 - no device id, command lives inside the
// array (UB-Xa bulk read)
export function buildNoPKTNoDevId(
  variant: DeviceVariant,
  array: number[],
): Uint8Array {
  const [m0, m1, m2] = modelBytes(variant);
  return finish([
    SOX,
    ...MUSIC_TRIBE_MFR,
    m0,
    m1,
    m2,
    ...array.map((b) => b & 0x7f),
  ]);
}

// integer -> little-endian 7-bit chunks (at least minBytes)
export function encode7bit(value: number, minBytes = 1): number[] {
  let v = Math.max(0, Math.trunc(value));
  const out: number[] = [];
  do {
    out.push(v & 0x7f);
    v >>= 7;
  } while (v > 0);
  while (out.length < minBytes) out.push(0);
  return out;
}

interface SetParamOptions {
  // value byte count (default: as many 7-bit chunks as needed)
  valueBytes?: number;
  // signed wire offset, e.g. transpose -12..12 -> 0..24
  offset?: number;
}

// set parameter: header + pkt + [spkt] + value + F7
export function buildSetParam(
  variant: DeviceVariant,
  address: SysexAddress,
  value: number,
  opts: SetParamOptions = {},
): Uint8Array {
  const bytes = frameHeader(variant);
  bytes.push((address.pkt ?? 0) & 0x7f);
  if (address.spkt !== undefined) bytes.push(address.spkt & 0x7f);
  bytes.push(...encode7bit(value - (opts.offset ?? 0), opts.valueBytes ?? 1));
  return finish(bytes);
}

// get parameter: header + pkt + [spkt] + F7 (the device answers with a set)
export function buildGetParam(
  variant: DeviceVariant,
  address: SysexAddress,
): Uint8Array {
  const bytes = frameHeader(variant);
  bytes.push((address.pkt ?? 0) & 0x7f);
  if (address.spkt !== undefined) bytes.push(address.spkt & 0x7f);
  return finish(bytes);
}

// inbound

// true if the buffer is a Music Tribe manufacturer SysEx
export function isMusicTribeSysex(data: ArrayLike<number>): boolean {
  return (
    data.length >= 5 &&
    data[0] === SOX &&
    data[1] === MUSIC_TRIBE_MFR[0] &&
    data[2] === MUSIC_TRIBE_MFR[1] &&
    data[3] === MUSIC_TRIBE_MFR[2]
  );
}

interface ParsedFrame {
  cmd: number;
  // bytes after the command, excluding the trailing F7
  payload: number[];
  model: [number, number, number];
}

// Parse an inbound frame addressed to `variant`: matches mfr + 3 model bytes.
// The device-id byte is intentionally NOT checked (the firmware dispatcher
// ignores it too; some units reply with a different id). Command position is
// protocol-aware (index 7 or 8).
export function parseFrame(
  variant: DeviceVariant,
  data: Uint8Array,
): ParsedFrame | null {
  if (!isMusicTribeSysex(data)) return null;
  const ci = cmdIndex(variant);
  if (data.length < ci + 2) return null;
  const [m0, m1, m2] = modelBytes(variant);
  if (data[4] !== m0 || data[5] !== m1 || data[6] !== m2) return null;
  const end = data[data.length - 1] === EOX ? data.length - 1 : data.length;
  return {
    cmd: data[ci],
    payload: Array.from(data.slice(ci + 1, end)),
    model: [data[4], data[5], data[6]],
  };
}

// encodings

// nibble packing for 0x77/0x78 sequencer data: 1 byte -> (hi, lo)
export function packNibbles(bytes: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push((bytes[i] >> 4) & 0x0f, bytes[i] & 0x0f);
  }
  return out;
}

// inverse of packNibbles: (hi<<4)|lo per payload pair
export function unpackNibbles(payload: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < payload.length; i += 2) {
    out.push(((payload[i] & 0x0f) << 4) | (payload[i + 1] & 0x0f));
  }
  return out;
}

// 8-to-7 MIDI unpacking for bulk dumps: 1 high-bit byte (bit7 of each following
// byte, LSB-first) + 7 low-7-bit bytes -> 7 data bytes
export function unpack87(bytes: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 7 < bytes.length + 1 && i < bytes.length; i += 8) {
    const msb = bytes[i] & 0x7f;
    for (let j = 0; j < 7 && i + 1 + j < bytes.length; j++) {
      out.push((bytes[i + 1 + j] & 0x7f) | (((msb >> j) & 1) << 7));
    }
  }
  return out;
}

// "F0 00 20 32 ..." for logs
export function hex(data: ArrayLike<number>): string {
  return Array.from(data as ArrayLike<number>, (b) =>
    b.toString(16).padStart(2, '0').toUpperCase(),
  ).join(' ');
}

// split a raw buffer (.syx file) into F0..F7 messages; stray bytes are ignored
export function splitSysex(buffer: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === SOX) start = i;
    else if (b === EOX && start >= 0) {
      out.push(buffer.slice(start, i + 1));
      start = -1;
    }
  }
  return out;
}
