// On-screen + QWERTY piano: plays the connected synth through the sequencer
// engine (so armed recording captures it). Rows a..; map two octaves from the
// base octave; z/x shift the octave. Active only while mounted - it captures
// its keys ahead of the global hotkeys.
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Sequencer, noteName, type SequencerState } from '../lib/sequencer';
import { suspendLetterHotkeys } from '../lib/hotkeys';
import { Icon } from './Icons';

interface Props {
  engine: Sequencer;
  state: () => SequencerState;
  outputId: () => string | undefined;
}

// semitone offset (from base C) per QWERTY key, DAW-style layout
const KEY_ORDER = [
  'a',
  'w',
  's',
  'e',
  'd',
  'f',
  't',
  'g',
  'y',
  'h',
  'u',
  'j',
  'k',
  'o',
  'l',
  'p',
  ';',
];
const KEY_OFFSET = new Map(KEY_ORDER.map((k, i) => [k, i]));

const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);

function isTyping(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      (el.tagName === 'INPUT' &&
        !['range', 'checkbox', 'radio', 'button'].includes(
          (el as HTMLInputElement).type,
        )))
  );
}

export default function QwertyPiano(props: Props) {
  const [octave, setOctave] = createSignal(3); // C3 = MIDI 48
  const [velocity, setVelocity] = createSignal(100);
  const [pressed, setPressed] = createSignal<Set<number>>(new Set());

  const base = () => (octave() + 1) * 12;
  // two octaves + closing C
  const notes = () => Array.from({ length: 25 }, (_, i) => base() + i);

  const down = (note: number) => {
    if (note < 0 || note > 127 || pressed().has(note)) return;
    props.engine.playNote(note, velocity());
    setPressed((p) => new Set(p).add(note));
  };
  const up = (note: number) => {
    if (!pressed().has(note)) return;
    props.engine.releaseNote(note);
    setPressed((p) => {
      const n = new Set(p);
      n.delete(note);
      return n;
    });
  };
  const releaseAll = () => {
    for (const n of pressed()) props.engine.releaseNote(n);
    setPressed(new Set<number>());
  };
  const shiftOctave = (d: number) => {
    releaseAll();
    setOctave((o) => Math.max(0, Math.min(7, o + d)));
  };

  // capture-phase so piano keys win over the global hotkeys while open;
  // letter hotkeys (j/k/r/c/...) are suspended entirely while mounted
  onMount(() => {
    suspendLetterHotkeys(true);
    onCleanup(() => suspendLetterHotkeys(false));
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'x') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) shiftOctave(k === 'z' ? -1 : 1);
        return;
      }
      const off = KEY_OFFSET.get(k);
      if (off === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) down(base() + off);
    };
    const onUp = (e: KeyboardEvent) => {
      const off = KEY_OFFSET.get(e.key.toLowerCase());
      if (off === undefined) return;
      // release across octave shifts too - drop any pressed note of this class
      up(base() + off);
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    onCleanup(() => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      releaseAll();
    });
  });

  const keyLabel = (i: number) => KEY_ORDER[i] ?? '';

  return (
    <div class="rec-bar panel qwerty-wrap">
      <div class="body flex wrap" style={{ 'align-items': 'center' }}>
        <span class="tiny hot">
          <Icon name="piano" size={13} /> KEYS
        </span>
        <div class="seq-slot" role="group" aria-label="Octave">
          <span class="lbl tiny">oct</span>
          <button
            class="icon-btn"
            onClick={() => shiftOctave(-1)}
            title="Octave down (z)"
          >
            <Icon name="minus" size={13} />
          </button>
          <span class="slot-num">C{octave()}</span>
          <button
            class="icon-btn"
            onClick={() => shiftOctave(1)}
            title="Octave up (x)"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <label class="knob-field" title="Velocity">
          <span class="lbl">
            <Icon name="velocity" size={12} /> vel {velocity()}
          </span>
          <input
            type="range"
            min="1"
            max="127"
            value={velocity()}
            onInput={(e) => setVelocity(+e.currentTarget.value)}
          />
        </label>
        <button
          class={`btn icon-btn tiny ${props.state().recording ? 'rec-on' : 'ghost'}`}
          onClick={() =>
            props.state().recording
              ? props.engine.disarmRecord()
              : props.engine.armLocalRecord()
          }
          title="Record played keys into the sequencer steps"
          aria-pressed={props.state().recording}
        >
          <Icon name="record" fill /> REC
        </button>
        <Show when={props.state().recording}>
          <span class="pill rec-live tiny">
            <span class="dot err" />
            {props.state().playing
              ? 'overdub at playhead'
              : `step ${props.state().recCursor + 1}`}
          </span>
        </Show>
        <span class="spacer" />
        <span class="tiny dim">
          play: a w s e d f t g y h u j k - octave: z / x - letter hotkeys
          paused
        </span>
        <Show when={!props.outputId()}>
          <span class="tiny amber">no MIDI out - silent</span>
        </Show>
      </div>
      <div class="qwerty-piano" onPointerLeave={releaseAll}>
        <For each={notes()}>
          {(note, i) => (
            <button
              class={`pk ${isBlack(note) ? 'blk' : ''} ${pressed().has(note) ? 'held' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                down(note);
              }}
              onPointerUp={() => up(note)}
              onPointerEnter={(e) => {
                if (e.buttons > 0) down(note);
              }}
              onPointerLeave={() => up(note)}
              title={noteName(note)}
            >
              <span class="pk-label tiny">
                {note % 12 === 0 ? noteName(note) : keyLabel(i())}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
