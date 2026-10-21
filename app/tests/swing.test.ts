import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jArr,
  jDouble,
  jInt,
  jStr,
  vtRead,
  vtWrite,
  type ValueTree,
} from '../src/devices/_shared/juce-valuetree.ts';
import {
  SW_POLY,
  SwingLink,
  swEmptySeq,
  swFrame,
  swParse,
  swProjectFromJson,
  swProjectToJson,
  swSeqDiff,
  swSeqFromFile,
  swSeqToFile,
  type SwSeq,
} from '../src/devices/_shared/swing.ts';
import { ctDevice } from '../src/devices/_shared/controltribe.ts';
import type { MidiIO } from '../src/devices/_shared/midi-io.ts';

// ---- JUCE ValueTree stream ----

test('ValueTree bytes match the JUCE stream layout', () => {
  const t: ValueTree = {
    type: 'S',
    props: [
      ['a', jInt(300)],
      ['b', jStr('hi')],
      ['c', jArr([jInt(1)])],
    ],
    children: [{ type: 'K', props: [], children: [] }],
  };
  // type\0 cint(3) | a\0 cint(5) 01 int32 | b\0 cint(4) 05 'hi'\0 |
  // c\0 cint(1+9) 07 [cint(1) cint(5) 01 int32] | cint(1) child K\0 00 00
  const want = [
    0x53, 0, 1, 3,
    0x61, 0, 1, 5, 1, 0x2c, 0x01, 0, 0,
    0x62, 0, 1, 4, 5, 0x68, 0x69, 0,
    0x63, 0, 1, 10, 7, 1, 1, 1, 5, 1, 1, 0, 0, 0,
    1, 1, 0x4b, 0, 0, 0,
  ];
  assert.deepEqual([...vtWrite(t)], want);
  assert.deepEqual(vtRead(Uint8Array.from(want)), t);
});

test('ValueTree round-trips every var type', () => {
  const t: ValueTree = {
    type: 'root',
    props: [
      ['void', { t: 'void' }],
      ['undef', { t: 'undefined' }],
      ['yes', { t: 'bool', v: true }],
      ['no', { t: 'bool', v: false }],
      ['neg', jInt(-5)],
      ['big', { t: 'int64', v: 1n << 40n }],
      ['pi', jDouble(Math.PI)],
      ['utf', jStr('Seq \u00e4 \u2713')], // multi-byte UTF-8
      ['bin', { t: 'binary', v: Uint8Array.from([0, 255, 7]) }],
      ['nest', jArr([jArr([jDouble(0.5), jStr('')]), jInt(70000)])],
    ],
    children: [{ type: 'c', props: [['x', jInt(1)]], children: [] }],
  };
  assert.deepEqual(vtRead(vtWrite(t)), t);
  assert.throws(() => vtRead(vtWrite(t).subarray(0, 20)), /truncated/);
});

// ---- .swingseq ----

const seqWith = (f: (q: SwSeq) => void): SwSeq => {
  const q = swEmptySeq();
  f(q);
  return q;
};

test('.swingseq: a ControlTribe export decodes (row, beat, velocity, attr)', () => {
  // what CT writes: Length/Swing doubles, Gate text, name, then notes
  const ct = vtWrite({
    type: 'Sequence',
    props: [
      ['Swing-0048', jDouble(16)],
      ['Swing-0049', jDouble(62)],
      ['Swing-0050', jStr('75%')],
      ['name', jStr('SeqExp')],
      [
        'notes',
        jArr([
          jArr([jInt(127 - 60), jDouble(0), jDouble(100 / 127), jInt(3)]),
          jArr([jInt(127 - 64), jDouble(0), jDouble(1), jInt(4)]),
          jArr([jInt(127 - 48), jDouble(15), jDouble(0.5), jInt(6)]),
          jArr([jInt(127 - 50), jDouble(64), jDouble(0.5), jInt(3)]), // off grid
        ]),
      ],
    ],
    children: [],
  });
  const q = swSeqFromFile(ct);
  assert.equal(q.len, 16);
  assert.equal(q.swing, 62);
  assert.equal(q.gate, 75);
  assert.deepEqual(q.steps[0].notes, [
    { note: 60, vel: 100, len: 3 },
    { note: 64, vel: 127, len: 4 },
  ]);
  assert.deepEqual(q.steps[15].notes, [{ note: 48, vel: 64, len: 6 }]);
  assert.equal(q.dropped, 1);
});

