// Central input validation: one place decides a control's legal range and
// coerces any value (user input, read-back, preset load) into it, so
// out-of-range values never reach the hardware.
import type { SubControl } from './controls';

interface FieldSpec {
  min: number;
  max: number;
  // option count (dropdown/radio) bounds the value to 0..count-1
  optionCount?: number;
}

// legal-value spec for a sub-control; an option list wins over a larger max
function specOf(sub: SubControl): FieldSpec {
  const optionCount = sub.options?.length;
  const min = typeof sub.min === 'number' ? sub.min : 0;
  let max =
    typeof sub.max === 'number' ? sub.max : optionCount ? optionCount - 1 : 127;
  if (optionCount && optionCount - 1 < max) max = optionCount - 1;
  return { min, max, optionCount };
}

// coerce to a finite integer within [min,max]; non-numeric falls back to min
function clampToSpec(value: unknown, spec: FieldSpec): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return spec.min;
  if (n < spec.min) return spec.min;
  if (n > spec.max) return spec.max;
  return n;
}

// clamp a value to a sub-control's legal range
export function clampSub(sub: SubControl, value: unknown): number {
  return clampToSpec(value, specOf(sub));
}
