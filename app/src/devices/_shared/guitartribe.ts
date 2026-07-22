// GuitarTribe BM pedals speak MIDI CC on ch1, not SysEx. `controlvalue` holds
// the CC number(s): one -> 7-bit CC; two -> 14-bit pair (cv0=MSB, cv1=LSB,
// LSB sent first). Discrete controls index into `valuearray`; knobs scale by
// `valueratio` (+`valueconstant`). CC is write-only, so no read-back.
import { DeviceDriver, type DriverFactory } from './driver';
import type { DeviceSetting } from '../../lib/types';
import type { ReadbackValue } from './readback';

// CC status byte, channel 1
const CC_STATUS_CH1 = 0xb0;

function numArray(v: unknown): number[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'number')
    ? (v as number[])
    : null;
}

class GuitarTribeDriver extends DeviceDriver {
  // widget value -> wire value: index into valuearray, else scale by ratio
  private wireValue(
    raw: Record<string, unknown>,
    value: number,
    is14: boolean,
  ): number {
    const va = numArray(raw.valuearray);
    let wire: number;
    if (va && va.length > 0) {
      const idx = Math.max(0, Math.min(va.length - 1, Math.round(value)));
      wire = va[idx];
    } else {
      const ratio = typeof raw.valueratio === 'number' ? raw.valueratio : 1;
      const konst =
        typeof raw.valueconstant === 'number' ? raw.valueconstant : 0;
      wire = Math.round(value * ratio) + konst;
    }
    const maxWire = is14 ? 0x3fff : 0x7f;
    return Math.max(0, Math.min(maxWire, wire));
  }

  // MIDI CC message(s) for a control + widget value
  override buildSet(setting: DeviceSetting, value: number): Uint8Array | null {
    const raw = setting.raw as Record<string, unknown>;
    const cc = numArray(raw.controlvalue);
    if (!cc || cc.length === 0) return null;
    const is14 = cc.length >= 2;
    const wire = this.wireValue(raw, value, is14);
    if (is14) {
      // cv0=MSB, cv1=LSB; the app sends LSB first
      const msb = (wire >> 7) & 0x7f;
      const lsb = wire & 0x7f;
      return Uint8Array.from([
        CC_STATUS_CH1,
        cc[1] & 0x7f,
        lsb,
        CC_STATUS_CH1,
        cc[0] & 0x7f,
        msb,
      ]);
    }
    return Uint8Array.from([CC_STATUS_CH1, cc[0] & 0x7f, wire & 0x7f]);
  }

  // CC is write-only - no parameter read-back
  override readbackSupported(): boolean {
    return false;
  }
  override readKind(): null {
    return null;
  }
  override decodeReadback(): ReadbackValue[] | null {
    return null;
  }
}

export const guitarTribeDriver: DriverFactory = (def, variant) =>
  new GuitarTribeDriver(def, variant);
