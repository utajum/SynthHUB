// Generic data-driven device driver: turns the normalized device JSON into
// wire traffic. Devices only subclass this when they deviate from the
// defaults (e.g. GuitarTribe CC pedals).
import type { DeviceDef, DeviceSetting, DeviceVariant } from '../../lib/types';
import {
  buildSetParam,
  buildGetParam,
  parseFrame,
  CMD_ENTIRE_PARAMS,
  frameHeader,
  encode7bit,
  EOX,
  hex,
} from '../../lib/midi/sysex';
import { midi } from '../../lib/midi/webmidi';
import { decompose } from './controls';
import { clampSub } from './validation';
import { wireSpecFor } from './wire-map';
import { mapDumpToParams, type ReadbackValue } from './readback';
import { buildReadbackRequest, specialReadKind } from './params-extra';

interface SendResult {
  ok: boolean;
  bytes: Uint8Array | null;
  hex: string;
}

export class DeviceDriver {
  constructor(
    public readonly def: DeviceDef,
    public readonly variant: DeviceVariant,
  ) {}

  // number of 7-bit value bytes a setting needs
  valueBytes(setting: DeviceSetting): number {
    const max =
      typeof setting.max === 'number'
        ? setting.max
        : typeof setting.raw.max === 'number'
          ? (setting.raw.max as number)
          : 127;
    return max > 127 ? 2 : 1;
  }

  // signed wire offset for a setting (e.g. transpose -12..12)
  offset(setting: DeviceSetting): number {
    return typeof setting.raw.offset === 'number'
      ? (setting.raw.offset as number)
      : 0;
  }

  // "set parameter" SysEx, or null if not addressable
  buildSet(setting: DeviceSetting, value: number): Uint8Array | null {
    if (!setting.sysex || setting.sysex.pkt === undefined) return null;
    return buildSetParam(this.variant, setting.sysex, value, {
      offset: this.offset(setting),
      valueBytes: this.valueBytes(setting),
    });
  }

  buildGet(setting: DeviceSetting): Uint8Array | null {
    if (!setting.sysex || setting.sysex.pkt === undefined) return null;
    return buildGetParam(this.variant, setting.sysex);
  }

  // every protocol family has a read-back path (0x75, poly, UB-Xa, Pro 16);
  // GuitarTribe overrides this to false (CC is write-only)
  readbackSupported(): boolean {
    return true;
  }

  // special read path this variant uses, if any
  readKind(): 'poly' | 'ubxa' | 'pro16' | null {
    return specialReadKind(this.variant, this.variant.name);
  }

  // send the "request settings" message; feed replies to decodeReadback.
  // read-only, never mutates device state
  requestReadback(outputId: string | undefined): SendResult {
    const bytes = buildReadbackRequest(this.variant, this.variant.name);
    const h = hex(bytes);
    if (!outputId) return { ok: false, bytes, hex: h };
    return { ok: midi.send(outputId, bytes), bytes, hex: h };
  }

  // decode a 0x76 dump addressed to this variant into store entries, else
  // null (ACKs, firmware replies, other devices)
  decodeReadback(data: Uint8Array): ReadbackValue[] | null {
    const r = parseFrame(this.variant, data);
    if (!r || r.cmd !== CMD_ENTIRE_PARAMS) return null;
    return mapDumpToParams(this.def, r.payload);
  }

  // Build one message for a whole setting from its sub-control values.
  // Simple settings collapse to a single value; composites emit the shared
  // pkt + one 7-bit value per sub-control in declaration order.
  buildSetting(
    setting: DeviceSetting,
    subValues: Record<string, number>,
  ): Uint8Array | null {
    const subs = decompose(setting);
    if (subs.length === 1 && subs[0].id === 'value') {
      const sub = subs[0];
      const v = clampSub(sub, subValues.value ?? Number(sub.default) ?? 0);
      // key_value dropdown: the wire byte is the mapped value (atoi(value)),
      // not the row index. Emit pkt [spkt] <mapped> directly.
      if (sub.valueMap && sub.valueMap.length) {
        if (!setting.sysex || setting.sysex.pkt === undefined) return null;
        const i = Math.max(0, Math.min(sub.valueMap.length - 1, v));
        const bytes = frameHeader(this.variant);
        bytes.push(setting.sysex.pkt & 0x7f);
        if (setting.sysex.spkt !== undefined) {
          bytes.push(setting.sysex.spkt & 0x7f);
        }
        bytes.push(sub.valueMap[i] & 0x7f);
        bytes.push(EOX);
        return Uint8Array.from(bytes);
      }
      return this.buildSet(setting, v);
    }
    if (!setting.sysex || setting.sysex.pkt === undefined) return null;
    const bytes = frameHeader(this.variant);
    bytes.push(setting.sysex.pkt & 0x7f);
    if (setting.sysex.spkt !== undefined) bytes.push(setting.sysex.spkt & 0x7f);
    for (const sub of subs) {
      const v = clampSub(sub, subValues[sub.id] ?? Number(sub.default) ?? 0);
      bytes.push(...encode7bit(v - (sub.offset ?? 0), 1));
    }
    bytes.push(EOX);
    return Uint8Array.from(bytes);
  }

