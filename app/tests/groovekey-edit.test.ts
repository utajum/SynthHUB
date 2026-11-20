import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { midi } from '../src/lib/midi/webmidi.ts';
import { GK_ITEMS, gkWrite } from '../src/devices/_shared/groovekey-seq.ts';
import {
  GDP,
  GK_LANES,
  GK_PER_STEP,
  gkAddNote,
  gkBit,
  gkClearPattern,
  gkCopyPattern,
  gkDefault,
  gkDeleteNote,
  gkFlipBit,
  gkHitOff,
  gkDrumPatternOff,
  gkNote,
  gkNoteAtStep,
  gkNotes,
  gkPastePattern,
  gkPatternItem,
  gkPatternUsed,
  gkStepOn,
  gkToggleHit,
  gkToggleStep,
  gkTrackItem,
} from '../src/devices/_shared/groovekey-edit.ts';

test('new project equals ProjectData::resetToDefault (emulated)', () => {
  // the 34 bytes resetToDefault leaves alone (index, pad, 2 per drum
  // pattern) are 0 here and were zeroed in the reference
  const h = createHash('sha256').update(gkDefault()).digest('hex');
  assert.equal(
    h,
    'e9b816dbd40f2d37e744922b792a9b98a572c0dedfb560f20dee13c3accd0afd',
  );
});

test('notes: SequencerGrid add / delete / reindex, lanes', () => {
  const img = gkDefault();
  assert.equal(gkAddNote(img, 1, 2, 5, 60), 0);
  assert.equal(gkAddNote(img, 1, 2, 5, 64), 1);
  assert.equal(gkAddNote(img, 1, 2, 5, 60), null); // already there
  // the default note: velocity 127, no gate start, gate 1 step, shift 0,
  // rand pitch 100, type Note
  assert.deepEqual(
    Array.from(gkNote(img, 1, 2, 1)),
    [64, 0x7f, 0xff, 0x0b, 0x32, 0, 0x64, 1, 5, 1, 0, 0],
  );
  assert.equal(gkNoteAtStep(img, 1, 2, 5), 1); // the highest pitch
  gkDeleteNote(img, 1, 2, 0);
  assert.deepEqual(gkNotes(img, 1, 2), [
    { slot: 1, pitch: 64, step: 5, order: 0 },
  ]);
  for (let i = 0; i < 9; i++) gkAddNote(img, 1, 2, 9, 40 + i);
  assert.equal(
    gkNotes(img, 1, 2).filter((n) => n.step === 9).length,
    GK_PER_STEP,
  );
  const n = gkNote(img, 1, 2, 1);
  const start = GK_LANES[2];
  assert.equal(start.get(n), 0);
  start.set(n, 12);
  assert.deepEqual([n[2], start.show(12)], [11, '1.00']);
  start.set(n, 0);
  assert.equal(n[2], 0xff);
  GK_LANES[6].set(n, 9); // type clamps to 1-3
  assert.equal(n[7], 3);
  assert.equal(GK_LANES[3].show(GK_LANES[3].get(n)), '0');
});

test('steps, hits, patterns, items', () => {
  const img = gkDefault();
  assert.equal(gkStepOn(img, 0, 0, 17), false);
  gkToggleStep(img, 0, 0, 17);
  assert.equal(gkStepOn(img, 0, 0, 17), true);
  gkToggleHit(img, 3, 9, 63);
  assert.equal(img[gkHitOff(3, 9, 63)], 1);
  assert.equal(gkPatternUsed(img, 4, 3), true);
  const o = gkDrumPatternOff(3) + GDP.mute;
  assert.equal(gkBit(img, o, 9), true); // default: all bits set
  gkFlipBit(img, o, 9);
  assert.equal(img[o + 1], 0xfd);
  gkPastePattern(img, 4, 5, gkCopyPattern(img, 4, 3));
  assert.equal(gkPatternUsed(img, 4, 5), true);
  gkClearPattern(img, 4, 3);
  assert.equal(gkPatternUsed(img, 4, 3), false);
  assert.deepEqual(gkCopyPattern(img, 4, 3), gkCopyPattern(gkDefault(), 4, 0));
  assert.deepEqual([gkPatternItem(4, 15), gkTrackItem(4)], [GK_ITEMS - 1, 5]);
});

test('write selected items only', async () => {
  const ls = new Set<(d: Uint8Array) => void>();
  const sent: number[][] = [];
  Object.assign(midi, {
    onMessage: (l: (d: Uint8Array) => void) => (ls.add(l), () => ls.delete(l)),
    send: (_o: string, d: Uint8Array) => {
      sent.push([d[9], d[10]]);
      const ack = Uint8Array.from([
        0xf0, 0, 0x20, 0x32, 0, 1, 0x42, 0, 1, 0xf7,
      ]);
      setTimeout(() => ls.forEach((l) => l(ack)), 1);
    },
  });
  assert.equal(
    await gkWrite('o', gkDefault(), () => {}, [gkTrackItem(2)]),
    null,
  );
  assert.deepEqual(sent, [[0x31, 2]]);
});
