// GROOVE KEY project editors (Control Tribe 1.12.4): pattern matrix, track
// inspector, piano roll with note lanes, drum grid with hit options and the
// CV lane, and the song arranger. Edits change the project image; "send"
// writes one pattern or track block to the device.
import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { GK_PATTERNS, GK_TRACKS } from '../devices/_shared/groovekey-seq';
import {
  GK_DRUM_AT,
  GK_DRUM_TRACK_AT,
  GK_DIVS,
  GK_DRUMS,
  GK_DRUM_OFF,
  GK_GATE,
  GK_HIT,
  GK_LANES,
  GK_OCTAVES,
  GK_PLAY_MODES,
  GK_ROOTS,
  GK_SCALES,
  GK_SLOTS,
  GK_SONGS,
  GK_STEPS,
  GK_STYLES,
  GK_TRACK_MODES,
  GK_VOICES,
  GK_PATTERN_AT,
  GK_TRACK_AT,
  gkAddNote,
  gkBit,
  gkClearPattern,
  gkCopyPattern,
  gkDeleteNote,
  gkDrumPatternOff,
  gkFlipBit,
  gkMoveNote,
  gkHitOff,
  gkMicroOff,
  gkNote,
  gkNoteAtStep,
  gkNotes,
  gkPastePattern,
  gkPatternItem,
  gkPatternOff,
  gkPatternUsed,
  gkSongOff,
  gkStepOn,
  gkToggleHit,
  gkToggleStep,
  gkTrackItem,
  gkTrackOff,
} from '../devices/_shared/groovekey-edit';

const W = 14; // step width (px)
const ROWS = 24; // piano roll pitch rows
const LANE_H = 80;
const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];
const noteName = (n: number) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const named = (a: string[]) => a.map((n, i): [string, number] => [n, i]);

