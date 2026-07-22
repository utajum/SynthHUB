// DevicePanel: workspace for one device. Lazily loads the code-split logic
// module, resolves variant + MIDI output from discovery, and renders one tab
// per device function. Firmware flashing is out of scope.
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { onCommand } from '../lib/hotkeys';
import {
  loadDevice,
  meta,
  pickVariant,
  type DeviceModule,
} from '../devices/registry';
import type { DeviceFunction } from '../lib/types';
import type { DeviceDriver } from '../devices/_shared/driver';
import SettingControl from './SettingControl';
import SequencerView from './Sequencer';
import SwingSequencer from './SwingSequencer';
import BulkDump from './BulkDump';
import FirmwareView from './FirmwareView';
import ManualsView from './ManualsView';
import { fetchManuals } from '../lib/manuals';
import ImageZoomModal from './ImageZoomModal';
import { actions, useApp } from '../lib/store-solid';
import { midi } from '../lib/midi/webmidi';
import { buildPresetSyx, sendPresetSyx } from '../devices/_shared/preset';
import {
  requestActivePreset,
  requestAllPresets,
} from '../devices/_shared/preset-sync';
import {
  buildRestoreFactory,
  paramsToCsvRows,
  toCsv,
  fromCsv,
} from '../devices/_shared/params-extra';
import PolyChainView from './PolyChain';
import ControlTribeSettings from './ControlTribeSettings';
import GuitarTribePresets from './GuitarTribePresets';
import PatchLibrary from './PatchLibrary';
import { deviceImage, deviceImageFull } from '../lib/deviceImages';
import VirtualSynthPanel from './VirtualSynthPanel';
import { hasVirtualSynth, virtualId, isVirtualId } from '../lib/virtualsynth';

interface Props {
  slug: string;
}

const HIDDEN_FUNCTIONS = /^#/; // internal/disabled entries in the source config

// display label for a function tab (renames the firmware tab)
function tabLabel(name: string): string {
  return name === 'Update' ? 'Firmware info' : name;
}

