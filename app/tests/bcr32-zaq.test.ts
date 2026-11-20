import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midi } from '../src/lib/midi/webmidi.ts';
import {
  LANE_DRUM,
  ZAQ_TRACK,
  ZaqLink,
  zaqApply,
  zaqData,
  zaqFormat,
  zaqFrame,
  zaqInWindow,
  zaqLaneEditable,
  zaqLaneRange,
  zaqLoadPreset,
  zaqPack,
  zaqParse,
  zaqReadAll,
  zaqStepWrite,
  zaqTrackWrite,
  zaqGlobalWrite,
} from '../src/devices/_shared/bcr32-zaq.ts';

const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const H = 'f0 00 20 32 7f 64';
const reply = (cmd: number, data: number[]) =>
  Uint8Array.from([0xf0, 0, 0x20, 0x32, 0x7f, 0x64, cmd, ...data, 0xf7]);

test('frames: BCR32ZaqSync::Request::toMessage', () => {
  assert.equal(
    hex(zaqFrame(zaqStepWrite(1, 7, 4, -1))),
    `${H} 44 02 01 07 04 03 7f 7f f7`,
  );
  assert.equal(
    hex(zaqFrame(zaqTrackWrite(3, ZAQ_TRACK.divider, 5))),
    `${H} 46 02 03 03 00 00 05 f7`,
  );
  assert.equal(
    hex(zaqFrame(zaqGlobalWrite(0, 1200))),
    `${H} 47 02 00 02 04 30 f7`,
  );
  assert.equal(hex(zaqFrame(zaqLoadPreset(37))), `${H} 48 02 00 00 25 f7`);
  const all = zaqReadAll().map((r) => hex(zaqFrame(r)).slice(H.length + 1, -3));
  assert.deepEqual(all.slice(0, 6), [
    '48 00',
    '47 01 00',
    '47 01 03',
    '47 01 04',
    '47 01 0a',
    '46 01 00 0d',
  ]);
  assert.equal(all[6 + 10], '45 01 00 00');
  assert.equal(all.length, 5 + 4 * (1 + 10 + 9));
});

// replies and the values BCR32::ZaqHost::parse gave for them (emulated,
// temp/bcrzaq/emu_parse.py)
test('replies: same values as ZaqHost::parse', () => {
  const lane: number[] = [];
  const want: number[] = [];
  for (let k = 0; k < 32; k++) {
    const v = Math.max(
      -32768,
      Math.min(32767, [0, 60, -1, 127, -300, 1000, -32768, 32767][k % 8] + k),
    );
    want.push(v);
    lane.push((v >> 8) & 0xff, v & 0xff);
  }
  const e = zaqParse(reply(0x45, [1, 2, 5, 0, ...zaqPack(lane)]))!;
  assert.deepEqual([e.op, e.track, e.param, e.status], [1, 2, 5, 0]);
  assert.deepEqual(e.values, want);
  assert.deepEqual(
    want.slice(0, 8),
    [0, 61, 1, 130, -296, 1005, -32762, 32767],
  );
  assert.deepEqual(
    zaqParse(reply(0x45, [1, 2, 5, 2, ...zaqPack(lane)]))!.values,
    [],
  );
  const d = zaqParse(reply(0x44, [1, 3, 31, 4, 0, 3, 0x7f, 0x7f]))!;
  assert.deepEqual([d.track, d.step, d.param, d.values], [3, 31, 4, [-1]]);
  const w = zaqParse(reply(0x44, [2, 1, 7, 0x12, 1, 0, 0, 1]))!;
  assert.deepEqual([w.op, w.status, w.param, w.values], [2, 1, 0x12, [1]]);
  assert.deepEqual(
    zaqParse(reply(0x46, [1, 1, 0x0b, 0, 3, 0x7f, 0x7a]))!.values,
    [-6],
  );
  assert.deepEqual(
    zaqParse(reply(0x47, [1, 0, 0, 2, 0x0b, 0x38]))!.values,
    [3000],
  );
  assert.equal(zaqParse(reply(0x47, [1, 0, 0])), null);
  assert.deepEqual(
    zaqParse(reply(0x48, [0, 0, ...zaqPack([1, 37, 2, 200, 0])]))!.values,
    [1, 37, 2, 200, 0],
  );
  assert.deepEqual(zaqParse(reply(0x48, [2, 0]))!.values, []);
});

