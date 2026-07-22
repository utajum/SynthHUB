// Generative tools bar: euclidean gates, scale-quantized random melody,
// evolve (mutate) and humanize. Melody is mono-only; euclid targets the
// selected drum row in drum mode.
import { For, Show, createSignal } from 'solid-js';
import { Sequencer, type SequencerState } from '../lib/sequencer';
import { SCALES, ROOT_NAMES, scaleById } from '../lib/scales';
import {
  euclid,
  gatesToMono,
  gatesToRow,
  randomMelody,
  evolveMono,
  evolveRow,
  humanizeMono,
  humanizeRow,
} from '../lib/generative';
import { Icon } from './Icons';

interface Props {
  engine: Sequencer;
  state: () => SequencerState;
  isDrum: () => boolean;
  selRow: () => number;
}

export default function GenerativeBar(props: Props) {
  const [scaleId, setScaleId] = createSignal('min-pent');
  const [root, setRoot] = createSignal(0);
  const [baseOct, setBaseOct] = createSignal(2);
  const [octaves, setOctaves] = createSignal(2);
  const [density, setDensity] = createSignal(65);
  const [pulses, setPulses] = createSignal(4);
  const [rotate, setRotate] = createSignal(0);
  const [amount, setAmount] = createSignal(30);

  const len = () => props.state().length;
  const rowName = () =>
    props.state().rows[props.selRow()]?.label ?? `row ${props.selRow() + 1}`;

  const doEuclid = () => {
    const mask = euclid(Math.min(pulses(), len()), len(), rotate());
    if (props.isDrum()) {
      props.engine.applyRow(props.selRow(), gatesToRow(mask, len()));
    } else {
      props.engine.applyMono(gatesToMono(mask, len()));
    }
  };

  const doMelody = () => {
    props.engine.applyMono(
      randomMelody(len(), props.state().maxSteps, {
        scale: scaleById(scaleId()),
        root: root(),
        baseOctave: baseOct(),
        octaves: octaves(),
        density: density() / 100,
        rest: true,
      }),
    );
  };

  const doEvolve = () => {
    const a = amount() / 100;
    if (props.isDrum()) {
      props.state().rows.forEach((_, r) => {
        props.engine.applyRow(r, evolveRow(props.state().drum[r], len(), a));
      });
    } else {
      props.engine.applyMono(
        evolveMono(props.state().steps, len(), a, scaleById(scaleId()), root()),
      );
    }
  };

  const doHumanize = () => {
    const a = amount() / 100;
    if (props.isDrum()) {
      props.state().rows.forEach((_, r) => {
        props.engine.applyRow(r, humanizeRow(props.state().drum[r], len(), a));
      });
    } else {
      props.engine.applyMono(humanizeMono(props.state().steps, len(), a));
    }
  };

  return (
    <div class="rec-bar panel">
      <div class="body flex wrap" style={{ 'align-items': 'flex-end' }}>
        <span class="tiny hot">
          <Icon name="wand" size={13} /> GENERATE
        </span>

        <label class="knob-field" title="Scale" style={{ width: 'auto' }}>
          <span class="lbl">scale</span>
          <select
            value={scaleId()}
            onChange={(e) => setScaleId(e.currentTarget.value)}
          >
            <For each={SCALES}>
              {(s) => <option value={s.id}>{s.name}</option>}
            </For>
          </select>
        </label>
        <label class="knob-field" title="Root note" style={{ width: '58px' }}>
          <span class="lbl">root</span>
          <select
            value={root()}
            onChange={(e) => setRoot(+e.currentTarget.value)}
          >
            <For each={ROOT_NAMES}>
              {(n, i) => <option value={i()}>{n}</option>}
            </For>
          </select>
        </label>

        <Show when={!props.isDrum()}>
          <label
            class="knob-field"
            title="Base octave"
            style={{ width: '58px' }}
          >
            <span class="lbl">oct {baseOct()}</span>
            <input
              type="range"
              min="0"
              max="6"
              value={baseOct()}
              onInput={(e) => setBaseOct(+e.currentTarget.value)}
            />
          </label>
          <label
            class="knob-field"
            title="Octave range"
            style={{ width: '58px' }}
          >
            <span class="lbl">range {octaves()}</span>
            <input
              type="range"
              min="1"
              max="4"
              value={octaves()}
              onInput={(e) => setOctaves(+e.currentTarget.value)}
            />
          </label>
          <label class="knob-field" title="Note density">
            <span class="lbl">density {density()}%</span>
            <input
              type="range"
              min="10"
              max="100"
              value={density()}
              onInput={(e) => setDensity(+e.currentTarget.value)}
            />
          </label>
          <button
            class="btn icon-btn tiny"
            onClick={doMelody}
            title="Random melody in the selected scale"
          >
            <Icon name="wand" /> MELODY
          </button>
        </Show>

        <span class="seq-div" />

        <label
          class="knob-field"
          title="Euclidean pulses"
          style={{ width: '70px' }}
        >
          <span class="lbl">pulses {Math.min(pulses(), len())}</span>
          <input
            type="range"
            min="1"
            max={len()}
            value={Math.min(pulses(), len())}
            onInput={(e) => setPulses(+e.currentTarget.value)}
          />
        </label>
        <label
          class="knob-field"
          title="Euclidean rotation"
          style={{ width: '70px' }}
        >
          <span class="lbl">rot {rotate()}</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, len() - 1)}
            value={Math.min(rotate(), len() - 1)}
            onInput={(e) => setRotate(+e.currentTarget.value)}
          />
        </label>
        <button
          class="btn icon-btn tiny"
          onClick={doEuclid}
          title={
            props.isDrum()
              ? `Euclidean gates on ${rowName()} (click a cell to pick the row)`
              : 'Euclidean gate pattern'
          }
        >
          <Icon name="ratchet" /> EUCLID
          <Show when={props.isDrum()}>
            <span class="dim tiny">@{rowName()}</span>
          </Show>
        </button>

        <span class="seq-div" />

        <label
          class="knob-field"
          title="Mutation / humanize amount"
          style={{ width: '80px' }}
        >
          <span class="lbl">amt {amount()}%</span>
          <input
            type="range"
            min="5"
            max="100"
            value={amount()}
            onInput={(e) => setAmount(+e.currentTarget.value)}
          />
        </label>
        <button
          class="btn icon-btn tiny"
          onClick={doEvolve}
          title="Mutate the pattern (gates + scale-aware notes)"
        >
          <Icon name="random" /> EVOLVE
        </button>
        <button
          class="btn icon-btn tiny"
          onClick={doHumanize}
          title="Humanize velocity / gate / probability"
        >
          <Icon name="velocity" /> HUMANIZE
        </button>
      </div>
    </div>
  );
}
