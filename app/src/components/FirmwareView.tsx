// Firmware info panel (info only, never flashes): compares the device's
// version (SysEx cmd 0x08) with the latest cloud release (via /api/firmware).
// Queries automatically on open and when a MIDI output appears.
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
} from 'solid-js';
import type { DeviceVariant } from '../lib/types';
import {
  queryDeviceFirmware,
  fetchServerFirmware,
  compareFirmware,
  type DeviceFirmware,
  type ServerFirmware,
  type CompareResult,
} from '../lib/firmware';
import { actions } from '../lib/store-solid';

interface Props {
  variant: DeviceVariant;
  outputId: () => string | undefined;
}

const CMP: Record<CompareResult, { text: string; cls: string }> = {
  'up-to-date': { text: 'UP TO DATE', cls: 'hot' },
  'update-available': { text: 'UPDATE AVAILABLE', cls: 'amber' },
  ahead: { text: 'DEVICE AHEAD OF SERVER', cls: 'hot' },
  unknown: { text: 'UNKNOWN', cls: 'dim' },
};

export default function FirmwareView(props: Props) {
  const [device, setDevice] = createSignal<DeviceFirmware | null>(null);
  const [querying, setQuerying] = createSignal(false);
  const [server, setServer] = createSignal<ServerFirmware | null>(null);
  const [serverErr, setServerErr] = createSignal<string | null>(null);
  const [checking, setChecking] = createSignal(false);

  const cmp = createMemo(() =>
    compareFirmware(device()?.version ?? null, server()?.version ?? null),
  );

  const queryDevice = async () => {
    if (!props.outputId()) return;
    setQuerying(true);
    actions().pushLog({
      dir: 'out',
      text: 'Firmware: querying device version (cmd 0x08)...',
    });
    const r = await queryDeviceFirmware(props.variant, props.outputId());
    setDevice(r);
    setQuerying(false);
    actions().pushLog({
      dir: r ? 'in' : 'info',
      text: r
        ? `Firmware: device reports ${r.version ?? '(unparsed)'} [${r.raw}]`
        : 'Firmware: no reply from device',
    });
  };

  const checkServer = async () => {
    setChecking(true);
    setServerErr(null);
    try {
      const r = await fetchServerFirmware(
        props.variant.cloudFamily ?? '',
        props.variant.cloudModel ?? '',
      );
      setServer(r);
      actions().pushLog({
        dir: 'info',
        text: `Firmware: server latest = ${r.version}`,
      });
    } catch (e) {
      setServer(null);
      setServerErr((e as Error).message || 'request failed');
    } finally {
      setChecking(false);
    }
  };

  // query automatically on open...
  onMount(() => {
    void queryDevice();
    void checkServer();
  });
  // ...and re-query the device as soon as a MIDI output becomes available.
  createEffect(
    on(
      () => props.outputId(),
      (id, prev) => {
        if (id && id !== prev) void queryDevice();
      },
      { defer: true },
    ),
  );

  return (
    <div class="stack">
      <div class="flex" style={{ 'justify-content': 'space-between' }}>
        <p class="hot" style={{ margin: 0 }}>
          Firmware info
        </p>
        <span class="pill tiny">read-only - no flashing</span>
      </div>

      <div class={`fw-banner ${cmp()}`}>
        <span class="fw-cmp">
          <span class={CMP[cmp()].cls}>{CMP[cmp()].text}</span>
        </span>
        <span class="tiny dim">
          device <span class="hot">{device()?.version ?? '?'}</span> vs server{' '}
          <span class="hot">{server()?.version ?? '?'}</span>
        </span>
      </div>
      <Show when={cmp() === 'ahead'}>
        <p class="tiny dim">
          Newer factory firmware than the cloud catalog - normal on recent
          production units (e.g. TD-3 ships v2.0.1, cloud stops at 1.3.7).
          Nothing to do.
        </p>
      </Show>

      <table class="mono-table">
        <tbody>
          <tr>
            <td class="muted" style={{ width: '9rem' }}>
              Device firmware
            </td>
            <td>
              <Show
                when={device()}
                fallback={
                  <span class="tiny dim">
                    {querying()
                      ? 'querying...'
                      : props.outputId()
                        ? 'no reply'
                        : 'no MIDI output'}
                  </span>
                }
              >
                <span class="hot">{device()!.version ?? '(unparsed)'}</span>{' '}
                <span class="tiny dim">{device()!.raw}</span>
              </Show>
            </td>
          </tr>
          <tr>
            <td class="muted">Latest (server)</td>
            <td>
              <Show
                when={server()?.version}
                fallback={
                  <span class="tiny dim">
                    {checking()
                      ? 'checking...'
                      : serverErr()
                        ? serverErr()
                        : server()
                          ? 'no firmware published for this model'
                          : '-'}
                  </span>
                }
              >
                <span class="hot">{server()!.version}</span>
              </Show>{' '}
              <span class="tiny dim">
                {props.variant.cloudFamily}/{props.variant.cloudModel}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <Show when={(server()?.releases?.length ?? 0) > 0}>
        <div class="stack" style={{ gap: '0.35rem' }}>
          <p class="muted tiny" style={{ margin: 0 }}>
            All firmware versions ({server()!.releases!.length})
          </p>
          <div class="scroll fw-versions-wrap">
            <table class="mono-table fw-versions">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Date</th>
                  <th>Size</th>
                  <th>Firmware</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <For each={server()!.releases}>
                  {(r) => (
                    <tr>
                      <td class="hot">{r.version}</td>
                      <td class="tiny dim">{r.releaseDate ?? '-'}</td>
                      <td class="tiny dim">
                        {r.bytes ? `${Math.round(r.bytes / 1024)} KB` : '-'}
                      </td>
                      <td>
                        <Show
                          when={r.downloadUrl}
                          fallback={<span class="tiny dim">-</span>}
                        >
                          <a
                            class="btn tiny fw-btn"
                            href={r.downloadUrl}
                            download={r.filename ?? ''}
                            target="_blank"
                            rel="noopener"
                          >
                            download
                          </a>
                        </Show>
                      </td>
                      <td>
                        <Show
                          when={r.notesUrl}
                          fallback={
                            <Show
                              when={r.notesText}
                              fallback={<span class="tiny dim">-</span>}
                            >
                              <span
                                class="tiny dim"
                                title={r.notesText}
                                style={{ cursor: 'help' }}
                              >
                                text
                              </span>
                            </Show>
                          }
                        >
                          <a
                            class="btn ghost tiny fw-btn"
                            href={r.notesUrl}
                            target="_blank"
                            rel="noopener"
                          >
                            notes
                          </a>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>

      <p class="tiny dim">
        The firmware file is provided for reference and backups only. To
        actually flash it, use the official Behringer SynthTribe application -
        this app is read-only and never writes firmware.
      </p>
    </div>
  );
}
