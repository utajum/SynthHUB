// Read paths beyond the general 0x75/0x76 flow, plus factory reset and CSV
// import/export. Request builders ported from GeneralController::
// readGlobalParameters / restoreFactorySettings / readSettingValueUBXa /
// getAllPro16Parameter.
import type { DeviceDef, DeviceVariant } from '../../lib/types';
import {
  buildPKT77,
  buildPKTNoValue,
  buildNoPKTNoDevId,
} from '../../lib/midi/sysex';
import { decompose } from './controls';
import { paramKey } from './paramKey';

// poly (family 5) read-back: `77 7e 03`; the reply is a normal 0x76 dump
function requestPolyReadback(variant: DeviceVariant): Uint8Array {
  return buildPKT77(variant, 0x7e, 3);
}

// UB-Xa read-back: no command/device-id byte, array `7f 74 07 03 7f` + the
// ASCII tag "BIN Globals" space-padded to 16 chars (captured byte-exact)
function requestUBXaReadback(variant: DeviceVariant): Uint8Array {
  const tag = Array.from('BIN Globals', (c) => c.charCodeAt(0));
  while (tag.length < 16) tag.push(0x20);
  return buildNoPKTNoDevId(variant, [0x7f, 0x74, 0x07, 0x03, 0x7f, ...tag]);
}

// Pro 16 read-back: plain 0x75 (the device replies on its own cmd)
function requestPro16Readback(variant: DeviceVariant): Uint8Array {
  return buildPKTNoValue(variant, 0x75);
}

// which special read path (if any) a variant uses instead of plain 0x75
export function specialReadKind(
  variant: DeviceVariant,
  deviceName: string,
): 'poly' | 'ubxa' | 'pro16' | null {
  if (variant.protocol === 5) return 'poly';
  const n = deviceName.toLowerCase();
  if (n.startsWith('ub-xa')) return 'ubxa';
  if (n === 'pro 16' || n === 'pro16') return 'pro16';
  return null;
}

// the correct read-back request for a variant (general or special)
export function buildReadbackRequest(
  variant: DeviceVariant,
  deviceName: string,
): Uint8Array {
  switch (specialReadKind(variant, deviceName)) {
    case 'poly':
      return requestPolyReadback(variant);
    case 'ubxa':
      return requestUBXaReadback(variant);
    case 'pro16':
      return requestPro16Readback(variant);
    default:
      return buildPKTNoValue(variant, 0x75);
  }
}

// restore factory settings (DESTRUCTIVE - callers must confirm first): plain
// no-value cmd 0x7d
export function buildRestoreFactory(variant: DeviceVariant): Uint8Array {
  return buildPKTNoValue(variant, 0x7d);
}

// CSV export / import (mirrors saveCsvValue)

interface CsvRow {
  key: string;
  label: string;
  value: number;
}

// flatten the current param store for a device into CSV rows
export function paramsToCsvRows(
  def: DeviceDef,
  params: Record<string, number>,
): CsvRow[] {
  const rows: CsvRow[] = [];
  def.functions.forEach((fn) => {
    (fn.settings ?? []).forEach((setting, position) => {
      const base = paramKey(fn.name, setting, position);
      for (const sub of decompose(setting)) {
        const key = `${base}:${sub.id}`;
        if (key in params) {
          rows.push({
            key,
            label:
              sub.label !== setting.title
                ? `${setting.title} - ${sub.label}`
                : setting.title,
            value: params[key],
          });
        }
      }
    });
  });
  return rows;
}

// serialize param rows to CSV (key,label,value)
export function toCsv(rows: CsvRow[]): string {
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const head = 'key,label,value';
  const body = rows
    .map((r) => `${esc(r.key)},${esc(r.label)},${r.value}`)
    .join('\n');
  return `${head}\n${body}\n`;
}

// parse a CSV string back into {key: value}; unknown/blank rows are ignored
export function fromCsv(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  for (const line of lines) {
    if (line.startsWith('key,')) continue; // header
    // split respecting simple quoting
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') {
        cells.push(cur);
        cur = '';
      } else cur += c;
    }
    cells.push(cur);
    const key = cells[0];
    const value = Number(cells[cells.length - 1]);
    if (key && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
