// Setting -> renderable sub-control decomposition. Simple settings are one
// value; composites pack several values via index<suffix>/default<suffix>
// pairs (channel, clock, midithrough, ...). Everything becomes a flat
// SubControl list so one data-driven renderer handles every device.
import type { DeviceSetting } from '../../lib/types';

export interface SubControl {
  // unique-within-setting id (the index suffix, or 'value')
  id: string;
  label: string;
  kind: 'dropdown' | 'toggle' | 'spinbox' | 'radio' | 'slider';
  options?: string[];
  min?: number;
  max?: number;
  // increment for sliders/spinboxes (GuitarTribe knobs use 0.1)
  step?: number;
  offset?: number;
  default: number;
  // raw SynthTribe field index (parameter position), when present
  index?: number | string;
  // index -> wire-value lookup for key_value settings: option i sends
  // valueMap[i] on the wire, not the row index; read-back reverses it
  valueMap?: number[];
}

const YESNO = ['Off', 'On'];

// label + option-source hints for known composite suffixes
const SUFFIX: Record<
  string,
  { label: string; opts?: string; toggle?: boolean; fixedOpts?: string[] }
> = {
  in: { label: 'MIDI In Ch', opts: 'inlist' },
  out: { label: 'MIDI Out Ch', opts: 'outlist' },
  usbin: { label: 'USB In Ch', opts: 'inlist' },
  usbout: { label: 'USB Out Ch', opts: 'outlist' },
  usb: { label: 'USB Ch', opts: 'inlist' },
  din: { label: 'DIN Ch', opts: 'inlist' },
  source: { label: 'Clock Source', opts: 'clocklabel' },
  // clock rate/polarity are fixed enumerations hard-coded by the app; without
  // them the widget would be an unbounded 0-127 spinbox
  rate: {
    label: 'Clock Rate',
    fixedOpts: ['1 PPS', '2 PPQ', '24 PPQ', '48 PPQ'],
  },
  division: { label: 'Clock Division', opts: 'clockdivision' },
  polarity: {
    label: 'Polarity',
    opts: 'polarity_label',
    fixedOpts: ['Rise', 'Fall'],
  },
  inpolarity: {
    label: 'In Polarity',
    opts: 'polarity_label',
    fixedOpts: ['Rise', 'Fall'],
  },
  outpolarity: {
    label: 'Out Polarity',
    opts: 'polarity_label',
    fixedOpts: ['Rise', 'Fall'],
  },
  m2u: { label: 'MIDI -> USB', toggle: true },
  u2m: { label: 'USB -> MIDI', toggle: true },
  mst: { label: 'MIDI -> Thru', toggle: true },
  onconstant: { label: 'On Velocity', toggle: true },
  offconstant: { label: 'Off Velocity', toggle: true },
  // fixed 3-option combobox; the wire byte is the selected index
  curve: { label: 'Velocity Curve', fixedOpts: ['Soft', 'Medium', 'Hard'] },
  mode: { label: 'Mode' },
  glide: { label: 'Glide' },
  legato: { label: 'Legato', toggle: true },
  arp: { label: 'Arp' },
  global: { label: 'Global' },
  song: { label: 'Song' },
  pattern: { label: 'Pattern' },
  ex: { label: 'Extra' },
  exex: { label: 'Extra 2' },
};

function splitOpts(
  raw: Record<string, unknown>,
  key?: string,
): string[] | undefined {
  if (!key) return undefined;
  const v = raw[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim());
  return undefined;
}

