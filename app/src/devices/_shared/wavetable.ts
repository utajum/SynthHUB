// Behringer Wave bulk data (WavetableController / WavePresetController).
// Slot names: cmd 0x74 sub 0x60, 8-to-7 packed fixed-width ASCII.
import type { DeviceVariant } from '../../lib/types';
import { parseFrame, unpack87 } from '../../lib/midi/sysex';

// decode wave slot names (cmd 0x74 / sub 0x60), split on NUL
export function decodeWaveSlotNames(
  variant: DeviceVariant,
  data: Uint8Array,
): string[] | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x74 || (f.payload[0] ?? 0) !== 0x60) return null;
  const bytes = unpack87(f.payload.slice(1));
  const names: string[] = [];
  let cur = '';
  for (const b of bytes) {
    if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
    else if (b === 0) {
      if (cur.trim()) names.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) names.push(cur.trim());
  return names;
}
