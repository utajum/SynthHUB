// Behringer BM-11M (GuitarTribe): An envelope-filter / auto-wah effect pedal
// (cloud bm11, protocol 3). Settings (Filter cutoff/resonance, envelope
// amount/mix) are ported from the GuitarTribe app config; individual opcodes
// are as-shipped but hardware-unverified.
// @keep - hand-authored (GuitarTribe config, not generated from SynthTribe).
import def from '../../data/devices/bm-11m.json';
import { guitarTribeDriver } from '../_shared/guitartribe';
import type { DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;

export const driver: DriverFactory = guitarTribeDriver;

export const hasSequencer = false;

export default { definition, driver, hasSequencer };
