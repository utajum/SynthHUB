import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoreAck } from '../src/devices/_shared/sequencer-sync.ts';
import { buildPKT } from '../src/lib/midi/sysex.ts';
import type { DeviceDef } from '../src/lib/types.ts';
import rd78 from '../src/data/devices/rhythm-designer-rd-78.json';
import rd9 from '../src/data/devices/rd-9.json';

const variant = (d: unknown) => (d as DeviceDef).variants[0];

test('store ACK: <hdr> 01 <x> <status> yields the status byte', () => {
  const v = variant(rd78);
  assert.equal(parseStoreAck(v, buildPKT(v, 0x01, [0x00, 0x00])), 0);
  assert.equal(parseStoreAck(v, buildPKT(v, 0x01, [0x00, 0x05])), 5);
});

test('store ACK: other cmds and other models are ignored', () => {
  const v = variant(rd78);
  assert.equal(parseStoreAck(v, buildPKT(v, 0x78, [0x00, 0x00])), null);
  assert.equal(parseStoreAck(v, buildPKT(v, 0x01, [0x00])), null);
  assert.equal(parseStoreAck(v, buildPKT(variant(rd9), 0x01, [0, 0])), null);
});
