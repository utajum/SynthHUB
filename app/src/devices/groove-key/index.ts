// Behringer GROOVE KEY (Control Tribe 1.12.4): keyboard groovebox: 4 tracks + drums, knobs and effects.
// @keep - hand-authored (Control Tribe device, no SynthTribe JSON config).
import def from '../../data/devices/groove-key.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;
export const driver: DriverFactory = genericDriver;
export const hasSequencer = false;

export default { definition, driver, hasSequencer };
