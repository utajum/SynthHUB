// Behringer BM-14M (GuitarTribe): A flanger / chorus modulation effect pedal
// (cloud bm14, protocol 3). Settings (output/mix, LFO wave/rate/amount,
// delay/feedback, bypass) are ported from the GuitarTribe app config;
// individual opcodes are as-shipped but hardware-unverified.
// @keep - hand-authored (GuitarTribe config, not generated from SynthTribe).
import def from '../../data/devices/bm-14m.json';
import { guitarTribeDriver } from '../_shared/guitartribe';
import type { DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;

export const driver: DriverFactory = guitarTribeDriver;

export const hasSequencer = false;

export default { definition, driver, hasSequencer };
