// Behringer JAM PLAY (Control Tribe): JAM plus sounds and effects. SysEx:
// F0 00 20 32 00 01 41 7F <cmd> [args] <val> F7; Swing sequencer frames.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/jam-play.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = true;

export default { definition, driver, hasSequencer };
