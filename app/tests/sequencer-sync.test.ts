import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeqFile,
  parseSeqFile,
  requestPattern,
  SEQ12_BLOCKS,
  seq12Block,
  seq12Frames,
} from '../src/devices/_shared/sequencer-sync.ts';
import { pack87, parseFrame, unpack87 } from '../src/lib/midi/sysex.ts';
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
  const f = buildSeqFile('MP', '1', [data]);
  assert.equal(
    hex(f.subarray(0, 18)),
    '76 54 98 23 04 00 00 00 4d 00 50 00 02 00 00 00 31 00',
  );
  assert.equal(hex(f.subarray(18, 22)), '45 00 00 00');
  assert.deepEqual(parseSeqFile(f), [data]);
});

test('.seq file: wrong magic or truncated data is rejected', () => {
  const f = buildSeqFile('MP', '', [[1, 2, 3]]);
  assert.equal(parseSeqFile(f.subarray(0, f.length - 1)), null);
  const bad = Uint8Array.from(f);
  bad[0] ^= 1;
  assert.equal(parseSeqFile(bad), null);
});

test('pack87: SynthTribe PackSysexData layout, inverse of unpack87', () => {
  assert.deepEqual(pack87([0x80, 1, 0xff]), [5, 0, 1, 0x7f, 0, 0, 0, 0]);
  const raw = Array.from({ length: 0xe8 }, (_, i) => (i * 37) & 0xff);
  assert.equal(pack87(raw).length, 272);
  assert.deepEqual(unpack87(pack87(raw)).slice(0, 0xe8), raw);
});

test('.seq type 12: global, song, pattern blocks <-> three 0x78 frames', () => {
  const v = variant(rd765);
  const raws = SEQ12_BLOCKS.map((b) =>
    Array.from({ length: b.size }, (_, i) => (i * 11 + b.sel) & 0xff),
  );
  const blocks = raws.map((r) => pack87(r));
  assert.deepEqual(
    blocks.map((b) => b.length),
    [272, 160, 2368],
  );
  const file = buildSeqFile('RD-765', '1.0.0', blocks);
  const frames = seq12Frames(v, parseSeqFile(file)!, 2, 9)!;
  assert.equal(frames.length, 3);
  frames.forEach((fr, i) => {
    const f = parseFrame(v, fr)!;
    assert.equal(f.cmd, 0x78);
    assert.deepEqual(Array.from(f.payload.slice(0, 3)), [[2, 1, 0][i], 2, 9]);
    // export of a device reply gives the same block back
    assert.deepEqual(
      seq12Block(Array.from(f.payload), SEQ12_BLOCKS[i].size),
      blocks[i],
    );
  });
  assert.equal(seq12Frames(v, blocks.slice(0, 2), 0, 0), null);
  assert.equal(seq12Block([2, 0, 0, ...blocks[0].slice(0, 8)], 0xe8), null);
});
