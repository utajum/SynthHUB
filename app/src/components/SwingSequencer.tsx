// Behringer Swing 64-step polyphonic sequencer editor. Protocol reverse
// engineered from USBPcap captures of ControlTribe 1.4.8 (docs/SWING-PROTOCOL
// .md). Frame: F0 00 20 32 7F 42 <cmd> [args] F7.
//   6F s        -> 6F s len center swing     sequence meta
//   71 s st     -> 71 s st ratchet n[8] v[8] l[8]   step read (8-voice poly)
//   68 s st n   add note   69 s st n vel   velocity   6E s st n len  length
//   6A s st n   delete     6B s len        seq length 6C s swing     swing %
//   58 s st r   step ratchet 1-4 (per STEP - a per-note form does not exist:
//   probed live, 4-arg 58 is ignored and 71 carries one ratchet byte)
//
// An embedded mono engine powers PLAY / REC / KEYS / GEN / ROLL / LIB. The
// engine is a monophonic projection (first note per step); engine edits are
// diffed and pushed to the device immediately - only steps a tool actually
// changed are rewritten, so untouched poly steps keep their chords.
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { actions, useApp } from '../lib/store-solid';
import { buildCtSet } from '../devices/_shared/controltribe';
import {
  Sequencer,
  defaultStep,
  type SequencerState,
  type Step,
} from '../lib/sequencer';
import { onCommand } from '../lib/hotkeys';
import { Icon } from './Icons';
import QwertyPiano from './QwertyPiano';
import GenerativeBar from './GenerativeBar';
import PatternLibrary from './PatternLibrary';
import PianoRollModal from './PianoRollModal';

const HDR = [0xf0, 0x00, 0x20, 0x32, 0x7f, 0x42];
const STEPS = 64;
const POLY = 8; // hardware note slots per step
// full MIDI range, highest row first (vertical scroll, no octave paging)
const ALL_NOTES = Array.from({ length: 128 }, (_, i) => 127 - i);

