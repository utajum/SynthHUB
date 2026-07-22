// MODEL 15 - PIDs 0x124d/0x124e, protocol 3. Uses the generic driver; its
// per-sub wire encodings (glide/legato, clock) are `wire` metadata in
// model-15.json handled by DeviceDriver.buildWireFrames.
// @keep - carries hand-recovered wire encodings.
import def from '../../data/devices/model-15.json';
import { genericDriver, type DriverFactory } from '../_shared/driver';
import type { DeviceDef } from '../../lib/types';

export const definition = def as unknown as DeviceDef;

export const driver: DriverFactory = genericDriver;

export const hasSequencer = false;

export default { definition, driver, hasSequencer };
