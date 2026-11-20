// AQ64L light effects (Control Tribe 1.12.4 AQ64LLightEffects): tracks of
// effect chains run on the computer; pad presses on the AQ64L (or a click
// on the grid here) light the pads through the chain. Projects, tracks,
// chains and single effects go to / from .aq64leff / .aq64ltra /
// .aq64lcha / .aq64ldev files.
import {
  For,
  Index,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import { saveFile } from '../lib/midi/port-io';
import { actions } from '../lib/store-solid';
import { aqLightFrames, aqProgramMode } from '../devices/_shared/aq64l';
import {
  FX_ENUMS,
  FX_FILES,
  FX_NAMES,
  FX_STEPS,
  FxEngine,
  fxFrom24,
  fxFromFile,
  fxIndexToLed,
  fxMake,
  fxMidiToIndex,
  fxName,
  fxProject,
  fxTo24,
  fxToFile,
  pack,
  type FxDevice,
  type FxFrame,
  type FxOffset,
  type FxProject,
  type FxTime,
  type FxTrack,
} from '../devices/_shared/aq64l-fx';

const hex = (c: number) => `#${fxTo24(c).toString(16).padStart(6, '0')}`;
const unhex = (s: string) => fxFrom24(parseInt(s.slice(1), 16));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
type Step = { d: number; k: 'chain' | 'preprocess' | number };
type Field =
  | [string, string, 'bool' | 'time' | 'color' | 'offset']
  | [string, string, 'int' | 'float', number, number]
  | [string, string, 'enum', string[]];

// editable params per effect (the rest has its own editor)
const FIELDS: Record<string, Field[]> = {
  pattern: [
    ['mode', 'mode', 'enum', FX_ENUMS.patternMode],
    ['repeats', 'repeats', 'int', 1, 128],
    ['gate', 'gate', 'float', 0.01, 4],
    ['pinch', 'pinch', 'float', -2, 2],
    ['bilateral', 'bilateral', 'bool'],
    ['infinite', 'infinite', 'bool'],
    ['rootKey', 'root key', 'int', -1, 100],
    ['wrap', 'wrap', 'bool'],
  ],
  fade: [
    ['time', 'time', 'time'],
    ['gate', 'gate', 'float', 0.01, 4],
    ['playMode', 'mode', 'enum', FX_ENUMS.fadeMode],
  ],
  tone: [
    ['hue', 'hue', 'float', -180, 180],
    ['satHigh', 'sat hi', 'float', 0, 1],
    ['satLow', 'sat lo', 'float', 0, 1],
    ['valHigh', 'val hi', 'float', 0, 1],
    ['valLow', 'val lo', 'float', 0, 1],
  ],
  paint: [['color', 'colour', 'color']],
  colorfilter: [
    ['hue', 'hue', 'float', -180, 180],
    ['saturation', 'sat', 'float', 0, 1],
    ['value', 'val', 'float', 0, 1],
    ['hueT', 'hue tol', 'float', 0, 1],
    ['satT', 'sat tol', 'float', 0, 1],
    ['valT', 'val tol', 'float', 0, 1],
  ],
  move: [
    ['offset', 'offset', 'offset'],
    ['grid', 'grid', 'enum', FX_ENUMS.grid],
    ['wrap', 'wrap', 'bool'],
  ],
  flip: [
    ['mode', 'mode', 'enum', FX_ENUMS.flip],
    ['bypass', 'bypass', 'bool'],
  ],
  rotate: [
    ['mode', 'mode', 'enum', FX_ENUMS.rotate],
    ['bypass', 'bypass', 'bool'],
  ],
  copy: [
    ['copyMode', 'mode', 'enum', FX_ENUMS.copyMode],
    ['time', 'rate', 'time'],
    ['gate', 'gate', 'float', 0.01, 4],
    ['pinch', 'pinch', 'float', -2, 2],
    ['bilateral', 'bilateral', 'bool'],
    ['reverse', 'reverse', 'bool'],
    ['infinite', 'infinite', 'bool'],
    ['grid', 'grid', 'enum', FX_ENUMS.grid],
    ['wrap', 'wrap', 'bool'],
  ],
  layerfilter: [
    ['target', 'target', 'int', -100, 100],
    ['range', 'range', 'int', 0, 100],
  ],
  macrofilter: [['macro', 'macro', 'int', 1, 4]],
  layer: [
    ['target', 'target', 'int', -100, 100],
    ['blending', 'blend', 'enum', FX_ENUMS.blending],
    ['range', 'range', 'int', 1, 200],
  ],
  multi: [['mode', 'mode', 'enum', FX_ENUMS.multiMode]],
  switch: [
    ['target', 'macro', 'int', 1, 4],
    ['value', 'value', 'int', 1, 100],
  ],
  output: [['target', 'target', 'int', -1, 15]],
  delay: [
    ['time', 'time', 'time'],
    ['gate', 'gate', 'float', 0.01, 4],
  ],
  loop: [
    ['rate', 'rate', 'time'],
    ['gate', 'gate', 'float', 0.01, 4],
    ['repeats', 'repeats', 'int', 1, 128],
    ['hold', 'hold (repeat while held)', 'bool'],
  ],
  hold: [
    ['time', 'time', 'time'],
    ['gate', 'gate', 'float', 0.01, 4],
    ['holdMode', 'mode', 'enum', FX_ENUMS.holdMode],
    ['release', 'release (react on note-off)', 'bool'],
  ],
  choke: [['target', 'target', 'int', 1, 16]],
  clear: [['mode', 'mode', 'enum', FX_ENUMS.clear]],
};

const lbl = (text: string, el: JSX.Element) => (
  <label class="tiny flex" style={{ gap: '0.3rem' }}>
    {text}
    {el}
  </label>
);
const numIn = (
  v: number,
  lo: number,
  hi: number,
  step: number,
  set: (v: number) => void,
) => (
  <input
    type="number"
    min={lo}
    max={hi}
    step={step}
    value={v}
    style={{ width: '4.4rem' }}
    onChange={(e) =>
      set(Math.max(lo, Math.min(hi, +e.currentTarget.value || 0)))
    }
  />
);
const selIn = (v: number, opts: string[], set: (v: number) => void) => (
  <select onChange={(e) => set(+e.currentTarget.value)}>
    <For each={opts}>
      {(o, i) => (
        <option value={i()} selected={i() === v}>
          {o}
        </option>
      )}
    </For>
  </select>
);
const timeIn = (t: FxTime, set: (t: FxTime) => void) => (
  <span class="flex" style={{ gap: '0.2rem' }}>
    {selIn(t.mode ? 1 : 0, ['ms', 'sync'], (v) => set({ ...t, mode: v === 1 }))}
    {t.mode
      ? selIn(t.step, FX_STEPS, (v) => set({ ...t, step: v }))
      : numIn(t.free, 1, 30000, 1, (v) => set({ ...t, free: Math.round(v) }))}
  </span>
);
const offsetIn = (o: FxOffset, set: (o: FxOffset) => void) => (
  <span class="flex" style={{ gap: '0.2rem' }}>
    {selIn(o.abs ? 1 : 0, ['relative', 'absolute'], (v) =>
      set({ ...o, abs: v === 1 }),
    )}
    {o.abs ? 'x' : 'dx'}
    {numIn(o.abs ? o.ax : o.x, -9, 9, 1, (v) =>
      set(o.abs ? { ...o, ax: v } : { ...o, x: v }),
    )}
    {o.abs ? 'y' : 'dy'}
    {numIn(o.abs ? o.ay : o.y, -9, 9, 1, (v) =>
      set(o.abs ? { ...o, ay: v } : { ...o, y: v }),
    )}
  </span>
);
const toggles = (
  vals: boolean[],
  cols: number,
  label: (i: number) => string,
  set: (i: number) => void,
) => (
  <div
    style={{
      display: 'grid',
      'grid-template-columns': `repeat(${cols}, 22px)`,
      gap: '2px',
    }}
  >
    <Index each={vals}>
      {(v, i) => (
        <button
          title={label(i)}
          onClick={() => set(i)}
          style={{
            height: '18px',
            padding: 0,
            background: v() ? '#ffb608' : '#1b1a1a',
            border: '1px solid #0008',
            'font-size': '8px',
            color: '#9a9898',
          }}
        >
          {label(i)}
        </button>
      )}
    </Index>
  </div>
);

export default function Aq64lLight(props: {
  outputId: () => string | undefined;
}) {
  const [project, setProject] = createSignal<FxProject>(fxProject());
  const [track, setTrack] = createSignal(0);
  const [path, setPath] = createSignal<Step[]>([]);
  const [sel, setSel] = createSignal<number | null>(null);
  const [frame, setFrame] = createSignal(0);
  const [brush, setBrush] = createSignal(0x3f0000);
  const [screen, setScreen] = createSignal<number[]>(Array(101).fill(0));
  const [status, setStatus] = createSignal('');
  const engine = new FxEngine(project());

  // screen -> AQ64L LEDs, at most every 20 ms
  let shown: number[] | null = null;
  let pending = false;
  engine.ctx.screen.onChange = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      setScreen(range(101).map((i) => pack(engine.ctx.screen.color(i))));
      const leds = engine.leds();
      const out = props.outputId();
      if (out) for (const f of aqLightFrames(leds, shown)) midi.send(out, f);
      shown = leds;
    }, 20);
  };
  const reload = (p: FxProject) => {
    setProject(p);
    engine.load(p);
  };
  onMount(() => {
    const out = props.outputId();
    if (out) midi.send(out, aqProgramMode(true));
    actions().pushLog({
      dir: 'out',
      text: 'AQ64L: Light FX: enter program mode',
    });
  });
  onCleanup(
    midi.onMessage((d) => {
      const m = fxMidiToIndex(d);
      if (m) engine.input(m[0], m[1]);
    }),
  );
  onCleanup(() => engine.stop());

  // edit the project; the chain at `path` of the selected track
  const edit = (fn: (p: FxProject) => void) => {
    const p = structuredClone(project());
    fn(p);
    reload(p);
  };
  const chainAt = (p: FxProject, ps = path()): FxDevice[] => {
    let c = p.tracks[track()]?.chain ?? [];
    for (const s of ps) {
      const d = c[s.d];
      if (!d) return [];
      c = (
        typeof s.k === 'number' ? (d.chains as FxDevice[][])[s.k] : d[s.k]
      ) as FxDevice[];
    }
    return c ?? [];
  };
  const editChain = (fn: (c: FxDevice[]) => void) =>
    edit((p) => fn(chainAt(p)));
  const editDev = (i: number, fn: (d: FxDevice) => void) =>
    editChain((c) => fn(c[i]));
  const setField = (i: number, k: string, v: unknown) =>
    editDev(i, (d) => void (d[k] = v));

  const files = (
    kind: keyof typeof FX_FILES,
    get: () => unknown,
    name: string,
    put: (v: unknown) => void,
  ) => {
    let input!: HTMLInputElement;
    const { ext } = FX_FILES[kind];
    return (
      <>
        <button
          class="btn tiny ghost"
          onClick={() => saveFile(`${name}.${ext}`, fxToFile(kind, get()))}
        >
          export .{ext}
        </button>
        <input
          ref={input}
          type="file"
          accept={`.${ext}`}
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            const r = fxFromFile(kind, await f.text());
            if (typeof r === 'string')
              return setStatus(`Cannot import ${f.name}. ${r}`);
            put(r);
            setStatus(`imported ${f.name}`);
          }}
        />
        <button class="btn tiny ghost" onClick={() => input.click()}>
          import .{ext}
        </button>
      </>
    );
  };

  const fieldEl = (i: number, d: FxDevice, f: Field) => {
    const [k, label, kind] = f;
    const v = d[k];
    if (kind === 'bool')
      return lbl(
        label,
        <input
          type="checkbox"
          checked={!!v}
          onChange={(e) => setField(i, k, e.currentTarget.checked)}
        />,
      );
    if (kind === 'time')
      return lbl(
        label,
        timeIn(v as FxTime, (t) => setField(i, k, t)),
      );
    if (kind === 'color')
      return lbl(
        label,
        <input
          type="color"
          value={hex(v as number)}
          onChange={(e) => setField(i, k, unhex(e.currentTarget.value))}
        />,
      );
    if (kind === 'offset')
      return lbl(
        label,
        offsetIn(v as FxOffset, (o) => setField(i, k, o)),
      );
    if (kind === 'enum')
      return lbl(
        label,
        selIn(v as number, f[3] as string[], (x) => setField(i, k, x)),
      );
    const [lo, hi] = [f[3] as number, f[4] as number];
    return lbl(
      label,
      numIn(v as number, lo, hi, kind === 'int' ? 1 : 0.01, (x) =>
        setField(i, k, kind === 'int' ? Math.round(x) : x),
      ),
    );
  };

  // the parts with their own editor
  const extra = (i: number, d: FxDevice) => {
    if (d.type === 'keyfilter')
      return toggles(
        d.filter as boolean[],
        10,
        (j) => `${j}`,
        (j) =>
          editDev(
            i,
            (x) =>
              void ((x.filter as boolean[])[j] = !(x.filter as boolean[])[j]),
          ),
      );
    if (d.type === 'macrofilter')
      return toggles(
        d.filter as boolean[],
        10,
        (j) => `${j + 1}`,
        (j) =>
          editDev(
            i,
            (x) =>
              void ((x.filter as boolean[])[j] = !(x.filter as boolean[])[j]),
          ),
      );
    if (d.type === 'refresh')
      return toggles(
        d.macros as boolean[],
        4,
        (j) => `M${j + 1}`,
        (j) =>
          editDev(
            i,
            (x) =>
              void ((x.macros as boolean[])[j] = !(x.macros as boolean[])[j]),
          ),
      );
    if (d.type === 'copy')
      return (
        <div class="stack">
          <For each={d.offsets as FxOffset[]}>
            {(o, j) => (
              <div class="flex wrap">
                {lbl(
                  `offset ${j() + 1}`,
                  offsetIn(o, (n) =>
                    editDev(
                      i,
                      (x) => void ((x.offsets as FxOffset[])[j()] = n),
                    ),
                  ),
                )}
                {lbl(
                  'angle',
                  numIn(
                    Number((d.angles as number[])[j()] ?? 0),
                    -90,
                    90,
                    1,
                    (n) =>
                      editDev(i, (x) => void ((x.angles as number[])[j()] = n)),
                  ),
                )}
                <button
                  class="btn tiny ghost"
                  onClick={() =>
                    editDev(i, (x) => {
                      (x.offsets as FxOffset[]).splice(j(), 1);
                      (x.angles as number[]).splice(j(), 1);
                    })
                  }
                >
                  remove
                </button>
              </div>
            )}
          </For>
          <button
            class="btn tiny ghost"
            onClick={() =>
              editDev(i, (x) => {
                (x.offsets as FxOffset[]).push({
                  x: 1,
                  y: 0,
                  abs: false,
                  ax: 5,
                  ay: 5,
                });
                (x.angles as number[]).push(0);
              })
            }
          >
            add offset
          </button>
        </div>
      );
    if (d.type === 'fade')
      return (
        <div class="stack">
          <For each={d.colors as number[]}>
            {(c, j) => (
              <div class="flex wrap">
                {lbl(
                  `stop ${j() + 1}`,
                  <input
                    type="color"
                    value={hex(c)}
                    onChange={(e) =>
                      editDev(
                        i,
                        (x) =>
                          void ((x.colors as number[])[j()] = unhex(
                            e.currentTarget.value,
                          )),
                      )
                    }
                  />,
                )}
                {lbl(
                  'position',
                  numIn((d.positions as number[])[j()], 0, 1, 0.01, (n) =>
                    editDev(
                      i,
                      (x) => void ((x.positions as number[])[j()] = n),
                    ),
                  ),
                )}
                <Show when={j() < (d.colors as number[]).length - 1}>
                  {lbl(
                    'fade',
                    selIn(
                      (d.types as number[])[j()] ?? 0,
                      FX_ENUMS.fadeType,
                      (n) =>
                        editDev(
                          i,
                          (x) => void ((x.types as number[])[j()] = n),
                        ),
                    ),
                  )}
                </Show>
                <Show when={(d.colors as number[]).length > 2}>
                  <button
                    class="btn tiny ghost"
                    onClick={() =>
                      editDev(i, (x) => {
                        (x.colors as number[]).splice(j(), 1);
                        (x.positions as number[]).splice(j(), 1);
                        (x.types as number[]).splice(
                          Math.min(j(), (x.types as number[]).length - 1),
                          1,
                        );
                      })
                    }
                  >
                    remove
                  </button>
                </Show>
              </div>
            )}
          </For>
          <button
            class="btn tiny ghost"
            onClick={() =>
              editDev(i, (x) => {
                const n = (x.colors as number[]).length;
                (x.colors as number[]).splice(n - 1, 0, 0x3f3f3f);
                (x.positions as number[]).splice(n - 1, 0, 0.5);
                (x.types as number[]).push(0);
              })
            }
          >
            add stop
          </button>
        </div>
      );
    if (d.type === 'pattern') {
      const frames = () => d.frames as FxFrame[];
      const fi = () => Math.min(frame(), frames().length - 1);
      const cur = () => frames()[fi()];
      const paint = (j: number) =>
        editDev(i, (x) => {
          const s = (x.frames as FxFrame[])[fi()].screen;
          s[j] = s[j] === brush() ? 0 : brush();
        });
      return (
        <div class="stack">
          <div class="flex wrap">
            {lbl(
              'frame',
              selIn(
                fi(),
                frames().map((_, j) => `${j + 1}`),
                setFrame,
              ),
            )}
            {lbl(
              'time',
              timeIn(cur().time, (t) =>
                editDev(
                  i,
                  (x) => void ((x.frames as FxFrame[])[fi()].time = t),
                ),
              ),
            )}
            {lbl(
              'colour',
              <input
                type="color"
                value={hex(brush())}
                onInput={(e) => setBrush(unhex(e.currentTarget.value))}
              />,
            )}
            <button
              class="btn tiny ghost"
              onClick={() => {
                editDev(
                  i,
                  (x) =>
                    void (x.frames as FxFrame[]).splice(
                      fi() + 1,
                      0,
                      structuredClone(cur()),
                    ),
                );
                setFrame(fi() + 1);
              }}
            >
              duplicate
            </button>
            <button
              class="btn tiny ghost"
              onClick={() => {
                editDev(
                  i,
                  (x) =>
                    void (x.frames as FxFrame[]).splice(fi() + 1, 0, {
                      time: { ...cur().time },
                      screen: Array(101).fill(0),
                    }),
                );
                setFrame(fi() + 1);
              }}
            >
              new frame
            </button>
            <button
              class="btn tiny ghost"
              disabled={frames().length < 2}
              onClick={() => {
                editDev(i, (x) => void (x.frames as FxFrame[]).splice(fi(), 1));
                setFrame(Math.max(0, fi() - 1));
              }}
            >
              delete frame
            </button>
          </div>
          <Grid colors={cur().screen} onDown={paint} />
        </div>
      );
    }
    const nested: [string, Step['k']][] =
      d.type === 'choke'
        ? [['chain', 'chain']]
        : d.type === 'multi'
          ? [
              ['preprocess', 'preprocess'],
              ...(d.chains as FxDevice[][]).map((_, j): [string, number] => [
                `chain ${j + 1}`,
                j,
              ]),
            ]
          : d.type === 'group'
            ? (d.chains as FxDevice[][]).map((_, j): [string, number] => [
                `chain ${j + 1}`,
                j,
              ])
            : [];
    if (!nested.length && d.type !== 'group' && d.type !== 'multi') return null;
    return (
      <div class="flex wrap">
        <For each={nested}>
          {([n, k]) => (
            <button
              class="btn tiny"
              onClick={() => {
                setPath([...path(), { d: i, k }]);
                setSel(null);
              }}
            >
              open {n}
            </button>
          )}
        </For>
        <Show when={d.type === 'group' || d.type === 'multi'}>
          <button
            class="btn tiny ghost"
            onClick={() =>
              editDev(i, (x) => void (x.chains as FxDevice[][]).push([]))
            }
          >
            add chain
          </button>
          <button
            class="btn tiny ghost"
            disabled={!(d.chains as FxDevice[][]).length}
            onClick={() =>
              editDev(i, (x) => void (x.chains as FxDevice[][]).pop())
            }
          >
            remove last chain
          </button>
        </Show>
      </div>
    );
  };

  const t = (): FxTrack | undefined => project().tracks[track()];
  const chain = () => chainAt(project());
  let addSel!: HTMLSelectElement;

  return (
    <div class="stack">
      <div class="flex wrap">
        {lbl(
          'BPM',
          numIn(project().bpm, 1, 999, 1, (v) =>
            edit((p) => void (p.bpm = Math.round(v))),
          ),
        )}
        <For each={range(4)}>
          {(m) =>
            lbl(
              `M${m + 1}`,
              numIn(project().macros[m], 1, 100, 1, (v) =>
                edit((p) => void (p.macros[m] = Math.round(v))),
              ),
            )
          }
        </For>
        {files('effect', project, 'AQ64L Light Effect', (v) => {
          reload(v as FxProject);
          setTrack(0);
          setPath([]);
        })}
        <button
          class="btn tiny ghost"
          onClick={() => {
            reload(fxProject());
            setTrack(0);
            setPath([]);
          }}
        >
          new
        </button>
        <button class="btn tiny ghost" onClick={() => engine.stop()}>
          all off
        </button>
      </div>

      <div class="flex wrap">
        <For each={project().tracks}>
          {(tr, i) => (
            <button
              class={track() === i() ? 'btn tiny' : 'btn tiny ghost'}
              style={{ opacity: tr.enabled ? 1 : 0.5 }}
              onClick={() => {
                setTrack(i());
                setPath([]);
                setSel(null);
              }}
            >
              {tr.name}
            </button>
          )}
        </For>
        <button
          class="btn tiny ghost"
          onClick={() =>
            edit(
              (p) =>
                void p.tracks.push({
                  name: `Track ${p.tracks.length + 1}`,
                  enabled: true,
                  chain: [],
                }),
            )
          }
        >
          add track
        </button>
        <Show when={t()}>
          {(tr) => (
            <>
              <input
                type="text"
                value={tr().name}
                style={{ width: '8rem' }}
                onChange={(e) =>
                  edit(
                    (p) =>
                      void (p.tracks[track()].name = e.currentTarget.value),
                  )
                }
              />
              {lbl(
                'on',
                <input
                  type="checkbox"
                  checked={tr().enabled}
                  onChange={(e) =>
                    edit(
                      (p) =>
                        void (p.tracks[track()].enabled =
                          e.currentTarget.checked),
                    )
                  }
                />,
              )}
              <button
                class="btn tiny ghost"
                onClick={() => {
                  edit((p) => void p.tracks.splice(track(), 1));
                  setTrack(0);
                  setPath([]);
                }}
              >
                remove track
              </button>
              {files(
                'track',
                () => tr(),
                tr().name,
                (v) =>
                  edit(
                    (p) => void p.tracks.splice(track() + 1, 0, v as FxTrack),
                  ),
              )}
            </>
          )}
        </Show>
      </div>

      <div
        class="flex wrap"
        style={{ 'align-items': 'flex-start', gap: '1rem' }}
      >
        <div class="stack">
          <span class="tiny dim">pads (click to play)</span>
          <Grid
            colors={screen()}
            onDown={(i) => engine.input(i, 127)}
            onUp={(i) => engine.input(i, 0)}
          />
        </div>
        <div class="stack" style={{ flex: 1, 'min-width': '22rem' }}>
          <div class="flex wrap">
            <button
              class="btn tiny ghost"
              disabled={!path().length}
              onClick={() => {
                setPath(path().slice(0, -1));
                setSel(null);
              }}
            >
              up
            </button>
            <span class="tiny hot">
              {t()?.name ?? '-'}
              {path()
                .map(
                  (s) =>
                    ` / ${fxName(chainAt(project(), path().slice(0, path().indexOf(s)))[s.d])} ${typeof s.k === 'number' ? `chain ${s.k + 1}` : s.k}`,
                )
                .join('')}
            </span>
            {files('chain', chain, 'AQ64L Chain', (v) =>
              editChain(
                (c) => void c.splice(0, c.length, ...(v as FxDevice[])),
              ),
            )}
          </div>
          <For each={chain()}>
            {(d, i) => (
              <div
                class="stack"
                style={{
                  border: '1px solid #ffffff18',
                  padding: '4px',
                  'border-radius': '4px',
                  opacity: d.enabled ? 1 : 0.55,
                }}
              >
                <div class="flex wrap">
                  <button
                    class={sel() === i() ? 'btn tiny' : 'btn tiny ghost'}
                    onClick={() => setSel(sel() === i() ? null : i())}
                  >
                    {i() + 1}. {fxName(d)}
                  </button>
                  {lbl(
                    'on',
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) =>
                        setField(i(), 'enabled', e.currentTarget.checked)
                      }
                    />,
                  )}
                  <button
                    class="btn tiny ghost"
                    disabled={i() === 0}
                    onClick={() =>
                      editChain(
                        (c) => void c.splice(i() - 1, 0, ...c.splice(i(), 1)),
                      )
                    }
                  >
                    up
                  </button>
                  <button
                    class="btn tiny ghost"
                    disabled={i() === chain().length - 1}
                    onClick={() =>
                      editChain(
                        (c) => void c.splice(i() + 1, 0, ...c.splice(i(), 1)),
                      )
                    }
                  >
                    down
                  </button>
                  <button
                    class="btn tiny ghost"
                    onClick={() =>
                      editChain(
                        (c) =>
                          void c.splice(i() + 1, 0, structuredClone(c[i()])),
                      )
                    }
                  >
                    duplicate
                  </button>
                  <button
                    class="btn tiny ghost"
                    onClick={() => {
                      editChain((c) => void c.splice(i(), 1));
                      setSel(null);
                    }}
                  >
                    delete
                  </button>
                  {files(
                    'device',
                    () => d,
                    fxName(d),
                    (v) =>
                      editChain(
                        (c) => void c.splice(i() + 1, 0, v as FxDevice),
                      ),
                  )}
                </div>
                <Show when={sel() === i()}>
                  <div class="flex wrap">
                    <For each={FIELDS[d.type] ?? []}>
                      {(f) => fieldEl(i(), d, f)}
                    </For>
                  </div>
                  {extra(i(), d)}
                </Show>
              </div>
            )}
          </For>
          <div class="flex wrap">
            <select ref={addSel}>
              <For each={FX_NAMES}>{(n) => <option value={n}>{n}</option>}</For>
            </select>
            <button
              class="btn tiny"
              onClick={() => {
                editChain((c) => void c.push(fxMake(addSel.value)));
                setSel(chain().length - 1);
              }}
            >
              add effect
            </button>
          </div>
        </div>
      </div>
      <Show when={status()}>
        <span class="tiny dim">{status()}</span>
      </Show>
    </div>
  );
}

// 10 x 10 signal grid (index = x + y * 10, 100 = the mode light); cells
// without an AQ64L LED are dim
function Grid(props: {
  colors: number[];
  onDown: (i: number) => void;
  onUp?: (i: number) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': 'repeat(10, 24px)',
        gap: '2px',
      }}
    >
      <Index each={range(100)}>
        {(_, i) => (
          <button
            title={`${i}`}
            onPointerDown={() => props.onDown(i)}
            onPointerUp={() => props.onUp?.(i)}
            onPointerLeave={(e) => e.buttons && props.onUp?.(i)}
            style={{
              width: '24px',
              height: '24px',
              padding: 0,
              background: props.colors[i] ? hex(props.colors[i]) : '#222',
              opacity: fxIndexToLed(i) === null ? 0.35 : 1,
              border: '1px solid #0008',
              'border-radius': '3px',
            }}
          />
        )}
      </Index>
    </div>
  );
}
