import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvBlock,
  csvBlockValues,
  csvBlockWrite,
  csvCmdValues,
  csvCmdWrite,
  csvDevice,
  csvReadRequest,
} from '../src/devices/_shared/csv-settings.ts';
import { buildReadbackRequest } from '../src/devices/_shared/params-extra.ts';
import {
  buildPKT78,
  buildPKT,
  hex,
  pack87,
  parseFrame,
  unpack87,
} from '../src/lib/midi/sysex.ts';
import type { DeviceDef } from '../src/lib/types.ts';
import jn80 from '../src/data/devices/jn-80.json';
import pro800 from '../src/data/devices/pro-800.json';
import proton from '../src/data/devices/proton.json';

const vJn = (jn80 as unknown as DeviceDef).variants[0];
const vPro = (pro800 as unknown as DeviceDef).variants[0];
const vProton = (proton as unknown as DeviceDef).variants[0];
const tail = (b: Uint8Array, n: number) => hex(b.slice(b.length - n - 1, -1));
// unpack87 of an unpadded pack: pad the last group, keep `n` bytes
const unpackN = (p: number[], n: number) =>
  unpack87([...p, ...Array(8).fill(0)]).slice(0, n);
const title = (slug: string, t: string) =>
  csvDevice(slug)!.rows.findIndex((r) => r.title === t);

test('read requests: JN-80 77 74 03, PRO-800 77 7e 03, PROTON 75', () => {
  assert.equal(tail(csvReadRequest(vJn, csvDevice('jn-80')!), 3), '77 74 03');
  assert.equal(
    tail(csvReadRequest(vPro, csvDevice('pro-800')!), 3),
    '77 7E 03',
  );
  assert.equal(tail(csvReadRequest(vProton, csvDevice('proton')!), 1), '75');
  // the generic read-back sends the same JN-80 request
  assert.equal(tail(buildReadbackRequest(vJn, vJn.name), 3), '77 74 03');
});

test('PRO-800 block: preset + bank * 100, BPM * 10, signed transpose', () => {
  const d = csvDevice('pro-800')!;
  const block = Array.from({ length: 42 }, (_, i) => i);
  [block[5], block[6]] = [302 & 0xff, 302 >> 8]; // bank 3, preset 2
  [block[13], block[14]] = [1200 & 0xff, 1200 >> 8];
  block[20] = 3;
  block[37] = 0xfe;
  block[9] = 0b101;
  const reply = buildPKT78(vPro, [0x7e, 3, ...pack87(block)]);
  const b = csvBlock(vPro, d, reply)!;
  const v = csvBlockValues(d, b);
  assert.equal(v[title('pro-800', 'Current Preset')], 2);
  assert.equal(v[title('pro-800', 'Bank')], 3);
  assert.equal(v[title('pro-800', 'BPM')], 120);
  assert.equal(v[title('pro-800', 'Transpose')], -2);
  assert.equal(v[title('pro-800', 'Voice kill')], 5);

  // BPM 130, preset 7 in bank 1: the rest of the block goes back as read
  v[title('pro-800', 'BPM')] = 130;
  v[title('pro-800', 'Current Preset')] = 7;
  v[title('pro-800', 'Bank')] = 1;
  const w = csvBlockWrite(vPro, d, b, v);
  const p = parseFrame(vPro, w)!;
  assert.equal(p.cmd, 0x78);
  assert.deepEqual(p.payload.slice(0, 2), [0x7e, 3]);
  // 40 bytes: 5 groups of 7 + a last group of 5, not padded
  assert.equal(p.payload.length - 2, 5 * 8 + 6);
  const out = unpackN(p.payload.slice(2), 40);
  const want = block.slice(0, 40);
  [want[5], want[6]] = [107, 0];
  [want[13], want[14]] = [1300 & 0xff, 1300 >> 8];
  want[20] = 1;
  assert.deepEqual(out, want);
});

test('JN-80 block: u16 rows, reserved and recall bytes kept, 236 bytes', () => {
  const d = csvDevice('jn-80')!;
  const block = Array.from({ length: 238 }, (_, i) => (i * 7) & 0xff);
  [block[31], block[32]] = [1000 & 0xff, 1000 >> 8];
  block[17] = 2;
  const b = csvBlock(vJn, d, buildPKT78(vJn, [0x74, 3, ...pack87(block)]))!;
  const v = csvBlockValues(d, b);
  assert.equal(v[title('jn-80', 'Bender Dead Zone')], 1000);
  assert.equal(v[title('jn-80', 'Sync Source')], 2);
  assert.equal(v[title('jn-80', 'Voicekill')], block[75]);
  v[title('jn-80', 'Sync Source')] = 1;
  const p = parseFrame(vJn, csvBlockWrite(vJn, d, b, v))!;
  assert.deepEqual(p.payload.slice(0, 2), [0x74, 3]);
  assert.equal(p.payload.length - 2, 33 * 8 + 6);
  const want = block.slice(0, 236);
  want[17] = 1;
  assert.deepEqual(unpackN(p.payload.slice(2), 236), want);
  // a reply from another device or a short block is not a settings block
  assert.equal(csvBlock(vJn, d, buildPKT78(vJn, [0x7e, 3])), null);
});

test('PROTON: 76 pairs (28 / 2C as lo7 hi), 74 10 cmd value writes', () => {
  const d = csvDevice('proton')!;
  const reply = buildPKT(vProton, 0x76, [0x21, 1, 0x28, 0x7c, 1, 0x49, 2]);
  const v = csvCmdValues(vProton, d, reply)!;
  assert.equal(v[title('proton', 'Extra Panel Functions')], 1);
  assert.equal(v[title('proton', 'VCF 1 Modulation Depth')], 252);
  assert.equal(v[title('proton', 'Sub Osc Shape')], 2);
  assert.equal(v[title('proton', 'Key Split')], undefined);
  const depth = d.rows[title('proton', 'VCF 1 Modulation Depth')];
  assert.equal(tail(csvCmdWrite(vProton, depth, 100), 4), '74 10 28 64');
  assert.equal(tail(csvCmdWrite(vProton, depth, 200), 5), '74 10 28 48 01');
  // 3.3.4 CSV fixes: "Key Split" and a parsed C8
  const split = d.rows[title('proton', 'Key Split')];
  assert.equal(split.options!.at(-1), 'C8');
});
