// BCR32 presets (Control Tribe 1.12.4 BCR32Controller): preset names and
// select, BCL export to a .bcl file and BCL import line by line, erase and
// factory reset.
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { saveFile } from '../lib/midi/port-io';
import { actions } from '../lib/store-solid';
import {
  BCL_ALL,
  BCL_GLOBAL,
  BCL_WORKING,
  BCR_PRESETS,
  bclErrorText,
  bclExportRequest,
  bclFatal,
  bclLine,
  bcrControllerMode,
  bcrErasePreset,
  bcrFactoryReset,
  bcrNamesRequest,
  bcrSelectPreset,
  bcrSnapshot,
  bcrZaquencerMode,
  isEndLine,
  parseBclLine,
  parseBclReply,
  parsePresetName,
  prepareBcl,
} from '../devices/_shared/bcr32';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Bcr32Panel(props: {
  outputId: () => string | undefined;
}) {
  const [names, setNames] = createSignal<string[]>(Array(BCR_PRESETS).fill(''));
  const [preset, setPreset] = createSignal(0);
  const [target, setTarget] = createSignal(BCL_WORKING);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const label = (p: number) =>
    `Preset ${p + 1}${names()[p] ? `  ${names()[p]}` : ''}`;

  const offNames = midi.onMessage((d) => {
    const n = parsePresetName(d);
    if (!n || n.preset >= BCR_PRESETS) return;
    setNames((a) => a.map((x, i) => (i === n.preset ? n.name : x)));
  });
  onCleanup(offNames);

  const send = (bytes: Uint8Array, what: string) => {
    const out = props.outputId();
    if (!out) return false;
    midi.send(out, bytes);
    actions().pushLog({ dir: 'out', text: `BCR32: ${what}` });
    return true;
  };

  const run = async (fn: (out: string) => Promise<string>) => {
    const out = props.outputId();
    if (!out || busy()) return;
    setBusy(true);
    try {
      setStatus(await fn(out));
    } finally {
      setBusy(false);
    }
  };

  // BCL needs Controller mode; the transfer starts 500 ms later
  const controllerMode = async (out: string) => {
    midi.send(out, bcrControllerMode());
    await sleep(500);
  };

  const exportBcl = () =>
    run(async (out) => {
      await controllerMode(out);
      setStatus('waiting for the device...');
      const lines: string[] = [];
      let next = 0;
      let lost = 0;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          off();
          resolve();
        };
        // 3 s without a line ends the export
        let timer = setTimeout(done, 3000);
        const off = midi.onMessage((d) => {
          const l = parseBclLine(d);
          if (!l) return;
          lost += (l.idx - next) & 0x3fff;
          next = l.idx + 1;
          lines.push(l.text);
          setStatus(`received ${lines.length} lines`);
          clearTimeout(timer);
          if (isEndLine(l.text)) return done();
          timer = setTimeout(done, 3000);
        });
        midi.send(out, bclExportRequest(target()));
      });
      if (!lines.length)
        return 'The device did not answer. BCL export needs firmware v1.0.1 or later, and the device must be in Controller mode (not in a menu).';
      if (!isEndLine(lines[lines.length - 1]))
        return `The export stopped after ${lines.length} lines without reaching $end.`;
      if (lost)
        return `${lost} lines were lost on the way, so the file was not written. Please try again.`;
      const t = target();
      const name =
        t === BCL_WORKING
          ? 'BCR32 Working Preset'
          : t === BCL_GLOBAL
            ? 'BCR32 Global Settings'
            : t === BCL_ALL
              ? 'BCR32 All Presets'
              : `BCR32 Preset ${t + 1}${names()[t] ? ` - ${names()[t]}` : ''}`;
      saveFile(
        `${name.replace(/[\\/:*?"<>|]/g, '_')}.bcl`,
        lines.join('\r\n') + '\r\n',
        'text/plain',
      );
      return `exported ${lines.length} lines`;
    });

  const importBcl = async (file: File) => {
    const r = prepareBcl(await file.text());
    if ('errors' in r) {
      setStatus(`The file cannot be sent: ${r.errors.join('; ')}`);
      return;
    }
    if (!window.confirm(`Send ${r.lines.length} BCL lines from ${file.name}?`))
      return;
    void run(async (out) => {
      await controllerMode(out);
      const errors: string[] = [];
      for (let i = 0; i < r.lines.length; i++) {
        setStatus(`sending line ${i + 1}/${r.lines.length}`);
        const idx = i & 0x3fff;
        const reply = await new Promise<number | null>((resolve) => {
          const off = midi.onMessage((d) => {
            const p = parseBclReply(d);
            if (!p || p.idx !== idx) return;
            clearTimeout(timer);
            off();
            resolve(p.err);
          });
          // about 5 s per line (248 timer ticks of 20 ms)
          const timer = setTimeout(() => {
            off();
            resolve(null);
          }, 5000);
          midi.send(out, bclLine(i, r.lines[i]));
        });
        if (reply === null) return `The device did not answer line ${i + 1}.`;
        if (!reply) continue;
        const msg = `line ${i + 1}: ${bclErrorText(reply)}`;
        if (bclFatal(reply, i))
          return `The device stopped the transfer at ${msg}.`;
        errors.push(msg);
      }
      return errors.length
        ? `sent with ${errors.length} error(s): ${errors.join('; ')}`
        : `sent ${r.lines.length} lines`;
    });
  };

  const confirmSend = (bytes: Uint8Array, what: string, text: string) =>
    window.confirm(text) && send(bytes, what);

  let fileInput!: HTMLInputElement;
  const off = () => busy() || !props.outputId();

  return (
    <div class="stack">
      <p class="hot">Presets</p>
      <div class="flex wrap">
        <button
          class="btn tiny"
          disabled={off()}
          onClick={() => send(bcrControllerMode(), 'Controller mode')}
        >
          Controller mode
        </button>
        <button
          class="btn tiny"
          disabled={off()}
          onClick={() => send(bcrZaquencerMode(), 'Zaquencer mode')}
        >
          Zaquencer mode
        </button>
        <button
          class="btn tiny ghost"
          disabled={off()}
          onClick={() => send(bcrSnapshot(), 'snapshot')}
        >
          snapshot
        </button>
        <button
          class="btn tiny ghost"
          disabled={off()}
          onClick={() => send(bcrNamesRequest(), 'read names')}
        >
          read names
        </button>
      </div>
      <div class="flex wrap">
        <select
          class="tiny"
          style={{ width: 'auto' }}
          value={preset()}
          onChange={(e) => setPreset(Number(e.currentTarget.value))}
        >
          <For each={names()}>
            {(_, i) => <option value={i()}>{label(i())}</option>}
          </For>
        </select>
        <button
          class="btn tiny"
          disabled={off()}
          onClick={() =>
            send(bcrSelectPreset(preset()), `select preset ${preset() + 1}`)
          }
        >
          select
        </button>
        <button
          class="btn tiny ghost"
          disabled={off()}
          onClick={() =>
            confirmSend(
              bcrErasePreset(preset()),
              `erase preset ${preset() + 1}`,
              `Erase ${label(preset())} on the device?`,
            )
          }
        >
          erase
        </button>
      </div>
      <div class="flex wrap">
        <select
          class="tiny"
          style={{ width: 'auto' }}
          value={target()}
          onChange={(e) => setTarget(Number(e.currentTarget.value))}
        >
          <option value={BCL_WORKING}>Working preset</option>
          <option value={BCL_ALL}>All presets</option>
          <option value={BCL_GLOBAL}>Global settings</option>
          <For each={names()}>
            {(_, i) => <option value={i()}>{label(i())}</option>}
          </For>
        </select>
        <button
          class="btn tiny"
          disabled={off()}
          onClick={() => void exportBcl()}
        >
          export .bcl
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".bcl,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void importBcl(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          class="btn tiny"
          disabled={off()}
          onClick={() => fileInput.click()}
        >
          import .bcl
        </button>
        <span class="spacer" />
        <button
          class="btn tiny ghost"
          disabled={off()}
          onClick={() =>
            confirmSend(
              bcrFactoryReset(),
              'factory reset',
              'Restore the BCR32 to its factory settings? All presets and settings are erased.',
            )
          }
        >
          factory reset
        </button>
      </div>
      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
    </div>
  );
}