function humanize(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// Setting types whose option list the app hard-codes (config carries no
// labels); the wire value is the selected index. Recovered via
// docs/handler-oracle.json; scripts/coverage-check.mjs gates completeness.
const TYPE_OPTS: Record<string, string[]> = {
  modulationcurve: ['Soft', 'Medium', 'Hard'],
  moduwheelrange: ['20', '50', '100', '200', '300'],
  arp_clock_division: [
    '1/4',
    '1/4T',
    '1/8',
    '1/8T',
    '1/16',
    '1/16T',
    '1/32',
    '1/32T',
  ],
  chainsongs: ['Loop', 'Hold', 'Stop'],
};

// highest valid MIDI channel (0-based)
const MIDI_CHANNEL_MAX = 15;

// decompose one setting into its renderable sub-controls
export function decompose(setting: DeviceSetting): SubControl[] {
  const raw = setting.raw as Record<string, unknown>;

  // channel fields are 0-15 but the config omits the range; cap at 15
  const typeMax = setting.type === 'channel' ? MIDI_CHANNEL_MAX : undefined;

  // composite: gather index<suffix>/default<suffix> pairs
  const subs: SubControl[] = [];
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('index')) continue;
    const suffix = key.slice('index'.length);
    if (suffix === '') continue; // plain "index" handled as simple below
    const idxVal = raw[key];
    // skip multi-index CSV strings (voice maps handled separately)
    if (typeof idxVal === 'string' && idxVal.includes(',')) continue;
    const info = SUFFIX[suffix.toLowerCase()] ?? { label: humanize(suffix) };
    // device-provided option list first, else the fixed enumeration
    const opts = splitOpts(raw, info.opts) ?? info.fixedOpts;
    const def = raw[`default${suffix}`];
    subs.push({
      id: suffix.toLowerCase(),
      label: info.label,
      kind: info.toggle ? 'toggle' : opts ? 'dropdown' : 'spinbox',
      options: info.toggle ? YESNO : opts,
      min: typeof raw.min === 'number' ? (raw.min as number) : 0,
      max:
        typeof raw.max === 'number'
          ? (raw.max as number)
          : opts
            ? opts.length - 1
            : (typeMax ?? 127),
      default: typeof def === 'number' ? def : 0,
      index: typeof idxVal === 'number' ? idxVal : undefined,
    });
  }
  if (subs.length > 0) {
    // a composite with a bare `index` also has a MAIN value (e.g.
    // localkeyboardmodeex, model-D pitchbend); emit it as the first sub
    // ('value') - WIRE_MAP pins the exact wire order
    if (typeof raw.index === 'number') {
      const mainOpts =
        setting.options ??
        splitOpts(raw, 'inlist') ??
        splitOpts(raw, 'optionlabel') ??
        splitOpts(raw, 'list') ??
        TYPE_OPTS[setting.type];
      const mainKind: SubControl['kind'] =
        setting.kind === 'toggle'
          ? 'toggle'
          : mainOpts && mainOpts.length
            ? mainOpts.length <= 3
              ? 'radio'
              : 'dropdown'
            : mapKind(setting);
      subs.unshift({
        id: 'value',
        label: setting.title,
        kind: mainKind,
        options: mainKind === 'toggle' ? (mainOpts ?? YESNO) : mainOpts,
        min: typeof setting.min === 'number' ? setting.min : 0,
        max:
          mainOpts && mainOpts.length
            ? mainOpts.length - 1
            : typeof setting.max === 'number'
              ? setting.max
              : (typeMax ?? 1),
        default:
          typeof setting.default === 'number'
            ? setting.default
            : typeof raw.default === 'number'
              ? (raw.default as number)
              : 0,
        index: raw.index as number,
      });
    }
    return subs;
  }

  // key_value dropdown: options are {value,name} pairs; the wire value is
  // atoi(value), not the row index
  const kv = raw.key_value;
  if (Array.isArray(kv) && kv.length > 0) {
    const rows = kv as Array<{ value?: unknown; name?: unknown }>;
    const options = rows.map((r) => String(r.name ?? r.value ?? ''));
    const valueMap = rows.map((r) => Math.trunc(Number(r.value)) || 0);
    const rawDef =
      typeof raw.default === 'number' ? (raw.default as number) : undefined;
    // config default may be a wire value or an index; prefer exact wire match
    const defIdx =
      rawDef !== undefined && valueMap.includes(rawDef)
        ? valueMap.indexOf(rawDef)
        : (rawDef ?? 0);
    return [
      {
        id: 'value',
        label: setting.title,
        kind: 'dropdown',
        options,
        min: 0,
        max: options.length - 1,
        default: defIdx,
        index:
          typeof raw.index === 'number' ? (raw.index as number) : undefined,
        valueMap,
      },
    ];
  }

  // simple single-value setting
  const options =
    setting.options ??
    splitOpts(raw, 'inlist') ??
    splitOpts(raw, 'optionlabel') ??
    splitOpts(raw, 'list') ??
    TYPE_OPTS[setting.type];
  // an option list means a discrete selector: radio (<=3) or dropdown,
  // bounded to the option count
  const kind: SubControl['kind'] =
    options && options.length && setting.kind !== 'toggle'
      ? options.length <= 3
        ? 'radio'
        : 'dropdown'
      : mapKind(setting);
  const def =
    typeof setting.default === 'number'
      ? setting.default
      : typeof raw.default === 'number'
        ? (raw.default as number)
        : 0;
  return [
    {
      id: 'value',
      label: setting.title,
      kind,
      options: kind === 'toggle' ? (options ?? YESNO) : options,
      min: typeof setting.min === 'number' ? setting.min : 0,
      max:
        options && options.length
          ? options.length - 1
          : typeof setting.max === 'number'
            ? setting.max
            : (typeMax ?? 1),
      step: typeof raw.step === 'number' ? (raw.step as number) : undefined,
      offset: typeof raw.offset === 'number' ? (raw.offset as number) : 0,
      default: def,
      index: typeof raw.index === 'number' ? (raw.index as number) : undefined,
    },
  ];
}

function mapKind(setting: DeviceSetting): SubControl['kind'] {
  switch (setting.kind) {
    case 'dropdown':
    case 'dual-dropdown':
      return 'dropdown';
    case 'toggle':
      return 'toggle';
    case 'radio':
      return 'radio';
    case 'slider':
      return 'slider';
    case 'spinbox':
      return 'spinbox';
    default:
      // infer from data
      if (setting.options && setting.options.length <= 3) return 'radio';
      if (setting.options) return 'dropdown';
      if (typeof setting.min === 'number' && typeof setting.max === 'number') {
        return setting.max - setting.min <= 1 ? 'toggle' : 'spinbox';
      }
      return 'spinbox';
  }
}
