import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jArr,
  jDouble,
  jInt,
  jProp,
  jStr,
  vtRead,
  vtWrite,
} from '../src/devices/_shared/juce-valuetree.ts';
import {
  jamProjectCmds,
  jamProjectFromFile,
  jamProjectToFile,
  swEmptySeq,
} from '../src/devices/_shared/swing.ts';

const project = () => {
  const seqs = Array.from({ length: 8 }, swEmptySeq);
  seqs[2].len = 12;
  seqs[2].swing = 55;
  seqs[2].gate = 70;
  seqs[2].steps[4].notes.push({ note: 60, vel: 127, len: 4 });
  seqs[2].steps[4].ratchet = 3;
  // Out channel 0x16 = wire 5 -> "5"; aftertouch CC 0x14 slider = 74
  return { settings: { 0x16: 5, 0x14: 74 }, seqs };
};

test('.jam: Control Tribe ValueTree layout', () => {
  const t = vtRead(jamProjectToFile('jam', project()));
  assert.equal(t.type, 'root');
  assert.deepEqual(jProp(t, 'JAM-0001'), jStr('5'));
  assert.deepEqual(jProp(t, 'JAM-0043'), jDouble(74));
  assert.equal(t.children.length, 8);
  const s3 = t.children[2];
  assert.deepEqual(jProp(s3, 'name'), jStr('Seq3'));
  assert.deepEqual(jProp(s3, 'JAM-0048'), jDouble(12));
  assert.deepEqual(jProp(s3, 'JAM-0050'), jStr('70%'));
  // [row, beat, velocity 0-1, attribute, ratchet]
  assert.deepEqual(
    jProp(s3, 'notes'),
    jArr([jArr([jInt(67), jDouble(4), jDouble(1), jInt(4), jInt(3)])]),
  );
});

test('.jam / .jamplay: round-trip', () => {
  for (const slug of ['jam', 'jam-play']) {
    const p = project();
    const r = jamProjectFromFile(slug, jamProjectToFile(slug, p));
    assert.deepEqual(r.settings, p.settings);
    assert.deepEqual(r.seqs, p.seqs);
    assert.equal(r.dropped, 0);
  }
  assert.ok(jamProjectCmds('jam-play').length > jamProjectCmds('jam').length);
});

test('.jam: reads Control Tribe files, rejects others', () => {
  // as Control Tribe writes it: gate text, children found by name
  const ct = vtWrite({
    type: 'root',
    props: [['JAM-0003', jStr('On')]],
    children: [
      {
        type: 'Seq1',
        props: [
          ['name', jStr('Seq1')],
          ['JAM-0050', jStr('80%')],
          [
            'notes',
            jArr([
              jArr([jInt(60), jDouble(0), jDouble(0.5), jInt(3), jInt(1)]),
            ]),
          ],
        ],
        children: [],
      },
    ],
  });
  const r = jamProjectFromFile('jam', ct);
  assert.equal(r.settings[0x08], 1);
  assert.equal(r.seqs[0].gate, 80);
  assert.deepEqual(r.seqs[0].steps[0].notes, [{ note: 67, vel: 64, len: 3 }]);
  assert.throws(
    () => jamProjectFromFile('jam', Uint8Array.of(1, 2)),
    /not a .jam/,
  );
  assert.throws(
    () => jamProjectFromFile('jam-play', ct),
    /not a .jamplay project/,
  );
});
