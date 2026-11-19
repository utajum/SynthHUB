import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCtAction,
  buildCtControl,
  buildCtSet,
  ctDevice,
  ctId,
  parseCtReply,
} from '../src/devices/_shared/controltribe.ts';
import { SwingLink, swHeader, swIO } from '../src/devices/_shared/swing.ts';

const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const ctl = (slug: string, method: string) =>
  ctDevice(slug)!.controls.find((c) => c.method === method)!;
const JAM = 'f0 00 20 32 00 01 40 7f';
const PLAY = 'f0 00 20 32 00 01 41 7f';

test('JAM: plain settings use the 00 01 40 7F header', () => {
  const out = ctl('jam', 'Settings_OutChannel');
  assert.equal(out.cmd, 0x16);
  assert.equal(hex(buildCtControl('jam', out, 5)), `${JAM} 16 05 f7`);
  assert.equal(hex(buildCtControl('jam', out, null)), `${JAM} 16 f7`);
  assert.equal(hex(buildCtAction('jam', [0x76, 1])), `${JAM} 76 01 f7`);
});

test('JAM: knob params carry knob + layer (0 / 4) before the value', () => {
  const cc = ctl('jam', 'Program_Knob2CC');
  const layer = ctl('jam', 'Program_Knob2Mode');
  assert.equal(layer.local, true);
  const v = { [ctId(layer)]: 4 };
  assert.equal(hex(buildCtControl('jam', cc, 0x30, v)), `${JAM} 59 05 30 f7`);
  assert.equal(hex(buildCtControl('jam', cc, 0x30)), `${JAM} 59 01 30 f7`);
  const r = parseCtReply(
    'jam',
    Uint8Array.from([...buildCtControl('jam', cc, 9, v)]),
    v,
  );
  assert.deepEqual(r, { id: ctId(cc), value: 9 });
});

test('JAM PLAY: CC bank before the knob slot; channel preset; USB mode', () => {
  const ch = ctl('jam-play', 'Program_Knob1Channel');
  const bank = ctl('jam-play', 'Program_CCBank');
  const v = { [ctId(bank)]: 1 };
  assert.equal(
    hex(buildCtControl('jam-play', ch, 3, v)),
    `${PLAY} 5a 01 00 03 f7`,
  );
  const preset = ctl('jam-play', 'channel_value');
  const pv = {
    [ctId(ctl('jam-play', 'sequence_savingMode'))]: 1,
    [ctId(ctl('jam-play', 'channel_sequnece'))]: 3,
    [ctId(ctl('jam-play', 'channel_channel'))]: 9,
  };
  assert.equal(
    hex(buildCtControl('jam-play', preset, 0x22, pv)),
    `${PLAY} 5e 01 03 09 22 f7`,
  );
  const usb = ctl('jam-play', 'Settings_UsbDetection');
  assert.equal(hex(buildCtControl('jam-play', usb, 2)), `${PLAY} 51 02 01 f7`);
  assert.equal(hex(buildCtControl('jam-play', usb, null)), `${PLAY} 51 f7`);
});

test('Swing frames are unchanged', () => {
  for (const c of ctDevice('swing')!.controls)
    assert.equal(
      hex(buildCtControl('swing', c, 3)),
      hex(buildCtSet('swing', c.cmd, 3, c.page)),
    );
  const c = ctDevice('qt32')!.controls.find((c) => c.page !== undefined)!;
  const f = buildCtSet('qt32', c.cmd, 7, c.page);
  assert.deepEqual(parseCtReply('qt32', f), { id: ctId(c), value: 7 });
});

test('JAM sequencer: Swing frames under the JAM header', async () => {
  const sent: string[] = [];
  let cb: (b: Uint8Array) => void = () => {};
  const io = swIO(
    {
      send: (b) => {
        sent.push(hex(b));
        // reply: 6F s len gate swing under the JAM header
        setTimeout(
          () =>
            cb(
              Uint8Array.from([...swHeader('jam'), 0x6f, 0, 16, 90, 50, 0xf7]),
            ),
          1,
        );
      },
      listen: (f) => ((cb = f), () => {}),
    },
    swHeader('jam'),
  );
  const p = await new SwingLink(io).query(0x6f, 0);
  assert.deepEqual(sent, [`${JAM} 6f 00 f7`]);
  assert.deepEqual(p, [0, 16, 90, 50]);
});
