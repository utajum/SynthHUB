// Behringer PK61 (Control Tribe 1.12.4): 61-key PolyKeys controller: knobs, faders, drawbars, pads, DAW buttons.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/pk61.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = false;

export default { definition, driver, hasSequencer };