interface SwNote {
  note: number;
  vel: number;
  len: number;
}
interface SwStep {
  ratchet: number;
  notes: SwNote[];
}
// selection: a step (for ratchet) and optionally one of its notes
interface SwSel {
  step: number;
  note: number | null;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 2}`;
const emptySteps = (): SwStep[] =>
  Array.from({ length: STEPS }, () => ({ ratchet: 1, notes: [] }));

// engine gate (0.1..2 steps) <-> device note length (1..127 steps)
const gateToLen = (g: number) => Math.max(1, Math.min(127, Math.round(g)));
const lenToGate = (l: number) => Math.max(0.1, Math.min(2, l));

export default function SwingSequencer(props: {
  outputId: () => string | undefined;
}) {
  const [seq, setSeq] = createSignal(0);
  const [len, setLen] = createSignal(16);
  const [swing, setSwing] = createSignal(50);
  const [gate, setGate] = createSignal(90);
  const [steps, setSteps] = createSignal<SwStep[]>(emptySteps());
  const [vel, setVel] = createSignal(127);
  const [nlen, setNlen] = createSignal(3); // app inserts length 3 by default
  const [showAll, setShowAll] = createSignal(false);
  const [sel, setSel] = createSignal<SwSel | null>(null);

  // engine for playback/tools (mono projection of the poly grid)
  const engine = new Sequencer('mono', STEPS, [], {
    patternCount: 1,
    patternLabel: 'sequence',
  });
  const [est, setEst] = createSignal<SequencerState>(engine.snapshot);
  onCleanup(engine.subscribe(setEst));
  onCleanup(() => engine.dispose());
  const [showKeys, setShowKeys] = createSignal(false);
  const [showGen, setShowGen] = createSignal(false);
  const [showLib, setShowLib] = createSignal(false);
  const [showRoll, setShowRoll] = createSignal(false);
  const [showRec, setShowRec] = createSignal(false);
  const midiInputs = useApp((s) => s.midiInputs);

  const out = () => props.outputId();

  const frame = (...body: number[]) =>
    Uint8Array.from([...HDR, ...body.map((b) => b & 0x7f), 0xf7]);

  const send = (bytes: Uint8Array) => {
    const o = out();
    if (!o) {
      actions().pushLog({ dir: 'info', text: 'swing seq: no MIDI output' });
      return false;
    }
    midi.send(o, bytes);
    return true;
  };

  // ---- device -> engine projection ----

  // guard: engine mutations made by sync must not be pushed back
  let syncing = false;
  // shadow of the last-synced engine steps for diffing tool edits
  let shadow: Step[] = engine.snapshot.steps.map((s) => ({ ...s }));
  let shadowLen = engine.snapshot.length;
  // true while a staggered 64-step read is in flight; edits are blocked so
  // they cannot race the incoming state
  const [reading, setReading] = createSignal(false);
  // engine working length: a virgin sequence (device len 0) gets a 16-step
  // canvas so recording and the generators have room to work
  const engLen = (n: number) => (n > 0 ? Math.min(64, n) : 16);

  const projectStep = (sw: SwStep): Step => {
    const s = defaultStep();
    const n = sw.notes[0];
    if (n) {
      s.on = true;
      s.note = n.note;
      s.velocity = n.vel;
      s.gate = lenToGate(n.len);
      s.accent = n.vel >= 112;
    }
    s.ratchet = Math.max(1, Math.min(8, sw.ratchet));
    return s;
  };

  // grid viewport: after a read, scroll the note rows to the content (or C4)
  let gridRef: HTMLDivElement | undefined;
  const scrollToContent = () => {
    if (!gridRef) return;
    const used = steps().flatMap((s) => s.notes.map((n) => n.note));
    const center = used.length
      ? (Math.min(...used) + Math.max(...used)) >> 1
      : 60;
    const frac = (127 - center) / 127;
    gridRef.scrollTop = Math.max(
      0,
      frac * gridRef.scrollHeight - gridRef.clientHeight / 2,
    );
  };

  const syncEngine = () => {
    syncing = true;
    engine.patch({ length: engLen(len()) });
    steps().forEach((sw, i) => engine.patchStep(i, projectStep(sw)));
    engine.markClean();
    syncing = false;
    shadow = engine.snapshot.steps.map((s) => ({ ...s }));
    shadowLen = engine.snapshot.length;
    setReading(false);
    scrollToContent();
  };
  const syncEngineStep = (i: number) => {
    syncing = true;
    engine.patchStep(i, projectStep(steps()[i]));
    syncing = false;
    shadow[i] = { ...engine.snapshot.steps[i] };
  };

  // ---- engine -> device push (diff against shadow) ----

  const stepEq = (a: Step, b: Step) =>
    a.on === b.on &&
    a.note === b.note &&
    a.velocity === b.velocity &&
    a.gate === b.gate &&
    a.ratchet === b.ratchet;

  // frames that transform device step i into engine step s
  const framesFor = (i: number, s: Step): Uint8Array[] => {
    const fr: Uint8Array[] = [];
    const dev = steps()[i];
    const want = s.on ? s.note : -1;
    let notesTouched = false;
    for (const n of dev.notes)
      if (n.note !== want) {
        fr.push(frame(0x6a, seq(), i, n.note));
        notesTouched = true;
      }
    if (s.on) {
      const existing = dev.notes.find((n) => n.note === want);
      const wLen = gateToLen(s.gate);
      const wVel = Math.max(1, Math.min(127, s.velocity));
      if (!existing) {
        fr.push(frame(0x68, seq(), i, want));
        fr.push(frame(0x6e, seq(), i, want, wLen));
        fr.push(frame(0x69, seq(), i, want, wVel));
        notesTouched = true;
      } else {
        if (existing.len !== wLen) fr.push(frame(0x6e, seq(), i, want, wLen));
        if (existing.vel !== wVel) fr.push(frame(0x69, seq(), i, want, wVel));
      }
    }
    const r = Math.max(1, Math.min(4, s.ratchet));
    // note ops reset the step ratchet on the device - always re-assert
    if (r !== dev.ratchet || (notesTouched && r > 1))
      fr.push(frame(0x58, seq(), i, r));
    return fr;
  };

  // apply engine step i to the local device mirror
  const mirrorStep = (i: number, s: Step) =>
    setSteps((prev) => {
      const c = prev.slice();
      const wLen = gateToLen(s.gate);
      const wVel = Math.max(1, Math.min(127, s.velocity));
      c[i] = {
        ratchet: Math.max(1, Math.min(4, s.ratchet)),
        notes: s.on ? [{ note: s.note, vel: wVel, len: wLen }] : [],
      };
      return c;
    });

  onCleanup(
    engine.subscribe((st) => {
      if (syncing || reading()) return;
      const jobs: Uint8Array[] = [];
      const changed: number[] = [];
      st.steps.forEach((s, i) => {
        if (i >= STEPS) return;
        const o = shadow[i];
        if (o && stepEq(s, o)) return;
        jobs.push(...framesFor(i, s));
        changed.push(i);
      });
      if (st.length !== shadowLen && st.length <= 64) {
        jobs.push(frame(0x6b, seq(), st.length));
        setLen(st.length);
      }
      shadow = st.steps.map((s) => ({ ...s }));
      shadowLen = st.length;
      if (!jobs.length) return;
      // mirror locally, then stagger the frames onto the wire
      changed.forEach((i) => mirrorStep(i, st.steps[i]));
      // note adds auto-extend the device sequence - mirror that locally
      const maxOn = Math.max(-1, ...changed.filter((i) => st.steps[i].on));
      if (maxOn >= len()) setLen(maxOn + 1);
      jobs.forEach((f, k) => setTimeout(() => send(f), k * 12));
    }),
  );

  // Read a sequence the way ControlTribe does: meta first, then exactly
  // `len` step reads (scheduled from the 6F handler); the engine is
  // re-projected after the last reply lands.
  const readSeq = (s: number) => {
    if (!out()) return;
    setReading(true);
    setSteps(emptySteps());
    send(frame(0x6f, s));
    actions().pushLog({ dir: 'out', text: `swing: read sequence ${s + 1}` });
    // safety: if the 6F reply never comes, unlock after 2s
    setTimeout(() => {
      if (reading()) syncEngine();
    }, 2000);
  };
  const scheduleStepReads = (s: number, n: number) => {
    for (let i = 0; i < n; i++)
      setTimeout(() => send(frame(0x71, s, i)), 10 + i * 10);
    setTimeout(syncEngine, 10 + n * 10 + 250);
  };

  onMount(() => {
    const off = midi.onMessage((d) => {
      if (d.length < 8) return;
      for (let i = 0; i < 6; i++) if (d[i] !== HDR[i]) return;
      const cmd = d[6];
      if (cmd === 0x0a && d.length >= 9) {
        setGate(d[7]);
      } else if (cmd === 0x6f && d.length >= 12 && d[7] === seq()) {
        setLen(d[8]); // 0 = virgin sequence
        setSwing(Math.max(50, d[10]));
        // during a read session the step reads follow the meta reply
        if (reading()) scheduleStepReads(d[7], d[8]);
      } else if (cmd === 0x71 && d.length >= 35 && d[7] === seq()) {
        const st = d[8];
        if (st >= STEPS) return;
        const notes: SwNote[] = [];
        for (let i = 0; i < POLY; i++) {
          const n = d[10 + i];
          if (n > 0) notes.push({ note: n, vel: d[18 + i], len: d[26 + i] });
        }
        setSteps((prev) => {
          const c = prev.slice();
          c[st] = { ratchet: Math.max(1, d[9]), notes };
          return c;
        });
      }
    });
    onCleanup(off);
    // query gate % and the current sequence shortly after mount
    if (out())
      setTimeout(() => {
        send(frame(0x0a)); // gate % (query = no value byte)
        readSeq(seq());
      }, 300);
    const subs = [
      onCommand('seq:playstop', () => engine.toggle()),
      onCommand('seq:tempo-up', () =>
        engine.patch({ tempo: Math.min(300, est().tempo + 1) }),
      ),
      onCommand('seq:tempo-down', () =>
        engine.patch({ tempo: Math.max(30, est().tempo - 1) }),
      ),
    ];
    onCleanup(() => subs.forEach((u) => u()));
  });
  // playback goes out the Swing's MIDI ports (USB -> DIN/CV forward)
  createEffect(() => engine.setOutput(props.outputId()));

  // every tab switch re-reads the device so the grid always shows live state
  const pickSeq = (s: number) => {
    engine.stop();
    setSeq(s);
    setSel(null);
    readSeq(s);
  };

  const noteAt = (step: number, note: number) =>
    steps()[step]?.notes.find((n) => n.note === note);

  const updateStep = (step: number, fn: (s: SwStep) => SwStep) =>
    setSteps((prev) => {
      const c = prev.slice();
      c[step] = fn(c[step]);
      return c;
    });

  // note ops reset the step ratchet on the device - re-assert it (native
  // ControlTribe does the same after every add/move/delete)
  const reassertRatchet = (step: number) => {
    const r = steps()[step]?.ratchet ?? 1;
    if (r > 1) send(frame(0x58, seq(), step, r));
  };

  const removeNote = (step: number, note: number) => {
    if (reading()) return;
    if (!send(frame(0x6a, seq(), step, note))) return;
    updateStep(step, (s) => ({
      ...s,
      notes: s.notes.filter((n) => n.note !== note),
    }));
    reassertRatchet(step);
    syncEngineStep(step);
    if (sel()?.step === step && sel()?.note === note)
      setSel({ step, note: null });
  };

  // click: empty cell adds; existing note selects; clicking the selected
  // note removes it. Alt-click always selects.
  const cellClick = (step: number, note: number, alt: boolean) => {
    if (reading()) return;
    const existing = noteAt(step, note);
    if (existing) {
      const isSel = sel()?.step === step && sel()?.note === note;
      if (isSel && !alt) {
        removeNote(step, note);
        return;
      }
      setSel({ step, note });
      setVel(existing.vel);
      setNlen(existing.len);
      return;
    }
    if (alt) {
      setSel({ step, note: null });
      return;
    }
    if ((steps()[step]?.notes.length ?? 0) >= POLY) {
      actions().pushLog({
        dir: 'info',
        text: `swing: step ${step + 1} full (${POLY} notes max)`,
      });
      return;
    }
    // same frame order as the ControlTribe editor: add, length, velocity
    if (!send(frame(0x68, seq(), step, note))) return;
    send(frame(0x6e, seq(), step, note, nlen()));
    send(frame(0x69, seq(), step, note, vel()));
    updateStep(step, (s) => ({
      ...s,
      notes: [...s.notes, { note, vel: vel(), len: nlen() }],
    }));
    reassertRatchet(step);
    syncEngineStep(step);
    // the device auto-extends the sequence length to cover the new step
    // (HW-verified: adding to a virgin sequence set len = step + 1)
    if (step >= len()) setLen(step + 1);
    setSel({ step, note });
  };

  const setRatchet = (step: number, r: number) => {
    if (reading()) return;
    if (!send(frame(0x58, seq(), step, r))) return;
    updateStep(step, (s) => ({ ...s, ratchet: r }));
    syncEngineStep(step);
  };

  const applyLen = (v: number) => {
    if (reading()) return;
    const prev = len();
    const n = Math.max(0, Math.min(64, v | 0)); // 0 = empty (HW-verified)
    setLen(n);
    send(frame(0x6b, seq(), n));
    syncing = true;
    engine.patch({ length: engLen(n) });
    syncing = false;
    shadowLen = engLen(n);
    // extending can reveal notes the device kept beyond the old length
    if (n > prev) setTimeout(() => readSeq(seq()), 150);
  };
  const applySwing = (v: number) => {
    if (reading()) return;
    const n = Math.max(50, Math.min(80, v | 0));
    setSwing(n);
    send(frame(0x6c, seq(), n));
  };
  const applyGate = (v: number) => {
    const n = Math.max(10, Math.min(95, v | 0));
    setGate(n);
    const o = out();
    if (o) midi.send(o, buildCtSet('swing', 0x0a, n));
  };

  // delete every note (staggered), reset length, then re-read
  const clearSeq = () => {
    if (!out() || reading()) return;
    if (!window.confirm(`Clear sequence ${seq() + 1} on the device?`)) return;
    engine.stop();
    const jobs: [number, number][] = [];
    steps().forEach((s, st) => s.notes.forEach((n) => jobs.push([st, n.note])));
    jobs.forEach(([st, n], i) =>
      setTimeout(() => send(frame(0x6a, seq(), st, n)), i * 12),
    );
    setTimeout(
      () => {
        send(frame(0x6b, seq(), 0));
        setSel(null);
        readSeq(seq());
      },
      jobs.length * 12 + 100,
    );
    actions().pushLog({
      dir: 'out',
      text: `swing: clear sequence ${seq() + 1} (${jobs.length} notes)`,
    });
  };

  // edit velocity / length of the selected note
  const applySelVel = (v: number) => {
    const s = sel();
    const n = Math.max(1, Math.min(127, v | 0));
    setVel(n);
    if (reading() || !s || s.note == null || !noteAt(s.step, s.note)) return;
    send(frame(0x69, seq(), s.step, s.note, n));
    updateStep(s.step, (st) => ({
      ...st,
      notes: st.notes.map((x) => (x.note === s.note ? { ...x, vel: n } : x)),
    }));
    syncEngineStep(s.step);
  };
  const applySelLen = (v: number) => {
    const s = sel();
    const n = Math.max(1, Math.min(127, v | 0));
    setNlen(n);
    if (reading() || !s || s.note == null || !noteAt(s.step, s.note)) return;
    send(frame(0x6e, seq(), s.step, s.note, n));
    updateStep(s.step, (st) => ({
      ...st,
      notes: st.notes.map((x) => (x.note === s.note ? { ...x, len: n } : x)),
    }));
    syncEngineStep(s.step);
  };

  // REC arms immediately (KEYS + on-screen piano record right away); the rec
  // bar opens for optional MIDI-input selection
  const recClick = () => {
    if (est().recording) {
      engine.disarmRecord();
      setShowRec(false);
      return;
    }
    engine.armLocalRecord();
    setShowRec(true);
    if (!showKeys()) setShowKeys(true);
  };
  // steps beyond the sequence length are hidden unless expanded; the 16-step
  // floor matches the engine's virgin canvas (recording / generators)
  const visSteps = () =>
    Array.from(
      { length: showAll() ? STEPS : Math.max(16, len()) },
      (_, i) => i,
    );
  const selStep = () => (sel() ? steps()[sel()!.step] : undefined);

  return (
    <div class="stack">
      <p class="muted tiny">
        Click a cell to add a note; click a note to select it; click it again to
        remove. The step number selects the whole step. Note badges: amber =
        accent (vel &gt;= 112), ~ = tie/slide (len &gt; 1), digit = step
        ratchet. Edits go to the device immediately. Tools (play, rec, gen,
        roll) work on one note per step - steps they change lose extra chord
        notes; untouched steps keep them.
      </p>

      {/* transport + tools (engine-powered) */}
      <div class="seq-transport flex wrap">
        <button
          class={`btn ${est().playing ? '' : 'primary'} icon-btn`}
          onClick={() => engine.toggle()}
          title={est().playing ? 'Stop' : 'Play (through the Swing outputs)'}
        >
          <Icon name={est().playing ? 'stop' : 'play'} fill />
          {est().playing ? 'STOP' : 'PLAY'}
        </button>
        <button
          class={`btn icon-btn ${est().recording ? 'rec-on' : ''}`}
          onClick={recClick}
          title={est().recording ? 'Stop recording (disarm)' : 'MIDI record'}
        >
          <Icon name="record" fill />
          REC
        </button>
        <button
          class={`btn icon-btn ${showKeys() ? 'primary' : 'ghost'}`}
          onClick={() => setShowKeys((v) => !v)}
          title="On-screen / QWERTY piano"
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
          class="btn ghost icon-btn"
          onClick={() => setShowRoll(true)}
          title="Piano roll (alternative editor)"
        >
          <Icon name="piano" /> ROLL
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
        <label class="knob-field" title="Tempo (BPM) - PWA playback">
          <span class="lbl">
            <Icon name="metronome" size={12} /> {est().tempo}
          </span>
          <input
            type="range"
            min="30"
            max="300"
            value={est().tempo}
            onInput={(e) => engine.patch({ tempo: +e.currentTarget.value })}
          />
        </label>
        <label
          class="knob-field"
          title="MIDI channel"
          style={{ width: '70px' }}
        >
          <span class="lbl">ch</span>
          <select
            value={est().channel}
            onChange={(e) => engine.patch({ channel: +e.currentTarget.value })}
          >
            <For each={Array.from({ length: 16 }, (_, i) => i)}>
              {(i) => <option value={i}>{i + 1}</option>}
            </For>
          </select>
        </label>
      </div>

      <Show when={showGen()}>
        <GenerativeBar
          engine={engine}
          state={est}
          isDrum={() => false}
          selRow={() => 0}
        />
      </Show>
      <Show when={showLib()}>
        <PatternLibrary engine={engine} state={est} slug="swing" />
      </Show>
      <Show when={showKeys()}>
        <QwertyPiano engine={engine} state={est} outputId={props.outputId} />
      </Show>
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
                  <option value={inp.id} selected={est().recInputId === inp.id}>
                    {inp.name}
                  </option>
                )}
              </For>
            </select>
            <Show
              when={est().recording}
              fallback={<span class="tiny dim">not armed</span>}
            >
              <span class="pill rec-live tiny">
                <span class="dot err" /> REC - {est().recInputName}
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
              {est().playing
                ? 'overdub at playhead'
                : `step-record -> step ${est().recCursor + 1}`}
            </span>
          </div>
        </div>
      </Show>

      <div class="flex wrap">
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
          {(s) => (
            <button
              class={`btn tiny ${seq() === s ? '' : 'ghost'}`}
              onClick={() => pickSeq(s)}
              title={`Sequence ${s + 1} (re-reads from device)`}
            >
              {s + 1}
            </button>
          )}
        </For>
        <span class="spacer" />
        <Show when={reading()}>
          <span class="pill tiny">
            <span class="dot on" /> reading...
          </span>
        </Show>
        <button
          class="btn tiny ghost"
          disabled={reading()}
          onClick={() => readSeq(seq())}
        >
          re-read
        </button>
        <button
          class="btn tiny ghost"
          disabled={reading()}
          onClick={clearSeq}
          title="Delete all notes and set length 0"
        >
          <Icon name="trash" size={12} /> clear
        </button>
      </div>

      <div class="flex wrap">
        <label class="tiny dim">
          length{' '}
          <input
            type="number"
            min="0"
            max="64"
            value={len()}
            onChange={(e) => applyLen(+e.currentTarget.value)}
            style={{ width: '3.6rem' }}
          />
        </label>
        <label class="tiny dim">
          swing %{' '}
          <input
            type="number"
            min="50"
            max="80"
            value={swing()}
            onChange={(e) => applySwing(+e.currentTarget.value)}
            style={{ width: '3.6rem' }}
          />
        </label>
        <label class="tiny dim">
          gate %{' '}
          <input
            type="number"
            min="10"
            max="95"
            step="5"
            value={gate()}
            onChange={(e) => applyGate(+e.currentTarget.value)}
            style={{ width: '3.6rem' }}
          />
        </label>
        <label class="tiny dim" title="Defaults for newly added notes">
          new vel{' '}
          <input
            type="number"
            min="1"
            max="127"
            value={vel()}
            onChange={(e) => setVel(+e.currentTarget.value)}
            style={{ width: '3.6rem' }}
          />
        </label>
        <label class="tiny dim" title="Default length for newly added notes">
          new len{' '}
          <input
            type="number"
            min="1"
            max="127"
            value={nlen()}
            onChange={(e) => setNlen(+e.currentTarget.value)}
            style={{ width: '3.6rem' }}
          />
        </label>
        <span class="spacer" />
        <button
          class={`btn tiny ${showAll() ? '' : 'ghost'}`}
          onClick={() => setShowAll((v) => !v)}
          title="Show all 64 steps or fit to sequence length"
          aria-pressed={showAll()}
        >
          {showAll() ? 'all 64' : `fit ${Math.max(16, len())}`}
        </button>
      </div>

      <div
        class="scroll swing-grid"
        ref={gridRef}
        style={{ 'overflow-x': 'auto', 'overflow-y': 'auto' }}
      >
        <table class="seq-grid">
          <thead>
            <tr>
              <th class="step-head" />
              <For each={visSteps()}>
                {(i) => (
                  <th
                    class={`step-head click ${i % 4 === 0 ? 'beat' : ''} ${sel()?.step === i ? 'edit' : ''} ${est().playing && est().playhead === i ? 'ph' : ''}`}
                    onClick={() => setSel({ step: i, note: null })}
                    title={`Step ${i + 1}${(steps()[i]?.ratchet ?? 1) > 1 ? ` - ratchet x${steps()[i].ratchet}` : ''} - click to edit`}
                  >
                    {i % 4 === 0 ? i + 1 : ''}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={ALL_NOTES}>
              {(note) => (
                <tr>
                  <td class="row-label" title={`MIDI note ${note}`}>
                    {noteName(note)}
                  </td>
                  <For each={visSteps()}>
                    {(st) => {
                      const n = () => noteAt(st, note);
                      const r = () => steps()[st]?.ratchet ?? 1;
                      return (
                        <td
                          class={`cell sm ${st % 4 === 0 ? 'beat' : ''} ${n() ? 'on' : ''} ${
                            n() && n()!.vel >= 112 ? 'amber' : ''
                          } ${st >= len() ? 'ghost' : ''} ${
                            sel()?.step === st && sel()?.note === note
                              ? 'edit'
                              : ''
                          } ${est().playing && est().playhead === st ? 'ph' : ''}`}
                          title={
                            n()
                              ? `${noteName(note)} vel ${n()!.vel} len ${n()!.len}` +
                                `${r() > 1 ? ` ratchet x${r()}` : ''}` +
                                `${n()!.vel >= 112 ? ' accent' : ''}` +
                                `${n()!.len > 1 ? ' tie/slide' : ''}` +
                                ` - click again to remove`
                              : `${noteName(note)} step ${st + 1}`
                          }
                          onClick={(e) => cellClick(st, note, e.altKey)}
                        >
                          <Show when={n()}>
                            <span
                              class="vel-bar"
                              style={{
                                height: `${(n()!.vel / 127) * 100}%`,
                              }}
                            />
                            <Show when={r() > 1}>
                              <span class="ratchet-badge">{r()}</span>
                            </Show>
                            <Show when={n()!.len > 1}>
                              <span class="slide-badge">~</span>
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
      </div>

      {/* step / note inspector */}
      <Show when={sel()}>
        <div class="panel inspector">
          <header>
            <span>
              step {sel()!.step + 1}
              <Show when={sel()!.note != null}>
                {' '}
                - {noteName(sel()!.note!)}
              </Show>
            </span>
          </header>
          <div
            class="body flex wrap"
            style={{ gap: '1rem', 'align-items': 'flex-end' }}
          >
            <div class="seq-slot" role="group" aria-label="Step ratchet">
              <span class="lbl tiny">ratchet</span>
              <For each={[1, 2, 3, 4]}>
                {(r) => (
                  <button
                    class={`icon-btn ${(selStep()?.ratchet ?? 1) === r ? 'sel' : ''}`}
                    onClick={() => setRatchet(sel()!.step, r)}
                    title={`${r} hit${r > 1 ? 's' : ''} - retriggers every note in this step`}
                  >
                    {r}
                  </button>
                )}
              </For>
            </div>
            <Show
              when={sel()!.note != null && noteAt(sel()!.step, sel()!.note!)}
              fallback={
                <span class="tiny dim">
                  click a note in this step to edit velocity / length
                </span>
              }
            >
              <label class="knob-field" title="Velocity">
                <span class="lbl">
                  <Icon name="velocity" size={12} /> vel {vel()}
                </span>
                <input
                  type="range"
                  min="1"
                  max="127"
                  value={vel()}
                  onInput={(e) => applySelVel(+e.currentTarget.value)}
                />
              </label>
              <label class="knob-field" title="Note length (steps held)">
                <span class="lbl">
                  <Icon name="gate" size={12} /> len {nlen()}
                </span>
                <input
                  type="range"
                  min="1"
                  max="64"
                  value={nlen()}
                  onInput={(e) => applySelLen(+e.currentTarget.value)}
                />
              </label>
              <button
                class="btn ghost icon-btn"
                onClick={() => removeNote(sel()!.step, sel()!.note!)}
                title="Delete this note"
              >
                <Icon name="trash" /> DEL
              </button>
            </Show>
            <span class="tiny dim">
              velocity / length are per note (accent = vel &gt;= 112, tie/slide
              = len &gt; 1); ratchet is stored once per step and retriggers all
              its notes
            </span>
          </div>
        </div>
      </Show>

      <Show when={showRoll()}>
        <PianoRollModal
          engine={engine}
          state={est}
          onClose={() => setShowRoll(false)}
        />
      </Show>
    </div>
  );
}