export default function GrooveKeyEditor(props: {
  img: () => Uint8Array;
  setImg: (u: Uint8Array) => void;
  send: (items: number[], what: string) => void;
  load: (items: number[], what: string) => void;
  canSend: boolean;
}) {
  const [tab, setTab] = createSignal<'patterns' | 'song'>('patterns');
  const [row, setRow] = createSignal(0); // track 0-3, 4 = drums
  const [pat, setPat] = createSignal(0);
  const [sel, setSel] = createSignal<number | null>(null); // note slot
  const [hit, setHit] = createSignal<[number, number] | null>(null);
  const [lane, setLane] = createSignal(0);
  const [low, setLow] = createSignal(48); // C2
  const [song, setSong] = createSignal(0);
  const [clip, setClip] = createSignal<[number, Uint8Array] | null>(null);

  const img = () => props.img();
  const u8 = (o: number) => img()[o];
  const edit = (fn: (m: Uint8Array) => void) => {
    const m = Uint8Array.from(img());
    fn(m);
    props.setImg(m);
  };
  const setU8 = (o: number, v: number) => edit((m) => void (m[o] = v));
  const drum = () => row() === GK_TRACKS;
  const trackBase = () => (drum() ? GK_DRUM_OFF : gkTrackOff(row()));
  const curOff = () =>
    trackBase() +
    (drum() ? GK_DRUM_TRACK_AT.curPattern : GK_TRACK_AT.curPattern);
  const msOff = () =>
    trackBase() + (drum() ? GK_DRUM_TRACK_AT.muteSolo : GK_TRACK_AT.muteSolo);
  const swOff = () =>
    trackBase() + (drum() ? GK_DRUM_TRACK_AT.swing : GK_TRACK_AT.swing);
  const pOff = () => gkPatternOff(row(), pat());
  const dOff = () => gkDrumPatternOff(pat());
  const len = () =>
    Math.max(
      1,
      Math.min(64, u8(drum() ? dOff() : pOff() + GK_PATTERN_AT.length)),
    );

  const sel1 = (
    label: string,
    v: number,
    opts: [string, number][],
    set: (v: number) => void,
  ) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      {label}
      <select onChange={(e) => set(Number(e.currentTarget.value))}>
        <For each={opts}>
          {([n, x]) => (
            <option value={x} selected={x === v}>
              {n}
            </option>
          )}
        </For>
      </select>
    </label>
  );
  const num = (
    label: string,
    v: number,
    lo: number,
    hi: number,
    set: (v: number) => void,
  ) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      {label}
      <input
        type="number"
        min={lo}
        max={hi}
        value={v}
        style={{ width: '4rem' }}
        onChange={(e) =>
          set(Math.max(lo, Math.min(hi, Math.round(+e.currentTarget.value))))
        }
      />
    </label>
  );
  const toggle = (label: string, on: boolean, flip: () => void, title = '') => (
    <button
      class={on ? 'btn tiny' : 'btn tiny ghost'}
      title={title}
      onClick={flip}
    >
      {label}
    </button>
  );

  // ---- piano roll --------------------------------------------------------
  const notes = createMemo(() => (drum() ? [] : gkNotes(img(), row(), pat())));
  const noteBytes = (slot: number) => gkNote(img(), row(), pat(), slot);
  const editNote = (slot: number, fn: (n: Uint8Array) => void) =>
    edit((m) => fn(gkNote(m, row(), pat(), slot)));
  const clickCell = (step: number, pitch: number) => {
    const at = notes().find((n) => n.step === step && n.pitch === pitch);
    if (at) return setSel(at.slot);
    let slot: number | null = null;
    edit((m) => (slot = gkAddNote(m, row(), pat(), step, pitch)));
    setSel(slot);
  };
  const deleteSel = () => {
    const s = sel();
    if (s === null) return;
    edit((m) => gkDeleteNote(m, row(), pat(), s));
    setSel(null);
  };
  const noteX = (slot: number) => {
    const n = noteBytes(slot);
    const start = n[2] === 0xff ? 0 : GK_GATE[Math.min(n[2], 11)];
    return (n[8] + start + (n[4] - 50) / 100) * W;
  };
  const laneSlot = (step: number) => {
    const s = sel();
    if (s !== null && noteBytes(s)[7] && noteBytes(s)[8] === step) return s;
    return gkNoteAtStep(img(), row(), pat(), step);
  };
  let dragging = false;
  const laneFromY = (e: PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const step = Math.floor((e.clientX - r.left) / W);
    if (step < 0 || step >= len()) return;
    const slot = laneSlot(step);
    if (slot === null) return;
    const l = GK_LANES[lane()];
    const f = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / LANE_H));
    const v = Math.round(l.min + f * (l.max - l.min));
    if (l.get(noteBytes(slot)) !== v) editNote(slot, (n) => l.set(n, v));
  };

  // ---- drum grid -----------------------------------------------------------
  const voiceLen = (v: number) =>
    u8(dOff() + GK_DRUM_AT.polymeter)
      ? u8(dOff() + GK_DRUM_AT.polyLength + v)
      : len();
  const hitByte = () => {
    const h = hit();
    return h ? u8(gkHitOff(pat(), h[0], h[1])) : 0;
  };
  const setHitBits = (mask: number, v: number) => {
    const h = hit();
    if (h) {
      const o = gkHitOff(pat(), h[0], h[1]);
      setU8(o, (u8(o) & ~mask) | v);
    }
  };

  return (
    <div class="stack">
      <div class="flex wrap">
        {toggle('Patterns', tab() === 'patterns', () => setTab('patterns'))}
        {toggle('Song', tab() === 'song', () => setTab('song'))}
        {num('BPM', u8(4) | (u8(5) << 8), 30, 240, (v) =>
          edit((m) => m.set([v & 0xff, v >> 8], 4)),
        )}
        {num('swing', u8(6), 50, 75, (v) => setU8(6, v))}
        {sel1(
          'current song',
          u8(7),
          range(GK_SONGS).map((i) => [`${i + 1}`, i]),
          (v) => setU8(7, v),
        )}
        <button
          class="btn tiny ghost"
          disabled={!props.canSend}
          onClick={() => props.send([0], 'project settings and songs')}
        >
          send project settings
        </button>
      </div>

      <Show when={tab() === 'song'}>
        <div class="flex wrap">
          {sel1(
            'song',
            song(),
            range(GK_SONGS).map((i) => [`${i + 1}`, i]),
            setSong,
          )}
          <span class="muted tiny">
            Each slot plays a pattern (or nothing) a number of times.
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': `5rem repeat(${GK_SLOTS}, 3.6rem)`,
            gap: '2px',
          }}
        >
          <Index each={range(GK_TRACKS + 1)}>
            {(r) => (
              <>
                <span class="tiny hot">
                  {r() < GK_TRACKS ? `Track ${r() + 1}` : 'Drum'}
                </span>
                <Index each={range(GK_SLOTS)}>
                  {(k) => {
                    const o = () => gkSongOff(r(), song(), k());
                    return (
                      <span class="stack" style={{ gap: '1px' }}>
                        <select
                          class="tiny"
                          onChange={(e) => setU8(o(), +e.currentTarget.value)}
                        >
                          <For each={range(17)}>
                            {(p) => (
                              <option value={p} selected={p === u8(o())}>
                                {p ? `P${p}` : '--'}
                              </option>
                            )}
                          </For>
                        </select>
                        <select
                          class="tiny"
                          onChange={(e) =>
                            setU8(o() + 1, +e.currentTarget.value)
                          }
                        >
                          <For each={range(5)}>
                            {(n) => (
                              <option
                                value={n + 1}
                                selected={n + 1 === Math.max(1, u8(o() + 1))}
                              >
                                x{n + 1}
                              </option>
                            )}
                          </For>
                        </select>
                      </span>
                    );
                  }}
                </Index>
              </>
            )}
          </Index>
        </div>
      </Show>

      <Show when={tab() === 'patterns'}>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': `5rem repeat(${GK_PATTERNS}, 1.8rem)`,
            gap: '2px',
          }}
        >
          <Index each={range(GK_TRACKS + 1)}>
            {(r) => (
              <>
                <span class="tiny hot">
                  {r() < GK_TRACKS ? `Track ${r() + 1}` : 'Drum'}
                </span>
                <Index each={range(GK_PATTERNS)}>
                  {(p) => {
                    const cur = () =>
                      u8(
                        r() < GK_TRACKS
                          ? gkTrackOff(r()) + GK_TRACK_AT.curPattern
                          : GK_DRUM_OFF + GK_DRUM_TRACK_AT.curPattern,
                      ) === p();
                    return (
                      <button
                        class="tiny"
                        title={cur() ? 'current pattern' : ''}
                        onClick={() => {
                          setRow(r());
                          setPat(p());
                          setSel(null);
                          setHit(null);
                        }}
                        style={{
                          padding: 0,
                          height: '1.4rem',
                          background: gkPatternUsed(img(), r(), p())
                            ? '#5a4410'
                            : '#1b1a1a',
                          border:
                            row() === r() && pat() === p()
                              ? '2px solid #ffb608'
                              : '1px solid #0008',
                          color: cur() ? '#ffb608' : '#9a9898',
                          'font-weight': cur() ? 'bold' : 'normal',
                        }}
                      >
                        {p() + 1}
                      </button>
                    );
                  }}
                </Index>
              </>
            )}
          </Index>
        </div>
        <div class="flex wrap">
          <span class="hot">
            {drum() ? 'Drum' : `Track ${row() + 1}`}, pattern {pat() + 1}
          </span>
          <button class="btn tiny ghost" onClick={() => setU8(curOff(), pat())}>
            make current
          </button>
          <button
            class="btn tiny ghost"
            onClick={() => setClip([row(), gkCopyPattern(img(), row(), pat())])}
          >
            copy
          </button>
          <button
            class="btn tiny ghost"
            onClick={() => {
              setClip([row(), gkCopyPattern(img(), row(), pat())]);
              edit((m) => gkClearPattern(m, row(), pat()));
              setSel(null);
              setHit(null);
            }}
          >
            cut
          </button>
          <button
            class="btn tiny ghost"
            disabled={!clip() || (clip()![0] === GK_TRACKS) !== drum()}
            onClick={() =>
              edit((m) => gkPastePattern(m, row(), pat(), clip()![1]))
            }
          >
            paste
          </button>
          <button
            class="btn tiny ghost"
            onClick={() => {
              edit((m) => gkClearPattern(m, row(), pat()));
              setSel(null);
              setHit(null);
            }}
          >
            clear
          </button>
          <button
            class="btn tiny ghost"
            disabled={!props.canSend}
            onClick={() =>
              props.load([gkPatternItem(row(), pat())], `pattern ${pat() + 1}`)
            }
          >
            load pattern
          </button>
          <button
            class="btn tiny ghost"
            disabled={!props.canSend}
            onClick={() =>
              props.send([gkPatternItem(row(), pat())], `pattern ${pat() + 1}`)
            }
          >
            send pattern
          </button>
          <button
            class="btn tiny ghost"
            disabled={!props.canSend}
            onClick={() => props.send([gkTrackItem(row())], 'track settings')}
          >
            send track
          </button>
        </div>

        <div class="tiny dim device-app-hdr">Track</div>
        <div class="flex wrap">
          <Show when={!drum()}>
            {sel1(
              'mode',
              u8(trackBase() + GK_TRACK_AT.mode),
              named(GK_TRACK_MODES),
              (v) => setU8(trackBase() + GK_TRACK_AT.mode, v),
            )}
            {num('preset', u8(trackBase() + GK_TRACK_AT.preset), 0, 127, (v) =>
              setU8(trackBase() + GK_TRACK_AT.preset, v),
            )}
          </Show>
          {num('swing', u8(swOff()), 50, 75, (v) => setU8(swOff(), v))}
          {toggle(
            'M',
            !!(u8(msOff()) & 1),
            () => setU8(msOff(), u8(msOff()) ^ 1),
            'mute',
          )}
          {toggle(
            'S',
            !!(u8(msOff()) & 2),
            () => setU8(msOff(), u8(msOff()) ^ 2),
            'solo',
          )}
          <span class="tiny dim">tone</span>
          <Index each={range(8)}>
            {(k) => {
              const o = () => trackBase() + (drum() ? 2 : 5) + k();
              return (
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={u8(o())}
                  style={{ width: '3.2rem' }}
                  onChange={(e) =>
                    setU8(
                      o(),
                      Math.max(0, Math.min(127, +e.currentTarget.value | 0)),
                    )
                  }
                />
              );
            }}
          </Index>
        </div>

        <Show when={!drum()}>
          <div class="tiny dim device-app-hdr">Pattern</div>
          <div class="flex wrap">
            {num('length', len(), 1, 64, (v) =>
              setU8(pOff() + GK_PATTERN_AT.length, v),
            )}
            {sel1(
              'play',
              u8(pOff() + GK_PATTERN_AT.playMode),
              named(GK_PLAY_MODES),
              (v) => setU8(pOff() + GK_PATTERN_AT.playMode, v),
            )}
            {sel1(
              'style',
              u8(pOff() + GK_PATTERN_AT.style),
              named(GK_STYLES),
              (v) => setU8(pOff() + GK_PATTERN_AT.style, v),
            )}
            {sel1(
              'octave',
              u8(pOff() + GK_PATTERN_AT.octave),
              named(GK_OCTAVES),
              (v) => setU8(pOff() + GK_PATTERN_AT.octave, v),
            )}
            {sel1(
              'scale',
              u8(pOff() + GK_PATTERN_AT.scale),
              named(GK_SCALES),
              (v) => setU8(pOff() + GK_PATTERN_AT.scale, v),
            )}
            {sel1(
              'root',
              u8(pOff() + GK_PATTERN_AT.root),
              named(GK_ROOTS),
              (v) => setU8(pOff() + GK_PATTERN_AT.root, v),
            )}
            {sel1(
              'time',
              u8(pOff() + GK_PATTERN_AT.timeDiv),
              named(GK_DIVS),
              (v) => setU8(pOff() + GK_PATTERN_AT.timeDiv, v),
            )}
          </div>
          <Show when={u8(pOff() + GK_PATTERN_AT.style) === 6}>
            <div class="flex wrap">
              <span class="tiny dim">custom order</span>
              <Index each={range(7)}>
                {(k) => (
                  <input
                    type="number"
                    min={0}
                    max={8}
                    value={u8(pOff() + GK_PATTERN_AT.custStyle + k())}
                    style={{ width: '3rem' }}
                    onChange={(e) =>
                      setU8(
                        pOff() + GK_PATTERN_AT.custStyle + k(),
                        Math.max(0, Math.min(8, +e.currentTarget.value | 0)),
                      )
                    }
                  />
                )}
              </Index>
            </div>
          </Show>

          <div class="flex wrap">
            <button
              class="btn tiny ghost"
              onClick={() => setLow(Math.min(104, low() + 12))}
            >
              octave up
            </button>
            <button
              class="btn tiny ghost"
              onClick={() => setLow(Math.max(0, low() - 12))}
            >
              octave down
            </button>
            <span class="muted tiny">
              Click a cell to add a note or select it; double-click a note to
              delete it.
            </span>
          </div>
          <div style={{ overflow: 'auto', 'max-width': '100%' }}>
            <div style={{ display: 'flex', 'margin-left': '3rem', gap: 0 }}>
              <Index each={range(len())}>
                {(s) => (
                  <button
                    title="step on"
                    onClick={() =>
                      edit((m) => gkToggleStep(m, row(), pat(), s()))
                    }
                    style={{
                      width: `${W}px`,
                      height: '10px',
                      padding: 0,
                      background: gkStepOn(img(), row(), pat(), s())
                        ? '#ffb608'
                        : '#1b1a1a',
                      border: '1px solid #0008',
                    }}
                  />
                )}
              </Index>
            </div>
            <div style={{ display: 'flex' }}>
              <div style={{ width: '3rem' }}>
                <Index each={range(ROWS)}>
                  {(k) => (
                    <div
                      class="tiny dim"
                      style={{ height: `${W}px`, 'font-size': '9px' }}
                    >
                      {noteName(low() + ROWS - 1 - k())}
                    </div>
                  )}
                </Index>
              </div>
              <div
                style={{
                  position: 'relative',
                  width: `${len() * W}px`,
                  height: `${ROWS * W}px`,
                  'background-image':
                    'linear-gradient(90deg, #ffffff10 1px, transparent 1px), linear-gradient(#ffffff08 1px, transparent 1px)',
                  'background-size': `${W}px ${W}px`,
                  'background-color': '#151414',
                }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const step = Math.floor((e.clientX - r.left) / W);
                  const pitch =
                    low() + ROWS - 1 - Math.floor((e.clientY - r.top) / W);
                  if (step >= 0 && step < len()) clickCell(step, pitch);
                }}
              >
                <For
                  each={notes().filter(
                    (n) => n.pitch >= low() && n.pitch < low() + ROWS,
                  )}
                >
                  {(n) => (
                    <div
                      onDblClick={(e) => {
                        e.stopPropagation();
                        setSel(n.slot);
                        deleteSel();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel(n.slot);
                      }}
                      title={`${noteName(n.pitch)} step ${n.step + 1}`}
                      style={{
                        position: 'absolute',
                        left: `${noteX(n.slot)}px`,
                        top: `${(low() + ROWS - 1 - n.pitch) * W + 1}px`,
                        width: `${Math.max(4, GK_GATE[Math.min(noteBytes(n.slot)[3], 127)] * W - 1)}px`,
                        height: `${W - 2}px`,
                        background:
                          noteBytes(n.slot)[7] === 2 ? '#555' : '#ffb608',
                        opacity: 0.4 + (noteBytes(n.slot)[1] / 127) * 0.6,
                        outline: sel() === n.slot ? '2px solid #fff' : 'none',
                        'border-radius': '2px',
                      }}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>

          <Show when={sel() !== null && noteBytes(sel()!)[7]}>
            <div class="flex wrap">
              <span class="hot tiny">
                note {noteName(noteBytes(sel()!)[0])}, step{' '}
                {noteBytes(sel()!)[8] + 1}
              </span>
              {num('pitch', noteBytes(sel()!)[0], 0, 127, (v) =>
                edit((m) =>
                  gkMoveNote(m, row(), pat(), sel()!, noteBytes(sel()!)[8], v),
                ),
              )}
              {num('step', noteBytes(sel()!)[8] + 1, 1, len(), (v) =>
                edit((m) =>
                  gkMoveNote(
                    m,
                    row(),
                    pat(),
                    sel()!,
                    v - 1,
                    noteBytes(sel()!)[0],
                  ),
                ),
              )}
              <For each={GK_LANES}>
                {(l) => (
                  <label class="tiny flex" style={{ gap: '0.3rem' }}>
                    {l.name}
                    <input
                      type="number"
                      min={l.min}
                      max={l.max}
                      value={l.get(noteBytes(sel()!))}
                      style={{ width: '3.6rem' }}
                      onChange={(e) =>
                        editNote(sel()!, (n) =>
                          l.set(n, Math.round(+e.currentTarget.value)),
                        )
                      }
                    />
                    <span class="dim">{l.show(l.get(noteBytes(sel()!)))}</span>
                  </label>
                )}
              </For>
              <button class="btn tiny ghost" onClick={deleteSel}>
                delete note
              </button>
            </div>
          </Show>

          <div class="flex wrap">
            <For each={GK_LANES}>
              {(l, i) => toggle(l.name, lane() === i(), () => setLane(i()))}
            </For>
          </div>
          <div
            style={{
              display: 'flex',
              'margin-left': '3rem',
              height: `${LANE_H}px`,
              cursor: 'ns-resize',
              'touch-action': 'none',
            }}
            onPointerDown={(e) => {
              dragging = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              laneFromY(e, e.currentTarget);
            }}
            onPointerMove={(e) => dragging && laneFromY(e, e.currentTarget)}
            onPointerUp={() => (dragging = false)}
          >
            <Index each={range(len())}>
              {(s) => {
                const slot = () => laneSlot(s());
                const frac = () => {
                  const l = GK_LANES[lane()];
                  const x = slot();
                  return x === null
                    ? 0
                    : (l.get(noteBytes(x)) - l.min) / (l.max - l.min);
                };
                return (
                  <div
                    title={
                      slot() === null
                        ? ''
                        : GK_LANES[lane()].show(
                            GK_LANES[lane()].get(noteBytes(slot()!)),
                          )
                    }
                    style={{
                      position: 'relative',
                      width: `${W}px`,
                      background: '#1b1a1a',
                      border: '1px solid #0008',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: `${frac() * 100}%`,
                        background: slot() === null ? 'transparent' : '#ffb608',
                      }}
                    />
                  </div>
                );
              }}
            </Index>
          </div>
        </Show>

        <Show when={drum()}>
          <div class="tiny dim device-app-hdr">Drum Pattern</div>
          <div class="flex wrap">
            {num('length', len(), 1, 64, (v) =>
              setU8(dOff() + GK_DRUM_AT.length, v),
            )}
            {sel1(
              'step',
              u8(dOff() + GK_DRUM_AT.stepSize),
              named(GK_DIVS),
              (v) => setU8(dOff() + GK_DRUM_AT.stepSize, v),
            )}
            {num(
              'probability',
              u8(dOff() + GK_DRUM_AT.probability),
              0,
              100,
              (v) => setU8(dOff() + GK_DRUM_AT.probability, v),
            )}
            {num('flam', u8(dOff() + GK_DRUM_AT.flam), 0, 8, (v) =>
              setU8(dOff() + GK_DRUM_AT.flam, v),
            )}
            {sel1(
              'polymeter',
              u8(dOff() + GK_DRUM_AT.polymeter),
              named(['OFF', 'ON']),
              (v) => setU8(dOff() + GK_DRUM_AT.polymeter, v),
            )}
          </div>
          <div style={{ overflow: 'auto', 'max-width': '100%' }}>
            <div
              style={{
                display: 'grid',
                'grid-template-columns': `13rem repeat(${GK_STEPS}, ${W}px)`,
                gap: '1px',
              }}
            >
              <span class="tiny dim">random steps</span>
              <Index each={range(GK_STEPS)}>
                {(s) => (
                  <button
                    title="random step"
                    onClick={() =>
                      edit((m) =>
                        gkFlipBit(m, dOff() + GK_DRUM_AT.randomStep, s()),
                      )
                    }
                    style={{
                      height: '10px',
                      padding: 0,
                      background: gkBit(
                        img(),
                        dOff() + GK_DRUM_AT.randomStep,
                        s(),
                      )
                        ? '#47d18c'
                        : '#1b1a1a',
                      opacity: s() < len() ? 1 : 0.3,
                      border: '1px solid #0008',
                    }}
                  />
                )}
              </Index>
              <Index each={range(GK_VOICES)}>
                {(v) => (
                  <>
                    <span class="tiny flex" style={{ gap: '2px' }}>
                      <span style={{ width: '4.2rem' }}>{GK_DRUMS[v()]}</span>
                      {toggle(
                        'M',
                        gkBit(img(), dOff() + GK_DRUM_AT.mute, v()),
                        () =>
                          edit((m) =>
                            gkFlipBit(m, dOff() + GK_DRUM_AT.mute, v()),
                          ),
                        'mute',
                      )}
                      {toggle(
                        'S',
                        gkBit(img(), dOff() + GK_DRUM_AT.solo, v()),
                        () =>
                          edit((m) =>
                            gkFlipBit(m, dOff() + GK_DRUM_AT.solo, v()),
                          ),
                        'solo',
                      )}
                      {toggle(
                        'R',
                        !!u8(dOff() + GK_DRUM_AT.randomTrack + v()),
                        () =>
                          setU8(
                            dOff() + GK_DRUM_AT.randomTrack + v(),
                            u8(dOff() + GK_DRUM_AT.randomTrack + v()) ? 0 : 1,
                          ),
                        'random',
                      )}
                      <Show when={u8(dOff() + GK_DRUM_AT.polymeter)}>
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={u8(dOff() + GK_DRUM_AT.polyLength + v())}
                          style={{ width: '2.8rem' }}
                          title="voice length"
                          onChange={(e) =>
                            setU8(
                              dOff() + GK_DRUM_AT.polyLength + v(),
                              Math.max(
                                1,
                                Math.min(64, +e.currentTarget.value | 0),
                              ),
                            )
                          }
                        />
                      </Show>
                    </span>
                    <Index each={range(GK_STEPS)}>
                      {(s) => {
                        const b = () => u8(gkHitOff(pat(), v(), s()));
                        const isSel = () =>
                          hit()?.[0] === v() && hit()?.[1] === s();
                        return (
                          <button
                            onClick={() => {
                              const on = b() & 1;
                              if (on && !isSel()) return setHit([v(), s()]);
                              edit((m) => gkToggleHit(m, pat(), v(), s()));
                              setHit(on ? null : [v(), s()]);
                            }}
                            style={{
                              height: `${W}px`,
                              padding: 0,
                              background:
                                b() & 1
                                  ? b() & GK_HIT.accent
                                    ? '#ff7a1a'
                                    : '#ffb608'
                                  : '#1b1a1a',
                              opacity: s() < voiceLen(v()) ? 1 : 0.3,
                              border: isSel()
                                ? '2px solid #fff'
                                : '1px solid #0008',
                            }}
                          />
                        );
                      }}
                    </Index>
                  </>
                )}
              </Index>
              <span class="tiny dim">auto CV</span>
              <Index each={range(GK_STEPS)}>
                {(s) => {
                  const o = () => dOff() + GK_DRUM_AT.autoCV + s();
                  return (
                    <div
                      title={`${u8(o())}`}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setU8(
                          o(),
                          Math.round(
                            255 *
                              (1 -
                                Math.min(
                                  1,
                                  Math.max(0, (e.clientY - r.top) / r.height),
                                )),
                          ),
                        );
                      }}
                      style={{
                        position: 'relative',
                        height: '40px',
                        background: '#1b1a1a',
                        opacity: s() < len() ? 1 : 0.3,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: `${(u8(o()) / 255) * 100}%`,
                          background: '#47d18c',
                        }}
                      />
                    </div>
                  );
                }}
              </Index>
            </div>
          </div>
          <Show when={hit() && hitByte() & 1}>
            <div class="flex wrap">
              <span class="hot tiny">
                {GK_DRUMS[hit()![0]]}, step {hit()![1] + 1}
              </span>
              {toggle('Accent', !!(hitByte() & GK_HIT.accent), () =>
                setHitBits(
                  GK_HIT.accent,
                  hitByte() & GK_HIT.accent ? 0 : GK_HIT.accent,
                ),
              )}
              {toggle('Flam', !!(hitByte() & GK_HIT.flam), () =>
                setHitBits(
                  GK_HIT.flam,
                  hitByte() & GK_HIT.flam ? 0 : GK_HIT.flam,
                ),
              )}
              {toggle('Prob', !!(hitByte() & GK_HIT.prob), () =>
                setHitBits(
                  GK_HIT.prob,
                  hitByte() & GK_HIT.prob ? 0 : GK_HIT.prob,
                ),
              )}
              {toggle('Note Repeat', !!(hitByte() & GK_HIT.repeat), () =>
                setHitBits(
                  GK_HIT.repeat,
                  hitByte() & GK_HIT.repeat ? 0 : GK_HIT.repeat,
                ),
              )}
              {sel1(
                'repeat x',
                (hitByte() >> 5) & 3,
                named(['1', '2', '4', '8']),
                (v) => setHitBits(0x60, v << 5),
              )}
              {num(
                'micro-timing',
                u8(gkMicroOff(pat(), hit()![0], hit()![1])),
                0,
                23,
                (v) => setU8(gkMicroOff(pat(), hit()![0], hit()![1]), v),
              )}
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