test('data: apply, drum voices, ranges, format', () => {
  const z = zaqData();
  // track 2 becomes a drum track: its voice notes and mutes are read next
  const more = zaqApply(z, zaqParse(reply(0x46, [1, 2, 0x0d, 0, 0, 0, 1]))!);
  assert.equal(more.length, 32);
  assert.equal(hex(zaqFrame(more[1])), `${H} 46 01 02 20 f7`);
  // a drum step write sets one bit of the voice mask lane
  zaqApply(z, zaqParse(reply(0x44, [2, 2, 4, 0x13, 0, 0, 0, 1]))!);
  assert.equal(z.tracks[2].lanes[LANE_DRUM]![4], 8);
  zaqApply(z, zaqParse(reply(0x44, [2, 2, 4, 0x13, 0, 0, 0, 0]))!);
  assert.equal(z.tracks[2].lanes[LANE_DRUM]![4], 0);
  // refused writes change nothing
  zaqApply(z, zaqParse(reply(0x47, [2, 0, 2, 0, 0, 5]))!);
  assert.equal(z.globals[0], undefined);
  const t = z.tracks[0];
  t.params[ZAQ_TRACK.divider] = 4; // 1/16 = 6 ticks
  assert.deepEqual(zaqLaneRange(t, 3), [-5, 5]);
  t.params[ZAQ_TRACK.divider] = 0; // 1/1 = 96 ticks
  assert.deepEqual(zaqLaneRange(t, 3), [-95, 95]);
  t.params[ZAQ_TRACK.ctrlA] = -5; // ratchet
  assert.deepEqual(zaqLaneRange(t, 5), [-1, 8]);
  t.params[ZAQ_TRACK.ctrlB] = -4; // OFF
  assert.equal(zaqLaneEditable(t, 6), false);
  t.params[ZAQ_TRACK.start] = 5;
  t.params[ZAQ_TRACK.length] = 4;
  assert.deepEqual(
    [3, 4, 7, 8].map((s) => zaqInWindow(t, s)),
    [false, true, true, false],
  );
  // BCR32ZaqLaneEditor::format (emulated)
  assert.deepEqual(
    [
      zaqFormat(0, 60),
      zaqFormat(0, -8),
      zaqFormat(4, 11),
      zaqFormat(5, -1),
      zaqFormat(7, 0),
      zaqFormat(7, 3),
    ],
    ['C3', 'E-2', '1/3', '--', '--', '#3'],
  );
});

test('link: one request at a time, resend twice, then skip', async () => {
  const ls = new Set<(d: Uint8Array) => void>();
  const sent: string[] = [];
  let answer = true;
  Object.assign(midi, {
    onMessage: (l: (d: Uint8Array) => void) => (ls.add(l), () => ls.delete(l)),
    send: (_o: string, d: Uint8Array) => {
      sent.push(hex(d).slice(H.length + 1, -3));
      // echo a read with value 7, status 0
      if (answer && d[6] === 0x47)
        setTimeout(
          () => ls.forEach((l) => l(reply(0x47, [d[7], d[8], 0, 0, 0, 7]))),
          5,
        );
    },
  });
  const z = zaqData();
  const l = new ZaqLink('o', (r) => zaqApply(z, r));
  l.push(...zaqReadAll().slice(1, 3));
  await l.idle();
  assert.deepEqual(sent, ['47 01 00', '47 01 03']);
  assert.deepEqual([z.globals[0], z.globals[3]], [7, 7]);
  answer = false;
  sent.length = 0;
  l.push(zaqGlobalWrite(0, 1), zaqGlobalWrite(0, 2));
  await l.idle();
  // the two writes merged; sent three times, then dropped
  assert.deepEqual(sent, [
    '47 02 00 00 00 02',
    '47 02 00 00 00 02',
    '47 02 00 00 00 02',
  ]);
  assert.equal(l.missed, 1);
});
