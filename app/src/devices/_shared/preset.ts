// Preset backup/restore as .syx files, mirroring the desktop app's
// openSyxFile/exportPreset: export concatenates one set-parameter message per
// addressable setting; import splits the file and streams the Music Tribe
// messages back to the device.
import type { DeviceDef } from '../../lib/types';
import type { DeviceDriver } from './driver';
import { decompose } from './controls';
import { paramKey } from './paramKey';
import { splitSysex, isMusicTribeSysex } from '../../lib/midi/sysex';
import { midi } from '../../lib/midi/webmidi';

// build a .syx from every addressable setting, using cached values in `params`
// (falling back to each control's default)
export function buildPresetSyx(
  def: DeviceDef,
  driver: DeviceDriver,
  params: Record<string, number>,
): Uint8Array {
  const out: number[] = [];
  for (const fn of def.functions) {
    (fn.settings ?? []).forEach((setting, pos) => {
      if (!setting.sysex || setting.sysex.pkt === undefined) return;
      const base = paramKey(fn.name, setting, pos);
      const subValues: Record<string, number> = {};
      for (const sub of decompose(setting)) {
        subValues[sub.id] =
          params[`${base}:${sub.id}`] ?? Number(sub.default) ?? 0;
      }
      const bytes = driver.buildSetting(setting, subValues);
      if (bytes) out.push(...bytes);
    });
  }
  return Uint8Array.from(out);
}

// stream a .syx file's Music Tribe messages to the device; returns the count
// sent (0 if no output)
export function sendPresetSyx(
  outputId: string | undefined,
  bytes: Uint8Array,
): number {
  if (!outputId) return 0;
  let n = 0;
  for (const msg of splitSysex(bytes)) {
    if (isMusicTribeSysex(msg) && midi.send(outputId, msg)) n++;
  }
  return n;
}
