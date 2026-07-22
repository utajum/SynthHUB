// Stable identity for a device parameter: function name + SysEx address
// (pkt/spkt) or type + position. Used as the store cache key and control DOM
// id, so it must be deterministic and collision-free within a device.
import type { DeviceSetting } from '../../lib/types';

export function paramKey(
  fnName: string,
  setting: DeviceSetting,
  position: number,
): string {
  const sx = setting.sysex;
  const addr =
    sx && sx.pkt !== undefined
      ? `p${sx.pkt}${sx.spkt !== undefined ? `s${sx.spkt}` : ''}`
      : `i${position}`;
  return `${slug(fnName)}.${slug(setting.type)}.${addr}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
