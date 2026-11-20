import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FX_NAMES,
  FxEngine,
  fxDevice,
  fxFadeSteps,
  fxFromFile,
  fxIndexToLed,
  fxLedToIndex,
  fxMake,
  fxMidiToIndex,
  fxOffset,
  fxPinch,
  fxProject,
  fxToFile,
  type Clock,
  type FxDevice,
  type FxProject,
} from '../src/devices/_shared/aq64l-fx.ts';

// a clock the test moves by hand
function manual() {
  let now = 0;
  const q: { at: number; fn: () => void; live: boolean }[] = [];
  const clock: Clock = {
    now: () => now,
    after: (ms, fn) => {
      const e = { at: now + Math.max(0, ms), fn, live: true };
      q.push(e);
      return () => (e.live = false);
    },
  };
  const run = (until: number) => {
    for (;;) {
      q.sort((a, b) => a.at - b.at);
      const e = q.find((x) => x.live && x.at <= until);
      if (!e) break;
      e.live = false;
      now = e.at;
      e.fn();
    }
    now = until;
  };
  return { clock, run };
}
const project = (...chain: FxDevice[]): FxProject => ({
  ...fxProject(),
  tracks: [{ name: 'T', enabled: true, chain }],
});
const dev = (name: string, p: Record<string, unknown> = {}) => ({
  ...fxMake(name),
  ...p,
});
const lit = (e: FxEngine) =>
  e.ctx.screen.px
    .map((_, i) => i)
    .filter((i) => e.ctx.screen.color(i).some((v) => v));

test('defaults: makeDeviceByName + serializeDevice (emulated)', () => {
  assert.equal(FX_NAMES.length, 24);
  assert.deepEqual(fxMake('Copy'), {
    type: 'copy',
    enabled: true,
    collapsed: false,
    time: { mode: false, step: 5, free: 500 },
    gate: 1,
    pinch: 0,
    bilateral: false,
    reverse: false,
    infinite: false,
    copyMode: 0,
    grid: 0,
    wrap: false,
    offsets: [],
    angles: [],
  });
  assert.deepEqual(fxMake('Move').offset, {
    x: 0,
    y: 0,
    abs: false,
    ax: 5,
    ay: 5,
  });
  assert.deepEqual(fxMake('Layer'), {
    type: 'layer',
    enabled: true,
    collapsed: false,
    target: 0,
    blending: 0,
    range: 200,
  });
  assert.equal((fxMake('Key Filter').filter as boolean[]).length, 101);
  assert.equal((fxMake('Macro Filter').filter as boolean[]).length, 100);
});

test('files: envelopes and checks (writeEnvelope / wrapPayload / checkEnvelope)', () => {
  const p = project(
    dev('Paint', { color: 0x3f0000 }),
    dev('Group', { chains: [[dev('Flip')], []] }),
  );
  const t = JSON.parse(fxToFile('effect', p));
  assert.deepEqual(Object.keys(t), [
    'bpm',
    'macros',
    'tracks',
    'format',
    'formatVersion',
    'device',
  ]);
  assert.equal(t.format, 'AQ64LLightEffect');
  assert.deepEqual(fxFromFile('effect', fxToFile('effect', p)), p);
  const c = JSON.parse(fxToFile('chain', p.tracks[0].chain));
  assert.deepEqual(Object.keys(c), [
    'format',
    'formatVersion',
    'device',
    'chain',
  ]);
  assert.deepEqual(
    fxFromFile('device', fxToFile('device', dev('Delay'))),
    dev('Delay'),
  );
  assert.equal(
    fxFromFile('track', fxToFile('device', dev('Delay'))),
    'It is a AQ64LLightDevice file, not a AQ64LLightTrack file.',
  );
  // missing fields take the defaults; unknown types drop out
  assert.deepEqual(fxDevice({ type: 'hold', gate: 2 }), {
    ...fxMake('Hold'),
    gate: 2,
  });
  assert.equal(fxDevice({ type: 'nope' }), null);
});

test('maps: LEDs, MIDI notes, offsets, pinch', () => {
  assert.deepEqual(
    [1, 8, 11, 19, 81, 89].map(fxIndexToLed),
    [0, 7, 8, 16, 71, 79],
  );
  assert.deepEqual([0, 7, 8, 16, 79].map(fxLedToIndex), [1, 8, 11, 19, 89]);
  // AQ64LLightEffects::processIncomingMidi: note 81 = top-left pad
  assert.deepEqual(fxMidiToIndex([0x90, 81, 100]), [11, 100]);
  assert.deepEqual(fxMidiToIndex([0x90, 19, 0]), [89, 0]);
  assert.deepEqual(fxMidiToIndex([0xb0, 104, 127]), [1, 127]);
  const o = { x: 2, y: -1, abs: false, ax: 0, ay: 0 };
  assert.equal(fxOffset(o, 55, 0, false), 47);
  assert.equal(fxOffset(o, 18, 1, false), null); // leaves the pads
  assert.equal(fxOffset(o, 18, 1, true), 82);
  assert.equal(fxOffset({ ...o, x: 0, y: -1 }, 4, 0, false), 100); // mode light
  assert.equal(fxPinch(500, 1000, 0, false), 500);
  assert.ok(fxPinch(500, 1000, 1, false) < 500);
});

