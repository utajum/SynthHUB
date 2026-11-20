// AQ64L program page (Control Tribe 1.12.4 AQ64LProgramPage and
// AQ64LOperationContent): paint the 80 LEDs with a tool, an effect and a
// colour; global brightness, scrolling text, save to USER1 / USER2.
import { For, Index, createSignal, onMount } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import {
  AQ_EFFECTS,
  AQ_LEDS,
  AQ_PALETTE,
  AQ_TOOLS,
  aqBrightness,
  aqFromHex,
  aqHex,
  aqLedCol,
  aqLedRow,
  aqNearest,
  aqProgramMode,
  aqProgramReset,
  aqSaveProgram,
  aqScrollStop,
  aqScrollText,
  aqToolFrame,
} from '../devices/_shared/aq64l';

const OFF = 0xff333333;

export default function Aq64lProgram(props: {
  outputId: () => string | undefined;
}) {
  const [leds, setLeds] = createSignal<number[]>(Array(AQ_LEDS).fill(OFF));
  const [tool, setTool] = createSignal(0);
  const [effect, setEffect] = createSignal(0);
  const [colour, setColour] = createSignal(0xffff0000);
  const [text, setText] = createSignal('');

  const send = (f: Uint8Array, what: string) => {
    const out = props.outputId();
    if (!out) return;
    midi.send(out, f);
    actions().pushLog({ dir: 'out', text: `AQ64L: ${what}` });
  };
  // parentHierarchyChanged: "Enter Program Mode" when the page shows
  onMount(() => send(aqProgramMode(true), 'Enter Program Mode'));

  const click = (led: number) => {
    if (tool() === 4)
      return setColour(leds()[led] === OFF ? colour() : leds()[led]);
    const f = aqToolFrame(tool(), effect(), colour(), led);
    if (f) send(f, AQ_TOOLS[tool()]);
    // preview what the device now shows (palette colour for flash / pulse)
    const shown = effect() ? AQ_PALETTE[aqNearest(colour())] : colour();
    setLeds((l) =>
      l.map((c, i) => {
        if (tool() === 3) return AQ_PALETTE[aqNearest(colour())];
        if (tool() === 5) return i === led ? OFF : c;
        const hit =
          tool() === 1
            ? aqLedRow(i) === aqLedRow(led)
            : tool() === 2
              ? aqLedCol(i) === aqLedCol(led)
              : i === led;
        return hit ? shown : c;
      }),
    );
  };

  const cell = (led: number) => (
    <button
      onClick={() => click(led)}
      title={`LED ${led}`}
      style={{
        width: '34px',
        height: led < 8 ? '18px' : '28px',
        padding: 0,
        background: aqHex(leds()[led]),
        border: '1px solid #0008',
        'border-radius': '4px',
      }}
    />
  );

  return (
    <div class="stack">
      <div class="flex wrap">
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          tool
          <select
            value={tool()}
            onChange={(e) => setTool(+e.currentTarget.value)}
          >
            <For each={AQ_TOOLS}>
              {(t, i) => <option value={i()}>{t}</option>}
            </For>
          </select>
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          effect
          <select
            value={effect()}
            onChange={(e) => setEffect(+e.currentTarget.value)}
          >
            <For each={AQ_EFFECTS}>
              {(t, i) => <option value={i()}>{t}</option>}
            </For>
          </select>
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          colour
          <input
            type="color"
            value={aqHex(colour())}
            onInput={(e) => setColour(aqFromHex(e.currentTarget.value))}
          />
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          global brightness
          <input
            type="range"
            min={0}
            max={100}
            value={100}
            onChange={(e) =>
              send(aqBrightness(+e.currentTarget.value), 'Global Brightness')
            }
          />
        </label>
        <button
          class="btn tiny ghost"
          onClick={() => (
            send(aqProgramReset(), 'Program Reset'),
            setLeds(Array(AQ_LEDS).fill(OFF))
          )}
        >
          reset
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(9, 34px)',
          gap: '4px',
        }}
      >
        <Index each={Array.from({ length: 8 }, (_, i) => i)}>
          {(l) => cell(l())}
        </Index>
        <span />
        <Index each={Array.from({ length: 8 }, (_, r) => r)}>
          {(r) => (
            <>
              <Index
                each={Array.from({ length: 9 }, (_, c) => 8 + r() * 9 + c)}
              >
                {(l) => cell(l())}
              </Index>
            </>
          )}
        </Index>
      </div>
      <div class="flex wrap">
        <input
          type="text"
          placeholder="Enter scrolling text..."
          value={text()}
          style={{ width: '14rem' }}
          onInput={(e) =>
            setText(e.currentTarget.value.replace(/[^\x20-\x7e]/g, ''))
          }
        />
        <button
          class="btn tiny"
          disabled={!text()}
          onClick={() =>
            send(aqScrollText(colour(), false, text()), 'Scrolling Text')
          }
        >
          play once
        </button>
        <button
          class="btn tiny"
          disabled={!text()}
          onClick={() =>
            send(aqScrollText(colour(), true, text()), 'Scrolling Text')
          }
        >
          play loop
        </button>
        <button
          class="btn tiny ghost"
          onClick={() => send(aqScrollStop(), 'Scrolling Text Stop')}
        >
          stop
        </button>
      </div>
      <div class="flex wrap">
        <span class="muted tiny">
          Save the current 8 x 8 colours into a USER preset so they survive a
          power cycle.
        </span>
        <button
          class="btn tiny"
          onClick={() => send(aqSaveProgram(1), 'Save Program')}
        >
          save to USER1
        </button>
        <button
          class="btn tiny"
          onClick={() => send(aqSaveProgram(2), 'Save Program')}
        >
          save to USER2
        </button>
      </div>
    </div>
  );
}
