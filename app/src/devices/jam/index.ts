// Behringer JAM (Control Tribe): Swing successor. SysEx: F0 00 20 32 00 01
// 40 7F <cmd> [args] <val> F7; sequencer frames match the Swing.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/jam.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = true;

export default { definition, driver, hasSequencer };
