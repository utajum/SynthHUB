// Behringer QT32 (Control Tribe): 32-key controller with pads, knobs,
// joystick and arpeggiator. SysEx: F0 00 20 32 7F 46 [7F] <cmd> <val> F7.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/qt32.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = false;

export default { definition, driver, hasSequencer };
