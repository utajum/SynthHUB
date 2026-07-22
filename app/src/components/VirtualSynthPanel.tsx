// Virtual synth panel: registers the engine as a virtual MIDI output (the
// sequencer + pianos then drive it like hardware) and renders its sound
// knobs + an oscilloscope. Clearly an approximation for fun - the app's job
// is the real hardware.
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { midi } from '../lib/midi/webmidi';
import {
  createVirtualEngine,
  makeVirtualSink,
  virtualId,
  virtualTitle,
  type VirtualEngine,
  type VParam,
} from '../lib/virtualsynth';
import { Icon } from './Icons';

export default function VirtualSynthPanel(props: { slug: string }) {
  const [engine, setEngine] = createSignal<VirtualEngine | null>(null);
  const [vals, setVals] = createSignal<Record<string, number>>({});
  let canvas: HTMLCanvasElement | undefined;

  onMount(() => {
    const eng = createVirtualEngine(props.slug);
    if (!eng) return;
    // capture the id: cleanup must release THIS mount's port even if the
    // surrounding page has already navigated to another slug
    const id = virtualId(props.slug);
    setEngine(eng);
    setVals(Object.fromEntries(eng.params.map((p) => [p.id, eng.get(p.id)])));
    midi.registerVirtualOutput(
      id,
      virtualTitle(props.slug),
      makeVirtualSink(eng),
    );

    // oscilloscope
    let raf = 0;
    const buf = new Uint8Array(eng.analyser.fftSize);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      eng.analyser.getByteTimeDomainData(buf);
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = '#39d353';
      g.lineWidth = 1.5;
      g.beginPath();
      const n = buf.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * c.width;
        const y = (buf[i] / 255) * c.height;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    raf = requestAnimationFrame(draw);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      midi.unregisterVirtualOutput(id);
      eng.dispose();
    });
  });

  const setParam = (p: VParam, v: number) => {
    engine()?.set(p.id, v);
    setVals((old) => ({ ...old, [p.id]: v }));
  };

  const fmt = (p: VParam) => {
    const v = vals()[p.id] ?? p.value;
    if (p.options) return p.options[v] ?? String(v);
    const s =
      p.step < 0.01 ? v.toFixed(3) : p.step < 1 ? v.toFixed(2) : String(v);
    return p.unit ? `${s} ${p.unit}` : s;
  };

  // hold-to-play test notes (independent of the sequencer tab)
  const hold = (note: number, vel: number) => {
    engine()?.noteOn(note, vel);
    const up = () => {
      engine()?.noteOff(note);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointerup', up);
  };

  return (
    <div class="panel virt-panel">
      <header>
        <span>
          <Icon name="piano" size={13} /> {virtualTitle(props.slug)}
        </span>
        <span class="pill amber tiny">in-browser approximation</span>
      </header>
      <div class="body stack">
        <p class="tiny dim">
          A fun Web Audio sketch of the real voice - play it with the Sequencer
          tab (steps, accent, slide, ratchet) and the on-screen / QWERTY keys.
          For the true sound, connect the hardware.
        </p>
        <canvas ref={canvas} class="virt-scope" width="600" height="70" />
        <Show when={engine()}>
          <div class="virt-grid">
            <For each={engine()!.params}>
              {(p) => (
                <Show
                  when={p.options}
                  fallback={
                    <label class="knob-field" title={p.label}>
                      <span class="lbl">
                        {p.label} <span class="hot">{fmt(p)}</span>
                      </span>
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={vals()[p.id] ?? p.value}
                        onInput={(e) => setParam(p, +e.currentTarget.value)}
                      />
                    </label>
                  }
                >
                  <div class="knob-field" title={p.label}>
                    <span class="lbl">{p.label}</span>
                    <div class="flex" style={{ gap: '0.25rem' }}>
                      <For each={p.options}>
                        {(opt, i) => (
                          <button
                            class={`btn tiny ${
                              (vals()[p.id] ?? p.value) === i()
                                ? 'primary'
                                : 'ghost'
                            }`}
                            onClick={() => setParam(p, i())}
                          >
                            {opt}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              )}
            </For>
          </div>
          <div class="flex wrap" style={{ gap: '0.4rem' }}>
            <button class="btn ghost tiny" onPointerDown={() => hold(36, 100)}>
              hold C2
            </button>
            <button class="btn ghost tiny" onPointerDown={() => hold(48, 100)}>
              hold C3
            </button>
            <button class="btn ghost tiny" onPointerDown={() => hold(48, 127)}>
              hold accent
            </button>
            <button
              class="btn ghost tiny"
              onClick={() => engine()?.allOff()}
              title="Silence the virtual synth"
            >
              all off
            </button>
            <span class="tiny dim">
              sequencer + keys on this page now play the virtual synth
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
}
