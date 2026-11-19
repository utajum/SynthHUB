import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeqFile,
  parseSeqFile,
  requestPattern,
} from '../src/devices/_shared/sequencer-sync.ts';
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

test('.seq file: SynthTribe layout round-trips the data block', () => {
  const data = Array.from({ length: 0x45 }, (_, i) => i & 0x7f);
  const f = buildSeqFile('MP', '1', data);
  assert.equal(
    hex(f.subarray(0, 18)),
    '76 54 98 23 04 00 00 00 4d 00 50 00 02 00 00 00 31 00',
  );
  assert.equal(hex(f.subarray(18, 22)), '45 00 00 00');
  assert.deepEqual(parseSeqFile(f), data);
});

test('.seq file: wrong magic or truncated data is rejected', () => {
  const f = buildSeqFile('MP', '', [1, 2, 3]);
  assert.equal(parseSeqFile(f.subarray(0, f.length - 1)), null);
  const bad = Uint8Array.from(f);
  bad[0] ^= 1;
  assert.equal(parseSeqFile(bad), null);
});