export default function DevicePanel(props: Props) {
  const [mod] = createResource<DeviceModule | null, string>(
    () => props.slug,
    (slug) => loadDevice(slug),
  );

  const detected = useApp((s) => s.detected);
  const detEntry = createMemo(() =>
    detected().find((d) => d.slug === props.slug),
  );

  const variant = createMemo(() => {
    const m = mod();
    if (!m) return null;
    return pickVariant(m.definition, detEntry()?.usbPid, detEntry()?.variant);
  });

  const driver = createMemo<DeviceDriver | null>(() => {
    const m = mod();
    const v = variant();
    return m && v ? m.driver(m.definition, v) : null;
  });

  // Virtual synth toggle: while ON this page routes ALL traffic (sequencer,
  // pianos, panel SysEx) to the in-browser engine; OFF restores hardware.
  const [virtualOn, setVirtualOn] = createSignal(false);
  const outputId = () =>
    virtualOn() && hasVirtualSynth(props.slug)
      ? virtualId(props.slug)
      : detEntry()?.midiOutputId;

  // Settings read-back (device -> UI): send 0x75 on connect and decode the
  // 0x76 dump so controls show the hardware's real state. Keyed on the DRIVER
  // INSTANCE (+ port), never the slug - during in-app navigation driver() can
  // briefly still be the previous device's driver, and keying on the slug
  // would lock onto it and never re-request (stale-settings bug).
  let readbackDriver: DeviceDriver | null = null;
  let readbackOut: string | undefined;
  let answered = false;

  onMount(() => {
    const off = midi.onMessage((data) => {
      const d = driver();
      if (!d) return;
      const vals = d.decodeReadback(data);
      if (!vals) return; // not a 0x76 dump for this device/model
      const a = actions();
      for (const v of vals) a.setParam(props.slug, v.key, v.value);
      answered = true; // device replied - stop the read-back retry loop
      a.pushLog({
        dir: 'in',
        text: `read-back: applied ${vals.length} setting(s) from device`,
      });
    });
    onCleanup(off);
  });

  // Request settings as soon as driver + port are ready. The first 0x75 can
  // be dropped while the port is still opening, so retry with backoff and
  // stop the instant the device answers.
  createEffect(() => {
    const d = driver();
    const out = outputId();
    // virtual outputs have no settings to read back - skip the retry loop
    if (!d || !out || isVirtualId(out) || !d.readbackSupported()) return;
    if (d === readbackDriver && out === readbackOut) return; // already scheduled
    readbackDriver = d;
    readbackOut = out;
    answered = false;

    const timers: ReturnType<typeof setTimeout>[] = [];
    [0, 250, 600, 1200, 2400].forEach((ms, attempt) => {
      timers.push(
        setTimeout(() => {
          // fire only while this exact driver+port is still active and the
          // device has not answered (guards against stale schedules)
          if (answered) return;
          if (driver() !== d || outputId() !== out) return;
          const res = d.requestReadback(out);
          actions().pushLog({
            dir: res.ok ? 'out' : 'info',
            text: res.hex
              ? `${res.ok ? '' : '[no-port] '}read-back request${
                  attempt ? ` (retry ${attempt})` : ''
                }  >  ${res.hex}`
              : 'read-back: not supported for this protocol',
          });
        }, ms),
      );
    });
    onCleanup(() => timers.forEach(clearTimeout));
  });

  const functions = createMemo(
    () =>
      mod()?.definition.functions.filter(
        (f) => !HIDDEN_FUNCTIONS.test(f.name),
      ) ?? [],
  );

  // manuals tab: appended after the device functions, shown only when the
  // device has at least one manual
  const [manuals] = createResource(() => props.slug, fetchManuals);
  const showManuals = createMemo(() => (manuals()?.count ?? 0) > 0);

  const [tab, setTab] = createSignal(0);
  const [zoom, setZoom] = createSignal<{ src: string; alt: string } | null>(
    null,
  );
  createEffect(() => {
    // reset to first tab (and close the zoom modal) when device changes;
    // the virtual synth is per-page, so it powers down too
    props.slug;
    setTab(0);
    setZoom(null);
    setVirtualOn(false);
  });

  // focus the active tab button on change; a <button> is not a typing target
  // so global navigation keys keep working
  const tabButtons: (HTMLButtonElement | undefined)[] = [];
  createEffect(() => {
    tab();
    mod();
    queueMicrotask(() => tabButtons[tab()]?.focus({ preventScroll: true }));
  });

  // keyboard: cycle / jump function tabs
  onMount(() => {
    const count = () => allTabNames().length;
    const subs = [
      onCommand('tab:next', () =>
        setTab((t) => (count() ? (t + 1) % count() : 0)),
      ),
      onCommand('tab:prev', () =>
        setTab((t) => (count() ? (t - 1 + count()) % count() : 0)),
      ),
      ...(
        [
          'tab:1',
          'tab:2',
          'tab:3',
          'tab:4',
          'tab:5',
          'tab:6',
          'tab:7',
          'tab:8',
          'tab:9',
        ] as const
      ).map((cmd, i) =>
        onCommand(cmd, () => {
          if (i < count()) setTab(i);
        }),
      ),
    ];
    onCleanup(() => subs.forEach((u) => u()));
  });

  // non-blocking chrome: name, hero and tab bar render instantly from the
  // prebuilt index; only the controls wait on the code-split module
  const info = createMemo(() => meta(props.slug));
  const displayName = () =>
    mod()?.definition.name ?? info()?.name ?? props.slug;
  const tabNames = createMemo<string[]>(() =>
    functions().length
      ? functions().map((f) => f.name)
      : (info()?.functions ?? []).filter((n) => !HIDDEN_FUNCTIONS.test(n)),
  );
  // full tab set = device functions + the synthetic "Manuals" tab (when any)
  const allTabNames = createMemo<string[]>(() =>
    showManuals() ? [...tabNames(), 'Manuals'] : tabNames(),
  );

  return (
    <>
      <div class="panel">
        <header>
          <span>
            {displayName()}
            <Show when={variant() && variant()!.name !== displayName()}>
              <span class="dim"> / {variant()!.name}</span>
            </Show>
          </span>
          <span class="flex tiny" style={{ gap: '0.4rem' }}>
            <Show
              when={variant()}
              fallback={
                <span class="pill dim">proto {info()?.protocols?.[0]}</span>
              }
            >
              <span class="pill">proto {variant()!.protocol}</span>
              <span class="pill">model {variant()!.modelId.join(' ')}</span>
            </Show>
            <Show
              when={outputId()}
              fallback={<span class="pill amber">no midi out</span>}
            >
              <span class="pill">
                <span class="dot on" />{' '}
                {isVirtualId(outputId()) ? 'virtual synth' : 'midi out'}
              </span>
            </Show>
            <Show when={hasVirtualSynth(props.slug)}>
              <button
                class={`pill virt-toggle ${virtualOn() ? 'on' : ''}`}
                onClick={() => setVirtualOn((v) => !v)}
                aria-pressed={virtualOn()}
                title="Play this synth in the browser (Web Audio approximation) - no hardware needed"
              >
                <span class={virtualOn() ? 'dot on' : 'dot'} /> VIRTUAL
              </button>
            </Show>
          </span>
        </header>
        <div class="body">
          {/* hero image - shown immediately from the slug (no module needed) */}
          <Show when={deviceImage(props.slug, variant()?.name)}>
            {(src) => (
              <div class="device-hero">
                <img
                  src={src()}
                  alt={displayName()}
                  loading="lazy"
                  class="zoomable"
                  title="Click to zoom"
                  onClick={() =>
                    setZoom({
                      src:
                        deviceImageFull(props.slug, variant()?.name) ?? src(),
                      alt: variant()?.name ?? displayName(),
                    })
                  }
                />
                <div class="scan" />
              </div>
            )}
          </Show>
          {/* virtual synth: keyed on the slug so navigating devices always
              tears down the old engine before building the new one */}
          <Show
            when={virtualOn() && hasVirtualSynth(props.slug) && props.slug}
            keyed
          >
            {(slug) => <VirtualSynthPanel slug={slug} />}
          </Show>
          {/* tabs - labels from the index during load (disabled until ready) */}
          <div
            class="flex wrap"
            style={{ 'margin-bottom': '0.7rem', 'margin-top': '0.7rem' }}
          >
            <For each={allTabNames()}>
              {(nm, i) => (
                <button
                  ref={(el) => (tabButtons[i()] = el)}
                  class={`btn ${tab() === i() ? 'primary' : 'ghost'}`}
                  disabled={!mod() && nm !== 'Manuals'}
                  onClick={() => setTab(i())}
                >
                  {tabLabel(nm)}
                </button>
              )}
            </For>
          </div>

          {/* active tab - focusable container so keyboard tab-switching moves
              focus into the controls (press Tab to edit them) */}
          <div tabindex="-1" class="tab-content">
            <Show when={mod.loading}>
              <p class="muted tiny">syncing controls from device profile...</p>
            </Show>
            <Show when={!mod.loading && mod() === null}>
              <p class="red">unknown device: {props.slug}</p>
            </Show>
            <Show when={mod()}>
              <For each={functions()}>
                {(fn, i) => (
                  <Show when={tab() === i()}>
                    <FunctionView
                      slug={props.slug}
                      fn={fn}
                      driver={driver}
                      outputId={outputId}
                      def={mod()!.definition}
                    />
                  </Show>
                )}
              </For>
            </Show>
            {/* synthetic Manuals tab - independent of the logic module */}
            <Show when={showManuals() && tab() === tabNames().length}>
              <ManualsView manuals={manuals()?.manuals ?? []} />
            </Show>
          </div>
        </div>
      </div>
      <Show when={zoom()}>
        {(z) => (
          <ImageZoomModal
            src={z().src}
            alt={z().alt}
            onClose={() => setZoom(null)}
          />
        )}
      </Show>
    </>
  );
}

