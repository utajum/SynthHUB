// UB-Xa 16 librarian (SynthTribe 3.3.1, import placement 3.3.4): read the
// patch names, back up the selected presets to .stpreset / .syx, restore
// files into their own slots or from a selected slot, swap two slots. Each
// preset moves as one dump-file transfer.
import { For, Show, createSignal } from 'solid-js';
import type { DeviceVariant } from '../lib/types';
import { queryDeviceFirmware } from '../lib/firmware';
import { saveFile } from '../lib/midi/port-io';
import { actions } from '../lib/store-solid';
import {
  NAMES_FILE,
  buildPresetSyx,
  buildStPreset,
  fwBytes,
  parseNames,
  parsePresetSyx,
  parseStPreset,
  patchFile,
  placeFrom,
  readFile,
  slotTag,
  writeFile,
  type PresetFile,
} from '../devices/_shared/librarian';

interface Props {
  variant: DeviceVariant;
  outputId: () => string | undefined;
}

export default function LibrarianPanel(props: Props) {
  const [names, setNames] = createSignal<string[]>([]);
  const [sel, setSel] = createSignal<number[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [loaded, setLoaded] = createSignal<PresetFile[]>([]);
  let fw: number[] | null = null;

  // file requests carry the device firmware version (UB-Xa only)
  const firmware = async (out: string) => {
    fw ??= fwBytes((await queryDeviceFirmware(props.variant, out))?.version);
    return fw;
  };

  const run = async (fn: (out: string) => Promise<string>) => {
    const out = props.outputId();
    if (!out || busy()) return;
    setBusy(true);
    try {
      const msg = await fn(out);
      setStatus(msg);
      actions().pushLog({ dir: 'info', text: `Librarian: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const readNames = () =>
    run(async (out) => {
      setStatus('reading names...');
      const f = await readFile(
        props.variant,
        out,
        NAMES_FILE,
        await firmware(out),
      );
      if (!f) return 'names: no reply (timeout or bad checksum)';
      setNames(parseNames(f.data));
      setSel([]);
      return `${names().length} presets`;
    });

  // read the given slots; a string reports the slot that failed
  const readSlots = async (
    out: string,
    slots: number[],
  ): Promise<PresetFile[] | string> => {
    const list: PresetFile[] = [];
    for (const slot of slots) {
      setStatus(`reading ${slotTag(slot)}...`);
      const f = await readFile(
        props.variant,
        out,
        patchFile(slot),
        await firmware(out),
      );
      if (!f) return `read ${slotTag(slot)} failed (timeout or bad checksum)`;
      list.push({ slot, name: names()[slot] || slotTag(slot), ...f });
    }
    return list;
  };

  const writeSlots = async (out: string, list: PresetFile[]) => {
    for (const p of list) {
      setStatus(`writing ${slotTag(p.slot)}...`);
      const ok = await writeFile(
        props.variant,
        out,
        patchFile(p.slot),
        p.size,
        p.data,
        await firmware(out),
      );
      if (!ok) return `write ${slotTag(p.slot)} failed (no ACK)`;
    }
    return '';
  };

  const exportAs = (ext: 'stpreset' | 'syx') =>
    run(async (out) => {
      const list = await readSlots(out, sel());
      if (typeof list === 'string') return list;
      const bytes =
        ext === 'stpreset'
          ? buildStPreset(list)
          : buildPresetSyx(props.variant, list, await firmware(out));
      const base =
        list.length === 1
          ? list[0].name.replace(/[^\w -]+/g, '_').trim() || 'preset'
          : 'UB-Xa presets';
      saveFile(`${base}.${ext}`, bytes, 'application/octet-stream');
      return `exported ${list.length} preset(s) as .${ext}`;
    });

  // one or more .stpreset / .syx files (SynthTribe 3.3.4 multi-file import)
  const importFiles = async (files: File[]) => {
    const all: PresetFile[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = /\.syx$/i.test(file.name)
        ? parsePresetSyx(props.variant, bytes)
        : parseStPreset(bytes);
      if (typeof r === 'string') return setStatus(`${file.name}: ${r}`);
      if (!r.length) return setStatus(`${file.name}: no UB-Xa presets found`);
      all.push(...r);
    }
    setLoaded(all);
    const from = files.length === 1 ? files[0].name : `${files.length} files`;
    setStatus(`${from}: ${all.length} preset(s) ready to write`);
  };

  // write the loaded presets to their own slots, or from slot `start` on
  const writeLoaded = (start?: number) => {
    const list = start === undefined ? loaded() : placeFrom(loaded(), start);
    const slots = list.map((p) => slotTag(p.slot)).join(', ');
    const cut =
      list.length < loaded().length
        ? `\n\nOnly ${list.length} fit when starting at ${slotTag(start!)}.`
        : '';
    if (
      !window.confirm(
        `Overwrite preset slot(s) ${slots} on the device? This can't be undone.${cut}`,
      )
    )
      return;
    void run(async (out) => {
      const err = await writeSlots(out, list);
      return err || `wrote ${list.length} preset(s); read names to refresh`;
    });
  };

  const swap = () => {
    const [a, b] = sel();
    if (!window.confirm(`Swap presets ${slotTag(a)} and ${slotTag(b)}?`))
      return;
    void run(async (out) => {
      const list = await readSlots(out, [a, b]);
      if (typeof list === 'string') return list;
      const err = await writeSlots(out, [
        { ...list[0], slot: b },
        { ...list[1], slot: a },
      ]);
      if (err) return err;
      const n = names().slice();
      [n[a], n[b]] = [n[b], n[a]];
      setNames(n);
      return `swapped ${slotTag(a)} and ${slotTag(b)}`;
    });
  };

  const toggle = (i: number) =>
    setSel((s) =>
      s.includes(i)
        ? s.filter((x) => x !== i)
        : [...s, i].sort((x, y) => x - y),
    );

  let fileInput!: HTMLInputElement;
  const noOut = () => busy() || !props.outputId();

  return (
    <div class="stack">
      <p class="hot">Librarian</p>
      <div class="flex wrap">
        <button class="btn" disabled={noOut()} onClick={readNames}>
          READ NAMES
        </button>
        <button
          class="btn ghost tiny"
          disabled={noOut() || !sel().length}
          onClick={() => exportAs('stpreset')}
          title="Read the selected presets and save them as one .stpreset file"
        >
          export .stpreset
        </button>
        <button
          class="btn ghost tiny"
          disabled={noOut() || !sel().length}
          onClick={() => exportAs('syx')}
          title="Read the selected presets and save their dump streams as .syx"
        >
          export .syx
        </button>
        <button
          class="btn ghost tiny"
          disabled={noOut() || sel().length !== 2}
          onClick={swap}
          title="Swap the two selected presets on the device"
        >
          swap 2
        </button>
        <span class="seq-div" />
        <input
          ref={fileInput}
          type="file"
          accept=".stpreset,.syx"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const fs = Array.from(e.currentTarget.files ?? []);
            if (fs.length) void importFiles(fs);
            e.currentTarget.value = '';
          }}
        />
        <button class="btn ghost tiny" onClick={() => fileInput.click()}>
          import .stpreset / .syx
        </button>
        <Show when={loaded().length}>
          <button
            class="btn"
            disabled={noOut()}
            onClick={() => writeLoaded()}
            title="Write each preset back to the slot stored in the file"
          >
            WRITE {loaded().length} TO ORIGINAL SLOTS
          </button>
          <button
            class="btn ghost"
            disabled={noOut() || !sel().length}
            onClick={() => writeLoaded(sel()[0])}
            title="Write the presets in file order from the first selected slot on"
          >
            WRITE FROM {sel().length ? slotTag(sel()[0]) : 'SELECTED SLOT'}
          </button>
        </Show>
      </div>
      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
      <Show when={names().length}>
        <div class="scroll" style={{ 'max-height': '360px' }}>
          <table class="mono-table">
            <tbody>
              <For each={names()}>
                {(name, i) => (
                  <tr onClick={() => toggle(i())} style={{ cursor: 'pointer' }}>
                    <td style={{ width: '2rem' }}>
                      <input type="checkbox" checked={sel().includes(i())} />
                    </td>
                    <td class="dim" style={{ width: '4rem' }}>
                      {slotTag(i())}
                    </td>
                    <td class="hot">{name}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
