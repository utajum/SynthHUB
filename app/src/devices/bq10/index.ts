// Behringer BQ10 (Control Tribe): 3-channel x 8-step CV/gate sequencer.
// SysEx: F0 00 20 32 7F 48 <cmd> <val> F7.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/bq10.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = false;

export default { definition, driver, hasSequencer };