  // Frames for a setting with a bespoke (type, subtype) encoding in WIRE_MAP
  // (glide/legato, clock, channel, ...). perSub = one message per sub-control;
  // single = one message with a fixed payload. Values are clamped first.
  buildWireFrames(
    setting: DeviceSetting,
    subValues: Record<string, number>,
    changedSubId?: string,
  ): Uint8Array[] {
    const spec = wireSpecFor(setting);
    if (!spec) return [];
    const byId = new Map(decompose(setting).map((s) => [s.id, s]));
    const valueOf = (id: string): number => {
      const sc = byId.get(id);
      const raw = subValues[id] ?? (sc ? Number(sc.default) : 0) ?? 0;
      return sc ? clampSub(sc, raw) : Math.max(0, Math.trunc(Number(raw)) || 0);
    };
    // control value -> wire byte: index->value table wins, else signed offset
    const toWire = (v: number, values?: number[], offset?: number): number => {
      if (values && values.length) {
        return values[Math.max(0, Math.min(values.length - 1, v))] & 0x7f;
      }
      return (v - (offset ?? 0)) & 0x7f;
    };

    if (spec.kind === 'perSub') {
      // send only the sub the user changed (re-sending siblings could reset
      // them); emit all mapped subs when the changed sub is unknown
      const subs = (spec.subs ?? []).filter(
        (ss) => changedSubId === undefined || ss.id === changedSubId,
      );
      const list = subs.length ? subs : (spec.subs ?? []);
      const frames: Uint8Array[] = [];
      for (const ss of list) {
        if (!byId.has(ss.id)) continue;
        const bytes = frameHeader(this.variant);
        bytes.push(ss.pkt & 0x7f);
        if (ss.spkt !== undefined) bytes.push(ss.spkt & 0x7f);
        bytes.push(toWire(valueOf(ss.id), ss.values, ss.offset));
        bytes.push(EOX);
        frames.push(Uint8Array.from(bytes));
      }
      return frames;
    }

    // single frame: header + pkt + [spkt] + payload items
    const pkt = spec.pkt ?? setting.sysex?.pkt;
    if (pkt === undefined) return [];
    const bytes = frameHeader(this.variant);
    bytes.push(pkt & 0x7f);
    if (spec.spkt !== undefined) bytes.push(spec.spkt & 0x7f);
    for (const it of spec.items ?? []) {
      if (it.const !== undefined) {
        bytes.push(it.const & 0x7f);
      } else if (it.sub !== undefined) {
        let v = valueOf(it.sub);
        if (it.invert) v = v ? 0 : 1;
        bytes.push(toWire(v, it.values, it.offset));
      }
    }
    bytes.push(EOX);
    return [Uint8Array.from(bytes)];
  }

  // send a full setting (simple or composite) and return the wire result
  sendSetting(
    outputId: string | undefined,
    setting: DeviceSetting,
    subValues: Record<string, number>,
    changedSubId?: string,
  ): SendResult {
    // WIRE_MAP types emit dedicated frames; the rest use the generic frame
    const frames = this.buildWireFrames(setting, subValues, changedSubId);
    if (frames.length > 0) {
      const h = frames.map((f) => hex(f)).join('  ');
      const last = frames[frames.length - 1];
      if (!outputId) return { ok: false, bytes: last, hex: h };
      let ok = true;
      for (const f of frames) ok = midi.send(outputId, f) && ok;
      return { ok, bytes: last, hex: h };
    }
    const bytes = this.buildSetting(setting, subValues);
    if (!bytes) return { ok: false, bytes: null, hex: '' };
    const h = hex(bytes);
    if (!outputId) return { ok: false, bytes, hex: h };
    return { ok: midi.send(outputId, bytes), bytes, hex: h };
  }

  // send a pre-built SysEx frame and return the wire result for logging
  sendRaw(outputId: string | undefined, bytes: Uint8Array): SendResult {
    const h = hex(bytes);
    if (!outputId) return { ok: false, bytes, hex: h };
    return { ok: midi.send(outputId, bytes), bytes, hex: h };
  }

  // send a single setting value via the matched MIDI output
  send(
    outputId: string | undefined,
    setting: DeviceSetting,
    value: number,
  ): SendResult {
    const bytes = this.buildSet(setting, value);
    if (!bytes) return { ok: false, bytes: null, hex: '' };
    const h = hex(bytes);
    if (!outputId) return { ok: false, bytes, hex: h };
    const ok = midi.send(outputId, bytes);
    return { ok, bytes, hex: h };
  }

  // fallback send by matching the output port name to the device aliases
  sendByName(setting: DeviceSetting, value: number): SendResult {
    const bytes = this.buildSet(setting, value);
    if (!bytes) return { ok: false, bytes: null, hex: '' };
    const aliases = [this.variant.name, ...this.variant.aliases].map((a) =>
      a.toLowerCase(),
    );
    const ok = midi.sendToNamed(
      (name) => aliases.some((a) => name.toLowerCase().includes(a)),
      bytes,
    );
    return { ok, bytes, hex: hex(bytes) };
  }
}

export type DriverFactory = (
  def: DeviceDef,
  variant: DeviceVariant,
) => DeviceDriver;

// default factory for devices without a bespoke driver
export const genericDriver: DriverFactory = (def, variant) =>
  new DeviceDriver(def, variant);
