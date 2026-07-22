// Sequencer editor: plays the connected synth live over MIDI and records from
// any MIDI input. Drum devices render a voice x step matrix; mono synths a
// note lane. Click a cell/step to edit it in the inspector.
import {
  For,
  Show,
  createSignal,
  createMemo,
  onCleanup,
  onMount,
  createEffect,
} from 'solid-js';
import { onCommand } from '../lib/hotkeys';
import type { DeviceDef, DeviceFunction } from '../lib/types';
import {
  Sequencer,
  noteName,
  type SeqRow,
  type SequencerState,
  type Direction,
} from '../lib/sequencer';
import { Icon, type IconName } from './Icons';
import { useApp, actions } from '../lib/store-solid';
import PianoRollModal from './PianoRollModal';
import QwertyPiano from './QwertyPiano';
import GenerativeBar from './GenerativeBar';
import PatternLibrary from './PatternLibrary';
import type { DeviceDriver } from '../devices/_shared/driver';
import { midi } from '../lib/midi/webmidi';
import {
  requestPattern,
  decodeDump,
  dumpToSteps,
  mergeSteps,
  encodeTD3,
  encodeMono0,
  buildPatternWrite,
  buildRawPatternWrite,
  MONO_SYNC_TYPES,
  SONG_PKT_TYPES,
  SEQ_TYPE_NAMES,
  seqCaps,
  type SeqCaps,
} from '../devices/_shared/sequencer-sync';
import { hex, splitSysex } from '../lib/midi/sysex';
import { isVirtualId } from '../lib/virtualsynth';

interface Props {
  def: DeviceDef;
  fn: DeviceFunction;
  outputId: () => string | undefined;
  driver: DeviceDriver;
  slug: string;
}

// RD-6 (type 3) voice rows: its config has neither rows nor a voicenotemap,
// so without this it fell through to the melodic piano-roll. GM notes.
const RD6_DRUMS: SeqRow[] = [
  { label: 'Bass Drum', note: 36 },
  { label: 'Snare Drum', note: 38 },
  { label: 'Low Tom', note: 43 },
  { label: 'Hi Tom', note: 50 },
  { label: 'Cymbal', note: 49 },
  { label: 'Clap', note: 39 },
  { label: 'Open Hi Hat', note: 46 },
  { label: 'Closed Hi Hat', note: 42 },
];

const GM_DRUMS: SeqRow[] = [
  { label: 'Bass Drum', note: 36 },
  { label: 'Snare', note: 38 },
  { label: 'Low Tom', note: 43 },
  { label: 'Mid Tom', note: 47 },
  { label: 'Hi Tom', note: 50 },
  { label: 'Rim Shot', note: 37 },
  { label: 'Hand Clap', note: 39 },
  { label: 'Cowbell', note: 56 },
  { label: 'Cymbal', note: 49 },
  { label: 'Open Hat', note: 46 },
  { label: 'Closed Hat', note: 42 },
];

// GM percussion note per normalized voice name (from the SynthTribe editor's
// own note table). Recording matches incoming notes to rows by note number,
// so each voice must carry its instrument's real GM note.
const GM_DRUM_NOTES: [number, string[]][] = [
  [35, ['ACOUSTICBASSDRUM']],
  [36, ['BASS', 'BASSDRUM', 'BASSDRUM1', 'KICK']],
  [37, ['SIDESTICK', 'RIMSHOT', 'RIM']],
  [38, ['SNARE', 'SNAREDRUM', 'ACOUSTICSNARE']],
  [39, ['CLAP', 'CLAPS', 'HANDCLAP']],
  [40, ['ELECTRICSNARE']],
  [41, ['LOWFLOORTOM']],
  [42, ['HAT', 'HIHAT', 'HIGHHAT', 'CLOSEDHAT', 'CLOSEDHIHAT', 'CH']],
  [43, ['HIGHFLOORTOM']],
  [44, ['PEDALHAT', 'PEDALHIHAT']],
  [45, ['LOWTOM', 'TOM']],
  [46, ['OPENHAT', 'OPENHIHAT', 'OH']],
  [47, ['LOWMIDTOM', 'MIDTOM']],
  [48, ['HIMIDTOM']],
  [49, ['CRASH', 'CRASHCYMBAL', 'CYMBAL']],
  [50, ['HITOM', 'HIGHTOM']],
  [51, ['RIDE', 'RIDECYMBAL']],
  [52, ['CHINACYMBAL', 'CHINESE', 'CHINESECYMBAL']],
  [53, ['RIDEBELL']],
  [54, ['TAMB', 'TAMBOURINE']],
  [55, ['SPLASH', 'SPLASHCYMBAL']],
  [56, ['COWBELL']],
  [57, ['CRASHCYMBAL2']],
  [58, ['VIBRASLAP']],
  [59, ['RIDECYMBAL2']],
  [60, ['HIBONGO', 'HIGHBONGO']],
  [61, ['LOWBONGO']],
  [62, ['MUTEHICONGA']],
  [63, ['OPENHICONGA', 'HICONGA', 'HIGHCONGA', 'CONGA']],
  [64, ['LOWCONGA']],
  [65, ['HITIMBALE', 'HIGHTIMBALE']],
  [66, ['LOWTIMBALE']],
  [67, ['HIAGOGO', 'HIGHAGOGO']],
  [68, ['LOWAGOGO']],
  [69, ['CABASA']],
  [70, ['MARACAS', 'SHAKER']],
  [73, ['GUIRO', 'SHORTGUIRO']],
  [75, ['CLAVE', 'CLAVES']],
  [76, ['WOODBLOCK', 'HIWOODBLOCK']],
  [77, ['LOWWOODBLOCK']],
];
const GM_NOTE_BY_NAME: Record<string, number> = {};
for (const [note, names] of GM_DRUM_NOTES)
  for (const nm of names) GM_NOTE_BY_NAME[nm] = note;

