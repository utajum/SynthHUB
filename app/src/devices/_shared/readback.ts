// Device -> UI settings read-back. Firmware: 0x75 request -> one 0x76 dump;
// each value is payload[setting.index]
// (GeneralController::setEntireParameterSettings).
import type { DeviceDef } from '../../lib/types';
import { decompose } from './controls';
import { paramKey } from './paramKey';

export interface ReadbackValue {
  // store key: `${paramKey(fn,setting,pos)}:${sub.id}`
  key: string;
  // decoded value (payload byte plus the sub-control's signed offset)
  value: number;
  // label for logging, e.g. "Key Priority"
  label: string;
}

function clamp(
  v: number,
  lo: number | undefined,
  hi: number | undefined,
): number {
  if (typeof lo === 'number' && v < lo) return lo;
  if (typeof hi === 'number' && v > hi) return hi;
  return v;
}

// Map a 0x76 dump payload to store entries. Only sub-controls with a numeric
// in-bounds `index` are emitted, so short/partial dumps never corrupt others.
export function mapDumpToParams(
  def: DeviceDef,
  payload: number[],
): ReadbackValue[] {
  const out: ReadbackValue[] = [];
  def.functions.forEach((fn) => {
    (fn.settings ?? []).forEach((setting, position) => {
      const base = paramKey(fn.name, setting, position);
      for (const sub of decompose(setting)) {
        const idx = sub.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= payload.length)
          continue;
        const raw = payload[idx] & 0x7f;
        // key_value dropdown: dump byte is a wire value; map back to the index
        const value =
          sub.valueMap && sub.valueMap.length
            ? Math.max(0, sub.valueMap.indexOf(raw))
            : clamp(raw + (sub.offset ?? 0), sub.min, sub.max);
        out.push({
          key: `${base}:${sub.id}`,
          value,
          label:
            sub.label !== setting.title
              ? `${setting.title} ${sub.label}`
              : setting.title,
        });
      }
    });
  });
  return out;
}
