import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPattern } from '../src/devices/_shared/sequencer-sync.ts';
import type { DeviceDef } from '../src/lib/types.ts';
import rd765 from '../src/data/devices/rd-765.json';
import rd9 from '../src/data/devices/rd-9.json';

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const variant = (d: unknown) => (d as DeviceDef).variants[0];

test('song pattern request: RD-765 (type 12) uses selector 00', () => {
  const req = requestPattern(variant(rd765), 3, 5, { song: true, type: 12 });
  assert.equal(hex(req), 'f0 00 20 32 00 01 68 00 77 00 03 05 f7');
});

test('song pattern request: RD-9 (type 4) keeps selector 41', () => {
  const req = requestPattern(variant(rd9), 3, 5, { song: true, type: 4 });
  assert.match(hex(req), / 77 41 03 05 f7$/);
});
