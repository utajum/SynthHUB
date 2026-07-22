// Patch library: named per-device presets in IndexedDB with tags, favorites,
// search and A/B diff. Save captures the current control values; entries can
// be re-applied, sent to the device, exported or diffed. Drag-and-drop (or
// pick) .syx files to keep raw dumps in the library too.
import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import type { DeviceDef } from '../lib/types';
import type { DeviceDriver } from '../devices/_shared/driver';
import { buildPresetSyx, sendPresetSyx } from '../devices/_shared/preset';
import {
  listPatches,
  savePatch,
  updatePatch,
  deletePatch,
  filterPatches,
  diffPatches,
  parseTags,
  type PatchEntry,
} from '../lib/patchlib';
import { actions, useApp } from '../lib/store-solid';
import { Icon } from './Icons';

interface Props {
  slug: string;
  def: DeviceDef;
  driver: () => DeviceDriver | null;
  outputId: () => string | undefined;
}

export default function PatchLibrary(props: Props) {
  const params = useApp((s) => s.params[props.slug] ?? {});
  const [name, setName] = createSignal('');
  const [tags, setTags] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [dragOver, setDragOver] = createSignal(false);
  const [aId, setAId] = createSignal<string | null>(null);
  const [bId, setBId] = createSignal<string | null>(null);
  const [rows, { refetch }] = createResource(
    () => props.slug,
    (slug) => listPatches(slug),
  );

  const log = (dir: 'in' | 'out' | 'info', text: string) =>
    actions().pushLog({ dir, text });

  const visible = createMemo(() => filterPatches(rows() ?? [], query()));
  const byId = (id: string | null) => (rows() ?? []).find((r) => r.id === id);
  const diff = createMemo(() => {
    const a = byId(aId());
    const b = byId(bId());
    if (!a?.params || !b?.params) return null;
    return { a, b, changes: diffPatches(a, b) };
  });

  const saveCurrent = async () => {
    const nm = name().trim() || `patch ${new Date().toLocaleString()}`;
    await savePatch({
      slug: props.slug,
      name: nm,
      tags: parseTags(tags()),
      fav: false,
      params: { ...params() },
    });
    setName('');
    setTags('');
    void refetch();
    log('info', `patch library: saved "${nm}"`);
  };

  const apply = (e: PatchEntry) => {
    if (!e.params) return;
    const a = actions();
    for (const [k, v] of Object.entries(e.params)) a.setParam(props.slug, k, v);
    log('info', `patch library: applied "${e.name}" to the editor`);
  };

  const entryBytes = (e: PatchEntry): Uint8Array | null => {
    if (e.syx) return Uint8Array.from(e.syx);
    const d = props.driver();
    if (!e.params || !d) return null;
    return buildPresetSyx(props.def, d, e.params);
  };

  const send = (e: PatchEntry) => {
    const bytes = entryBytes(e);
    if (!bytes || !bytes.length) {
      log('info', `patch library: "${e.name}" has nothing to send`);
      return;
    }
    const n = sendPresetSyx(props.outputId(), bytes);
    log(
      n ? 'out' : 'info',
      `patch library: "${e.name}" - sent ${n} message(s) to device`,
    );
  };

  const exportEntry = (e: PatchEntry) => {
    const bytes = entryBytes(e);
    if (!bytes) return;
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/octet-stream',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.slug}-${e.name.replace(/[^a-z0-9]+/gi, '-')}.syx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFav = async (e: PatchEntry) => {
    await updatePatch({ ...e, fav: !e.fav });
    void refetch();
  };

  const del = async (e: PatchEntry) => {
    await deletePatch(e.id);
    if (aId() === e.id) setAId(null);
    if (bId() === e.id) setBId(null);
    void refetch();
    log('info', `patch library: deleted "${e.name}"`);
  };

  const importFiles = async (files: FileList | File[]) => {
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await savePatch({
        slug: props.slug,
        name: f.name.replace(/\.(syx|bin)$/i, ''),
        tags: ['import'],
        fav: false,
        syx: [...bytes],
      });
      log('info', `patch library: imported ${f.name} (${bytes.length} bytes)`);
    }
    void refetch();
  };

  return (
    <details class="legend patch-lib">
      <summary>
        <Icon name="folder" size={13} /> PATCH LIBRARY
        <span class="dim tiny"> ({(rows() ?? []).length})</span>
      </summary>
      <div
        class={`legend-body stack ${dragOver() ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files.length)
            void importFiles(e.dataTransfer.files);
        }}
      >
        <div class="flex wrap">
          <input
            class="lib-input"
            type="text"
            placeholder="patch name..."
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <input
            class="lib-input"
            type="text"
            placeholder="tags, comma separated"
            value={tags()}
            onInput={(e) => setTags(e.currentTarget.value)}
          />
          <button
            class="btn ghost tiny icon-btn"
            onClick={() => void saveCurrent()}
            title="Snapshot the current control values into the library"
          >
            <Icon name="save" size={13} /> save current
          </button>
          <label
            class="btn ghost tiny"
            style={{ cursor: 'pointer' }}
            title="Add .syx files to the library"
          >
            add .syx
            <input
              type="file"
              accept=".syx,.bin"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.currentTarget.files?.length)
                  void importFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <span class="spacer" />
          <span class="lib-search flex">
            <Icon name="search" size={13} />
            <input
              class="lib-input"
              type="search"
              placeholder="search name / tag"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </span>
        </div>

        <Show
          when={visible().length}
          fallback={
            <p class="tiny dim">
              no patches yet - save the current settings or drop .syx files here
            </p>
          }
        >
          <div class="lib-list">
            <For each={visible()}>
              {(e) => (
                <div class="lib-row">
                  <button
                    class={`icon-btn fav ${e.fav ? 'on' : ''}`}
                    onClick={() => void toggleFav(e)}
                    title={e.fav ? 'Unfavorite' : 'Favorite'}
                  >
                    <Icon name="star" size={13} fill={e.fav} />
                  </button>
                  <span class="hot tiny">{e.name}</span>
                  <Show when={e.tags.length}>
                    <span class="tiny dim">[{e.tags.join(', ')}]</span>
                  </Show>
                  <span class="tiny dim">
                    {e.syx
                      ? `raw ${e.syx.length} B`
                      : `${Object.keys(e.params ?? {}).length} params`}
                    {' - '}
                    {new Date(e.ts).toLocaleDateString()}
                  </span>
                  <span class="spacer" />
                  <Show when={e.params}>
                    <button
                      class="btn ghost tiny"
                      onClick={() => apply(e)}
                      title="Apply values to the editor"
                    >
                      apply
                    </button>
                  </Show>
                  <button
                    class="btn ghost tiny"
                    disabled={!props.outputId()}
                    onClick={() => send(e)}
                    title="Send to the device"
                  >
                    send
                  </button>
                  <button
                    class="btn ghost tiny"
                    onClick={() => exportEntry(e)}
                    title="Download as .syx"
                  >
                    .syx
                  </button>
                  <Show when={e.params}>
                    <button
                      class={`btn ghost tiny ${aId() === e.id ? 'primary' : ''}`}
                      onClick={() => setAId(aId() === e.id ? null : e.id)}
                      title="Mark as diff side A"
                    >
                      A
                    </button>
                    <button
                      class={`btn ghost tiny ${bId() === e.id ? 'primary' : ''}`}
                      onClick={() => setBId(bId() === e.id ? null : e.id)}
                      title="Mark as diff side B"
                    >
                      B
                    </button>
                  </Show>
                  <button
                    class="btn ghost tiny"
                    onClick={() => void del(e)}
                    title="Delete"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={diff()}>
          {(d) => (
            <div class="stack">
              <span class="tiny hot">
                diff: {d().a.name} (A) vs {d().b.name} (B) -{' '}
                {d().changes.length} change(s)
              </span>
              <Show when={d().changes.length}>
                <table class="mono-table">
                  <thead>
                    <tr>
                      <th>param</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={d().changes}>
                      {(c) => (
                        <tr>
                          <td class="tiny">{c.key}</td>
                          <td class="tiny">{c.a ?? '-'}</td>
                          <td class="tiny amber">{c.b ?? '-'}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </details>
  );
}
