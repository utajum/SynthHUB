// Sample-device bulk dumps (RD-8 / LM-DRUM / BMX / RD-78) (SampleController).
// Inbound cmd 0x78, sub at payload[0]: 0x30 SMPH, 0x31 user data, 0x4x bank.
// Body 8-to-7 packed from payload[3] (sub + 2 index bytes).
import type { DeviceVariant } from '../../lib/types';
import { parseFrame, unpack87 } from '../../lib/midi/sysex';

type SampleDumpKind = 'infos' | 'userData' | 'bank' | 'unknown';

interface SampleDump {
  kind: SampleDumpKind;
  sub: number;
  // 8-to-7 unpacked body bytes
  bytes: number[];
  // sample names parsed from "SMPH" records (infos dumps only)
  names: string[];
}

function subKind(sub: number): SampleDumpKind {
  if (sub === 0x30) return 'infos';
  if (sub === 0x31) return 'userData';
  if ((sub & 0xf0) === 0x40) return 'bank';
  return 'unknown';
}

// scan an infos body for "SMPH" records; name bytes follow at +8..+0x1e
function parseSampleNames(bytes: number[]): string[] {
  const names: string[] = [];
  for (let i = 0; i + 0x1f < bytes.length; i++) {
    if (
      bytes[i] === 0x53 && // S
      bytes[i + 1] === 0x4d && // M
      bytes[i + 2] === 0x50 && // P
      bytes[i + 3] === 0x48 // H
    ) {
      let name = '';
      for (let j = 8; j < 0x1f; j++) {
        const c = bytes[i + j];
        if (c >= 0x20 && c < 0x7f) name += String.fromCharCode(c);
        else if (c === 0) break;
      }
      names.push(name.trim() || `sample ${names.length + 1}`);
      i += 0x1e;
    }
  }
  return names;
}

// decode an inbound sample dump (cmd 0x78 + sub 0x30/0x31/0x4x), or null
export function decodeSampleDump(
  variant: DeviceVariant,
  data: Uint8Array,
): SampleDump | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x78) return null;
  const sub = f.payload[0] ?? 0;
  const kind = subKind(sub);
  if (kind === 'unknown') return null;
  const bytes = unpack87(f.payload.slice(3));
  return {
    kind,
    sub,
    bytes,
    names: kind === 'infos' ? parseSampleNames(bytes) : [],
  };
}

// banks a bank file can target (SampleController ctor: 16)
export const SAMPLE_BANK_COUNT = 16;

// Bank import (ST 3.3.1 importOneBankData): a one-message `0x78 0x4x` file
// goes to `bank` with sub = 0x40 + bank. Null if `data` is not a bank dump.
export function retargetBank(
  variant: DeviceVariant,
  data: Uint8Array,
  bank: number,
): Uint8Array | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x78 || ((f.payload[0] ?? 0) & 0xf0) !== 0x40)
    return null;
  const out = Uint8Array.from(data);
  // sub byte = first payload byte; the payload stops before a trailing F7
  const end = data[data.length - 1] === 0xf7 ? data.length - 1 : data.length;
  out[end - f.payload.length] = 0x40 | (bank & 0x0f);
  return out;
}
