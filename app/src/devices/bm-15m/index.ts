// Behringer BM-15M "MURF BOX" (GuitarTribe): 8-band resonant filter animator
// pedal (cloud bm15, protocol 3); opcodes as-shipped, hardware-unverified.
// @keep - hand-authored (GuitarTribe config, not generated from SynthTribe).
import def from '../../data/devices/bm-15m.json';
import { guitarTribeDriver } from '../_shared/guitartribe';
import type { DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;

export const driver: DriverFactory = guitarTribeDriver;

export const hasSequencer = false;

export default { definition, driver, hasSequencer };
