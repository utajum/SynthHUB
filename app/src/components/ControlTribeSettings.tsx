// Control Tribe device-settings editor (Swing / 1601 / AQ64 / BQ10), driven
// by data/controltribe.json. Edits send Set frames immediately; "query all"
// reads current values back; "store" persists them on the unit. Enums render
// as dropdowns, plain params as sliders, sequencer steps in CtStepGrid.
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import {
  buildCtQuery,
  buildCtSet,
  buildCtStore,
  ctDevice,
  ctHasSteps,
  ctHex,
  ctOptionValue,
  ctSections,
  ctStepRows,
} from '../devices/_shared/controltribe';
import CtStepGrid from './CtStepGrid';

interface Props {
  slug: string;
  outputId: () => string | undefined;
}

export default function ControlTribeSettings(props: Props) {
  const dev = createMemo(() => ctDevice(props.slug));
  const sections = createMemo(() => ctSections(props.slug));
  const hasSteps = createMemo(() => ctHasSteps(props.slug));
  const stepRows = createMemo(() => ctStepRows(props.slug));

  const initial: Record<number, number> = {};
  for (const c of dev()?.controls ?? []) initial[c.cmd] = c.default;
  const [values, setValues] = createSignal<Record<number, number>>(initial);
  const [lastFrame, setLastFrame] = createSignal<string>('');

  const out = () => props.outputId();

  // mirror device replies (F0 00 20 32 devId prod cmd value F7) into the UI
  onMount(() => {
    const off = midi.onMessage((data) => {
      const d = dev();
      if (!d || data.length < 9) return;
      if (
        data[0] === 0xf0 &&
        data[1] === 0x00 &&
        data[2] === 0x20 &&
        data[3] === 0x32 &&
        data[4] === d.deviceId &&
        data[5] === d.productId
      ) {
        const cmd = data[6];
        const val = data[7];
        if (d.controls.some((c) => c.cmd === cmd)) {
          setValues((p) => ({ ...p, [cmd]: val }));
        }
      }
    });
    onCleanup(off);
    // auto-read current values on open so the UI never shows stale defaults
    if (out()) setTimeout(queryAll, 300);
  });

  const send = (bytes: Uint8Array, label: string) => {
    const o = out();
    if (!o) {
      actions().pushLog({ dir: 'info', text: `${label}: no MIDI output` });
      return false;
    }
    midi.send(o, bytes);
    setLastFrame(ctHex(bytes));
    actions().pushLog({ dir: 'out', text: `${label}  >  ${ctHex(bytes)}` });
    return true;
  };

  const setParam = (cmd: number, value: number) => {
    const v = Math.max(0, Math.min(127, value | 0));
    setValues((p) => ({ ...p, [cmd]: v }));
    send(buildCtSet(props.slug, cmd, v), `set 0x${cmd.toString(16)}`);
  };

  const queryAll = () => {
    const d = dev();
    if (!d || !out()) {
      actions().pushLog({ dir: 'info', text: 'query all: no MIDI output' });
      return;
    }
    let i = 0;
    for (const c of d.controls) {
      // stagger so we don't flood the port
      setTimeout(
        () => midi.send(out()!, buildCtQuery(props.slug, c.cmd)),
        i * 12,
      );
      i++;
    }
    actions().pushLog({
      dir: 'out',
      text: `query all ${d.controls.length} params`,
    });
  };

  const exportJson = () => {
    const d = dev();
    if (!d) return;
    const dump = Object.fromEntries(
      d.controls.map((c) => [c.method, values()[c.cmd] ?? c.default]),
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.slug}-settings.json`;
    a.click();
    URL.revokeObjectURL(url);
    actions().pushLog({
      dir: 'info',
      text: `exported ${props.slug} settings (JSON)`,
    });
  };

  return (
    <Show
      when={dev()}
      fallback={<p class="muted">no protocol for this device</p>}
    >
      <div class="stack">
        <p class="muted tiny">
          {dev()!.name} device settings ({dev()!.controls.length} parameters).
          Editing a control sends it to the device immediately. Use "query all"
          to read the device's current values, then "store" to save them on the
          unit.
        </p>

        <div class="flex wrap">
          <button class="btn tiny" onClick={queryAll}>
            query all
          </button>
          <button
            class="btn tiny"
            onClick={() => send(buildCtStore(props.slug), 'store')}
          >
            store
          </button>
          <button class="btn tiny ghost" onClick={exportJson}>
            export json
          </button>
          <span class="spacer" />
          <Show when={lastFrame()}>
            <span class="pill tiny" title="last frame sent">
              {lastFrame()}
            </span>
          </Show>
        </div>

        <Show when={hasSteps()}>
          <div class="stack" style={{ 'margin-bottom': '0.4rem' }}>
            <div class="tiny dim device-app-hdr">Step Sequencer</div>
            <CtStepGrid
              rows={stepRows}
              value={(cmd) => values()[cmd] ?? 0}
              onSet={setParam}
            />
          </div>
        </Show>

        <div class="scroll" style={{ 'max-height': '460px' }}>
          <For each={sections()}>
            {(sec) => (
              <div class="stack" style={{ 'margin-bottom': '0.6rem' }}>
                <div class="tiny dim device-app-hdr">{sec.section}</div>
                <table class="mono-table">
                  <tbody>
                    <For each={sec.controls}>
                      {(c) => (
                        <tr>
                          <td class="hot" style={{ width: '45%' }}>
                            {c.label}
                          </td>
                          <td class="tiny dim" style={{ width: '3.5rem' }}>
                            0x{c.cmd.toString(16).padStart(2, '0')}
                          </td>
                          <Show
                            when={c.kind === 'enum' && c.options}
                            fallback={
                              <>
                                <td>
                                  <input
                                    type="range"
                                    min={c.min}
                                    max={c.max}
                                    value={values()[c.cmd] ?? c.default}
                                    onInput={(e) =>
                                      setParam(c.cmd, +e.currentTarget.value)
                                    }
                                    style={{
                                      width: '120px',
                                      'vertical-align': 'middle',
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={c.min}
                                    max={c.max}
                                    value={values()[c.cmd] ?? c.default}
                                    onInput={(e) =>
                                      setParam(c.cmd, +e.currentTarget.value)
                                    }
                                    style={{ width: '70px' }}
                                  />
                                </td>
                              </>
                            }
                          >
                            <td colspan="2">
                              <select
                                value={values()[c.cmd] ?? c.default}
                                onInput={(e) =>
                                  setParam(c.cmd, +e.currentTarget.value)
                                }
                                style={{ width: '11rem' }}
                              >
                                <For each={c.options}>
                                  {(opt, i) => (
                                    <option value={ctOptionValue(c, i())}>
                                      {opt}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </td>
                          </Show>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
