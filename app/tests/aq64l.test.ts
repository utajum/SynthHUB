import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AQ_KEY_PALETTE,
  aqApplyTool,
  aqCustomFrames,
  aqKeyName,
  aqKeyStroke,
  aqPad,
  aqPreset,
  aqPresetFromJson,
  aqPresetToJson,
  aqRegion,
  aqRegionSettings,
  aqSetRegion,
} from '../src/devices/_shared/aq64l.ts';

const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const H = 'f0 00 20 32 00 01 6d 7f';

// the inputs of the buildMessages emulation (temp/aq64l/emu_custom.py)
test('custom mode frames match AQ64LCustomSync::buildMessages', () => {
  const p = aqPreset();
  p.pads = p.pads.map((_, i) =>
    aqPad({
      colour: 0xff50b0ff,
      onColour: 0,
      type: i % 12,
      note: 0x1c,
      octaves: 0x1d,
      mode: 0x1e,
      channel: 0x1f,
      param1: 0x20,
      param2: 0x21,
    }),
  );
  p.modes[0].function = 1;
  p.modes[2].function = 1;
  const f = aqCustomFrames(p, 3, 0).map((x) => hex(x).slice(H.length + 1, -3));
  assert.deepEqual(f.slice(0, 2), [
    '17 03',
    '1a 03 03 00 00 3d 43 40 34 4c 03 00',
  ]);
  const pad = (i: number) =>
    f.filter(
      (x) =>
        x.startsWith(`1`) &&
        x.split(' ')[2] === i.toString(16).padStart(2, '0') &&
        !x.startsWith('17') &&
        !x.startsWith('1a'),
    );
  assert.deepEqual(pad(0), [
    '16 03 00 00 00 00',
    '12 03 00 00 00 00',
    '13 03 00 0d 00 00 00',
  ]);
  assert.deepEqual(pad(1), [
    '16 03 01 00 00 00',
    '12 03 01 28 58 7f',
    '13 03 01 05 00 20 00',
  ]);
  assert.deepEqual(pad(4).slice(2), ['13 03 04 10 00 20 00']);
  assert.deepEqual(pad(5), [
    '16 03 05 00 00 00',
    '12 03 05 00 00 00',
    '13 03 05 0d 00 00 00',
  ]);
  assert.deepEqual(pad(7), [
    '16 03 07 00 00 00',
    '11 03 07 1c 1d 05',
    '12 03 07 28 58 7f',
  ]);
  assert.deepEqual(pad(9).slice(2), ['13 03 09 1e 00 20 21']);
  assert.deepEqual(pad(10).slice(2), ['13 03 0a 03 00 20 00']);
  assert.deepEqual(pad(11).slice(2), ['13 03 0b 11 00 20 21']);
  assert.equal(f.at(-1), '1d 03');
  assert.equal(f.length, 2 + 64 * 3 + 1);
});

test('.aq64l: Control Tribe JSON round-trip and envelope checks', () => {
  const p = aqPreset();
  aqApplyTool(p, 9, 10);
  p.modes[2].function = 1;
  const j = aqPresetToJson(p);
  const o = JSON.parse(j);
  assert.equal(o.format, 'AQ64LPreset');
  assert.equal(o.pads[10].colour, 0xffffc480 | 0);
  assert.deepEqual(aqPresetFromJson(j), p);
  assert.equal(aqPresetFromJson('{'), 'It is not a valid JSON file.');
  assert.equal(
    aqPresetFromJson('{"device":"QT32"}'),
    'It is not an AQ64L file.',
  );
  assert.equal(
    aqPresetFromJson('{"device":"AQ64L","format":"AQ64LLightEffect"}'),
    'It is a AQ64LLightEffect file, not a AQ64LPreset file.',
  );
  assert.match(
    String(
      aqPresetFromJson(j.replace('"formatVersion": 1', '"formatVersion": 2')),
    ),
    /newer version/,
  );
});

test('tools: regions', () => {
  const p = aqPreset();
  assert.deepEqual(aqApplyTool(p, 1, 19), [3, 11, 19, 27, 35, 43, 51, 59]);
  assert.equal(aqApplyTool(p, 5, 0).length, 16);
  assert.equal(p.pads[0].param2, 1); // gap above C
  assert.equal(p.pads[8].note, 0);
  assert.equal(aqApplyTool(p, 7, 63).length, 16);
  // a tool over a keyboard removes all of it
  aqApplyTool(p, 8, 15);
  assert.equal(p.pads.slice(0, 16).filter((d) => d.type === 5).length, 0);
});