const sample = (): SwSeq =>
  seqWith((q) => {
    q.len = 35;
    q.gate = 60;
    q.swing = 0; // never set
    q.steps[0] = {
      ratchet: 3,
      notes: [
        { note: 60, vel: 127, len: 18 },
        { note: 60, vel: 40, len: 1 }, // duplicate note numbers happen
      ],
    };
    q.steps[63] = { ratchet: 4, notes: [{ note: 127, vel: 1, len: 2 }] };
    q.steps[10].ratchet = 0; // virgin step
  });

test('.swingseq round-trips losslessly (raw note bytes, ratchets, 0 values)', () => {
  const q = sample();
  const back = swSeqFromFile(swSeqToFile(q));
  assert.equal(back.dropped, 0);
  const { dropped: _d, ...rest } = back;
  assert.deepEqual(rest, q);
});

// ---- .swing project ----

const swingControls = () => ctDevice('swing')!.controls;

test('.swing project round-trips settings and all 8 sequences', () => {
  const settings: Record<number, number> = {};
  for (const c of swingControls()) settings[c.cmd] = c.default;
  Object.assign(settings, { 0x16: 8, 0x07: 9, 0x21: 126, 0x13: 65, 0x2b: 61, 0x4f: 12, 0x57: 100, 0x0a: 85 });
  const seqs = Array.from({ length: 8 }, (_, k) => (k === 7 ? sample() : swEmptySeq()));
  const back = swProjectFromJson(swProjectToJson({ settings, seqs }));
  assert.deepEqual(back.settings, settings);
  assert.deepEqual(back.seqs, seqs);
  assert.equal(back.dropped, 0);
});

test('.swing project: a ControlTribe save (text values, no extras) decodes', () => {
  const ct = {
    model: 'Swing',
    version: '01.00.00',
    MidiControllerSettings: {
      'Swing-0001': 1, // CT keeps the user channel as an int
      'Swing-0002': '1',
      'Swing-0003': 'Off',
      'Swing-0005': 'Both',
      'Swing-0009': 'User',
      'Swing-0013': '1 step (Gate)',
      'Swing-0014': '3 taps',
      'Swing-0016': 'Tie to next',
      'Swing-0020': 'jump',
      'Swing-0021': 'as recorded',
      'Swing-0022': 78,
      'Swing-0024': 'None',
      'Swing-0025': 'ON',
      'Swing-0026': 'C3',
      'Swing-0028': 'F0',
      'Swing-0032': '5 V',
      'Swing-0044': 2,
      'Swing-0008': 'User', // sustain "Channel": no wire command, ignored
    },
    SeqSettings: {
      Seq0: {
        tabindex: 0,
        'Swing-0048': 16.0,
        'Swing-0049': 50.0,
        'Swing-0050': '90%',
        Grid: {
          notes: [
            { note: 60, beat: 0.0, velocity: 100, attribute: 'Standard' },
            { note: 62, beat: 1.0, velocity: 127, attribute: 'TieStart' },
            { note: 62, beat: 2.0, velocity: 127, attribute: 'TieEnd' },
          ],
        },
      },
    },
  };
  const p = swProjectFromJson(JSON.stringify(ct));
  assert.deepEqual(p.settings, {
    0x07: 1,
    0x08: 1,
    0x16: 0,
    0x0f: 2,
    0x13: 65,
    0x20: 0,
    0x22: 1,
    0x2c: 1,
    0x28: 0,
    0x29: 0,
    0x2a: 78,
    0x21: 126,
    0x26: 1,
    0x2b: 60,
    0x4c: 29,
    0x4f: 5,
    0x50: 2,
  });
  const q = p.seqs[0];
  assert.equal(q.len, 16);
  assert.equal(q.gate, 90);
  assert.deepEqual(q.steps[1].notes, [{ note: 62, vel: 127, len: 4 }]);
  assert.deepEqual(q.steps[2].notes, [{ note: 62, vel: 127, len: 6 }]);
  assert.deepEqual(p.seqs[1], swEmptySeq());
  assert.throws(() => swProjectFromJson('{"model":"RD-9"}'), /not a Swing/);
});

// ---- link against a modelled device ----

