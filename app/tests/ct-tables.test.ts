import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCtControl,
  ctDevice,
  ctId,
  parseCtReplies,
} from '../src/devices/_shared/controltribe.ts';

const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const ctl = (slug: string, method: string) =>
  ctDevice(slug)!.controls.find((c) => c.method === method)!;
const QTP = 'f0 00 20 32 00 01 45 7f';
const GK = 'f0 00 20 32 00 01 42 00';

test('QT32 PLAY: per-param frames; 16-bit params as <flags> <hi> <lo>', () => {
  const pb = ctl('qt32-play', 'PitchBendRange');
  assert.equal(hex(buildCtControl('qt32-play', pb, 12)), `${QTP} 47 0c f7`);
  const bpm = ctl('qt32-play', 'ArpTempo');
  assert.equal(bpm.wide, true);
  assert.equal(
    hex(buildCtControl('qt32-play', bpm, 300)),
    `${QTP} 16 00 01 2c f7`,
  );
  const r = parseCtReplies('qt32-play', buildCtControl('qt32-play', bpm, 300));
  assert.deepEqual(r, [{ id: ctId(bpm), value: 300 }]);
});

test('GROOVE KEY: a group frame carries every param of the group', () => {
  const t2 = ctl('groove-key', 'Track2MidiChannelInput');
  const t1 = ctl('groove-key', 'Track1MidiChannelInput');
  const v = { [ctId(t1)]: 3 };
  const f = buildCtControl('groove-key', t2, 5, v);
  assert.equal(hex(f), `${GK} 74 10 03 05 00 00 00 f7`);
  assert.equal(hex(buildCtControl('groove-key', t2, null)), `${GK} 74 10 f7`);
  const r = parseCtReplies('groove-key', f)!;
  assert.equal(r.length, 5);
  assert.deepEqual(r.slice(0, 2), [
    { id: ctId(t1), value: 3 },
    { id: ctId(t2), value: 5 },
  ]);
});

test('table devices: every param is sent by a frame that contains it', () => {
  for (const slug of ['qt32-play', 'groove-key', 'pk61']) {
    const d = ctDevice(slug)!;
    assert.ok(d.controls.length > 100, slug);
    for (const c of d.controls) {
      assert.ok(
        c.args!.some((a) => a.value),
        `${slug} ${c.method}`,
      );
      for (const a of c.args!)
        if (a.peer)
          assert.ok(
            d.controls.some((x) => x.method === a.peer),
            `${slug} ${c.method} -> ${a.peer}`,
          );
    }
  }
});
