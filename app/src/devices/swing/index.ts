// Behringer SWING (Control Tribe): 32-mini-key controller + step/arp
// sequencer. Bespoke SysEx frame F0 00 20 32 7F 42 <cmd> <val> F7.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/swing.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;

export const driver: DriverFactory = genericDriver;

export const hasSequencer = true;

export default { definition, driver, hasSequencer };
