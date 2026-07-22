// Poly-chain query + status (PolychainController).
// Query: cmd 0x7e no value, reply cmd 0x7e, payload[1..4].
// Op mode: cmd 0x03, 0x20/0x21 = master/member, 0x00 = off.
import type { DeviceVariant } from '../../lib/types';
import { buildPKTNoValue, parseFrame } from '../../lib/midi/sysex';

// poly-chain status query (cmd 0x7e, no value)
export function queryPolyChain(variant: DeviceVariant): Uint8Array {
  return buildPKTNoValue(variant, 0x7e);
}

interface PolyChainStatus {
  // raw payload of the 0x7e reply
  raw: number[];
  // updatePolyChain(a,b,c,d) arguments = payload[1..4]
  a: number;
  b: number;
  c: number;
  d: number;
}

// decode an inbound 0x7e poly-chain reply, or null
export function decodePolyChain(
  variant: DeviceVariant,
  data: Uint8Array,
): PolyChainStatus | null {
  const f = parseFrame(variant, data);
  if (!f || f.cmd !== 0x7e) return null;
  const p = f.payload;
  return { raw: p, a: p[1] ?? 0, b: p[2] ?? 0, c: p[3] ?? 0, d: p[4] ?? 0 };
}

// label for an operation-mode byte (cmd 0x03)
export function operationModeLabel(mode: number): string {
  switch (mode) {
    case 0x00:
      return 'Standalone';
    case 0x10:
      return 'Mode 0x10';
    case 0x20:
      return 'Poly-chain (master)';
    case 0x21:
      return 'Poly-chain (member)';
    default:
      return `Mode 0x${mode.toString(16)}`;
  }
}
