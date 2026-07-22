// Control Tribe step grid (1601 / BQ10): each step is a draggable bar that
// sends its Set frame on drag. Optional transport animates a playhead and can
// preview the sequence through WebAudio (local monitor only).
import { For, Show, createSignal, onCleanup } from 'solid-js';
import type { CtStepRow } from '../devices/_shared/controltribe';

interface Props {
  rows: () => CtStepRow[];
  value: (cmd: number) => number;
  onSet: (cmd: number, value: number) => void;
  max?: number;
}

export default function CtStepGrid(props: Props) {
  const max = () => props.max ?? 127;
  const cols = () => Math.max(1, ...props.rows().map((r) => r.controls.length));

  const [playing, setPlaying] = createSignal(false);
  const [head, setHead] = createSignal(-1);
  const [bpm, setBpm] = createSignal(120);
  const [audio, setAudio] = createSignal(false);

  let timer: number | undefined;
  let ac: AudioContext | undefined;

  // value <-> pointer geometry
  const valueFromEvent = (el: HTMLElement, clientY: number) => {
    const r = el.getBoundingClientRect();
    const frac = 1 - (clientY - r.top) / r.height;
    return Math.max(0, Math.min(max(), Math.round(frac * max())));
  };
  const onBarPointerDown = (cmd: number, e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    props.onSet(cmd, valueFromEvent(el, e.clientY));
  };
  const onBarPointerMove = (cmd: number, e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (!el.hasPointerCapture(e.pointerId)) return;
    props.onSet(cmd, valueFromEvent(el, e.clientY));
  };

  // transport / audio preview
  const blip = (val: number) => {
    if (!audio()) return;
    if (!ac) ac = new AudioContext();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    // map the 0..127 step value to a MIDI note -> frequency
    osc.frequency.value = 440 * Math.pow(2, (val - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  };

  const tick = () => {
    const n = cols();
    const next = (head() + 1) % n;
    setHead(next);
    if (audio()) {
      for (const row of props.rows()) {
        const c = row.controls[next];
        if (c) blip(props.value(c.cmd));
      }
    }
  };

  const stop = () => {
    setPlaying(false);
    setHead(-1);
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const start = () => {
    if (playing()) {
      stop();
      return;
    }
    setPlaying(true);
    setHead(-1);
    // 16th-note steps: 4 steps per beat
    const interval = 60000 / bpm() / 4;
    timer = window.setInterval(tick, interval);
  };
  onCleanup(stop);

  return (
    <div class="stack" style={{ 'margin-bottom': '0.8rem' }}>
      <div class="flex wrap" style={{ 'align-items': 'center', gap: '0.5rem' }}>
        <button class="btn tiny" onClick={start}>
          {playing() ? 'stop' : 'play'}
        </button>
        <label class="tiny dim">
          bpm{' '}
          <input
            type="number"
            min={20}
            max={300}
            value={bpm()}
            onInput={(e) => {
              setBpm(Math.max(20, Math.min(300, +e.currentTarget.value | 0)));
              if (playing()) {
                stop();
                start();
              }
            }}
            style={{ width: '4rem' }}
          />
        </label>
        <label class="tiny dim" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={audio()}
            onChange={(e) => setAudio(e.currentTarget.checked)}
          />{' '}
          audio preview
        </label>
        <span class="tiny dim">drag the bars to set each step</span>
      </div>

      <For each={props.rows()}>
        {(row) => (
          <div class="stack" style={{ gap: '0.2rem' }}>
            <Show when={props.rows().length > 1}>
              <div class="tiny dim">{row.label}</div>
            </Show>
            <div
              style={{ display: 'flex', gap: '3px', 'align-items': 'flex-end' }}
            >
              <For each={row.controls}>
                {(c, i) => (
                  <div
                    style={{
                      display: 'flex',
                      'flex-direction': 'column',
                      'align-items': 'center',
                      gap: '2px',
                      flex: '1 1 0',
                    }}
                  >
                    <div
                      class="ct-step-bar"
                      title={`${c.label}: ${props.value(c.cmd)}`}
                      onPointerDown={(e) => onBarPointerDown(c.cmd, e)}
                      onPointerMove={(e) => onBarPointerMove(c.cmd, e)}
                      style={{
                        position: 'relative',
                        width: '100%',
                        'min-width': '14px',
                        height: '96px',
                        background:
                          head() === i()
                            ? 'var(--accent-dim, rgba(120,170,255,0.18))'
                            : 'var(--panel-2, rgba(255,255,255,0.05))',
                        border:
                          '1px solid var(--border, rgba(255,255,255,0.12))',
                        'border-radius': '3px',
                        cursor: 'ns-resize',
                        'touch-action': 'none',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: `${(props.value(c.cmd) / max()) * 100}%`,
                          background:
                            head() === i()
                              ? 'var(--accent, #6aa2ff)'
                              : 'var(--accent-2, #4f7fd6)',
                        }}
                      />
                    </div>
                    <div
                      class="tiny dim"
                      style={{ 'font-variant-numeric': 'tabular-nums' }}
                    >
                      {props.value(c.cmd)}
                    </div>
                    <div class="tiny dim">{i() + 1}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
