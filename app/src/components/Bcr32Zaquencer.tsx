// BCR32 Zaquencer page (Control Tribe 1.12.4 BCR32Zaquencer): tempo, chain
// play, MIDI thru, note display and preset load; per track the sequence
// window, divider, shuffle and direction; a step lane editor (pitch,
// velocity, length, delay, ctrl A / B, chord, step mute, skip) or, on a drum
// track, the 16-voice drum grid. Edits go to the device as they happen.
import {
  For,
  Index,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import { bcrZaquencerMode } from '../devices/_shared/bcr32';
import {
  ZAQ_GLOBAL,
  LANE_DRUM,
  LANE_MUTE,
  LANE_SKIP,
  ZAQ_TRACK,
  ZAQ_DIRECTIONS,
  ZAQ_DIVIDERS,
  ZAQ_LANE_EDIT,
  ZAQ_NOTE_DISPLAY,
  ZAQ_PAGES,
  ZAQ_STEPS,
  ZAQ_THRU_DESTS,
  ZAQ_THRU_SOURCES,
  ZAQ_TRACKS,
  ZAQ_VOICES,
  ZaqLink,
  zaqApply,
  zaqCtrlName,
  zaqData,
  zaqFormat,
  zaqGlobalWrite,
  zaqInWindow,
  zaqIsDrum,
  zaqLaneEditable,
  zaqLaneRange,
  zaqLoadPreset,
  zaqNote,
  zaqReadAll,
  zaqStepWrite,
  zaqTrackWrite,
  type ZaqData,
  type ZaqReq,
  type ZaqTrack,
} from '../devices/_shared/bcr32-zaq';

const BAR_H = 120;
const range = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => i + from);

