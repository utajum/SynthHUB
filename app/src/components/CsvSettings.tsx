// General page of JN-80, PRO-800 and PROTON (SynthTribe 3.3.4 CSV settings).
// Block devices: read the block, then every change writes the whole block
// back (saveCsvValue). PROTON: every change sends its own command.
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { DeviceVariant } from '../lib/types';
import { hex } from '../lib/midi/sysex';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import {
  csvBlock,
  csvBlockValues,
  csvBlockWrite,
  csvCmdValues,
  csvCmdWrite,
  csvDevice,
  csvReadRequest,
} from '../devices/_shared/csv-settings';

interface Props {
  slug: string;
  variant: DeviceVariant;
  outputId: () => string | undefined;
}

export default function CsvSettings(props: Props) {
  const d = csvDevice(props.slug)!;
  const [values, setValues] = createSignal<(number | undefined)[]>(
    d.rows.map(() => undefined),
  );
  const [block, setBlock] = createSignal<number[] | null>(null);
  const groups = [...new Set(d.rows.map((r) => r.group))];

  const send = (bytes: Uint8Array, text: string) => {
    const o = props.outputId();
    if (!o) {
      actions().pushLog({ dir: 'info', text: `${text}: no MIDI output` });
      return;
    }
    midi.send(o, bytes);
    actions().pushLog({ dir: 'out', text: `${text}  >  ${hex(bytes)}` });
  };
  const read = () => send(csvReadRequest(props.variant, d), 'read settings');

  const off = midi.onMessage((msg) => {
    if (d.mode === 'cmd') {
      const v = csvCmdValues(props.variant, d, msg);
      if (v) setValues(v);
      return;
    }
    const b = csvBlock(props.variant, d, msg);
    if (!b) return;
    setBlock(b);
    setValues(csvBlockValues(d, b));
  });
  onCleanup(off);
  onMount(() => props.outputId() && read());

  const change = (i: number, v: number) => {
    const next = values().slice();
    next[i] = v;
    setValues(next);
    const r = d.rows[i];
    if (d.mode === 'cmd')
      return send(csvCmdWrite(props.variant, r, v), `${r.title} = ${v}`);
    const b = block();
    if (b)
      send(
        csvBlockWrite(props.variant, d, b, next as number[]),
        `${r.title} = ${v}`,
      );
  };

  const locked = () => d.mode === 'block' && !block();

  return (
    <div class="stack">
      <div class="flex wrap">
        <button class="btn tiny" onClick={read}>
          READ FROM DEVICE
        </button>
        <Show when={locked()}>
          <span class="muted tiny">
            Read first: a change writes the whole settings block back.
          </span>
        </Show>
      </div>
      <For each={groups}>
        {(g) => (
          <div class="stack">
            <p class="hot">{g}</p>
            <For each={d.rows.map((r, i) => [r, i] as const)}>
              {([r, i]) => (
                <Show when={r.group === g}>
                  <label class="flex wrap">
                    <span style={{ 'min-width': '14rem' }}>{r.title}</span>
                    <Show when={r.kind === 'enum'}>
                      <select
                        class="tiny"
                        disabled={locked()}
                        onChange={(e) => change(i, +e.currentTarget.value)}
                      >
                        <For each={r.options}>
                          {(o, k) => (
                            <option value={k()} selected={values()[i] === k()}>
                              {o}
                            </option>
                          )}
                        </For>
                      </select>
                    </Show>
                    <Show when={r.kind === 'number'}>
                      <input
                        type="number"
                        class="tiny"
                        min={r.min}
                        max={r.max}
                        value={values()[i] ?? ''}
                        disabled={locked()}
                        onChange={(e) => {
                          const v = Math.round(+e.currentTarget.value);
                          change(i, Math.max(r.min!, Math.min(r.max!, v)));
                        }}
                      />
                    </Show>
                    <Show when={r.kind === 'bits'}>
                      <For each={r.options}>
                        {(o, k) => (
                          <label class="tiny">
                            <input
                              type="checkbox"
                              disabled={locked()}
                              checked={(((values()[i] ?? 0) >> k()) & 1) === 1}
                              onChange={(e) =>
                                change(
                                  i,
                                  e.currentTarget.checked
                                    ? (values()[i] ?? 0) | (1 << k())
                                    : (values()[i] ?? 0) & ~(1 << k()),
                                )
                              }
                            />
                            {o}
                          </label>
                        )}
                      </For>
                    </Show>
                  </label>
                </Show>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
