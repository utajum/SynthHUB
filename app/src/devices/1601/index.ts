// Behringer 1601 Sequencer (Control Tribe): ARP 1601-style 16-step analog
// sequencer. SysEx: F0 00 20 32 7F 47 <cmd> <val> F7.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/1601.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = false;

export default { definition, driver, hasSequencer };