test('regions: scale keyboard, chromatic, drum grid settings', () => {
  const p = aqPreset();
  const n = (i: number) => p.pads[i].octaves * 12 + p.pads[i].note;
  // scale keyboard rows 6-7: bottom-left pad = root (C3 = 60), minor
  aqApplyTool(p, 6, 50);
  assert.deepEqual(
    [56, 57, 58, 59, 60, 61, 62, 63].map(n),
    [60, 62, 63, 65, 67, 68, 70, 72],
  );
  assert.equal(n(48), 72); // the row above: one octave up
  aqSetRegion(p, 49, { note: 2, mode: 2, octaves: 4 }); // D major, octave 2
  assert.deepEqual(
    [56, 57, 58, 59, 60, 61, 62, 63].map(n),
    [50, 52, 54, 55, 57, 59, 61, 62],
  );
  assert.deepEqual(aqRegionSettings(p, 63), {
    ...aqRegionSettings(p, 56),
    note: 2,
    octaves: 4,
    mode: 2,
  });
  assert.ok(p.pads.slice(48).every((d) => d.mode === 2 && d.param1 === 48));
  // root colour on the roots only
  aqSetRegion(p, 56, { root: AQ_KEY_PALETTE[0], key: AQ_KEY_PALETTE[3] });
  assert.equal(p.pads[56].colour, AQ_KEY_PALETTE[0]);
  assert.equal(p.pads[63].colour, AQ_KEY_PALETTE[0]);
  assert.equal(p.pads[57].colour, AQ_KEY_PALETTE[3]);
  // chromatic keyboard: octave only; drum grid: start note, channel id
  aqApplyTool(p, 5, 0);
  aqSetRegion(p, 3, { octaves: 6 });
  assert.equal(n(8), 72);
  assert.equal(n(1), 73);
  assert.equal(p.pads[3].param2, 1);
  aqApplyTool(p, 7, 20);
  assert.deepEqual(
    aqRegion(p, 20),
    [20, 21, 22, 23, 28, 29, 30, 31, 36, 37, 38, 39, 44, 45, 46, 47],
  );
  aqSetRegion(p, 20, { note: 2, octaves: 3, channel: 17 });
  assert.equal(n(44), 38);
  assert.equal(n(47), 41);
  assert.equal(n(20), 50);
  assert.ok(aqRegion(p, 20).every((i) => p.pads[i].channel === 17));
  // regions stay apart: the keyboards keep their settings
  assert.equal(aqRegionSettings(p, 0).octaves, 6);
  assert.equal(aqRegionSettings(p, 63).mode, 2);
});

test('key strokes', () => {
  const k = aqKeyStroke({
    code: 'KeyS',
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
  })!;
  assert.deepEqual(k, { key: 0x16, mods: 3 });
  assert.equal(aqKeyName(k.key, k.mods), 'Ctrl+Shift+S');
});

test('program page frames match AQ64LProgramPage (emulated)', async () => {
  const m = await import('../src/devices/_shared/aq64l.ts');
  const f = (x: Uint8Array | null) =>
    x ? hex(x).slice(H.length + 1, -3) : null;
  // nearest of the 128 device colours
  assert.deepEqual(
    [0xffff0000, 0xff00ff00, 0xff0000ff, 0xff804020].map(m.aqNearest),
    [5, 21, 45, 105],
  );
  assert.equal(f(m.aqToolFrame(0, 0, 0xffff0000, 9)), '70 03 09 7f 00 00');
  assert.equal(f(m.aqToolFrame(0, 1, 0xffff0000, 9)), '70 01 09 05 00');
  assert.equal(f(m.aqToolFrame(0, 2, 0xff804020, 9)), '70 02 09 69');
  assert.equal(f(m.aqToolFrame(0, 0, 0xff804020, 9)), '70 03 09 40 20 10');
  assert.equal(f(m.aqToolFrame(3, 0, 0xff00ff00, 9)), '6c 15');
  assert.equal(f(m.aqToolFrame(5, 0, 0, 33)), '68 21 00');
  assert.equal(m.aqToolFrame(4, 0, 0, 33), null);
  // LEDs 0-7 top buttons, then rows of 8 pads + the right button: a row
  // is 8 pads + its right button, a column 8 pads + its top button
  const leds = (x: Uint8Array | null) =>
    f(x)!
      .split(' ')
      .slice(1)
      .filter((_, i) => i % 3 === 1)
      .map((h) => parseInt(h, 16));
  assert.deepEqual(
    leds(m.aqToolFrame(1, 2, 0xff0000ff, 9)),
    [8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
  assert.deepEqual(
    leds(m.aqToolFrame(2, 2, 0xff0000ff, 9)),
    [1, 9, 18, 27, 36, 45, 54, 63, 72],
  );
  assert.deepEqual(
    leds(m.aqToolFrame(2, 2, 0xff0000ff, 16)),
    [16, 25, 34, 43, 52, 61, 70, 79],
  );
  assert.equal(
    f(m.aqScrollText(0xff00ff00, true, 'HELLO')),
    '6f 15 01 48 45 4c 4c 4f',
  );
  assert.equal(f(m.aqScrollStop()), '6f 00 00');
  assert.equal(f(m.aqSaveProgram(2)), '73 01');
  assert.equal(f(m.aqBrightness(100)), '72 64');
  assert.equal(f(m.aqProgramMode(true)), '66 01');
  assert.equal(f(m.aqProgramReset()), '6c 00');
});

test('light output matches AQ64L::LightOutput::send (emulated)', async () => {
  const m = await import('../src/devices/_shared/aq64l.ts');
  // 6-bit 63 / 32 / 1 -> 7f 41 02; 38 specs per frame
  const all = m.aqLightFrames(Array(80).fill(0xff8004));
  assert.deepEqual(
    all.map((f) => f.length),
    [8 + 1 + 38 * 5 + 1, 8 + 1 + 38 * 5 + 1, 8 + 1 + 4 * 5 + 1],
  );
  assert.equal(
    hex(all[0]).slice(H.length + 1, H.length + 1 + 32),
    '70 03 00 7f 41 02 03 01 7f 41 02',
  );
  assert.equal(all[1][9 + 1], 38);
  // a pattern frame sends only what changed
  const a = Array(80).fill(0);
  const b = [...a];
  b[17] = 0x00ff00;
  assert.equal(
    hex(m.aqLightFrames(b, a)[0]).slice(H.length + 1, -3),
    '70 03 11 00 7f 00',
  );
  assert.equal(m.aqLightFrames(a, a).length, 0);
});
