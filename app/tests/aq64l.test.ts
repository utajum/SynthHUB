import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aqApplyTool,
  aqCustomFrames,
  aqKeyName,
  aqKeyStroke,
  aqPad,
  aqPreset,
  aqPresetFromJson,
  aqPresetToJson,
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

test('tools: regions and key strokes', () => {
  const p = aqPreset();
  assert.deepEqual(aqApplyTool(p, 1, 19), [3, 11, 19, 27, 35, 43, 51, 59]);
  assert.equal(aqApplyTool(p, 5, 0).length, 16);
  assert.equal(p.pads[0].param2, 1); // gap above C
  assert.equal(p.pads[8].note, 0);
  assert.equal(aqApplyTool(p, 7, 63).length, 16);
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