test('engine: paint, flip, delay, screen', () => {
  const { clock, run } = manual();
  const e = new FxEngine(
    project(
      dev('Paint', { color: 0x3f0000 }),
      dev('Flip', { bypass: true }),
      dev('Delay', { time: { mode: false, step: 5, free: 100 } }),
    ),
    clock,
  );
  e.input(11, 127);
  assert.deepEqual(lit(e), []);
  run(100);
  assert.deepEqual(lit(e), [11, 18]);
  assert.deepEqual(e.ctx.screen.color(18), [63, 0, 0]);
  assert.equal(e.leds()[8], 0xff0000);
  e.input(11, 0);
  run(200);
  assert.deepEqual(lit(e), []);
});

test('engine: copy animate, hold, loop, fade, pattern, choke, multi', () => {
  const { clock, run } = manual();
  const step = (free: number) => ({ mode: false, step: 5, free });
  // copy animate: original then each offset, one rate apart
  let e = new FxEngine(
    project(
      dev('Copy', {
        copyMode: 1,
        time: step(100),
        offsets: [
          { x: 1, y: 0, abs: false, ax: 0, ay: 0 },
          { x: 2, y: 0, abs: false, ax: 0, ay: 0 },
        ],
      }),
    ),
    clock,
  );
  e.input(44, 127);
  run(clock.now() + 50);
  assert.deepEqual(lit(e), [44]);
  run(clock.now() + 100);
  assert.deepEqual(lit(e), [45]);
  run(clock.now() + 500);
  assert.deepEqual(lit(e), []);
  // hold duration: lit for the time despite the release
  e = new FxEngine(project(dev('Hold', { time: step(300) })), clock);
  e.input(33, 127);
  e.input(33, 0);
  run(clock.now() + 200);
  assert.deepEqual(lit(e), [33]);
  run(clock.now() + 200);
  assert.deepEqual(lit(e), []);
  // fade: white to black in 63 steps, then off
  const st = fxFadeSteps(fxMake('Fade'));
  assert.equal(st.length, 64);
  assert.deepEqual(
    [st[0].rgb, st[63].rgb, st[63].t],
    [[63, 63, 63], [0, 0, 0], 1],
  );
  // pattern with root key follows the pressed pad
  const screen = Array(101).fill(0);
  screen[55] = 0x003f00;
  e = new FxEngine(
    project(
      dev('Pattern', { rootKey: 55, frames: [{ time: step(100), screen }] }),
    ),
    clock,
  );
  e.input(23, 127);
  run(clock.now() + 1);
  assert.deepEqual(lit(e), [23]);
  run(clock.now() + 200);
  assert.deepEqual(lit(e), []);
  // choke: a press in choke B turns off what choke A lit
  const hold = dev('Hold', { holdMode: 2 });
  e = new FxEngine(
    project(
      dev('Group', {
        chains: [
          [
            dev('Key Filter', {
              filter: Array(101)
                .fill(false)
                .map((_, i) => i === 11),
            }),
            dev('Choke', { chain: [hold] }),
          ],
          [
            dev('Key Filter', {
              filter: Array(101)
                .fill(false)
                .map((_, i) => i === 12),
            }),
            dev('Choke', { chain: [hold] }),
          ],
        ],
      }),
    ),
    clock,
  );
  e.input(11, 127);
  assert.deepEqual(lit(e), [11]);
  e.input(12, 127);
  assert.deepEqual(lit(e), [12]);
  // multi forward: presses alternate chains, the release follows its press
  e = new FxEngine(
    project(
      dev('Multi', {
        chains: [
          [dev('Paint', { color: 0x3f0000 })],
          [dev('Paint', { color: 0x00003f })],
        ],
      }),
    ),
    clock,
  );
  e.input(11, 127);
  e.input(12, 127);
  assert.deepEqual(
    [e.ctx.screen.color(11), e.ctx.screen.color(12)],
    [
      [63, 0, 0],
      [0, 0, 63],
    ],
  );
  e.input(11, 0);
  assert.deepEqual(lit(e), [12]);
});
