import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  GK_ITEMS,
  GK_SIZE,
  gkApply,
  gkFileText,
  gkFromFile,
  gkPack,
  gkToJson,
  gkUnpack,
  gkWriteFrames,
} from '../src/devices/_shared/groovekey-seq.ts';

const lcg = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out[i] = (x >> 16) % 100;
  }
  return out;
};
const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

test('.gkseq JSON equals ProjectData::exportToFile (emulated) byte for byte', () => {
  // SHA-256 of the "project" object Control Tribe wrote for this image
  const j = JSON.stringify(gkToJson(lcg(GK_SIZE)));
  assert.equal(
    createHash('sha256').update(j).digest('hex'),
    'f4782e757830f54afb7f86f1122c1eb10e193da65151f4aa36827f22627855bf',
  );
});

test('.gkseq: file round-trip and rejects', () => {
  const img = lcg(GK_SIZE);
  const t = gkFileText(img);
  assert.ok(
    t.startsWith(
      '{"format": "GrooveKeySequencer", "formatVersion": 1, "device": "Groove Key", "project": {"index": ',
    ),
  );
  const back = gkFromFile(t) as Uint8Array;
  assert.deepEqual(gkToJson(back), gkToJson(img));
  assert.match(String(gkFromFile('{"format":"x"}')), /not a valid GrooveKey/);
  assert.match(String(gkFromFile('nope')), /not a valid GrooveKey/);
});

test('8-to-7 packing', () => {
  const d = [0x80, 1, 0xff, 0x7f, 0x40, 0x81, 0, 0x90, 2];
  const p = gkPack(d);
  assert.equal(hex(p.slice(0, 8)), '52 00 01 7f 7f 40 01 00');
  assert.deepEqual(gkUnpack(p), d);
});

test('device blocks: write frames read back into the same image', () => {
  const img = lcg(GK_SIZE);
  const copy = new Uint8Array(GK_SIZE);
  for (let n = 0; n < GK_ITEMS; n++) {
    const frames = gkWriteFrames(img, n);
    let raw: number[];
    if (frames[0][9] === 0x31) raw = Array.from(frames[0].slice(11, -1));
    else {
      // header 50 <type>, then 51 <count> <n> <len> chunks
      assert.equal(frames[0][9], 0x50);
      raw = frames.slice(1).flatMap((f, i) => {
        assert.equal(f[11], i + 1);
        assert.equal(f[12], (f.length - 14 + 14) & 0x7f);
        return Array.from(f.slice(13, -1));
      });
    }
    gkApply(copy, n, raw);
  }
  // every field Control Tribe saves survives the device round-trip
  assert.deepEqual(gkToJson(copy), gkToJson(img));
  // pattern 1 of track 2: 50 32, then 14 chunks of <= 0x72 bytes
  const f = gkWriteFrames(img, 6 + 16 + 1);
  assert.equal(hex(f[0]), 'f0 00 20 32 00 01 42 00 74 50 32 f7');
  assert.equal(f[1][10], f.length - 1);
});
