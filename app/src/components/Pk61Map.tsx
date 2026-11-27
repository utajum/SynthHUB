// PK61 device map (Control Tribe 1.12.4 PK61DeviceMap): the panel image
// with 64 hotspots; a click opens that element's settings (knob, fader,
// part, pad, DAW button, ribbon, keyboard, CV / gate, pedal). Names are 8
// chars (PK61EditNameOptions), pad colours one of 16 (PK61ColourGrid).
import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import {
  ctDevice,
  ctId,
  parseCtReplies,
} from '../devices/_shared/controltribe';
import {
  COLOURS,
  HOTSPOTS,
  pk61Clickable,
  pk61Element,
  pk61Shown,
} from '../devices/_shared/pk61-map';
import ControlTribeSettings from './ControlTribeSettings';

export default function Pk61Map(props: { outputId: () => string | undefined }) {
  const controls = ctDevice('pk61')!.controls;
  const preset = controls.find((c) => c.method === 'PresetIndex')!;
  const [presetIndex, setPresetIndex] = createSignal(preset.default);
  const [sel, setSel] = createSignal<number | null>(null);

  // hotspots grey out by the device's preset (PresetIndex)
  onCleanup(
    midi.onMessage((d) => {
      for (const r of parseCtReplies('pk61', d) ?? [])
        if (r.id === ctId(preset)) setPresetIndex(r.value);
    }),
  );

  const el = () => (sel() === null ? null : pk61Element(sel()!));
  const mode = (e: { prefix: RegExp }) =>
    controls.find((c) => e.prefix.test(c.method) && /\dMode$/.test(c.method));
  const modeLabel = (values: Record<number, number>) => {
    const e = el();
    const m = e && mode(e);
    if (!m?.options) return undefined;
    const v = values[ctId(m)] ?? m.default;
    return m.options[m.values ? m.values.indexOf(v) : v];
  };

  // editors of the selected element: name (Char1..8) and pad colours
  const custom = () => {
    const out: Record<
      string,
      (
        g: (m: string) => number,
        s: (m: string, v: number) => void,
      ) => JSX.Element
    > = {};
    const e = el();
    if (!e) return out;
    for (const c of controls) {
      if (!e.prefix.test(c.method)) continue;
      if (c.method.endsWith('Char1')) {
        const base = c.method.slice(0, -5);
        out[c.method] = (get, set) => (
          <label class="tiny flex" style={{ gap: '0.4rem' }}>
            name
            <input
              type="text"
              maxlength={8}
              title="Only numbers, letters and _ characters are allowed"
              value={Array.from({ length: 8 }, (_, k) =>
                String.fromCharCode(get(`${base}Char${k + 1}`) || 0x20),
              )
                .join('')
                .trimEnd()}
              style={{ width: '9rem' }}
              onChange={(ev) => {
                const t = ev.currentTarget.value
                  .replace(/[^A-Za-z0-9_]/g, '')
                  .slice(0, 8);
                ev.currentTarget.value = t;
                for (let k = 0; k < 8; k++)
                  set(`${base}Char${k + 1}`, t.charCodeAt(k) || 0x20);
              }}
            />
          </label>
        );
      } else if (/Colou?r$/.test(c.method)) {
        out[c.method] = (get, set) => (
          <div class="flex wrap" style={{ gap: '3px' }}>
            <span class="tiny dim" style={{ width: '9rem' }}>
              {c.label}
            </span>
            <For each={COLOURS}>
              {([rgb, name], k) => (
                <button
                  title={name}
                  onClick={() => set(c.method, k())}
                  style={{
                    width: '18px',
                    height: '18px',
                    padding: 0,
                    background: rgb,
                    border:
                      get(c.method) === k()
                        ? '2px solid #fff'
                        : '1px solid #0006',
                    'border-radius': '3px',
                  }}
                />
              )}
            </For>
          </div>
        );
      }
    }
    return out;
  };

  return (
    <div class="stack">
      <div style={{ position: 'relative', 'max-width': '960px' }}>
        <img
          src="/devices/map/pk61.webp"
          alt="PK61"
          style={{ width: '100%', display: 'block' }}
        />
        <For each={HOTSPOTS}>
          {([x, y, w, h], i) => (
            <button
              title={pk61Element(i()).label}
              disabled={!pk61Clickable(i(), presetIndex())}
              onClick={() => setSel(i())}
              style={{
                position: 'absolute',
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
                padding: 0,
                background: sel() === i() ? '#ffb00055' : 'transparent',
                border:
                  sel() === i() ? '2px solid #ffb000' : '1px solid #ffffff22',
                'border-radius': '4px',
                cursor: pk61Clickable(i(), presetIndex())
                  ? 'pointer'
                  : 'default',
              }}
            />
          )}
        </For>
      </div>
      <div class="flex wrap">
        <span class="hot">{el()?.label ?? 'All settings'}</span>
        <Show when={el()}>
          <button class="btn tiny ghost" onClick={() => setSel(null)}>
            show all
          </button>
        </Show>
        <span class="muted tiny">
          Click a control on the PK61 to edit it. Preset 0 fixes the knobs,
          faders and most DAW buttons.
        </span>
      </div>
      <ControlTribeSettings
        slug="pk61"
        outputId={props.outputId}
        only={(c, v) => {
          const e = el();
          return !e || pk61Shown(e, c, modeLabel(v));
        }}
        custom={custom()}
      />
    </div>
  );
}
