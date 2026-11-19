// Stable identity for a device parameter: function name + SysEx address
// (pkt/spkt), else the dump index, else type + position. Used as the store
// cache key, patch-library key and control DOM id, so it must be
// deterministic and collision-free within a device.
import type { DeviceSetting } from '../../lib/types';

export function paramKey(
  fnName: string,
  setting: DeviceSetting,
  position: number,
): string {
  const sx = setting.sysex;
  const index = setting.raw.index;
  const addr =
    sx && sx.pkt !== undefined
      ? `p${sx.pkt}${sx.spkt !== undefined ? `s${sx.spkt}` : ''}`
      : typeof index === 'number'
        ? `x${index}`
        : `i${position}`;
  return `${slug(fnName)}.${slug(setting.type)}.${addr}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
