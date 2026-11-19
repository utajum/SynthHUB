// Control Tribe settings editor (Swing / 1601 / AQ64 / BQ10 / QT32), driven
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
  buildCtAction,
  buildCtControl,
  buildCtStore,
  ctDevice,
  ctHasSteps,
  ctHex,
  ctId,
  ctOptionValue,
  ctSections,
  ctStepRows,
  parseCtReplies,
  parseCtReply,
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
  for (const c of dev()?.controls ?? []) initial[ctId(c)] = c.default;
  const [values, setValues] = createSignal<Record<number, number>>(initial);
  const [lastFrame, setLastFrame] = createSignal<string>('');

  const out = () => props.outputId();

  // mirror device replies (F0 00 20 32 devId prod cmd value F7) into the UI
  onMount(() => {
    const off = midi.onMessage((data) => {
      // group frames (table devices) carry several params
      const many = parseCtReplies(props.slug, data, values());
      const r = many ?? [parseCtReply(props.slug, data, values())];
      for (const x of r) if (x) setValues((p) => ({ ...p, [x.id]: x.value }));
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

  // id = ctId(control); 7-bit unless the control's range goes higher
  const setParam = (id: number, value: number) => {
    const c = dev()?.controls.find((c) => ctId(c) === id);
    if (!c) return;
    const v = Math.max(0, Math.min(Math.max(127, c.max), value | 0));
    setValues((p) => ({ ...p, [id]: v }));
    // UI-only selectors (JAM knob layer) send nothing
    if (!c.local)
      send(
        buildCtControl(props.slug, c, v, values()),
        `set 0x${c.cmd.toString(16)}`,
      );
    // controls addressed through this one now point elsewhere: re-read them
    for (const x of dev()!.controls)
      if (x.args?.some((a) => a.ref === c.method))
        send(
          buildCtControl(props.slug, x, null, values()),
          `query 0x${x.cmd.toString(16)}`,
        );
  };

  const queryAll = () => {
    const d = dev();
    if (!d || !out()) {
      actions().pushLog({ dir: 'info', text: 'query all: no MIDI output' });
      return;
    }
    let i = 0;
    const seen = new Set<string>();
    for (const c of d.controls) {
      if (c.local) continue;
      // controls of one group frame share a query
      const q = buildCtControl(props.slug, c, null, values());
      if (seen.has(ctHex(q))) continue;
      seen.add(ctHex(q));
      // stagger so we don't flood the port
      setTimeout(() => midi.send(out()!, q), i * 12);
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
      d.controls.map((c) => [c.method, values()[ctId(c)] ?? c.default]),
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
          <Show when={dev()!.store !== false}>
            <button
              class="btn tiny"
              onClick={() => send(buildCtStore(props.slug), 'store')}
            >
              store
            </button>
          </Show>
          <button class="btn tiny ghost" onClick={exportJson}>
            export json
          </button>
          <For each={dev()!.actions ?? []}>
            {(a) => (
              <button
                class="btn tiny ghost"
                onClick={() =>
                  window.confirm(a.confirm) &&
                  send(buildCtAction(props.slug, a.bytes), a.label)
                }
              >
                {a.label}
              </button>
            )}
          </For>
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
                                    value={values()[ctId(c)] ?? c.default}
                                    onInput={(e) =>
                                      setParam(ctId(c), +e.currentTarget.value)
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
                                    value={values()[ctId(c)] ?? c.default}
                                    onInput={(e) =>
                                      setParam(ctId(c), +e.currentTarget.value)
                                    }
                                    style={{ width: '70px' }}
                                  />
                                </td>
                              </>
                            }
                          >
                            <td colspan="2">
                              <select
                                value={values()[ctId(c)] ?? c.default}
                                onInput={(e) =>
                                  setParam(ctId(c), +e.currentTarget.value)
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