function FunctionView(props: {
  slug: string;
  fn: DeviceFunction;
  driver: () => DeviceDriver | null;
  outputId: () => string | undefined;
  def: DeviceModule['definition'];
}) {
  const name = props.fn.name;
  const params = useApp((s) => s.params[props.slug] ?? {});

  return (
    <Show
      when={props.driver()}
      fallback={<p class="muted">initializing driver...</p>}
    >
      <Show when={name === 'Sequencer' && props.slug === 'swing'}>
        <SwingSequencer outputId={props.outputId} />
      </Show>
      <Show when={name === 'Sequencer' && props.slug !== 'swing'}>
        <SequencerView
          def={props.def}
          fn={props.fn}
          outputId={props.outputId}
          driver={props.driver()!}
          slug={props.slug}
        />
      </Show>

      <Show when={name === 'Update'}>
        <FirmwareView
          variant={props.driver()!.variant}
          outputId={props.outputId}
        />
      </Show>

      <Show when={/alibration/i.test(name)}>
        <CalibrationView fn={props.fn} />
      </Show>

      <Show when={name === 'PolyChain'}>
        <PolyChainView
          variant={props.driver()!.variant}
          outputId={props.outputId}
        />
      </Show>

      <Show when={name === 'Device Settings'}>
        <ControlTribeSettings slug={props.slug} outputId={props.outputId} />
      </Show>

      {/* settings-bearing functions (General, Sample, etc.) */}
      <Show when={props.fn.settings && props.fn.settings.length > 0}>
        <div class="stack">
          {/* GuitarTribe pedals use MIDI CC: show preset bar, not SysEx tools */}
          <Show when={props.def.app === 'guitartribe'}>
            <GuitarTribePresets
              slug={props.slug}
              def={props.def}
              driver={props.driver()!}
              outputId={props.outputId}
            />
          </Show>
          <Show when={props.def.app !== 'guitartribe'}>
            <div
              class="flex"
              style={{
                'justify-content': 'space-between',
                'align-items': 'center',
                gap: '0.5rem',
              }}
            >
              <span class="tiny dim">
                <Show
                  when={props.driver()!.readbackSupported()}
                  fallback={'edit values - each change is sent to the device'}
                >
                  values reflect the device (auto-read on connect)
                </Show>
              </span>
              <span class="flex" style={{ gap: '0.4rem' }}>
                <Show when={props.driver()!.readbackSupported()}>
                  <button
                    class="btn ghost tiny"
                    disabled={!props.outputId()}
                    title="Ask the device to re-send its current settings (read-only)"
                    onClick={() => {
                      const d = props.driver();
                      const out = props.outputId();
                      if (!d || !out) return;
                      const res = d.requestReadback(out);
                      actions().pushLog({
                        dir: res.ok ? 'out' : 'info',
                        text: res.hex
                          ? `reload from device  >  ${res.hex}`
                          : 'reload: no port',
                      });
                    }}
                  >
                    reload
                  </button>
                  <button
                    class="btn ghost tiny"
                    disabled={!props.outputId()}
                    title="Request the device's active preset (SysEx 0x00 - reply repopulates the controls)"
                    onClick={() => {
                      const d = props.driver();
                      const out = props.outputId();
                      if (!d || !out) return;
                      const res = d.sendRaw(
                        out,
                        requestActivePreset(d.variant),
                      );
                      actions().pushLog({
                        dir: res.ok ? 'out' : 'info',
                        text: `receive preset  >  ${res.hex}`,
                      });
                    }}
                  >
                    receive preset
                  </button>
                </Show>
                {/* CSV export/import of the current control values */}
                <button
                  class="btn ghost tiny"
                  title="Export the current control values as CSV"
                  onClick={() => {
                    const rows = paramsToCsvRows(
                      props.def,
                      params() as Record<string, number>,
                    );
                    const url = URL.createObjectURL(
                      new Blob([toCsv(rows)], { type: 'text/csv' }),
                    );
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${props.slug}-settings.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    actions().pushLog({
                      dir: 'info',
                      text: `exported ${rows.length} value(s) to CSV`,
                    });
                  }}
                >
                  export csv
                </button>
                <label
                  class="btn ghost tiny"
                  style={{ cursor: 'pointer' }}
                  title="Load control values from CSV and send them to the device"
                >
                  import csv
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      const map = fromCsv(await file.text());
                      const a = actions();
                      let n = 0;
                      for (const [key, value] of Object.entries(map)) {
                        a.setParam(props.slug, key, value);
                        n++;
                      }
                      a.pushLog({
                        dir: 'info',
                        text: `imported ${n} value(s) from ${file.name}`,
                      });
                      input.value = '';
                    }}
                  />
                </label>
                {/* DESTRUCTIVE: gated behind an explicit confirmation */}
                <button
                  class="btn ghost tiny amber"
                  disabled={!props.outputId()}
                  title="Restore the device to factory settings (DESTRUCTIVE)"
                  onClick={() => {
                    const d = props.driver();
                    const out = props.outputId();
                    if (!d || !out) return;
                    if (
                      !window.confirm(
                        'Restore FACTORY settings on the device? This overwrites the unit\u2019s current user settings and cannot be undone.',
                      )
                    )
                      return;
                    const res = d.sendRaw(out, buildRestoreFactory(d.variant));
                    actions().pushLog({
                      dir: res.ok ? 'out' : 'info',
                      text: `restore factory  >  ${res.hex}`,
                    });
                    // give the device a moment, then reload its (now-default) state
                    setTimeout(() => d.requestReadback(out), 600);
                  }}
                >
                  restore factory
                </button>
                <button
                  class="btn ghost tiny"
                  title="Export the current settings as a .syx patch file"
                  onClick={() => {
                    const d = props.driver();
                    if (!d) return;
                    const bytes = buildPresetSyx(props.def, d, params());
                    const url = URL.createObjectURL(
                      new Blob([bytes.buffer as ArrayBuffer], {
                        type: 'application/octet-stream',
                      }),
                    );
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${props.slug}-preset.syx`;
                    a.click();
                    URL.revokeObjectURL(url);
                    actions().pushLog({
                      dir: 'info',
                      text: `exported ${bytes.length}-byte .syx (${props.slug})`,
                    });
                  }}
                >
                  export .syx
                </button>
                <label
                  class="btn ghost tiny"
                  style={{ cursor: 'pointer' }}
                  title="Send a .syx patch file to the device"
                >
                  import .syx
                  <input
                    type="file"
                    accept=".syx,.bin,.mid"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      const out = props.outputId();
                      const n = sendPresetSyx(out, bytes);
                      actions().pushLog({
                        dir: n ? 'out' : 'info',
                        text: out
                          ? `imported ${file.name}: sent ${n} message(s) to device`
                          : `import ${file.name}: no MIDI output`,
                      });
                      // auto-reload so the controls reflect what was sent
                      const d = props.driver();
                      if (out && n && d) {
                        setTimeout(() => {
                          const res = d.requestReadback(out);
                          actions().pushLog({
                            dir: res.ok ? 'out' : 'info',
                            text: `auto-reload after import  >  ${res.hex}`,
                          });
                        }, 400);
                      }
                      input.value = '';
                    }}
                  />
                </label>
              </span>
            </div>
          </Show>
          {/* named preset library (IndexedDB) - snapshots the whole device */}
          <Show when={props.def.app !== 'controltribe'}>
            <PatchLibrary
              slug={props.slug}
              def={props.def}
              driver={props.driver}
              outputId={props.outputId}
            />
          </Show>
          <For each={props.fn.settings}>
            {(setting, i) => (
              <SettingControl
                slug={props.slug}
                fnName={name}
                position={i()}
                setting={setting}
                driver={props.driver()!}
                outputId={props.outputId}
              />
            )}
          </For>
        </div>
      </Show>

      {/* generic view for data/bulk functions without individual settings
          (Sample, Wavetable, WavePreset, Librarian, Preset, ...) */}
      <Show
        when={
          !props.fn.settings?.length &&
          !['Sequencer', 'Update', 'PolyChain', 'Device Settings'].includes(
            name,
          ) &&
          !/alibration/i.test(name)
        }
      >
        <GenericFunctionView
          name={name}
          deviceName={props.def.name}
          outputId={props.outputId}
          driver={props.driver()!}
        />
      </Show>
    </Show>
  );
}

// informative + bulk-dump view for functions without per-control UI
function GenericFunctionView(props: {
  name: string;
  deviceName: string;
  outputId: () => string | undefined;
  driver: DeviceDriver;
}) {
  const n = props.name.toLowerCase();
  const isLibrary =
    n.includes('preset') || n.includes('librarian') || n.includes('patch');
  const requestAll = () => {
    const out = props.outputId();
    if (!out) {
      actions().pushLog({ dir: 'info', text: `${props.name}: no MIDI output` });
      return;
    }
    const msg = requestAllPresets(props.driver.variant);
    props.driver.sendRaw(out, msg);
    actions().pushLog({
      dir: 'out',
      text: `${props.name}: request all (0x00 20) - use RECEIVE DUMP to capture the reply`,
    });
  };
  const kind = n.includes('sample')
    ? {
        title: 'Sample memory',
        blurb:
          'Upload/receive user samples to the device sample slots via SysEx bulk transfer.',
      }
    : n.includes('wavetable') || n.includes('wave')
      ? {
          title: 'Wavetable',
          blurb:
            'Manage on-device wavetables. Send factory or user wavetables as SysEx bulk data.',
        }
      : n.includes('preset')
        ? {
            title: 'Presets',
            blurb:
              'Send and receive device presets/patches as SysEx bulk dumps.',
          }
        : n.includes('librarian')
          ? {
              title: 'Librarian',
              blurb:
                'Back up and restore the full patch library via SysEx dump.',
            }
          : {
              title: props.name,
              blurb: 'Bulk data function - transferred as SysEx dump/receive.',
            };

  return (
    <div class="stack">
      <p class="hot">{kind.title}</p>
      <p class="muted tiny">{kind.blurb}</p>
      <Show when={isLibrary}>
        <div class="flex wrap">
          <button
            class="btn"
            disabled={!props.outputId()}
            onClick={requestAll}
            title="Ask the device to send all presets (SysEx 0x00 0x20)"
          >
            REQUEST ALL FROM DEVICE
          </button>
          <span class="tiny dim">
            then use RECEIVE DUMP below to capture the reply
          </span>
        </div>
      </Show>
      <BulkDump
        name={props.name}
        deviceName={props.deviceName}
        outputId={props.outputId}
        variant={props.driver.variant}
      />
    </div>
  );
}

function CalibrationView(props: { fn: DeviceFunction }) {
  const channels = () =>
    (props.fn.cvchannels as Array<Record<string, unknown>>) ?? [];
  return (
    <div class="stack">
      <div class="fw-banner unknown">
        <span class="amber">REFERENCE ONLY</span>
        <span class="tiny dim">calibration is not performed here</span>
      </div>
      <p class="muted">
        The values below are the CV calibration{' '}
        <strong>reference points</strong> from the device profile - shown here
        for information only. This app does <strong>not</strong> perform
        calibration.
      </p>
      <p class="tiny dim">
        To actually calibrate your unit, use the official Behringer SynthTribe
        application and follow the calibration procedure in your device's
        Behringer user manual / quick-start guide. Improper calibration can
        affect tuning and tracking, so always use the official tools and
        documented steps.
      </p>
      <Show
        when={channels().length}
        fallback={<p class="dim tiny">No calibration channels.</p>}
      >
        <table class="mono-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Calibration points</th>
            </tr>
          </thead>
          <tbody>
            <For each={channels()}>
              {(ch) => (
                <tr>
                  <td class="hot">{String(ch.label)}</td>
                  <td class="tiny">
                    {((ch.points as Array<Record<string, unknown>>) ?? [])
                      .map((p) => String(p.name))
                      .join('  -  ')}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
