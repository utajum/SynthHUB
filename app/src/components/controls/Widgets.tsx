// Reusable form primitives. Every value control supports scroll-wheel
// adjustment, keyboard arrows, and double-click reset to default.
import { For, Show, type JSX } from 'solid-js';

interface BaseProps {
  id?: string;
  label?: string;
  value: number;
  onInput: (v: number) => void;
  disabled?: boolean;
  // value applied on double-click (reset)
  default?: number;
}

const clampStep = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

// one wheel "notch" = one step: accumulate normalized delta and step once per
// threshold, so trackpad momentum never jumps multiple values
let wheelAccum = 0;
let wheelSign = 0;
const WHEEL_NOTCH = 40;

function wheelAdjust(
  e: WheelEvent,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
  disabled?: boolean,
) {
  if (disabled) return;
  e.preventDefault();
  // normalize across deltaMode (0=pixel, 1=line, 2=page)
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 16;
  else if (e.deltaMode === 2) d *= 400;
  const sign = d < 0 ? 1 : -1;
  if (sign !== wheelSign) {
    wheelAccum = 0; // direction changed - start fresh
    wheelSign = sign;
  }
  wheelAccum += Math.abs(d);
  if (wheelAccum < WHEEL_NOTCH) return;
  wheelAccum = 0; // one step per notch, discard the rest (no big jumps)
  const next = clampStep(value + sign * step, min, max);
  if (next !== value) onInput(next);
}

function Field(props: { label?: string; children: JSX.Element; id?: string }) {
  return (
    <label class="field" for={props.id}>
      <Show when={props.label}>
        <span class="lbl">{props.label}</span>
      </Show>
      {props.children}
    </label>
  );
}

export function Dropdown(props: BaseProps & { options: string[] }) {
  return (
    <Field label={props.label} id={props.id}>
      <select
        id={props.id}
        disabled={props.disabled}
        value={String(props.value)}
        title={props.options[props.value]}
        onChange={(e) => props.onInput(Number(e.currentTarget.value))}
        onDblClick={() =>
          props.default !== undefined && props.onInput(props.default)
        }
      >
        <For each={props.options}>
          {(opt, i) => <option value={i()}>{opt}</option>}
        </For>
      </select>
    </Field>
  );
}

export function Toggle(props: BaseProps & { options?: string[] }) {
  const on = () => props.value > 0;
  const labels = () => props.options ?? ['Off', 'On'];
  return (
    <Field label={props.label} id={props.id}>
      <button
        type="button"
        class={`toggle wheelable ${on() ? 'on' : ''}`}
        id={props.id}
        disabled={props.disabled}
        title={on() ? labels()[1] : labels()[0]}
        onClick={() => props.onInput(on() ? 0 : 1)}
        aria-pressed={on()}
      >
        <span class="track">
          <span class="knob" />
        </span>
        <span class="tiny muted">{on() ? labels()[1] : labels()[0]}</span>
      </button>
    </Field>
  );
}

export function Spinbox(
  props: BaseProps & { min?: number; max?: number; suffix?: string },
) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 127;
  // coerce to a finite number once: props.value can arrive as a string and
  // "5" + 1 would concatenate to "51" on the + button
  const cur = () => {
    const n = Number(props.value);
    return Number.isFinite(n) ? n : min();
  };
  const clamp = (v: number) => clampStep(v, min(), max());
  const set = (v: number) => props.onInput(clamp(v));
  return (
    <Field label={props.label} id={props.id}>
      <div
        class="flex wheelable"
        style={{ gap: '0.35rem' }}
        title={`${cur()} (scroll to change, double-click resets)`}
        onWheel={(e) =>
          wheelAdjust(e, cur(), min(), max(), 1, props.onInput, props.disabled)
        }
        onDblClick={() =>
          props.default !== undefined && props.onInput(props.default)
        }
      >
        <button
          type="button"
          class="btn ghost"
          disabled={props.disabled || cur() <= min()}
          onClick={() => set(cur() - 1)}
          aria-label="decrease"
        >
          -
        </button>
        <input
          id={props.id}
          type="number"
          min={min()}
          max={max()}
          disabled={props.disabled}
          value={cur()}
          style={{ 'text-align': 'center' }}
          onInput={(e) => set(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          class="btn ghost"
          disabled={props.disabled || cur() >= max()}
          onClick={() => set(cur() + 1)}
          aria-label="increase"
        >
          +
        </button>
        <Show when={props.suffix}>
          <span class="tiny dim">{props.suffix}</span>
        </Show>
      </div>
    </Field>
  );
}

export function Radio(props: BaseProps & { options: string[] }) {
  return (
    <Field label={props.label} id={props.id}>
      <div class="radio-group" role="radiogroup">
        <For each={props.options}>
          {(opt, i) => (
            <button
              type="button"
              class={props.value === i() ? 'sel' : ''}
              disabled={props.disabled}
              onClick={() => props.onInput(i())}
            >
              {opt}
            </button>
          )}
        </For>
      </div>
    </Field>
  );
}

export function Slider(
  props: BaseProps & { min?: number; max?: number; step?: number },
) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 127;
  const step = () => props.step ?? 1;
  // decimals implied by step (0.1 -> 1), so display is "5.6" not "5.60000001"
  const dp = () => {
    const s = String(step());
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  };
  const shown = () => props.value.toFixed(dp());
  const emit = (v: number) => {
    const p = Math.pow(10, dp());
    props.onInput(Math.round(v * p) / p); // snap to step, kill float drift
  };
  return (
    <Field label={props.label} id={props.id}>
      <div
        class="flex wheelable"
        title={`${shown()} (scroll to change, double-click resets)`}
        onWheel={(e) =>
          wheelAdjust(
            e,
            props.value,
            min(),
            max(),
            step(),
            emit,
            props.disabled,
          )
        }
        onDblClick={() => props.default !== undefined && emit(props.default)}
      >
        <input
          id={props.id}
          type="range"
          min={min()}
          max={max()}
          step={step()}
          value={props.value}
          disabled={props.disabled}
          style={{ flex: '1', 'accent-color': 'var(--acc)' }}
          onInput={(e) => emit(Number(e.currentTarget.value))}
        />
        <span class="pill">{shown()}</span>
      </div>
    </Field>
  );
}