export default function Bcr32Zaquencer(props: {
  outputId: () => string | undefined;
}) {
  const [data, setData] = createSignal<ZaqData>(zaqData());
  const [track, setTrack] = createSignal(0);
  const [lane, setLane] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const [preset, setPreset] = createSignal(0);
  const [status, setStatus] = createSignal('');
  let link: ZaqLink | null = null;
  let linkOut = '';

  const update = (fn: (z: ZaqData) => void) => {
    const z = structuredClone(data());
    fn(z);
    setData(z);
  };
  const getLink = () => {
    const out = props.outputId();
    if (!out) return null;
    if (!link || linkOut !== out) {
      linkOut = out;
      link = new ZaqLink(out, (r) => {
        let more: ZaqReq[] = [];
        update((z) => (more = zaqApply(z, r)));
        if (more.length) link!.push(...more);
        // a loaded preset changes everything: read it again (presetChanged)
        if (r.cmd === 0x48 && r.op === 2 && r.status <= 1)
          setTimeout(() => void readAll(), 300);
      });
    }
    return link;
  };
  onCleanup(() => (link = null));

  const readAll = async () => {
    const l = getLink();
    if (!l) return;
    setData(zaqData());
    setStatus('reading...');
    l.missed = 0;
    l.push(...zaqReadAll());
    await l.idle();
    setStatus(
      l.missed
        ? `read, ${l.missed} requests not answered (firmware 1.0.3+, Zaquencer mode)`
        : 'read',
    );
    actions().pushLog({ dir: 'in', text: 'BCR32: Zaquencer data read' });
  };
  const write = (r: ZaqReq) => getLink()?.push(r);

  const t = (): ZaqTrack => data().tracks[track()];
  const drum = createMemo(() => zaqIsDrum(t()));
  const lanes = createMemo(() =>
    ZAQ_LANE_EDIT.filter(([, l]) => !drum() || (l !== 0 && l !== 7)),
  );
  // drum tracks have no pitch or chord lane (setDrumTrack)
  const curLane = () =>
    lanes().some(([, l]) => l === lane()) ? lane() : lanes()[0][1];

  const setTrackParam = (p: number, v: number) => {
    update((z) => void (z.tracks[track()].params[p] = v));
    write(zaqTrackWrite(track(), p, v));
  };
  const setGlobal = (p: number, v: number) => {
    update((z) => void (z.globals[p] = v));
    write(zaqGlobalWrite(p, v));
  };
  const setStep = (s: number, l: number, v: number) => {
    update((z) => {
      const tr = z.tracks[track()];
      (tr.lanes[l] ??= Array(ZAQ_STEPS).fill(0))[s] = v;
    });
    write(zaqStepWrite(track(), s, l, v));
  };
  const setVoice = (s: number, voice: number, on: boolean) => {
    update((z) => {
      const m = (z.tracks[track()].lanes[LANE_DRUM] ??=
        Array(ZAQ_STEPS).fill(0));
      m[s] = on ? m[s] | (1 << voice) : m[s] & ~(1 << voice);
    });
    write(zaqStepWrite(track(), s, 0x10 + voice, on ? 1 : 0));
  };

  // lane editor: the bar height sets the value
  let dragging = false;
  const fromY = (e: PointerEvent, el: HTMLElement) => {
    const l = curLane();
    if (!zaqLaneEditable(t(), l) || !t().lanes[l]) return;
    const r = el.getBoundingClientRect();
    const s = Math.floor(((e.clientX - r.left) / r.width) * ZAQ_STEPS);
    if (s < 0 || s >= ZAQ_STEPS) return;
    const [lo, hi] = zaqLaneRange(t(), l);
    const f = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / BAR_H));
    const v = Math.round(lo + f * (hi - lo));
    if (t().lanes[l]![s] !== v) setStep(s, l, v);
  };

  const sel = (
    label: string,
    v: number | undefined,
    opts: [string, number][],
    set: (v: number) => void,
  ) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      {label}
      <select
        disabled={v === undefined}
        onChange={(e) => set(Number(e.currentTarget.value))}
      >
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
    v: number | undefined,
    lo: number,
    hi: number,
    set: (v: number) => void,
    shift = 0,
  ) => (
    <label class="tiny flex" style={{ gap: '0.3rem' }}>
      {label}
      <input
        type="number"
        min={lo + shift}
        max={hi + shift}
        disabled={v === undefined}
        value={v === undefined ? '' : v + shift}
        style={{ width: '4rem' }}
        onChange={(e) =>
          set(
            Math.max(
              lo,
              Math.min(hi, Math.round(+e.currentTarget.value - shift)),
            ),
          )
        }
      />
    </label>
  );
  const named = (a: string[]) => a.map((n, i): [string, number] => [n, i]);

  const thru = () => data().globals[ZAQ_GLOBAL.thru];
  const setThru = (src: number, dest: number) =>
    setGlobal(ZAQ_GLOBAL.thru, (src << 4) | dest);

  return (
    <div class="stack">
      <div class="flex wrap">
        <button
          class="btn tiny"
          disabled={!props.outputId()}
          onClick={() => void readAll()}
        >
          read all
        </button>
        <button
          class="btn tiny ghost"
          disabled={!props.outputId()}
          onClick={() => {
            const out = props.outputId();
            if (out) midi.send(out, bcrZaquencerMode());
          }}
          title="Put the BCR32 in Zaquencer mode"
        >
          Zaquencer mode
        </button>
        <span class="muted tiny">
          Needs firmware 1.0.3 or later. Edits are sent at once.
        </span>
      </div>

      <div class="tiny dim device-app-hdr">General</div>
      <div class="flex wrap">
        <label class="tiny flex" style={{ gap: '0.3rem' }}>
          tempo (BPM)
          <input
            type="number"
            min={30}
            max={300}
            step={0.1}
            disabled={data().globals[ZAQ_GLOBAL.tempo] === undefined}
            value={(data().globals[ZAQ_GLOBAL.tempo] ?? NaN) / 10 || ''}
            style={{ width: '5rem' }}
            onChange={(e) =>
              setGlobal(
                ZAQ_GLOBAL.tempo,
                Math.max(
                  300,
                  Math.min(3000, Math.round(+e.currentTarget.value * 10)),
                ),
              )
            }
          />
        </label>
        {sel(
          'chain play',
          data().globals[ZAQ_GLOBAL.chainPlay],
          named(['OFF', 'ON']),
          (v) => setGlobal(ZAQ_GLOBAL.chainPlay, v),
        )}
        {sel(
          'note display',
          data().globals[ZAQ_GLOBAL.noteDisplay],
          named(ZAQ_NOTE_DISPLAY),
          (v) => setGlobal(ZAQ_GLOBAL.noteDisplay, v),
        )}
        {sel(
          'thru source',
          thru() === undefined ? undefined : thru()! >> 4,
          named(ZAQ_THRU_SOURCES),
          (v) => setThru(v, (thru() ?? 0) & 0xf),
        )}
        <Show when={(thru() ?? 0) >> 4}>
          {sel(
            'thru destination',
            thru() === undefined ? undefined : thru()! & 0xf,
            ZAQ_THRU_DESTS,
            (v) => setThru(thru()! >> 4, v),
          )}
        </Show>
      </div>
      <div class="flex wrap">
        {sel(
          'page',
          page(),
          range(ZAQ_PAGES).map((i) => [`${i + 1}`, i]),
          setPage,
        )}
        {sel(
          'preset',
          preset(),
          range(16).map((i) => [`${i + 1}`, i]),
          setPreset,
        )}
        <button
          class="btn tiny"
          disabled={!props.outputId()}
          onClick={() => write(zaqLoadPreset(page() * 16 + preset()))}
        >
          load preset
        </button>
        <Show when={data().state}>
          {(s) => (
            <span class="tiny dim">
              current: page {(s()[1] >> 4) + 1}, preset {(s()[1] & 15) + 1}
            </span>
          )}
        </Show>
      </div>

      <div class="flex wrap">
        <For each={range(ZAQ_TRACKS)}>
          {(i) => (
            <button
              class={track() === i ? 'btn tiny' : 'btn tiny ghost'}
              onClick={() => setTrack(i)}
            >
              Track {i + 1}
            </button>
          )}
        </For>
        <span class="tiny dim">
          {t().params[ZAQ_TRACK.mode] === undefined
            ? ''
            : drum()
              ? 'DRUM'
              : 'CHORD'}
          {t().params[ZAQ_TRACK.ctrlA] === undefined
            ? ''
            : ` / Ctrl A ${zaqCtrlName(t().params[ZAQ_TRACK.ctrlA]!)} / Ctrl B ${zaqCtrlName(t().params[ZAQ_TRACK.ctrlB] ?? -4)}`}
        </span>
      </div>
      <div class="flex wrap">
        {sel('mute', t().params[ZAQ_TRACK.mute], named(['OFF', 'ON']), (v) =>
          setTrackParam(ZAQ_TRACK.mute, v),
        )}
        {num('start', t().params[ZAQ_TRACK.start], 1, 32, (v) =>
          setTrackParam(ZAQ_TRACK.start, v),
        )}
        {num('length', t().params[ZAQ_TRACK.length], 1, 32, (v) =>
          setTrackParam(ZAQ_TRACK.length, v),
        )}
        {num('offset', t().params[ZAQ_TRACK.offset], 0, 31, (v) =>
          setTrackParam(ZAQ_TRACK.offset, v),
        )}
        {sel(
          'direction',
          t().params[ZAQ_TRACK.direction],
          named(ZAQ_DIRECTIONS),
          (v) => setTrackParam(ZAQ_TRACK.direction, v),
        )}
        {sel(
          'divider',
          t().params[ZAQ_TRACK.divider],
          named(ZAQ_DIVIDERS),
          (v) => setTrackParam(ZAQ_TRACK.divider, v),
        )}
        {num('shuffle even', t().params[ZAQ_TRACK.shuffleEven], 0, 5, (v) =>
          setTrackParam(ZAQ_TRACK.shuffleEven, v),
        )}
        {num('shuffle odd', t().params[ZAQ_TRACK.shuffleOdd], 0, 5, (v) =>
          setTrackParam(ZAQ_TRACK.shuffleOdd, v),
        )}
      </div>

      <Show when={drum()}>
        <div class="tiny dim device-app-hdr">Drum Grid</div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': `11rem repeat(${ZAQ_STEPS}, 14px)`,
            gap: '2px',
          }}
        >
          <Index each={range(ZAQ_VOICES)}>
            {(v) => (
              <>
                <span class="tiny flex" style={{ gap: '0.3rem' }}>
                  <button
                    class="btn tiny"
                    style={{
                      color: t().params[ZAQ_TRACK.voiceOn + v()]
                        ? '#47d18c'
                        : '#ff5a5f',
                    }}
                    disabled={t().params[ZAQ_TRACK.voiceOn + v()] === undefined}
                    title="voice on / off"
                    onClick={() =>
                      setTrackParam(
                        ZAQ_TRACK.voiceOn + v(),
                        t().params[ZAQ_TRACK.voiceOn + v()] ? 0 : 1,
                      )
                    }
                  >
                    {v() + 1}
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={127}
                    disabled={
                      t().params[ZAQ_TRACK.voiceNote + v()] === undefined
                    }
                    value={t().params[ZAQ_TRACK.voiceNote + v()] ?? ''}
                    style={{ width: '3.4rem' }}
                    onChange={(e) =>
                      setTrackParam(
                        ZAQ_TRACK.voiceNote + v(),
                        Math.max(0, Math.min(127, +e.currentTarget.value | 0)),
                      )
                    }
                  />
                  {zaqNote(t().params[ZAQ_TRACK.voiceNote + v()] ?? 0)}
                </span>
                <Index each={range(ZAQ_STEPS)}>
                  {(s) => {
                    const on = () =>
                      ((t().lanes[LANE_DRUM]?.[s()] ?? 0) >> v()) & 1;
                    return (
                      <button
                        disabled={!t().lanes[LANE_DRUM]}
                        onClick={() => setVoice(s(), v(), !on())}
                        style={{
                          width: '14px',
                          height: '14px',
                          padding: 0,
                          background: on() ? '#ffb608' : '#222',
                          opacity: zaqInWindow(t(), s()) ? 1 : 0.4,
                          border: '1px solid #0008',
                        }}
                      />
                    );
                  }}
                </Index>
              </>
            )}
          </Index>
        </div>
      </Show>

      <div class="tiny dim device-app-hdr">Step Lanes</div>
      <div class="flex wrap">
        <For each={lanes()}>
          {([name, l]) => (
            <button
              class={curLane() === l ? 'btn tiny' : 'btn tiny ghost'}
              onClick={() => setLane(l)}
            >
              {name}
            </button>
          )}
        </For>
        <Show when={!zaqLaneEditable(t(), curLane())}>
          <span class="tiny dim">not editable (ctrl type OFF)</span>
        </Show>
      </div>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': `repeat(${ZAQ_STEPS}, 1fr)`,
          gap: '2px',
          height: `${BAR_H}px`,
          'max-width': '960px',
          cursor: 'ns-resize',
          'touch-action': 'none',
        }}
        onPointerDown={(e) => {
          dragging = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromY(e, e.currentTarget);
        }}
        onPointerMove={(e) => dragging && fromY(e, e.currentTarget)}
        onPointerUp={() => (dragging = false)}
      >
        <Index each={range(ZAQ_STEPS)}>
          {(s) => {
            const v = () => t().lanes[curLane()]?.[s()];
            const frac = () => {
              const [lo, hi] = zaqLaneRange(t(), curLane());
              return v() === undefined ? 0 : (v()! - lo) / (hi - lo || 1);
            };
            return (
              <div
                style={{
                  position: 'relative',
                  background: '#1b1a1a',
                  opacity: zaqInWindow(t(), s()) ? 1 : 0.4,
                  'border-radius': '2px',
                }}
                title={
                  v() === undefined
                    ? ''
                    : `${s() + 1}: ${zaqFormat(curLane(), v()!)}`
                }
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${Math.max(0, Math.min(1, frac())) * 100}%`,
                    background: '#ffb608',
                    'border-radius': '2px',
                  }}
                />
              </div>
            );
          }}
        </Index>
      </div>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': `repeat(${ZAQ_STEPS}, 1fr)`,
          gap: '2px',
          'max-width': '960px',
        }}
      >
        <Index each={range(ZAQ_STEPS)}>
          {(s) => (
            <span
              class="tiny dim"
              style={{ 'text-align': 'center', 'font-size': '9px' }}
            >
              {t().lanes[curLane()]
                ? zaqFormat(curLane(), t().lanes[curLane()]![s()])
                : '..'}
            </span>
          )}
        </Index>
      </div>
      <For
        each={
          [
            ['Step Mute', LANE_MUTE],
            ['Skip', LANE_SKIP],
          ] as [string, number][]
        }
      >
        {([name, l]) => (
          <div
            style={{
              display: 'grid',
              'grid-template-columns': `6rem repeat(${ZAQ_STEPS}, 1fr)`,
              gap: '2px',
              'max-width': 'calc(960px + 6rem)',
            }}
          >
            <span class="tiny dim">{name}</span>
            <Index each={range(ZAQ_STEPS)}>
              {(s) => (
                <button
                  disabled={!t().lanes[l]}
                  onClick={() => setStep(s(), l, t().lanes[l]![s()] ? 0 : 1)}
                  style={{
                    height: '14px',
                    padding: 0,
                    background: t().lanes[l]?.[s()] ? '#ffb608' : '#1b1a1a',
                    opacity: zaqInWindow(t(), s()) ? 1 : 0.4,
                    border: '1px solid #0008',
                  }}
                />
              )}
            </Index>
          </div>
        )}
      </For>

      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
    </div>
  );
}