// numbered toms (BMX TOM1..TOM6) spread across the GM tom range
const TOM_NOTES = [41, 43, 45, 47, 48, 50];

// voice label -> lookup key: part before "/", uppercased, punctuation stripped
function normVoice(label: string): string {
  return label
    .split('/')[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// MIDI note for a named drum voice, or null when not a known GM instrument
function knownNote(label: string): number | null {
  const key = normVoice(label);
  const tom = key.match(/^TOM(\d+)$/);
  if (tom) {
    const i = Math.max(0, Math.min(TOM_NOTES.length - 1, Number(tom[1]) - 1));
    return TOM_NOTES[i];
  }
  const n = GM_NOTE_BY_NAME[key];
  return typeof n === 'number' ? n : null;
}

// rows from device voice labels: known voices take their GM note; unknown
// voices get the next free note so rows never shadow each other
function buildRows(labels: string[]): SeqRow[] {
  const notes = labels.map(knownNote);
  const used = new Set(notes.filter((n): n is number => n != null));
  let next = 36;
  return labels.map((label, i) => {
    let note = notes[i];
    if (note == null) {
      while (used.has(next)) next++;
      note = next;
      used.add(next);
    }
    return { label, note };
  });
}

function deriveRows(def: DeviceDef, type?: number): SeqRow[] {
  for (const fn of def.functions) {
    for (const s of fn.settings ?? []) {
      if (s.type === 'voicenotemap') {
        const labels = String((s.raw as Record<string, unknown>).labels ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (labels.length) return buildRows(labels);
      }
    }
  }
  if (type === 3) return RD6_DRUMS;
  return GM_DRUMS;
}

const DIRECTIONS: { id: Direction; icon: IconName; title: string }[] = [
  { id: 'fwd', icon: 'fwd', title: 'Forward' },
  { id: 'rev', icon: 'rev', title: 'Reverse' },
  { id: 'pingpong', icon: 'pingpong', title: 'Ping-pong' },
  { id: 'random', icon: 'random', title: 'Random' },
];

// device pattern-memory geometry

// drum-machine sequencer types (per-type SequencerController subclasses)
const DRUM_TYPES = new Set([3, 4, 5, 6, 7, 8, 10, 11, 12]);

// max steps per pattern from the device manuals (config `columns` wins)
const TYPE_MAX_STEPS: Record<number, number> = { 0: 32, 1: 16, 2: 32, 10: 64 };

// [banks, patterns-per-bank] per sequencer type (SequencerController ctor,
// byte0 = bank, HW-verified MS-1 MK II)
const WIRE_DIMS: Record<number, [number, number]> = {
  0: [8, 8], // Crave / Grind / MS-1 / MS-1 MKII (manual: 8 banks of 8)
  1: [4, 16], // TD-3: 4 groups (I-IV) x 16 patterns
  3: [2, 16], // RD-6
  6: [5, 16], // RD-78
  11: [2, 16],
};

// song machines set no ctor dims; [songs, patterns-per-song] from the manuals
const MANUAL_DIMS: Record<number, [number, number]> = {
  2: [8, 8], // Poly D: banks 1-8, patterns 1-8 (LOCATION LEDs)
  4: [16, 16], // RD-9
  5: [16, 16], // RD-8 / RD-8 MKII
  7: [8, 16], // LM-DRUM
  8: [16, 16], // RS-9
  10: [8, 16], // BMX
};

// TD-3 display names: 16 wire slots shown as 1A-8A / 1B-8B, banks as I-IV
const TD3_PATTERN_NAMES = Array.from(
  { length: 16 },
  (_, i) => `${(i % 8) + 1}${i < 8 ? 'A' : 'B'}`,
);
const TD3_GROUP_NAMES = ['I', 'II', 'III', 'IV'];

export default function SequencerView(props: Props) {
  const isDrum = createMemo(
    () =>
      (props.fn.rows ?? 0) > 1 ||
      DRUM_TYPES.has(props.fn.type ?? -1) ||
      props.def.functions.some((f) =>
        (f.settings ?? []).some((s) => s.type === 'voicenotemap'),
      ),
  );
  const maxSteps = createMemo(() =>
    Math.min(64, props.fn.columns ?? TYPE_MAX_STEPS[props.fn.type ?? -1] ?? 16),
  );
  const rows = createMemo(() =>
    isDrum() ? deriveRows(props.def, props.fn.type) : [],
  );
  // per-step fields this device's pattern memory can persist; drum grids
  // never round-trip so they keep the full local toolset
  const caps = isDrum() ? seqCaps(-1) : seqCaps(props.fn.type ?? -1);

  const configBank =
    typeof props.fn.banklabel === 'string' && props.fn.banklabel.length > 0;
  // an explicit pattern_count (e.g. Swing) suppresses the type-driven dims;
  // otherwise type dims apply even without supportdump
  const explicitCount = typeof props.fn.pattern_count === 'number';
  const dims = explicitCount
    ? undefined
    : (WIRE_DIMS[props.fn.type ?? -1] ?? MANUAL_DIMS[props.fn.type ?? -1]);
  const isTD3 = !explicitCount && props.fn.type === 1;
  const engine = new Sequencer(isDrum() ? 'drum' : 'mono', maxSteps(), rows(), {
    patternCount: explicitCount
      ? (props.fn.pattern_count as number)
      : (dims?.[1] ?? (configBank ? 16 : 8)),
    bankCount: dims?.[0] ?? (configBank ? 8 : 1),
    patternLabel: props.fn.patternlabel ?? 'pattern',
    bankLabel:
      props.fn.banklabel ??
      (dims && dims[0] > 1
        ? props.fn.type === 1
          ? 'group'
          : 'bank'
        : undefined),
    patternNames: isTD3 ? TD3_PATTERN_NAMES : undefined,
    bankNames: isTD3 ? TD3_GROUP_NAMES : undefined,
  });
  const [state, setState] = createSignal<SequencerState>(engine.snapshot);
  onCleanup(engine.subscribe(setState));
  onCleanup(() => engine.dispose());
  createEffect(() => engine.setOutput(props.outputId()));

  // persistence: the engine dies with this component, so edits are saved
  // (debounced) to localStorage per slug and restored on mount
  const persistKey = `seq:${props.slug}`;
  try {
    const raw = localStorage.getItem(persistKey);
    if (raw) engine.restore(JSON.parse(raw));
  } catch {
    // corrupted/unavailable storage - start fresh
  }
  const persistNow = () => {
    try {
      localStorage.setItem(persistKey, JSON.stringify(engine.serialize()));
    } catch {
      // quota/private mode - persistence is best-effort
    }
  };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(
    engine.subscribe(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 400);
    }),
  );
  // flush on unmount (during playback every tick resets the debounce)
  onCleanup(() => {
    clearTimeout(saveTimer);
    persistNow();
  });

  // selection for the inspector
  const [sel, setSel] = createSignal<{ row: number; step: number } | null>(
    null,
  );

  // available MIDI inputs for recording (ANY device)
  const midiInputs = useApp((s) => s.midiInputs);
  const [showRec, setShowRec] = createSignal(false);
  const [showPiano, setShowPiano] = createSignal(false);
  const [showKeys, setShowKeys] = createSignal(false);
  const [showGen, setShowGen] = createSignal(false);
  const [showLib, setShowLib] = createSignal(false);

  // REC toggles: armed -> disarm; otherwise toggle the record panel
  const recClick = () => {
    if (state().recording) {
      engine.disarmRecord();
      setShowRec(false);
      return;
    }
    setShowRec((v) => !v);
  };

  // keyboard control of the sequencer (only active while this view is mounted)
  onMount(() => {
    const subs = [
      onCommand('seq:playstop', () => engine.toggle()),
      onCommand('seq:clear', () => engine.clear()),
      onCommand('seq:rand', () => engine.randomize()),
      onCommand('seq:rec', recClick),
      onCommand('seq:tempo-up', () =>
        engine.patch({ tempo: Math.min(300, state().tempo + 1) }),
      ),
      onCommand('seq:tempo-down', () =>
        engine.patch({ tempo: Math.max(30, state().tempo - 1) }),
      ),
    ];
    onCleanup(() => subs.forEach((u) => u()));
  });

  // drive a lightweight ticker while recording so the activity LED is reactive
  const [, setTick] = createSignal(0);
  createEffect(() => {
    if (!state().recording) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    onCleanup(() => clearInterval(id));
  });
  const noteFresh = () => Date.now() - state().recActivity < 180;
  const lastNoteName = () =>
    state().recLastNote >= 0 ? noteName(state().recLastNote) : '--';

  const steps = () => Array.from({ length: state().length }, (_, i) => i);

  return (
    <div class="stack seq">
      {/* transport */}
      <div class="seq-transport flex wrap">
        <button
          class={`btn ${state().playing ? '' : 'primary'} icon-btn`}
          onClick={() => engine.toggle()}
          title={state().playing ? 'Stop' : 'Play'}
        >
          <Icon name={state().playing ? 'stop' : 'play'} fill />
          {state().playing ? 'STOP' : 'PLAY'}
        </button>

        <button
          class={`btn icon-btn ${state().recording ? 'rec-on' : ''}`}
          onClick={recClick}
          title={state().recording ? 'Stop recording (disarm)' : 'MIDI record'}
        >
          <Icon name="record" fill />
          REC
        </button>

        <button
          class="btn ghost icon-btn"
          onClick={() => engine.clear()}
          title="Clear"
        >
          <Icon name="trash" />
        </button>
        <button
          class="btn ghost icon-btn"
          onClick={() => engine.randomize()}
          title="Randomize"
        >
          <Icon name="dice" />
        </button>
        <button
          class="btn ghost icon-btn"
          onClick={() => engine.shift(-1)}
          title="Shift left"
        >
          <Icon name="shift-l" />
        </button>
        <button
          class="btn ghost icon-btn"
          onClick={() => engine.shift(1)}
          title="Shift right"
        >
          <Icon name="shift-r" />
        </button>
        <Show when={!isDrum()}>
          <button
            class="btn ghost icon-btn"
            onClick={() => setShowPiano(true)}
            title="Piano roll (alternative editor)"
          >
            <Icon name="piano" /> ROLL
          </button>
        </Show>
        <button
          class={`btn icon-btn ${showKeys() ? 'primary' : 'ghost'}`}
          onClick={() => setShowKeys((v) => !v)}
          title="On-screen / QWERTY piano - play the synth live"
          aria-pressed={showKeys()}
        >
          <Icon name="piano" /> KEYS
        </button>
        <button
          class={`btn icon-btn ${showGen() ? 'primary' : 'ghost'}`}
          onClick={() => setShowGen((v) => !v)}
          title="Generative tools - euclid, melody, evolve, humanize"
          aria-pressed={showGen()}
        >
          <Icon name="wand" /> GEN
        </button>
        <button
          class={`btn icon-btn ${showLib() ? 'primary' : 'ghost'}`}
          onClick={() => setShowLib((v) => !v)}
          title="Pattern library - save/load patterns, .mid export/import"
          aria-pressed={showLib()}
        >
          <Icon name="folder" /> LIB
        </button>

        <span class="seq-div" />

        <label class="knob-field" title="Tempo (BPM)">
          <span class="lbl">
            <Icon name="metronome" size={12} /> {state().tempo}
          </span>
          <input
            type="range"
            min="30"
            max="300"
            value={state().tempo}
            onInput={(e) => engine.patch({ tempo: +e.currentTarget.value })}
          />
        </label>
        <label class="knob-field" title="Swing">
          <span class="lbl">swing {(state().swing * 100) | 0}%</span>
          <input
            type="range"
            min="0"
            max="0.6"
            step="0.02"
            value={state().swing}
            onInput={(e) => engine.patch({ swing: +e.currentTarget.value })}
          />
        </label>
        <label class="knob-field" title="Pattern length">
          <span class="lbl">len {state().length}</span>
          <input
            type="range"
            min="1"
            max={state().maxSteps}
            value={state().length}
            onInput={(e) => engine.patch({ length: +e.currentTarget.value })}
          />
        </label>

        <span class="seq-div" />

        {/* pattern (and bank/song) slot selector - local per-slot patterns */}
        <div class="seq-slot" role="group" aria-label={state().patternLabel}>
          <span class="lbl tiny">{state().patternLabel}</span>
          <button
            class="icon-btn"
            onClick={() => engine.selectSlot(state().bank, state().pattern - 1)}
            disabled={state().pattern <= 0}
            title="Previous"
          >
            <Icon name="minus" size={13} />
          </button>
          <span class="slot-num">
            {state().patternNames?.[state().pattern] ?? state().pattern + 1}/
            {state().patternNames
              ? state().patternNames![state().patternCount - 1]
              : state().patternCount}
          </span>
          <button
            class="icon-btn"
            onClick={() => engine.selectSlot(state().bank, state().pattern + 1)}
            disabled={state().pattern >= state().patternCount - 1}
            title="Next"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <Show when={state().bankCount > 1}>
          <div class="seq-slot" role="group" aria-label={state().bankLabel}>
            <span class="lbl tiny">{state().bankLabel}</span>
            <button
              class="icon-btn"
              onClick={() =>
                engine.selectSlot(state().bank - 1, state().pattern)
              }
              disabled={state().bank <= 0}
              title="Previous"
            >
              <Icon name="minus" size={13} />
            </button>
            <span class="slot-num">
              {state().bankNames?.[state().bank] ?? state().bank + 1}/
              {state().bankNames
                ? state().bankNames![state().bankCount - 1]
                : state().bankCount}
            </span>
            <button
              class="icon-btn"
              onClick={() =>
                engine.selectSlot(state().bank + 1, state().pattern)
              }
              disabled={state().bank >= state().bankCount - 1}
              title="Next"
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
        </Show>

        <span class="seq-div" />

        <div class="dir-group" role="group" aria-label="Direction">
          <For each={DIRECTIONS}>
            {(d) => (
              <button
                class={`icon-btn ${state().direction === d.id ? 'sel' : ''}`}
                onClick={() => engine.patch({ direction: d.id })}
                title={d.title}
              >
                <Icon name={d.icon} />
              </button>
            )}
          </For>
        </div>

        <label
          class="knob-field"
          title="MIDI channel"
          style={{ width: '70px' }}
        >
          <span class="lbl">ch</span>
          <select
            value={state().channel}
            onChange={(e) => engine.patch({ channel: +e.currentTarget.value })}
          >
            <For each={Array.from({ length: 16 }, (_, i) => i)}>
              {(i) => <option value={i}>{i + 1}</option>}
            </For>
          </select>
        </label>

        <span class="spacer" />
        <span class="pill tiny">seq-type {props.fn.type ?? '?'}</span>
        <Show when={props.fn.supportdump}>
          <span class="pill tiny">
            <Icon name="chip" size={12} /> dump
          </span>
        </Show>
      </div>

      {/* device pattern sync (SysEx 0x77/0x78) - hidden for the virtual
          synth, which has no pattern memory to read or write */}
      <Show when={!isVirtualId(props.outputId())}>
        <DeviceSyncBar
          engine={engine}
          state={state}
          driver={props.driver}
          outputId={props.outputId}
          type={props.fn.type ?? 0}
          slug={props.slug}
        />
      </Show>

      {/* generative tools */}
      <Show when={showGen()}>
        <GenerativeBar
          engine={engine}
          state={state}
          isDrum={isDrum}
          selRow={() => sel()?.row ?? 0}
        />
      </Show>

      {/* pattern library */}
      <Show when={showLib()}>
        <PatternLibrary engine={engine} state={state} slug={props.slug} />
      </Show>

      {/* on-screen / QWERTY piano */}
      <Show when={showKeys()}>
        <QwertyPiano engine={engine} state={state} outputId={props.outputId} />
      </Show>

      {/* MIDI record bar */}
      <Show when={showRec()}>
        <div class="rec-bar panel">
          <div class="body flex wrap">
            <span class="tiny hot">
              <Icon name="usb" size={13} /> RECORD SOURCE
            </span>
            <select
              style={{ 'max-width': '260px' }}
              onChange={(e) => {
                const id = e.currentTarget.value;
                const inp = midiInputs().find((i) => i.id === id);
                if (inp) engine.armRecord(inp.id, inp.name);
              }}
            >
              <option value="">- select any MIDI input -</option>
              <For each={midiInputs()}>
                {(inp) => (
                  <option
                    value={inp.id}
                    selected={state().recInputId === inp.id}
                  >
                    {inp.name}
                    {inp.manufacturer ? ` - ${inp.manufacturer}` : ''}
                  </option>
                )}
              </For>
            </select>

            <Show
              when={state().recording}
              fallback={<span class="tiny dim">not armed</span>}
            >
              <span class="pill rec-live tiny">
                <span class="dot err" /> REC - {state().recInputName}
              </span>
              {/* live MIDI-in activity indicator */}
              <span
                class={`midi-activity tiny ${noteFresh() ? 'lit' : ''}`}
                title="Incoming MIDI"
              >
                <span class="led" /> MIDI IN
                <span class="note-readout">{lastNoteName()}</span>
                <span class="dim">v{state().recLastVelocity}</span>
              </span>
              <button
                class="btn ghost tiny"
                onClick={() => engine.disarmRecord()}
              >
                disarm
              </button>
            </Show>
            <span class="spacer" />
            <span class="tiny dim">
              {state().playing
                ? 'overdub at playhead'
                : `step-record -> step ${state().recCursor + 1}`}
            </span>
          </div>
          <Show when={!midiInputs().length}>
            <div class="body tiny amber">
              No MIDI inputs yet - click ENABLE MIDI in the transport bar and
              grant access.
            </div>
          </Show>
        </div>
      </Show>

      {/* grid */}
      <div class="scroll">
        <Show
          when={isDrum()}
          fallback={
            <MonoGrid
              engine={engine}
              state={state}
              steps={steps}
              sel={sel}
              setSel={setSel}
              caps={caps}
            />
          }
        >
          <DrumGrid
            engine={engine}
            state={state}
            steps={steps}
            sel={sel}
            setSel={setSel}
          />
        </Show>
      </div>

      {/* legend: orange = engine-only features for this device */}
      <Show
        when={
          !isDrum() &&
          (!caps.velocity ||
            !caps.accent ||
            !caps.slide ||
            !caps.ratchet ||
            !caps.probability)
        }
      >
        <p class="tiny dim">
          <span class="legend-swatch" /> orange rows and controls are not stored
          in this device's patterns - they play from the PWA only.
        </p>
      </Show>

      {/* step inspector */}
      <Show when={sel()}>
        <StepInspector
          engine={engine}
          state={state}
          sel={sel}
          isDrum={isDrum}
          caps={caps}
        />
      </Show>

      <p class="tiny dim">
        Live playback drives the connected synth over MIDI. Ratchets,
        probability, gate and swing are computed here in real time.
        Reading/writing the device's internal patterns via SysEx dump is
        device-specific. TD-3 patterns store accent + slide but no velocity (vel
        &gt;= 112 writes the accent bit; the device plays accents at 112, plain
        notes at 80) - ratchet and probability play from the PWA only.
        MS-1-family patterns store velocity + gate per step: accent writes
        velocity &gt;= 112, slide holds the note into the next step, ratchet
        &gt; 1 writes a retrigger roll. Reading back keeps your local extras
        (exact velocity, ratchet count, probability) on steps the device did not
        change.
      </p>

      <Show when={showPiano() && !isDrum()}>
        <PianoRollModal
          engine={engine}
          state={state}
          onClose={() => setShowPiano(false)}
        />
      </Show>
    </div>
  );
}

// device pattern sync
function DeviceSyncBar(props: {
  engine: Sequencer;
  state: () => SequencerState;
  driver: DeviceDriver;
  outputId: () => string | undefined;
  type: number;
  slug: string;
}) {
  const variant = props.driver.variant;
  const canMap = MONO_SYNC_TYPES.has(props.type);
  // song machines: 0x77 carries the 0x41 selector; writes echo byte-exact
  const songMode = SONG_PKT_TYPES.has(props.type);
  const [busy, setBusy] = createSignal(false);
  // raw body of the last read/imported pattern (byte-exact write/export)
  const [lastRaw, setLastRaw] = createSignal<number[] | null>(null);
  // the complete last 0x78 payload (header included) for byte-exact echo
  const [lastFrame, setLastFrame] = createSignal<number[] | null>(null);
  const [status, setStatus] = createSignal('');

  const log = (dir: 'in' | 'out' | 'info', text: string) =>
    actions().pushLog({ dir, text });

  // apply a decoded dump to the engine (mono types) or stash the raw bytes
  const applyDump = (dump: { bytes: number[]; raw: number[] }) => {
    setLastRaw(dump.bytes);
    setLastFrame(dump.raw);
    if (!canMap) {
      setStatus(
        `read ${dump.raw.length} raw bytes (type ${props.type} - saved for backup)`,
      );
      return;
    }
    const mapped = dumpToSteps(props.type, {
      bank: 0,
      pattern: 0,
      bytes: dump.bytes,
      raw: dump.raw,
    });
    if (!mapped) {
      setStatus(`read ${dump.bytes.length} bytes (could not map)`);
      return;
    }
    props.engine.patch({ length: mapped.length });
    // merge: steps unchanged on the device keep their local PWA-only
    // fields (ratchet, probability, exact velocity)
    const merged = mergeSteps(props.type, mapped.steps, props.state().steps);
    merged.forEach((s, i) => props.engine.patchStep(i, s));
    // the editor now mirrors the device - clear the dirty flag
    props.engine.markClean();
    setStatus(`applied ${mapped.steps.length} steps from device`);
  };

  const readPattern = () => {
    const out = props.outputId();
    if (!out) {
      log('info', 'read pattern: no MIDI output');
      return;
    }
    // a read replaces the editor content - confirm when there are local edits
    if (
      props.state().dirty &&
      !window.confirm(
        'You have unsaved edits in this pattern. Reading from the device will overwrite them. Continue?',
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus('requesting pattern...');
    let done = false;
    const off = midi.onMessage((data) => {
      const dump = decodeDump(variant, data);
      if (!dump) return;
      done = true;
      off();
      setBusy(false);
      log(
        'in',
        `pattern dump: bank${dump.bank} p${dump.pattern}, ${dump.bytes.length} bytes`,
      );
      applyDump(dump);
    });
    // byte0 = bank, byte1 = pattern; song machines prefix the 0x41 selector
    const req = requestPattern(
      variant,
      props.state().bank,
      props.state().pattern,
      { song: songMode },
    );
    props.driver.sendRaw(out, req);
    log(
      'out',
      `request bank ${props.state().bank} pattern ${props.state().pattern}  >  ${hex(req)}`,
    );
    setTimeout(() => {
      if (done) return;
      off();
      setBusy(false);
      setStatus('no dump received (device may not support 0x77, or is silent)');
    }, 3000);
  };

  // write body from the current engine steps, layered over the last-read raw
  // body to preserve unmodeled fields; unencodable types fall back to raw
  const buildBody = (): number[] | null => {
    if (props.type === 1) {
      return encodeTD3(
        props.state().steps,
        props.state().length,
        props.state().bank,
        lastRaw() ?? undefined,
      );
    }
    if (props.type === 0) {
      return encodeMono0(
        props.state().steps,
        props.state().length,
        props.state().bank,
        lastRaw() ?? undefined,
      );
    }
    return lastRaw();
  };

  // outbound 0x78: mapped types re-encode with a [bank, pattern] header;
  // pass-through types echo the last received payload byte-exact
  const buildWriteMsg = (): Uint8Array | null => {
    if (!canMap) {
      const frame = lastFrame();
      return frame ? buildRawPatternWrite(variant, frame) : null;
    }
    const body = buildBody();
    if (!body) return null;
    return buildPatternWrite(
      variant,
      props.state().bank,
      props.state().pattern,
      body,
    );
  };

  const writePattern = () => {
    const out = props.outputId();
    const msg = buildWriteMsg();
    if (!out || !msg) {
      log(
        'info',
        'write pattern: ' +
          (!out ? 'no MIDI output' : 'nothing to write (read first)'),
      );
      return;
    }
    props.driver.sendRaw(out, msg);
    log(
      'out',
      `write bank ${props.state().bank} pattern ${props.state().pattern} (0x78)  >  ${msg.length} bytes sent`,
    );
    // editor content is now on the device
    props.engine.markClean();
    setStatus('pattern written to device');
  };

  const exportSyx = () => {
    const bytes = buildWriteMsg();
    if (!bytes) {
      log('info', 'export: read a pattern first (or edit a TD-3 pattern)');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/octet-stream',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.slug}-pattern-${props.state().pattern + 1}.syx`;
    a.click();
    URL.revokeObjectURL(url);
    log('info', `exported pattern .syx (${bytes.length} bytes)`);
  };

  const importSyx = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    const out = props.outputId();
    let sent = 0;
    let applied = false;
    for (const m of splitSysex(buf)) {
      if (out) {
        midi.send(out, m);
        sent++;
      }
      const dump = decodeDump(variant, m);
      if (dump && !applied) {
        applyDump(dump);
        applied = true;
      }
    }
    log(
      sent ? 'out' : 'info',
      `import ${file.name}: ${sent} message(s) sent${applied ? ', applied to editor' : ''}`,
    );
  };

  return (
    <div class="rec-bar panel">
      <div class="body flex wrap" style={{ 'align-items': 'center' }}>
        <span class="tiny hot">
          <Icon name="chip" size={13} /> DEVICE PATTERN
        </span>
        <button
          class="btn ghost tiny"
          disabled={busy() || !props.outputId()}
          onClick={readPattern}
          title="Request the current pattern from the device (SysEx 0x77 -> 0x78)"
        >
          read from device
        </button>
        <button
          class="btn ghost tiny"
          disabled={!props.outputId() || (props.type !== 1 && !lastRaw())}
          onClick={writePattern}
          title={
            props.type === 1
              ? 'Send the edited pattern to the device (SysEx 0x78)'
              : 'Send the last-read pattern back to the device (byte-exact)'
          }
        >
          write to device
        </button>
        <span class="seq-div" />
        <button
          class="btn ghost tiny"
          onClick={exportSyx}
          title="Save the pattern as a .syx file"
        >
          export .syx
        </button>
        <label
          class="btn ghost tiny"
          style={{ cursor: 'pointer' }}
          title="Load/send a pattern .syx"
        >
          import .syx
          <input
            type="file"
            accept=".syx,.bin,.mid"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void importSyx(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <span class="spacer" />
        <span class="tiny dim" title={SEQ_TYPE_NAMES[props.type] ?? ''}>
          {canMap ? 'editable sync' : 'backup/restore only'}
        </span>
      </div>
      <Show when={status()}>
        <div class="body tiny dim">{status()}</div>
      </Show>
    </div>
  );
}

// drum grid
function DrumGrid(props: {
  engine: Sequencer;
  state: () => SequencerState;
  steps: () => number[];
  sel: () => { row: number; step: number } | null;
  setSel: (v: { row: number; step: number } | null) => void;
}) {
  return (
    <table class="seq-grid">
      <thead>
        <tr>
          <th />
          <For each={props.steps()}>
            {(i) => (
              <th
                class={`step-head ${props.state().playhead === i ? 'ph' : ''} ${i % 4 === 0 ? 'beat' : ''}`}
              >
                {i + 1}
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.state().rows}>
          {(row, r) => (
            <tr>
              <td class="row-label tiny">
                <button
                  class={`mute ${row.muted ? 'muted' : ''}`}
                  onClick={() => props.engine.toggleMute(r())}
                  title={row.muted ? 'Unmute' : 'Mute'}
                >
                  {row.muted ? 'M' : '*'}
                </button>
                {row.label} <span class="dim">{noteName(row.note)}</span>
              </td>
              <For each={props.steps()}>
                {(step) => {
                  const cell = () => props.state().drum[r()][step];
                  const selected = () =>
                    props.sel()?.row === r() && props.sel()?.step === step;
                  return (
                    <td
                      class={`cell ${cell().on ? 'on' : ''} ${
                        cell().accent ? 'amber' : ''
                      } ${props.state().playhead === step ? 'ph' : ''} ${
                        step % 4 === 0 ? 'beat' : ''
                      } ${selected() ? 'edit' : ''}`}
                      style={{
                        opacity: cell().on
                          ? 0.35 + (cell().probability / 100) * 0.65
                          : 1,
                      }}
                      onClick={() => {
                        props.engine.toggleCell(r(), step);
                        props.setSel({ row: r(), step });
                      }}
                    >
                      <Show when={cell().on}>
                        <span
                          class="vel-bar"
                          style={{
                            height: `${(cell().velocity / 127) * 100}%`,
                          }}
                        />
                        <Show when={cell().ratchet > 1}>
                          <span class="ratchet-badge">{cell().ratchet}</span>
                        </Show>
                      </Show>
                    </td>
                  );
                }}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

// mono grid
function MonoGrid(props: {
  engine: Sequencer;
  state: () => SequencerState;
  steps: () => number[];
  sel: () => { row: number; step: number } | null;
  setSel: (v: { row: number; step: number } | null) => void;
  caps: SeqCaps;
}) {
  const rowClick = (step: number) => {
    const s = props.state().steps[step];
    props.engine.patchStep(step, { on: !s.on });
    props.setSel({ row: 0, step });
  };
  // open the inspector without toggling anything
  const inspect = (step: number) => props.setSel({ row: 0, step });
  return (
    <table class="seq-grid mono">
      <thead>
        <tr>
          <th class="tiny">STEP</th>
          <For each={props.steps()}>
            {(i) => (
              <th
                class={`step-head click ${props.state().playhead === i ? 'ph' : ''} ${i % 4 === 0 ? 'beat' : ''} ${props.sel()?.step === i ? 'edit' : ''}`}
                onClick={() => inspect(i)}
                title="Open step inspector"
              >
                {i + 1}
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="row-label tiny">
            <Icon name="gate" size={12} /> GATE
          </td>
          <For each={props.steps()}>
            {(step) => {
              const s = () => props.state().steps[step];
              const selected = () => props.sel()?.step === step;
              return (
                <td
                  class={`cell ${s().on ? 'on' : ''} ${s().accent ? 'amber' : ''} ${
                    props.state().playhead === step ? 'ph' : ''
                  } ${step % 4 === 0 ? 'beat' : ''} ${selected() ? 'edit' : ''}`}
                  style={{
                    opacity: s().on ? 0.35 + (s().probability / 100) * 0.65 : 1,
                  }}
                  onClick={() => rowClick(step)}
                >
                  <Show when={s().on}>
                    <span
                      class="vel-bar"
                      style={{ height: `${(s().velocity / 127) * 100}%` }}
                    />
                    <Show when={s().ratchet > 1}>
                      <span class="ratchet-badge">{s().ratchet}</span>
                    </Show>
                    <Show when={s().slide}>
                      <span class="slide-badge">~</span>
                    </Show>
                  </Show>
                </td>
              );
            }}
          </For>
        </tr>
        <tr>
          <td class="row-label tiny">
            <Icon name="piano" size={12} /> NOTE
          </td>
          <For each={props.steps()}>
            {(step) => (
              <td
                class={`note-cell ${props.sel()?.step === step ? 'edit' : ''}`}
              >
                <input
                  type="number"
                  min="0"
                  max="127"
                  value={props.state().steps[step].note}
                  onClick={() => inspect(step)}
                  onInput={(e) =>
                    props.engine.patchStep(step, {
                      note: +e.currentTarget.value,
                    })
                  }
                  title={noteName(props.state().steps[step].note)}
                />
                <span
                  class="note-name tiny dim click"
                  onClick={() => inspect(step)}
                  title="Open step inspector"
                >
                  {noteName(props.state().steps[step].note)}
                </span>
              </td>
            )}
          </For>
        </tr>
        <tr class={props.caps.accent ? '' : 'pwa-only'}>
          <td class="row-label tiny">
            <Icon name="accent" size={12} /> ACC
          </td>
          <For each={props.steps()}>
            {(step) => {
              const s = () => props.state().steps[step];
              return (
                <td
                  class={`cell flag ${s().accent ? 'on amber' : ''} ${step % 4 === 0 ? 'beat' : ''}`}
                  onClick={() =>
                    props.engine.patchStep(step, { accent: !s().accent })
                  }
                  title={`Accent${props.caps.accent ? '' : ' (PWA playback only)'}`}
                >
                  <Show when={s().accent}>
                    <span class="flag-dot" />
                  </Show>
                </td>
              );
            }}
          </For>
        </tr>
        <tr class={props.caps.slide ? '' : 'pwa-only'}>
          <td class="row-label tiny">
            <Icon name="slide" size={12} /> SLIDE
          </td>
          <For each={props.steps()}>
            {(step) => {
              const s = () => props.state().steps[step];
              return (
                <td
                  class={`cell flag ${s().slide ? 'on' : ''} ${step % 4 === 0 ? 'beat' : ''}`}
                  onClick={() =>
                    props.engine.patchStep(step, { slide: !s().slide })
                  }
                  title={`Slide (legato into next note)${props.caps.slide ? '' : ' (PWA playback only)'}`}
                >
                  <Show when={s().slide}>
                    <span class="flag-dot">~</span>
                  </Show>
                </td>
              );
            }}
          </For>
        </tr>
        <tr class={props.caps.ratchet ? '' : 'pwa-only'}>
          <td class="row-label tiny">
            <Icon name="ratchet" size={12} /> RATCH
          </td>
          <For each={props.steps()}>
            {(step) => {
              const s = () => props.state().steps[step];
              // click cycles 1 -> 2 -> 3 -> 4 -> 1
              return (
                <td
                  class={`cell flag ${s().ratchet > 1 ? 'on' : ''} ${step % 4 === 0 ? 'beat' : ''}`}
                  onClick={() =>
                    props.engine.patchStep(step, {
                      ratchet: s().ratchet >= 4 ? 1 : s().ratchet + 1,
                    })
                  }
                  title={`Ratchet (click cycles 1-4)${props.caps.ratchet ? '' : ' (PWA playback only)'}`}
                >
                  <Show when={s().ratchet > 1}>
                    <span class="flag-dot">{s().ratchet}</span>
                  </Show>
                </td>
              );
            }}
          </For>
        </tr>
      </tbody>
    </table>
  );
}

// step inspector
function StepInspector(props: {
  engine: Sequencer;
  state: () => SequencerState;
  sel: () => { row: number; step: number } | null;
  isDrum: () => boolean;
  caps: SeqCaps;
}) {
  const cur = createMemo(() => {
    const s = props.sel();
    if (!s) return null;
    if (props.isDrum()) {
      const c = props.state().drum[s.row]?.[s.step];
      return c
        ? {
            velocity: c.velocity,
            ratchet: c.ratchet,
            probability: c.probability,
            accent: c.accent,
            note: props.state().rows[s.row]?.note ?? 36,
            gate: 1,
            slide: false,
          }
        : null;
    }
    return props.state().steps[s.step] ?? null;
  });

  const set = (p: Record<string, number | boolean>) => {
    const s = props.sel();
    if (!s) return;
    if (props.isDrum()) props.engine.patchCell(s.row, s.step, p as never);
    else props.engine.patchStep(s.step, p as never);
  };

  return (
    <Show when={cur()}>
      {(c) => (
        <div class="panel inspector">
          <header>
            <span>
              step inspector -{' '}
              {props.isDrum()
                ? `${props.state().rows[props.sel()!.row]?.label} `
                : ''}
              #{props.sel()!.step + 1}
            </span>
          </header>
          <div
            class="body flex wrap"
            style={{ gap: '1rem', 'align-items': 'flex-end' }}
          >
            <label
              class="knob-field"
              title={`Velocity${props.caps.velocity ? '' : ' (PWA playback only)'}`}
            >
              <span class={`lbl ${props.caps.velocity ? '' : 'pwa-only-lbl'}`}>
                <Icon name="velocity" size={12} /> vel {c().velocity}
              </span>
              <input
                type="range"
                min="1"
                max="127"
                value={c().velocity}
                onInput={(e) => set({ velocity: +e.currentTarget.value })}
              />
            </label>
            <label
              class="knob-field"
              title={`Ratchet (retriggers)${props.caps.ratchet ? '' : ' (PWA playback only)'}`}
            >
              <span class={`lbl ${props.caps.ratchet ? '' : 'pwa-only-lbl'}`}>
                <Icon name="ratchet" size={12} /> ratchet {c().ratchet}
              </span>
              <input
                type="range"
                min="1"
                max="8"
                value={c().ratchet}
                onInput={(e) => set({ ratchet: +e.currentTarget.value })}
              />
            </label>
            <label
              class="knob-field"
              title={`Probability${props.caps.probability ? '' : ' (PWA playback only)'}`}
            >
              <span
                class={`lbl ${props.caps.probability ? '' : 'pwa-only-lbl'}`}
              >
                <Icon name="dice" size={12} /> prob {c().probability}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={c().probability}
                onInput={(e) => set({ probability: +e.currentTarget.value })}
              />
            </label>
            <Show when={!props.isDrum()}>
              <label
                class="knob-field"
                title={`Gate length (> 100% ties)${props.caps.gate ? '' : ' (PWA playback only)'}`}
              >
                <span class={`lbl ${props.caps.gate ? '' : 'pwa-only-lbl'}`}>
                  <Icon name="gate" size={12} /> gate{' '}
                  {Math.round((c() as { gate: number }).gate * 100)}%
                </span>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.05"
                  value={(c() as { gate: number }).gate}
                  onInput={(e) => set({ gate: +e.currentTarget.value })}
                />
              </label>
              <label class="knob-field" title="Note">
                <span class="lbl">
                  <Icon name="piano" size={12} /> {noteName(c().note)}
                </span>
                <input
                  type="range"
                  min="0"
                  max="127"
                  value={c().note}
                  onInput={(e) => set({ note: +e.currentTarget.value })}
                />
              </label>
            </Show>
            <button
              class={`btn icon-btn ${c().accent ? 'primary' : 'ghost'} ${props.caps.accent ? '' : 'pwa-only-btn'}`}
              onClick={() => set({ accent: !c().accent })}
              title={`Accent${props.caps.accent ? '' : ' (PWA playback only)'}`}
            >
              <Icon name="accent" fill={c().accent} /> ACC
            </button>
            <Show when={!props.isDrum()}>
              <button
                class={`btn icon-btn ${(c() as { slide: boolean }).slide ? 'primary' : 'ghost'} ${props.caps.slide ? '' : 'pwa-only-btn'}`}
                onClick={() =>
                  set({ slide: !(c() as { slide: boolean }).slide })
                }
                title={`Slide / tie${props.caps.slide ? '' : ' (PWA playback only)'}`}
              >
                <Icon name="slide" /> SLIDE
              </button>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
