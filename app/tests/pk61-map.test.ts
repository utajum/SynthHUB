import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctDevice } from '../src/devices/_shared/controltribe.ts';
import {
  COLOURS,
  HOTSPOTS,
  pk61Clickable,
  pk61Element,
  pk61Shown,
} from '../src/devices/_shared/pk61-map.ts';

const controls = ctDevice('pk61')!.controls;
const shown = (i: number, mode?: string) =>
  controls
    .filter((c) => pk61Shown(pk61Element(i), c, mode))
    .map((c) => c.method);

test('hotspots: 64 elements in settingsPanelFactory order', () => {
  assert.equal(HOTSPOTS.length, 64);
  assert.equal(COLOURS.length, 16);
  assert.deepEqual(
    [0, 9, 18, 22, 38, 39, 57, 58, 59, 63].map((i) => pk61Element(i).label),
    [
      'Knob 1',
      'Fader 1',
      'Part 1',
      'Pad 1',
      'DAW Stop',
      'DAW Record',
      'DAW Left',
      'Ribbon',
      'Keyboard',
      'Pedal',
    ],
  );
  // every element edits at least one param
  for (let i = 0; i < 64; i++) assert.ok(shown(i).length, pk61Element(i).label);
});

test('isClickable: preset 0 fixes knobs, faders and most DAW buttons', () => {
  assert.equal(pk61Clickable(0, 0), false);
  assert.equal(pk61Clickable(0, 3), true);
  assert.equal(pk61Clickable(22, 0), true);
  assert.equal(pk61Clickable(49, 0), true);
  assert.equal(pk61Clickable(44, 5), false);
  assert.equal(pk61Clickable(60, 0), true);
});

test('params of the selected mode; one name field', () => {
  const pad = shown(22, 'Patch Change');
  assert.ok(pad.includes('Pad1PatchProgram') && pad.includes('Pad1Char1'));
  assert.ok(!pad.includes('Pad1MidiNote') && !pad.includes('Pad1Char2'));
  assert.ok(!shown(31).includes('Pad1Mode'), 'Pad 10 must not match Pad 1');
  const fader = shown(9, 'Fader');
  assert.ok(fader.includes('Fader1CC') && !fader.includes('Drawbar1CC'));
  assert.ok(shown(9, 'Drawbar').includes('Drawbar1CC'));
  assert.ok(shown(0, 'RELATIVE 2').includes('Knob1Rel2CC'));
  assert.ok(!shown(0, 'RELATIVE 2').includes('Knob1Rel1CC'));
});
