// AQ64L light effects: a pattern of LED frames played from the computer
// (Control Tribe 1.12.4 AQ64LLightEffects, AQ64L::Pattern and LightOutput).
// Play starts from the button or from a pad press on the AQ64L.
import { For, Index, createSignal, onCleanup, onMount } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import {
  AQ_LEDS,
  aqLightFrames,
  aqProgramMode,
} from '../devices/_shared/aq64l';

interface Frame {
  ms: number;
  leds: number[]; // 0xRRGGBB, 0 = off
}
const blank = (ms = 200): Frame => ({ ms, leds: Array(AQ_LEDS).fill(0) });
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

export default function Aq64lLight(props: {
  outputId: () => string | undefined;
}) {
  const [frames, setFrames] = createSignal<Frame[]>([blank()]);
  const [cur, setCur] = createSignal(0);
  const [colour, setColour] = createSignal(0xff0000);
  const [loop, setLoop] = createSignal(false);
  const [onPad, setOnPad] = createSignal(true);
  const [playing, setPlaying] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: number[] | null = null;

  const out = () => props.outputId();
  const show = (leds: number[]) => {
    const o = out();
    if (!o) return;
    for (const f of aqLightFrames(leds, shown)) midi.send(o, f);
    shown = leds;
  };
  const stop = () => {
    clearTimeout(timer);
    setPlaying(false);
  };
  const play = () => {
    stop();
    setPlaying(true);
    const step = (i: number) => {
      const f = frames();
      if (i >= f.length) {
        if (!loop()) return stop();
        i = 0;
      }
      show(f[i].leds);
      timer = setTimeout(() => step(i + 1), Math.max(10, f[i].ms));
    };
    step(0);
  };

  onMount(() => {
    const o = out();
    if (o) midi.send(o, aqProgramMode(true));
    actions().pushLog({
      dir: 'out',
      text: 'AQ64L: Light FX: enter program mode',
    });
  });
  // a pad press (note on) starts the pattern
  onCleanup(
    midi.onMessage((d) => {
      if (onPad() && (d[0] & 0xf0) === 0x90 && d[2] > 0) play();
    }),
  );
  onCleanup(stop);

  const edit = (fn: (f: Frame[]) => void) => {
    const f = structuredClone(frames());
    fn(f);
    setFrames(f);
  };
  const paint = (led: number) => {
    edit((f) => {
      const l = f[cur()].leds;
      l[led] = l[led] === colour() ? 0 : colour();
    });
    if (!playing()) show(frames()[cur()].leds);
  };
  const cell = (led: number) => (
    <button
      onClick={() => paint(led)}
      style={{
        width: '30px',
        height: led < 8 ? '16px' : '26px',
        padding: 0,
        background: frames()[cur()].leds[led]
          ? hex(frames()[cur()].leds[led])
          : '#222',
        border: '1px solid #0008',
        'border-radius': '4px',
      }}
    />
  );

  return (
    <div class="stack">
      <div class="flex wrap">
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          frame
          <select
            value={cur()}
            onChange={(e) => setCur(+e.currentTarget.value)}
          >
            <For each={frames()}>
              {(_, i) => <option value={i()}>{i() + 1}</option>}
            </For>
          </select>
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          ms
          <input
            type="number"
            min={10}
            max={10000}
            value={frames()[cur()].ms}
            style={{ width: '5rem' }}
            onChange={(e) =>
              edit(
                (f) => (f[cur()].ms = Math.max(10, +e.currentTarget.value | 0)),
              )
            }
          />
        </label>
        <button
          class="btn tiny ghost"
          onClick={() => (
            edit((f) => f.splice(cur() + 1, 0, structuredClone(f[cur()]))),
            setCur(cur() + 1)
          )}
        >
          duplicate
        </button>
        <button
          class="btn tiny ghost"
          onClick={() => (
            edit((f) => f.splice(cur() + 1, 0, blank(f[cur()].ms))),
            setCur(cur() + 1)
          )}
        >
          new frame
        </button>
        <button
          class="btn tiny ghost"
          disabled={frames().length < 2}
          onClick={() => (
            edit((f) => f.splice(cur(), 1)),
            setCur(Math.max(0, cur() - 1))
          )}
        >
          delete
        </button>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          colour
          <input
            type="color"
            value={hex(colour())}
            onInput={(e) =>
              setColour(parseInt(e.currentTarget.value.slice(1), 16))
            }
          />
        </label>
      </div>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(9, 30px)',
          gap: '3px',
        }}
      >
        <Index each={Array.from({ length: 8 }, (_, i) => i)}>
          {(l) => cell(l())}
        </Index>
        <span />
        <Index each={Array.from({ length: 72 }, (_, i) => 8 + i)}>
          {(l) => cell(l())}
        </Index>
      </div>
      <div class="flex wrap">
        <button
          class="btn tiny"
          disabled={!out()}
          onClick={() => (playing() ? stop() : play())}
        >
          {playing() ? 'stop' : 'play'}
        </button>
        <label class="tiny">
          <input
            type="checkbox"
            checked={loop()}
            onChange={(e) => setLoop(e.currentTarget.checked)}
          />{' '}
          loop
        </label>
        <label class="tiny">
          <input
            type="checkbox"
            checked={onPad()}
            onChange={(e) => setOnPad(e.currentTarget.checked)}
          />{' '}
          play on pad press
        </label>
        <button
          class="btn tiny ghost"
          disabled={!out()}
          onClick={() => ((shown = null), show(Array(AQ_LEDS).fill(0)))}
        >
          all off
        </button>
      </div>
    </div>
  );
}
