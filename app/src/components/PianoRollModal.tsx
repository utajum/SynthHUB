// Piano-roll editor (modal) for the mono note lane. Shares the same engine
// as the step view. Rows = pitches, columns = steps, monophonic.
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { Sequencer, noteName, type SequencerState } from '../lib/sequencer';
import { Icon } from './Icons';
import { useApp } from '../lib/store-solid';
import QwertyPiano from './QwertyPiano';

interface Props {
  engine: Sequencer;
  state: () => SequencerState;
  onClose: () => void;
}

const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);

const LOW = 36; // C2
const HIGH = 84; // C6

export default function PianoRollModal(props: Props) {
  const steps = () => Array.from({ length: props.state().length }, (_, i) => i);
  const pitches = Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i); // high at top

  // MIDI record - shares the engine's recorder with the step view
  const midiInputs = useApp((s) => s.midiInputs);
  const [showRec, setShowRec] = createSignal(false);
  const [showKeys, setShowKeys] = createSignal(false);

  // REC toggles: armed -> disarm; otherwise toggle the record panel
  const recClick = () => {
    if (props.state().recording) {
      props.engine.disarmRecord();
      setShowRec(false);
      return;
    }
    setShowRec((v) => !v);
  };
  const [, setTick] = createSignal(0);
  createEffect(() => {
    if (!props.state().recording) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    onCleanup(() => clearInterval(id));
  });
  const noteFresh = () => Date.now() - props.state().recActivity < 180;
  const lastNoteName = () =>
    props.state().recLastNote >= 0 ? noteName(props.state().recLastNote) : '--';

  const setCell = (pitch: number, step: number) => {
    const s = props.state().steps[step];
    if (s.on && s.note === pitch) props.engine.patchStep(step, { on: false });
    else props.engine.patchStep(step, { on: true, note: pitch });
  };

  // draw (pencil) mode: drag across cells to paint notes (add-only)
  const [draw, setDraw] = createSignal(false);
  const [painting, setPainting] = createSignal(false);
  const paint = (pitch: number, step: number) => {
    const s = props.state().steps[step];
    if (!(s.on && s.note === pitch))
      props.engine.patchStep(step, { on: true, note: pitch });
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    const stopPaint = () => setPainting(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', stopPaint);
    window.addEventListener('pointercancel', stopPaint);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', stopPaint);
      window.removeEventListener('pointercancel', stopPaint);
    });
  });

  return (
    <div class="img-modal-backdrop" onClick={props.onClose}>
      <div class="seq-modal" onClick={(e) => e.stopPropagation()}>
        <div class="img-modal-bar seq-modal-bar">
          <span class="tiny hot">
            <Icon name="piano" size={13} /> piano roll
          </span>
          <span class="spacer" />
          <button
            class={`btn icon-btn tiny ${props.state().playing ? '' : 'primary'}`}
            onClick={() => props.engine.toggle()}
            title={props.state().playing ? 'Stop' : 'Play'}
          >
            <Icon name={props.state().playing ? 'stop' : 'play'} fill />
            {props.state().playing ? 'stop' : 'play'}
          </button>
          <button
            class={`btn icon-btn tiny ${props.state().recording ? 'rec-on' : ''}`}
            onClick={recClick}
            title={
              props.state().recording
                ? 'Stop recording (disarm)'
                : 'MIDI record'
            }
          >
            <Icon name="record" fill /> rec
          </button>
          <button
            class={`btn icon-btn tiny ${showKeys() ? 'primary' : 'ghost'}`}
            onClick={() => setShowKeys((v) => !v)}
            title="On-screen / QWERTY piano"
            aria-pressed={showKeys()}
          >
            <Icon name="piano" /> keys
          </button>
          <button
            class={`btn icon-btn tiny ${draw() ? 'primary' : 'ghost'}`}
            onClick={() => setDraw((v) => !v)}
            title={
              draw()
                ? 'Draw mode on - drag to add notes'
                : 'Draw mode - drag to add notes'
            }
            aria-pressed={draw()}
          >
            <Icon name="pencil" /> draw
          </button>
          <button
            class="btn ghost icon-btn tiny"
            onClick={() => props.engine.clear()}
            title="Clear"
          >
            <Icon name="trash" />
          </button>
          <button
            class="btn ghost icon-btn tiny"
            onClick={() => props.engine.randomize()}
            title="Randomize"
          >
            <Icon name="dice" />
          </button>
          <label class="knob-field" title="Tempo (BPM)">
            <span class="lbl">
              <Icon name="metronome" size={12} /> {props.state().tempo}
            </span>
            <input
              type="range"
              min="30"
              max="300"
              value={props.state().tempo}
              onInput={(e) =>
                props.engine.patch({ tempo: +e.currentTarget.value })
              }
            />
          </label>
          <label class="knob-field" title="Pattern length">
            <span class="lbl">len {props.state().length}</span>
            <input
              type="range"
              min="1"
              max={props.state().maxSteps}
              value={props.state().length}
              onInput={(e) =>
                props.engine.patch({ length: +e.currentTarget.value })
              }
            />
          </label>
          <div
            class="seq-slot"
            role="group"
            aria-label={props.state().patternLabel}
          >
            <span class="lbl tiny">{props.state().patternLabel}</span>
            <button
              class="icon-btn"
              onClick={() =>
                props.engine.selectSlot(
                  props.state().bank,
                  props.state().pattern - 1,
                )
              }
              disabled={props.state().pattern <= 0}
              title="Previous"
            >
              <Icon name="minus" size={12} />
            </button>
            <span class="slot-num">
              {props.state().pattern + 1}/{props.state().patternCount}
            </span>
            <button
              class="icon-btn"
              onClick={() =>
                props.engine.selectSlot(
                  props.state().bank,
                  props.state().pattern + 1,
                )
              }
              disabled={props.state().pattern >= props.state().patternCount - 1}
              title="Next"
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          <button class="btn tiny" onClick={props.onClose} title="Close (Esc)">
            close
          </button>
        </div>

        <Show when={showRec()}>
          <div class="img-modal-bar seq-modal-bar seq-modal-recbar">
            <span class="tiny hot">
              <Icon name="usb" size={12} /> rec src
            </span>
            <select
              style={{ 'max-width': '220px' }}
              onChange={(e) => {
                const id = e.currentTarget.value;
                const inp = midiInputs().find((i) => i.id === id);
                if (inp) props.engine.armRecord(inp.id, inp.name);
                else props.engine.disarmRecord();
              }}
            >
              <option value="">- select any MIDI input -</option>
              <For each={midiInputs()}>
                {(inp) => (
                  <option
                    value={inp.id}
                    selected={props.state().recInputId === inp.id}
                  >
                    {inp.name}
                    {inp.manufacturer ? ` - ${inp.manufacturer}` : ''}
                  </option>
                )}
              </For>
            </select>
            <Show
              when={props.state().recording}
              fallback={<span class="tiny dim">not armed</span>}
            >
              <span class="pill rec-live tiny">
                <span class="dot err" /> rec - {props.state().recInputName}
              </span>
              <span
                class={`midi-activity tiny ${noteFresh() ? 'lit' : ''}`}
                title="Incoming MIDI"
              >
                <span class="led" /> {lastNoteName()}
                <span class="dim">v{props.state().recLastVelocity}</span>
              </span>
              <button
                class="btn ghost tiny"
                onClick={() => props.engine.disarmRecord()}
              >
                disarm
              </button>
            </Show>
            <span class="spacer" />
            <span class="tiny dim">
              {props.state().playing
                ? 'overdub at playhead'
                : `step-record -> step ${props.state().recCursor + 1}`}
            </span>
            <Show when={!midiInputs().length}>
              <span class="tiny amber">
                enable MIDI in the transport bar first
              </span>
            </Show>
          </div>
        </Show>

        <Show when={showKeys()}>
          <QwertyPiano
            engine={props.engine}
            state={props.state}
            outputId={() => props.state().outputId}
          />
        </Show>

        <div class="seq-modal-stage scroll">
          <table class={`piano-roll ${draw() ? 'drawing' : ''}`}>
            <tbody>
              <For each={pitches}>
                {(pitch) => (
                  <tr class={isBlack(pitch) ? 'blk' : ''}>
                    <td class="pr-key tiny">{noteName(pitch)}</td>
                    <For each={steps()}>
                      {(step) => {
                        const s = () => props.state().steps[step];
                        const on = () => s().on && s().note === pitch;
                        return (
                          <td
                            class={`pr-cell ${on() ? 'on' : ''} ${
                              props.state().playhead === step ? 'ph' : ''
                            } ${step % 4 === 0 ? 'beat' : ''}`}
                            title={`${noteName(pitch)} - step ${step + 1}`}
                            onClick={() => {
                              if (!draw()) setCell(pitch, step);
                            }}
                            onPointerDown={(e) => {
                              if (!draw()) return;
                              e.preventDefault();
                              setPainting(true);
                              paint(pitch, step);
                            }}
                            onPointerEnter={() => {
                              if (draw() && painting()) paint(pitch, step);
                            }}
                          />
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
