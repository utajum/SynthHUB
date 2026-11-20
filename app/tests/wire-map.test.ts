import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genericDriver } from '../src/devices/_shared/driver.ts';
import type { DeviceDef } from '../src/lib/types.ts';
import polyeight from '../src/data/devices/polyeight.json';

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

test('Polyeight channel/5 is one 0e 00 <in> <out> <usbin> <usbout> frame', () => {
  const def = polyeight as unknown as DeviceDef;
  const drv = genericDriver(def, def.variants[0]);
  const ch = def.functions[0].settings![0];
  const frames = drv.buildWireFrames(
    ch,
    { in: 16, out: 2, usbin: 3, usbout: 16 },
    'out',
  );
  assert.deepEqual(frames.map(hex), [
    'f0 00 20 32 00 01 3b 00 0e 00 10 02 03 10 f7',
  ]);
});
