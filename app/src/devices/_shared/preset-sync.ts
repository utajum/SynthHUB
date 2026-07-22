// Preset requests (GeneralController). Device replies 0x76,
// decoded by the normal read-back path.
import type { DeviceVariant } from '../../lib/types';
import { buildPKT } from '../../lib/midi/sysex';

// request the active preset (cmd 0x00, payload [0x00]); reply: 0x76
export function requestActivePreset(variant: DeviceVariant): Uint8Array {
  return buildPKT(variant, 0x00, [0x00]);
}

// request ALL presets (cmd 0x00, payload [0x20]); reply: 0x76 dump(s)
export function requestAllPresets(variant: DeviceVariant): Uint8Array {
  return buildPKT(variant, 0x00, [0x20]);
}
