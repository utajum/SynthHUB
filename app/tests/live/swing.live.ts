// Live hardware validation for the Swing file features (.swingseq sequence
// files, .swing projects) through the exact link + codecs the app uses.
// Everything written is read back, and the unit is restored to its pre-test
// state (verified by a full re-read).
//   SWING_HW=hw:7,0,0 SWING_SEQ=3 npm run test:live
// LIVE_SNAPSHOT_DIR keeps the pre-test state as a .swing project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SW_SEQS,
  SwingLink,
  swEmptySeq,
  swProjectFromJson,
  swProjectToJson,
  swSeqDiff,
  swSeqFromFile,
  swSeqToFile,
  type SwProject,
  type SwSeq,
} from '../../src/devices/_shared/swing';
import { ctDevice } from '../../src/devices/_shared/controltribe';
import { RawMidi } from './rawmidi';

const HW = process.env.SWING_HW ?? 'hw:7,0,0';
const SEQ = Number(process.env.SWING_SEQ ?? 3) - 1; // scratch sequence
const node = (() => {
  const m = /^hw:(\d+),(\d+)/.exec(HW);
  return m ? `/dev/snd/midiC${m[1]}D${m[2]}` : HW;
})();
const CMDS = ctDevice('swing')!.controls.map((c) => c.cmd);

async function readProject(l: SwingLink): Promise<SwProject> {
  const settings = await l.readSettings(CMDS);
  const seqs: SwSeq[] = [];
  for (let s = 0; s < SW_SEQS; s++) seqs.push(await l.readSeq(s));
  return { settings, seqs };
}

// a dense sequence: chords up to 8 notes, every attribute byte seen on
// hardware (1, 2-6, 18), all ratchets, notes beyond the length
function richSeq(): SwSeq {
  const q = swEmptySeq();
  q.len = 20;
  q.swing = 63;
  q.gate = 75;
  q.steps[0] = {
    ratchet: 2,
    notes: Array.from({ length: 8 }, (_, i) => ({ note: 48 + i * 3, vel: 10 + i * 15, len: 3 })),
  };
  q.steps[1] = { ratchet: 4, notes: [{ note: 60, vel: 127, len: 4 }] };
  q.steps[2] = { ratchet: 1, notes: [{ note: 60, vel: 127, len: 5 }] };
  q.steps[3] = { ratchet: 3, notes: [{ note: 60, vel: 127, len: 6 }] };
  q.steps[7] = { ratchet: 1, notes: [{ note: 1, vel: 1, len: 2 }, { note: 127, vel: 64, len: 1 }] };
  q.steps[19] = { ratchet: 1, notes: [{ note: 72, vel: 99, len: 18 }] };
  q.steps[40] = { ratchet: 2, notes: [{ note: 36, vel: 80, len: 3 }] }; // beyond len
  return q;
}

test('Swing: .swingseq / .swing round trips on hardware, unit restored', { skip: !existsSync(node) && `no ${node}` }, async (t) => {
  const io = new RawMidi(HW);
  const l = new SwingLink(io);
  try {
    const t0 = Date.now();
    const before = await readProject(l);
    const notes = before.seqs.reduce((n, q) => n + q.steps.reduce((m, s) => m + s.notes.length, 0), 0);
    t.diagnostic(`snapshot: ${CMDS.length} settings, 8 seqs, ${notes} notes in ${Date.now() - t0} ms`);
    const dir = process.env.LIVE_SNAPSHOT_DIR;
    if (dir) writeFileSync(join(dir, 'swing-before.swing'), swProjectToJson(before));

    // 1) the project file is lossless for the unit's own state
    const reparsed = swProjectFromJson(swProjectToJson(before));
    assert.deepEqual(reparsed.settings, before.settings);
    reparsed.seqs.forEach((q, s) => assert.deepEqual(swSeqDiff(before.seqs[s], q), [], `seq ${s + 1}`));

    try {
      // 2) a dense sequence through a .swingseq file onto the scratch slot
      const rich = swSeqFromFile(swSeqToFile(richSeq()));
      assert.equal(rich.dropped, 0);
      let frames = await l.writeSeq(SEQ, before.seqs[SEQ], rich);
      let got = await l.readSeq(SEQ);
      assert.deepEqual(swSeqDiff(rich, got), [], 'dense sequence read back');
      t.diagnostic(`dense .swingseq -> seq ${SEQ + 1}: ${frames} frames, read back exact`);
      assert.equal(await l.writeSeq(SEQ, got, rich), 0, 'rewrite of an equal sequence sends nothing');

      // 3) export every programmed sequence to a file and import it into the
      // scratch slot (copy between slots), over the dense content
      for (let s = 0; s < SW_SEQS; s++) {
        if (s === SEQ || before.seqs[s].len === 0) continue;
        const file = swSeqToFile(await l.readSeq(s));
        const q = swSeqFromFile(file);
        frames = await l.writeSeq(SEQ, got, q);
        got = await l.readSeq(SEQ);
        assert.deepEqual(swSeqDiff(before.seqs[s], got), [], `seq ${s + 1} copied via file`);
        t.diagnostic(`seq ${s + 1} -> file (${file.length} B) -> seq ${SEQ + 1}: ${frames} frames, exact`);
      }

      // 4) load an edited project (settings + the scratch sequence)
      const edited = swProjectFromJson(swProjectToJson(before));
      const fv = before.settings[0x2a];
      edited.settings[0x2a] = fv === 100 ? 101 : 100; // fixed velocity
      edited.settings[0x0d] = (before.settings[0x0d] + 1) & 0x7f; // sustain CC
      edited.seqs[SEQ] = richSeq();
      const cur = await readProject(l);
      const nSet = await l.writeSettings(edited.settings, cur.settings);
      for (let s = 0; s < SW_SEQS; s++) await l.writeSeq(s, cur.seqs[s], edited.seqs[s]);
      const after = await readProject(l);
      assert.equal(nSet, 2);
      assert.deepEqual(after.settings, edited.settings, 'project settings applied');
      after.seqs.forEach((q, s) => assert.deepEqual(swSeqDiff(edited.seqs[s], q), [], `project seq ${s + 1}`));
      t.diagnostic(`edited .swing project applied: ${nSet} settings + seq ${SEQ + 1}, read back exact`);
    } finally {
      // restore: the pre-test project, then verify with a full re-read
      const cur = await readProject(l);
      await l.writeSettings(before.settings, cur.settings);
      for (let s = 0; s < SW_SEQS; s++) await l.writeSeq(s, cur.seqs[s], before.seqs[s]);
      const final = await readProject(l);
      assert.deepEqual(final.settings, before.settings, 'settings restored');
      final.seqs.forEach((q, s) => assert.deepEqual(swSeqDiff(before.seqs[s], q), [], `seq ${s + 1} restored`));
      t.diagnostic('unit restored to its pre-test state (full re-read)');
    }
  } finally {
    io.close();
  }
});
