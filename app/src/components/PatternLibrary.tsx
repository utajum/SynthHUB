// Pattern library bar: save/load named patterns (IndexedDB) and exchange
// patterns as standard .mid files. "all" shows patterns saved from other
// devices; loading adapts them to the current grid.
import { For, Show, createResource, createSignal } from 'solid-js';
import { Sequencer, type SequencerState, type Step } from '../lib/sequencer';
import {
  listPatterns,
  listAllPatterns,
  savePattern,
  deletePattern,
  type PatternEntry,
} from '../lib/patternlib';
import { writeMidi, readMidi, type MidiNote } from '../lib/midifile';
import { actions } from '../lib/store-solid';
import { Icon } from './Icons';

interface Props {
  engine: Sequencer;
  state: () => SequencerState;
  slug: string;
}

export default function PatternLibrary(props: Props) {
  const [name, setName] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  const [rows, { refetch }] = createResource(
    () => ({ slug: props.slug, all: showAll() }),
    (k) => (k.all ? listAllPatterns() : listPatterns(k.slug)),
  );

  const log = (text: string) => actions().pushLog({ dir: 'info', text });

  const save = async () => {
    const st = props.state();
    const nm = name().trim() || `pattern ${new Date().toLocaleString()}`;
    await savePattern({
      slug: props.slug,
      name: nm,
      tags: [],
      mode: st.mode,
      tempo: st.tempo,
      rows: st.rows,
      content: props.engine.contentSnapshot(),
    });
    setName('');
    void refetch();
    log(`pattern library: saved "${nm}"`);
  };

  const load = (e: PatternEntry) => {
    props.engine.loadContent(e.content);
    props.engine.patch({ tempo: e.tempo });
    log(
      `pattern library: loaded "${e.name}"${e.slug !== props.slug ? ` (from ${e.slug})` : ''}`,
    );
  };

  const del = async (e: PatternEntry) => {
    await deletePattern(e.id);
    void refetch();
    log(`pattern library: deleted "${e.name}"`);
  };

  // current editor content -> SMF notes
  const currentNotes = (): MidiNote[] => {
    const st = props.state();
    const out: MidiNote[] = [];
    if (st.mode === 'drum') {
      st.rows.forEach((row, r) => {
        for (let i = 0; i < st.length; i++) {
          const c = st.drum[r][i];
          if (!c.on) continue;
          out.push({
            step: i,
            note: row.note,
            velocity: Math.min(127, c.velocity + (c.accent ? 27 : 0)),
            gateSteps: 0.5,
          });
        }
      });
    } else {
      for (let i = 0; i < st.length; i++) {
        const s = st.steps[i];
        if (!s.on) continue;
        out.push({
          step: i,
          note: s.note,
          velocity: Math.min(127, s.velocity + (s.accent ? 27 : 0)),
          gateSteps: s.gate,
        });
      }
    }
    return out;
  };

  const exportMid = (entryName?: string) => {
    const bytes = writeMidi(currentNotes(), props.state().tempo);
    const a = document.createElement('a');
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }),
    );
    a.href = url;
    a.download = `${props.slug}-${(entryName ?? 'pattern').replace(/[^a-z0-9]+/gi, '-')}.mid`;
    a.click();
    URL.revokeObjectURL(url);
    log(`pattern library: exported .mid (${bytes.length} bytes)`);
  };

  const importMid = async (file: File) => {
    const parsed = readMidi(new Uint8Array(await file.arrayBuffer()));
    if (!parsed || !parsed.notes.length) {
      log(`import ${file.name}: no notes found`);
      return;
    }
    const st = props.state();
    const max = st.maxSteps;
    const length = Math.min(
      max,
      Math.max(1, ...parsed.notes.map((n) => n.step + 1)),
    );
    if (st.mode === 'drum') {
      // map notes to matching voice rows
      st.rows.forEach((row, r) => {
        const patches = Array.from(
          { length: max },
          () => null as null | { on: boolean; velocity: number },
        );
        for (const n of parsed.notes) {
          if (n.note !== row.note || n.step >= max) continue;
          patches[n.step] = { on: true, velocity: n.velocity };
        }
        props.engine.applyRow(r, patches);
      });
    } else {
      const patches = Array.from(
        { length: max },
        () => null as null | Partial<Step>,
      );
      for (const n of parsed.notes) {
        if (n.step >= max || patches[n.step]) continue; // first note per step
        patches[n.step] = {
          on: true,
          note: n.note,
          velocity: n.velocity,
          gate: Math.max(0.1, Math.min(2, n.gateSteps)),
        };
      }
      props.engine.applyMono(patches);
    }
    props.engine.patch({ length, tempo: parsed.tempo });
    log(
      `imported ${file.name}: ${parsed.notes.length} note(s), ${parsed.tempo} bpm`,
    );
  };

  return (
    <div class="rec-bar panel">
      <div class="body flex wrap" style={{ 'align-items': 'center' }}>
        <span class="tiny hot">
          <Icon name="folder" size={13} /> PATTERN LIBRARY
        </span>
        <input
          class="lib-input"
          type="text"
          placeholder="pattern name..."
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button
          class="btn ghost tiny icon-btn"
          onClick={() => void save()}
          title="Save the current pattern"
        >
          <Icon name="save" size={13} /> save
        </button>
        <span class="seq-div" />
        <button
          class="btn ghost tiny"
          onClick={() => exportMid()}
          title="Download the current pattern as a standard MIDI file"
        >
          export .mid
        </button>
        <label
          class="btn ghost tiny"
          style={{ cursor: 'pointer' }}
          title="Load a .mid file into the editor"
        >
          import .mid
          <input
            type="file"
            accept=".mid,.midi,audio/midi"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void importMid(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <span class="spacer" />
        <label
          class="tiny dim flex"
          style={{ gap: '0.3rem', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={showAll()}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
          all devices
        </label>
      </div>
      <Show
        when={(rows() ?? []).length}
        fallback={<div class="body tiny dim">no saved patterns yet</div>}
      >
        <div class="body lib-list">
          <For each={rows()}>
            {(e) => (
              <div class="lib-row">
                <span class="hot tiny">{e.name}</span>
                <span class="tiny dim">
                  {e.mode} - {e.content.length} steps - {e.tempo} bpm
                  {showAll() ? ` - ${e.slug}` : ''}
                </span>
                <span class="spacer" />
                <button
                  class="btn ghost tiny"
                  onClick={() => load(e)}
                  title="Load into the editor"
                >
                  load
                </button>
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
    </div>
  );
}
