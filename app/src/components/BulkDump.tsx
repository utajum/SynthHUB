// Bulk SysEx transfer for data functions (Sample, Wavetable, Preset, ...):
// send a .syx file to the device and capture incoming dumps for download.
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { splitSysex, hex, isMusicTribeSysex } from '../lib/midi/sysex';
import { actions } from '../lib/store-solid';
import type { DeviceVariant } from '../lib/types';
import { decodeSampleDump } from '../devices/_shared/sample';
import { decodeWaveSlotNames } from '../devices/_shared/wavetable';

interface Props {
  name: string;
  deviceName: string;
  outputId: () => string | undefined;
  variant?: DeviceVariant;
}

export default function BulkDump(props: Props) {
  const [capturing, setCapturing] = createSignal(false);
  const [captured, setCaptured] = createSignal<Uint8Array[]>([]);
  const [sentCount, setSentCount] = createSignal(0);
  const [parsed, setParsed] = createSignal<string[]>([]);
  let unsub: (() => void) | null = null;
  onCleanup(() => unsub?.());

  // pull human-readable info (sample/wave names) out of a dump
  const parseDump = (msg: Uint8Array) => {
    const v = props.variant;
    if (!v) return;
    const s = decodeSampleDump(v, msg);
    if (s && s.names.length) {
      setParsed((p) => [...p, ...s.names.map((n) => `sample: ${n}`)]);
      return;
    }
    const names = decodeWaveSlotNames(v, msg);
    if (names && names.length)
      setParsed((p) => [...p, ...names.map((n) => `wave slot: ${n}`)]);
  };

  const capturedBytes = () => captured().reduce((n, m) => n + m.length, 0);

  const sendFile = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    const msgs = splitSysex(buf);
    const out = props.outputId();
    if (!out) {
      actions().pushLog({ dir: 'info', text: `${props.name}: no MIDI output` });
      return;
    }
    let n = 0;
    for (const m of msgs) {
      // pace bulk messages slightly so the device keeps up
      midi.send(out, m);
      n++;
      if (n % 16 === 0) await new Promise((r) => setTimeout(r, 8));
    }
    setSentCount(n);
    actions().pushLog({
      dir: 'out',
      text: `${props.name}: sent ${n} SysEx message(s) from ${file.name} (${buf.length} bytes)`,
    });
  };

  const toggleCapture = () => {
    if (capturing()) {
      unsub?.();
      unsub = null;
      setCapturing(false);
      actions().pushLog({
        dir: 'info',
        text: `${props.name}: captured ${captured().length} message(s), ${capturedBytes()} bytes`,
      });
      return;
    }
    setCaptured([]);
    setParsed([]);
    setCapturing(true);
    unsub = midi.onMessage((data) => {
      if (data[0] !== 0xf0) return; // SysEx only
      setCaptured((c) => [...c, data]);
      parseDump(data);
    });
    actions().pushLog({
      dir: 'info',
      text: `${props.name}: capturing incoming SysEx...`,
    });
  };

  const download = () => {
    const total = capturedBytes();
    const merged = new Uint8Array(total);
    let o = 0;
    for (const m of captured()) {
      merged.set(m, o);
      o += m.length;
    }
    const blob = new Blob([merged], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = props.deviceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    a.href = url;
    a.download = `${slug}-${props.name.toLowerCase()}.syx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  let fileInput!: HTMLInputElement;

  return (
    <div class="stack">
      <div class="flex wrap">
        <input
          ref={fileInput}
          type="file"
          accept=".syx,.mid,application/octet-stream"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void sendFile(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          class="btn"
          disabled={!props.outputId()}
          onClick={() => fileInput.click()}
          title="Send a .syx dump to the device"
        >
          SEND DUMP (.syx)
        </button>
        <Show when={sentCount() > 0}>
          <span class="pill tiny">sent {sentCount()}</span>
        </Show>

        <span class="seq-div" />

        <button
          class={`btn ${capturing() ? 'rec-on' : ''}`}
          onClick={toggleCapture}
          title="Capture incoming SysEx dump from the device"
        >
          {capturing() ? 'STOP CAPTURE' : 'RECEIVE DUMP'}
        </button>
        <Show when={captured().length > 0}>
          <span class="pill tiny">
            {captured().length} msg / {capturedBytes()} B
          </span>
          <button class="btn ghost" onClick={download}>
            SAVE .syx
          </button>
        </Show>
      </div>
      <p class="tiny dim">
        SEND streams a .syx file to the device as-is (any Music-Tribe or
        standard SysEx). RECEIVE captures whatever SysEx the device transmits
        (trigger the dump on the unit, or via its dump control) and saves it as
        a .syx file.
      </p>
      <Show when={capturing()}>
        <p class="tiny amber">
          Capturing... last:{' '}
          <span class="dim">
            {captured().length
              ? hex(captured()[captured().length - 1].slice(0, 10))
              : '--'}
            {captured().length &&
            isMusicTribeSysex(captured()[captured().length - 1])
              ? ' (music-tribe)'
              : ''}
          </span>
        </p>
      </Show>
      <Show when={parsed().length}>
        <div class="stack" style={{ gap: '0.15rem' }}>
          <span class="tiny hot">parsed from dump:</span>
          <For each={parsed()}>
            {(line) => <span class="tiny dim">{line}</span>}
          </For>
        </div>
      </Show>
    </div>
  );
}
