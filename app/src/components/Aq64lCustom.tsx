// AQ64L custom pad modes (Control Tribe 1.12.4 AQ64LCustomMode): an 8 x 8
// grid, a tool per pad type, a pad editor, User 1 / User 2 and the global
// channel; send to the device, save / load .aq64l presets.
import { For, Show, createSignal } from 'solid-js';
import { saveFile } from '../lib/midi/port-io';
import { actions } from '../lib/store-solid';
import {
  AQ_CC_MODES,
  AQ_GLOBAL,
  AQ_TYPES,
  AQ_TYPE_LABEL,
  aqApplyTool,
  aqCustomFrames,
  aqKeyName,
  aqKeyStroke,
  aqPreset,
  aqPresetFromJson,
  aqPresetToJson,
  aqSendPaced,
  type AqPad,
  type AqPreset,
} from '../devices/_shared/aq64l';

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const OCTAVES = ['-2', '-1', '0', '1', '2', '3', '4', '5', '6', '7'];
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
const fromHex = (s: string) => (0xff000000 | parseInt(s.slice(1), 16)) >>> 0;

export default function Aq64lCustom(props: {
  outputId: () => string | undefined;
}) {
  const [preset, setPreset] = createSignal<AqPreset>(aqPreset());
  const [tool, setTool] = createSignal(8);
  const [sel, setSel] = createSignal<number | null>(null);
  const [slot, setSlot] = createSignal(0);
  const [channel, setChannel] = createSignal(0);
  const [status, setStatus] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const update = (fn: (p: AqPreset) => void) => {
    const p = structuredClone(preset());
    fn(p);
    setPreset(p);
  };
  const pad = () => (sel() === null ? null : preset().pads[sel()!]);
  const setPad = (d: Partial<AqPad>) =>
    update((p) => Object.assign(p.pads[sel()!], d));

  const send = async () => {
    const out = props.outputId();
    if (!out || busy()) return;
    setBusy(true);
    const frames = aqCustomFrames(preset(), slot(), channel());
    const missed = await aqSendPaced(out, frames, (i, n) =>
      setStatus(`sending ${i}/${n}`),
    );
    setBusy(false);
    setStatus(
      missed
        ? `sent ${frames.length} frames, ${missed} not answered`
        : `sent ${frames.length} frames`,
    );
    actions().pushLog({
      dir: 'out',
      text: `AQ64L: custom mode -> User ${slot() + 1}`,
    });
  };
  const load = async (f: File) => {
    const r = aqPresetFromJson(await f.text());
    if (typeof r === 'string')
      return setStatus(`${f.name} was not imported. ${r}`);
    setPreset(r);
    setSel(null);
    setStatus(`loaded ${f.name}`);
  };
  let fileInput!: HTMLInputElement;

  const num = (
    label: string,
    v: number,
    max: number,
    set: (v: number) => void,
  ) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        value={v}
        style={{ width: '4.5rem' }}
        onChange={(e) =>
          set(Math.max(0, Math.min(max, +e.currentTarget.value | 0)))
        }
      />
    </label>
  );
  const channelSel = (d: AqPad) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      channel
      <select
        value={d.channel}
        onChange={(e) => setPad({ channel: +e.currentTarget.value })}
      >
        <option value={AQ_GLOBAL}>Global</option>
        <For each={Array.from({ length: 16 }, (_, i) => i)}>
          {(c) => <option value={c}>{c + 1}</option>}
        </For>
      </select>
    </label>
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
            <For each={AQ_TYPES}>
              {(t, i) => (
                <option value={i()}>{i() ? AQ_TYPE_LABEL[t] : 'Remove'}</option>
              )}
            </For>
          </select>
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          user mode
          <select
            value={slot()}
            onChange={(e) => setSlot(+e.currentTarget.value)}
          >
            <option value={0}>User 1</option>
            <option value={1}>User 2</option>
          </select>
        </label>
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          channel
          <select
            value={channel()}
            onChange={(e) => setChannel(+e.currentTarget.value)}
          >
            <For
              each={[
                'ALL',
                ...Array.from({ length: 16 }, (_, i) => `${i + 1}`),
              ]}
            >
              {(c, i) => <option value={i()}>{c}</option>}
            </For>
          </select>
        </label>
        <button
          class="btn tiny"
          disabled={busy() || !props.outputId()}
          onClick={() => void send()}
        >
          send to device
        </button>
        <button
          class="btn tiny ghost"
          onClick={() =>
            saveFile('AQ64L Preset.aq64l', aqPresetToJson(preset()))
          }
        >
          export .aq64l
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".aq64l"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void load(f);
            e.currentTarget.value = '';
          }}
        />
        <button class="btn tiny ghost" onClick={() => fileInput.click()}>
          import .aq64l
        </button>
        <button
          class="btn tiny ghost"
          onClick={() => (setPreset(aqPreset()), setSel(null))}
        >
          clear
        </button>
      </div>
      <p class="muted tiny">
        Click a pad to place the tool. Faders fill a column or row, keyboards
        two rows, the drum grid 4 x 4 pads. Shift-click selects a pad without
        changing it.
      </p>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(8, 34px)',
          gap: '4px',
        }}
      >
        <For each={preset().pads}>
          {(d, i) => (
            <button
              title={`pad ${i() + 1}: ${AQ_TYPE_LABEL[AQ_TYPES[d.type] ?? 'none']}`}
              onClick={(e) => {
                if (!e.shiftKey)
                  update((p) => void aqApplyTool(p, tool(), i()));
                setSel(i());
              }}
              style={{
                width: '34px',
                height: '34px',
                padding: 0,
                'border-radius': '4px',
                background: d.type ? hex(d.colour) : '#222',
                border: sel() === i() ? '2px solid #fff' : '1px solid #0008',
                color: '#000',
                'font-size': '9px',
              }}
            >
              {d.type ? AQ_TYPES[d.type].slice(0, 3) : ''}
            </button>
          )}
        </For>
      </div>
      <Show when={pad()}>
        {(d) => (
          <div class="stack">
            <p class="hot">
              Pad {sel()! + 1}: {AQ_TYPE_LABEL[AQ_TYPES[d().type] ?? 'none']}
            </p>
            <div class="flex wrap">
              <label class="tiny flex" style={{ gap: '0.3rem' }}>
                primary colour
                <input
                  type="color"
                  value={hex(d().colour)}
                  onChange={(e) =>
                    setPad({ colour: fromHex(e.currentTarget.value) })
                  }
                />
              </label>
              <label class="tiny flex" style={{ gap: '0.3rem' }}>
                secondary colour
                <input
                  type="color"
                  value={hex(d().onColour)}
                  onChange={(e) =>
                    setPad({ onColour: fromHex(e.currentTarget.value) })
                  }
                />
              </label>
            </div>
            <div class="flex wrap">
              <Show when={d().type >= 1 && d().type <= 4}>
                {channelSel(d())}
                {num('CC number', d().param1, 127, (v) =>
                  setPad({ param1: v }),
                )}
              </Show>
              <Show when={d().type >= 5 && d().type <= 8}>
                <label class="tiny flex" style={{ gap: '0.3rem' }}>
                  note
                  <select
                    value={d().note}
                    onChange={(e) => setPad({ note: +e.currentTarget.value })}
                  >
                    <For each={NOTES}>
                      {(n, i) => <option value={i()}>{n}</option>}
                    </For>
                  </select>
                </label>
                <label class="tiny flex" style={{ gap: '0.3rem' }}>
                  octave
                  <select
                    value={d().octaves}
                    onChange={(e) =>
                      setPad({ octaves: +e.currentTarget.value })
                    }
                  >
                    <For each={OCTAVES}>
                      {(n, i) => <option value={i()}>{n}</option>}
                    </For>
                  </select>
                </label>
              </Show>
              <Show when={d().type === 9}>
                <label class="tiny flex" style={{ gap: '0.3rem' }}>
                  mode
                  <select
                    value={d().mode}
                    onChange={(e) => setPad({ mode: +e.currentTarget.value })}
                  >
                    <For each={AQ_CC_MODES}>
                      {([n, v]) => <option value={v}>{n}</option>}
                    </For>
                  </select>
                </label>
                {channelSel(d())}
                {num('CC number', d().param1, 127, (v) =>
                  setPad({ param1: v }),
                )}
                {num('on value', d().param2, 127, (v) => setPad({ param2: v }))}
              </Show>
              <Show when={d().type === 10}>
                {channelSel(d())}
                {num('PC number', d().param1, 127, (v) =>
                  setPad({ param1: v }),
                )}
              </Show>
              <Show when={d().type === 11}>
                <label class="tiny flex" style={{ gap: '0.3rem' }}>
                  key combination
                  <input
                    readOnly
                    placeholder="press keys"
                    value={aqKeyName(d().param1, d().param2)}
                    style={{ width: '10rem' }}
                    onKeyDown={(e) => {
                      const k = aqKeyStroke(e);
                      if (!k) return;
                      e.preventDefault();
                      setPad({ param1: k.key, param2: k.mods });
                    }}
                  />
                </label>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
    </div>
  );
}