// Device model from live observation (fw 1.1.52): 68 fills the first free
// slot, auto-extends the length and gives a virgin sequence gate 60; every
// write is acked by an empty echo except 72 (store), which is silent.
class FakeSwing implements MidiIO {
  seqs: SwSeq[] = Array.from({ length: 8 }, swEmptySeq);
  slots = this.seqs.map(() =>
    Array.from({ length: 64 }, () => ({ ratchet: 0, n: [0, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 0, 0], l: [0, 0, 0, 0, 0, 0, 0, 0] })),
  );
  settings: Record<number, number> = { 0x07: 1, 0x0a: 90, 0x16: 1 };
  sent: number[][] = [];
  private ls = new Set<(b: Uint8Array) => void>();
  listen(cb: (b: Uint8Array) => void) {
    this.ls.add(cb);
    return () => this.ls.delete(cb);
  }
  private reply(...d: number[]) {
    const f = swFrame(...d);
    queueMicrotask(() => [...this.ls].forEach((l) => l(f)));
  }
  send(bytes: Uint8Array) {
    const m = swParse(bytes)!;
    const [s, st, a, b] = m.data;
    this.sent.push([m.cmd, ...m.data]);
    const q = this.seqs[s];
    const sl = this.slots[s]?.[st];
    switch (m.cmd) {
      case 0x6f:
        return this.reply(0x6f, s, q.len, q.gate, q.swing);
      case 0x71:
        return this.reply(0x71, s, st, sl.ratchet, ...sl.n, ...sl.v, ...sl.l);
      case 0x68: {
        const i = sl.n.indexOf(0);
        if (i >= 0) [sl.n[i], sl.v[i], sl.l[i]] = [a, 100, 3];
        if (q.len === 0 && q.gate === 0) q.gate = 60;
        if (st >= q.len) q.len = st + 1;
        break;
      }
      case 0x6a: {
        const i = sl.n.indexOf(a);
        if (i >= 0) [sl.n[i], sl.v[i], sl.l[i]] = [0, 0, 0];
        break;
      }
      case 0x6e:
      case 0x69: {
        const i = sl.n.indexOf(a);
        if (i >= 0) (m.cmd === 0x6e ? sl.l : sl.v)[i] = b;
        break;
      }
      case 0x58:
        sl.ratchet = a;
        break;
      case 0x6b:
        q.len = st;
        break;
      case 0x6c:
        q.swing = st;
        break;
      case 0x6d:
        q.gate = st;
        break;
      case 0x72:
        return; // store: never answered
      default:
        if (m.data.length === 0) return this.reply(m.cmd, this.settings[m.cmd] ?? 0);
        this.settings[m.cmd] = s;
    }
    this.reply(m.cmd);
  }
}

test('SwingLink writes a sequence exactly, then is a no-op, then restores a virgin one', async () => {
  const dev = new FakeSwing();
  const l = new SwingLink(dev, 100);
  const target = sample();
  // duplicate note numbers cannot be addressed separately - keep one
  target.steps[0].notes.pop();
  const v0 = await l.readSeq(2);
  assert.deepEqual(swSeqDiff(v0, swEmptySeq()), []); // ratchet 0 == 1
  const n = await l.writeSeq(2, v0, target);
  assert.ok(n > 0);
  const got = await l.readSeq(2);
  assert.deepEqual(swSeqDiff(target, got), []);
  assert.equal(await l.writeSeq(2, got, target), 0, 'nothing to do when equal');
  await l.writeSeq(2, got, v0);
  assert.deepEqual(swSeqDiff(v0, await l.readSeq(2)), []);
  const full = seqWith((q) => {
    q.len = 1;
    q.steps[0].notes = Array.from({ length: SW_POLY }, (_, i) => ({ note: 40 + i, vel: 90, len: 3 }));
  });
  await l.writeSeq(3, await l.readSeq(3), full);
  // the first add gives a virgin sequence gate 60 - re-asserted to 0
  assert.deepEqual(swSeqDiff(full, await l.readSeq(3)), []);
});

test('SwingLink settings: only changes are written, then an unacked store', async () => {
  const dev = new FakeSwing();
  const l = new SwingLink(dev, 100);
  const cur = await l.readSettings([0x07, 0x0a, 0x16]);
  assert.deepEqual(cur, { 0x07: 1, 0x0a: 90, 0x16: 1 });
  dev.sent = [];
  assert.equal(await l.writeSettings({ 0x07: 5, 0x0a: 90, 0x16: 0 }, cur), 2);
  assert.deepEqual(dev.sent, [[0x07, 5], [0x16, 0], [0x72, 0]]);
  assert.deepEqual(await l.readSettings([0x07, 0x16]), { 0x07: 5, 0x16: 0 });
});
