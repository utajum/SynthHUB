// SynthTribe 3.3.4 CSV settings pages: JN-80 / PRO-800 synthtool_global_
// settings.csv (one settings block) and PROTON proton_global_settings.csv
// (one command per row). Rows and byte layouts in data/csv-settings.json
// (GeneralController::onReceiveSettingDataJN80 / PRO800, saveCsvValue,
// onReceiveProtonEntireData, SettingRow::sliderValueChanged).
//   block: read 77 <sel>, reply 78 <sel> <8-to-7 block>, write 78 <sel> <block>
//   cmd:   read 75, reply 76 (<cmd> <value>)..., write 74 10 <cmd> <value>
import data from '../../data/csv-settings.json';
import type { DeviceVariant } from '../../lib/types';
import {
  buildPKT,
  buildPKT77,
  buildPKT78,
  buildPKTNoValue,
  pack87,
  parseFrame,
  unpack87,
} from '../../lib/midi/sysex';

export interface CsvRow {
  title: string;
  group: string;
  kind: 'enum' | 'number' | 'bits';
  options?: string[];
  min?: number;
  max?: number;
  // block devices: byte offset and size (u16 little-endian) in the block
  at?: number;
  size?: number;
  signed?: boolean;
  // stored value = shown value * scale (PRO-800 BPM)
  scale?: number;
  // PRO-800 current preset: stored as number + bank * 100, bank at this byte
  presetBankAt?: number;
  // PROTON command
  cmd?: number;
}

export interface CsvDevice {
  mode: 'block' | 'cmd';
  sel?: [number, number];
  // bytes the host writes back (the reply carries 8-to-7 padding)
  length?: number;
  rows: CsvRow[];
}

const DEVICES = data as unknown as Record<string, CsvDevice>;
export const csvDevice = (slug: string): CsvDevice | undefined => DEVICES[slug];

// PROTON commands whose value is <lo7> <hi> (range 0-252)
const WIDE_CMDS = new Set([0x28, 0x2c]);

export function csvReadRequest(v: DeviceVariant, d: CsvDevice): Uint8Array {
  return d.mode === 'block'
    ? buildPKT77(v, d.sel![0], d.sel![1])
    : buildPKTNoValue(v, 0x75);
}

function getAt(block: number[], r: CsvRow): number {
  const lo = block[r.at!] ?? 0;
  const x = r.size === 2 ? lo | ((block[r.at! + 1] ?? 0) << 8) : lo;
  if (r.signed) return x & 0x80 ? x - 0x100 : x;
  if (r.presetBankAt !== undefined) return x % 100;
  return r.scale ? Math.round(x / r.scale) : x;
}

function setAt(block: number[], r: CsvRow, v: number) {
  let x = r.scale ? v * r.scale : v;
  if (r.presetBankAt !== undefined) x = v + block[r.presetBankAt] * 100;
  block[r.at!] = x & 0xff;
  if (r.size === 2) block[r.at! + 1] = (x >> 8) & 0xff;
}

// the settings block of a reply, or null if `msg` is not one
export function csvBlock(
  v: DeviceVariant,
  d: CsvDevice,
  msg: Uint8Array,
): number[] | null {
  const f = parseFrame(v, msg);
  if (!f || f.cmd !== 0x78 || d.mode !== 'block') return null;
  if (f.payload[0] !== d.sel![0] || f.payload[1] !== d.sel![1]) return null;
  const block = unpack87(f.payload.slice(2));
  return block.length >= d.length! ? block : null;
}

// row values of a block, in row order
export const csvBlockValues = (d: CsvDevice, block: number[]): number[] =>
  d.rows.map((r) => getAt(block, r));

// write frame: the block as read, rows set to `values`, cut to `length`
// and 8-to-7 packed without padding the last group (packBulkDumpDataPRO800)
export function csvBlockWrite(
  v: DeviceVariant,
  d: CsvDevice,
  block: number[],
  values: number[],
): Uint8Array {
  const b = block.slice(0, d.length);
  // the preset row last: it stores number + bank * 100
  for (const last of [false, true])
    d.rows.forEach((r, i) => {
      if ((r.presetBankAt !== undefined) === last) setAt(b, r, values[i]);
    });
  const p = pack87(b);
  const r = b.length % 7;
  return buildPKT78(v, [...d.sel!, ...(r ? p.slice(0, p.length - 7 + r) : p)]);
}

// PROTON: values by row from a 76 reply, or null
export function csvCmdValues(
  v: DeviceVariant,
  d: CsvDevice,
  msg: Uint8Array,
): (number | undefined)[] | null {
  const f = parseFrame(v, msg);
  if (!f || f.cmd !== 0x76 || d.mode !== 'cmd') return null;
  const got = new Map<number, number>();
  const p = f.payload;
  for (let i = 0; i + 1 < p.length;) {
    const cmd = p[i];
    if (WIDE_CMDS.has(cmd)) {
      if (i + 2 >= p.length) break;
      got.set(cmd, ((p[i + 1] & 0x7f) | (p[i + 2] << 7)) & 0xff);
      i += 3;
    } else {
      got.set(cmd, p[i + 1]);
      i += 2;
    }
  }
  return d.rows.map((r) => got.get(r.cmd!));
}

// PROTON: one setting. SynthTribe sends the value as one byte; above 127
// (VCF modulation depth) that byte is not valid SysEx, so it goes as the
// <lo7> <hi> pair the device uses in its own dump (not verified on hardware).
export function csvCmdWrite(v: DeviceVariant, r: CsvRow, value: number) {
  const x = value > 0x7f ? [value & 0x7f, value >> 7] : [value];
  return buildPKT(v, 0x74, [0x10, r.cmd!, ...x]);
}
