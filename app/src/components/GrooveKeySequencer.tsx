// GROOVE KEY sequencer project (Control Tribe 1.12.4 GrooveKeySequencer):
// read all tracks and patterns from the device, write them back, and
// export / import Control Tribe .gkseq files.
import { For, Show, createMemo, createSignal } from 'solid-js';
import { saveFile } from '../lib/midi/port-io';
import { actions } from '../lib/store-solid';
import {
  GK_EXT,
  gkFileText,
  gkFromFile,
  gkImage,
  gkRead,
  gkSummary,
  gkWrite,
} from '../devices/_shared/groovekey-seq';

export default function GrooveKeySequencer(props: {
  outputId: () => string | undefined;
}) {
  const [img, setImg] = createSignal<Uint8Array | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const sum = createMemo(() => (img() ? gkSummary(img()!) : null));
  const pct = (what: string) => (i: number, n: number) =>
    setStatus(`${what} ${i}/${n}`);

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
  const read = () =>
    run(async (out) => {
      const next = img() ? Uint8Array.from(img()!) : gkImage();
      const missed = await gkRead(out, next, pct('reading'));
      setImg(next);
      actions().pushLog({
        dir: 'in',
        text: 'GROOVE KEY: sequencer project read',
      });
      return missed ? `read with ${missed} items not answered` : 'project read';
    });
  const write = () => {
    if (
      !img() ||
      !window.confirm(
        'Write the whole sequencer project (tracks, patterns, songs) to the device?',
      )
    )
      return;
    void run(
      async (out) =>
        (await gkWrite(out, img()!, pct('writing'))) ?? 'project written',
    );
  };
  const load = async (f: File) => {
    const r = gkFromFile(await f.text());
    if (typeof r === 'string') return setStatus(`Import failed: ${r}`);
    setImg(r);
    setStatus(`imported ${f.name}`);
  };
  let fileInput!: HTMLInputElement;
  const blocked = () => busy() || !props.outputId();

  return (
    <div class="stack">
      <div class="flex wrap">
        <button
          class="btn tiny"
          disabled={blocked()}
          onClick={() => void read()}
        >
          read from device
        </button>
        <button class="btn tiny" disabled={blocked() || !img()} onClick={write}>
          write to device
        </button>
        <button
          class="btn tiny ghost"
          disabled={!img()}
          onClick={() =>
            saveFile(`GrooveKey_Project.${GK_EXT}`, gkFileText(img()!))
          }
        >
          export .{GK_EXT}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={`.${GK_EXT}`}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void load(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          class="btn tiny ghost"
          disabled={busy()}
          onClick={() => fileInput.click()}
        >
          import .{GK_EXT}
        </button>
      </div>
      <Show
        when={sum()}
        fallback={
          <p class="muted tiny">
            Read the project from the device or import a .{GK_EXT} file.
          </p>
        }
      >
        {(s) => (
          <table class="mono-table">
            <tbody>
              <tr>
                <td class="hot">project</td>
                <td colspan="2">
                  bpm {s().bpm} / swing {s().swing} / song {s().curSong + 1}
                </td>
              </tr>
              <For each={s().tracks}>
                {(t, i) => (
                  <tr>
                    <td class="hot">track {i() + 1}</td>
                    <td>
                      pattern {t.curPattern + 1}, preset {t.preset}
                    </td>
                    <td class="tiny dim">
                      lengths {t.patterns.map((p) => p.length).join(' ')}
                    </td>
                  </tr>
                )}
              </For>
              <tr>
                <td class="hot">drums</td>
                <td>pattern {s().drumTrack.curPattern + 1}</td>
                <td class="tiny dim">
                  lengths{' '}
                  {s()
                    .drumTrack.patterns.map((p) => p.length)
                    .join(' ')}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Show>
      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
    </div>
  );
}
