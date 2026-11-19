// Bespoke frame (no 3-byte model id): F0 00 20 32 <deviceId> <productId>
// [<page>] <cmd> [<value>] F7 - value omitted for queries; values >= 0x80
// (QT32 BPM) go as <flags> <hi> <lo>, flags bit1/bit0 = bit 7 of lo/hi. Cmds
// + (deviceId, productId) pairs live in data/controltribe.json. JAM / JAM
// PLAY use a 4-byte `header` instead, and some controls carry `args`.
import data from '../../data/controltribe.json';

type CtKind = 'enum' | 'range' | 'step';
// one payload byte after cmd: another control's value (+ add), a constant,
// or this control's value
export interface CtArg {
  ref?: string;
  // another param of a group frame (table devices): its current value
  peer?: string;
  add?: number;
  const?: number;
  value?: true;
}
export interface CtControl {
  cmd: number;
  label: string;
  section: string;
  kind: CtKind;
  min: number;
  max: number;
  default: number;
  method: string;
  // option list for enum controls (index == wire value unless values[] given)
  options?: string[];
  // wire value per option, for enums with non-contiguous codes
  // (Swing channels: 0x41 = User, 0x7e = None; mod voltage: raw volts)
  values?: number[];
  // address byte before cmd (QT32 favourites: 0x7f)
  page?: number;
  // value key when controls share a cmd (JAM knobs)
  id?: number;
  // payload layout after cmd (default: the value)
  args?: CtArg[];
  // UI-only selector feeding other controls' args; never sent
  local?: boolean;
  // value always as <flags> <hi> <lo> (QT32 PLAY 16-bit params)
  wide?: boolean;
}

// "options": "notes" in the JSON = MIDI note names, C-2 = 0 .. G8 = 127
const NOTE_NAMES = Array.from(
  { length: 128 },
  (_, n) =>
    ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'][n % 12] +
    (Math.floor(n / 12) - 2),
);

// value key: cmd, plus the page byte when the control has one
export function ctId(c: CtControl): number {
  return c.id ?? ((c.page ?? 0) << 8) | c.cmd;
}

function ctValueBytes(v: number): number[] {
  if (v < 0x80) return [v];
  return [((v >> 6) & 2) | ((v >> 15) & 1), (v >> 8) & 0x7f, v & 0x7f];
}

// wire value for the i-th option of an enum control
export function ctOptionValue(c: CtControl, i: number): number {
  return c.values?.[i] ?? i;
}

interface CtDevice {
  name: string;
  deviceId: number;
  productId: number;
  // bytes after F0 00 20 32 when not <deviceId> <productId>
  header?: number[];
  // false when the unit has no 0x72 store (table devices save on their own)
  store?: boolean;
  // confirmed one-shot commands (JAM: restore settings, erase all data)
  actions?: { label: string; bytes: number[]; confirm: string }[];
  controls: CtControl[];
}
export interface CtStepRow {
  label: string;
  controls: CtControl[];
}

const CT_DEVICES = data as unknown as Record<string, CtDevice>;
for (const d of Object.values(CT_DEVICES))
  for (const c of d.controls)
    if ((c.options as unknown) === 'notes') c.options = NOTE_NAMES;

// management command bytes shared across the devices
const CT_CMD = {
  store: 0x72, // persist current settings to device memory
  requestBootloader: 0x77,
} as const;

// catalogue slug -> protocol key (the 1601 route slug differs)
function ctKey(slug: string): string {
  if (slug === 'behringer-1601' || slug === '1601' || slug === '1601-sequencer')
    return 's1601';
  return slug;
}

export function ctDevice(slug: string): CtDevice | undefined {
  return CT_DEVICES[ctKey(slug)];
}

function ctHeader(d: CtDevice): number[] {
  const h = d.header ?? [d.deviceId, d.productId];
  return [0xf0, 0x00, 0x20, 0x32, ...h.map((b) => b & 0x7f)];
}

// set message: F0 00 20 32 devId prod [page] cmd value F7
export function buildCtSet(
  slug: string,
  cmd: number,
  value: number,
  page?: number,
): Uint8Array {
  const d = ctDevice(slug);
  if (!d) throw new Error(`unknown Control Tribe device: ${slug}`);
  return Uint8Array.from([
    ...ctHeader(d),
    ...(page === undefined ? [] : [page & 0x7f]),
    cmd & 0x7f,
    ...ctValueBytes(value),
    0xf7,
  ]);
}

// query message (no value byte): F0 00 20 32 devId prod [page] cmd F7
export function buildCtQuery(
  slug: string,
  cmd: number,
  page?: number,
): Uint8Array {
  const d = ctDevice(slug);
  if (!d) throw new Error(`unknown Control Tribe device: ${slug}`);
  return Uint8Array.from([
    ...ctHeader(d),
    ...(page === undefined ? [] : [page & 0x7f]),
    cmd & 0x7f,
    0xf7,
  ]);
}

// one value on the wire: 7-bit, or 3 bytes for wide params
function ctWire(c: CtControl, v: number): number[] {
  return c.wide
    ? [((v >> 6) & 2) | ((v >> 15) & 1), (v >> 8) & 0x7f, v & 0x7f]
    : [v & 0x7f];
}

// payload bytes of a control with args; value null -> the bytes before it
function ctArgBytes(
  d: CtDevice,
  c: CtControl,
  value: number | null,
  values: Record<number, number>,
): number[] {
  const out: number[] = [];
  for (const a of c.args ?? []) {
    if (a.value) {
      if (value === null) break;
      out.push(...ctWire(c, value));
      continue;
    }
    if (a.peer) {
      // a query stops at the first param of a group frame
      if (value === null) break;
      const p = d.controls.find((x) => x.method === a.peer)!;
      out.push(...ctWire(p, values[ctId(p)] ?? p.default));
      continue;
    }
    const r = a.ref ? d.controls.find((x) => x.method === a.ref) : undefined;
    const base = r ? (values[ctId(r)] ?? r.default) : (a.const ?? 0);
    out.push((base + (a.add ?? 0)) & 0x7f);
  }
  return out;
}

// set (value) or query (null) frame of one control, args resolved from the
// current UI `values`
export function buildCtControl(
  slug: string,
  c: CtControl,
  value: number | null,
  values: Record<number, number> = {},
): Uint8Array {
  const d = ctDevice(slug);
  if (!d) throw new Error(`unknown Control Tribe device: ${slug}`);
  if (!c.args)
    return value === null
      ? buildCtQuery(slug, c.cmd, c.page)
      : buildCtSet(slug, c.cmd, value, c.page);
  return Uint8Array.from([
    ...ctHeader(d),
    c.cmd & 0x7f,
    ...ctArgBytes(d, c, value, values),
    0xf7,
  ]);
}

// group frame (args) -> one update per param it carries, or null
export function parseCtReplies(
  slug: string,
  data: Uint8Array,
  values: Record<number, number> = {},
): { id: number; value: number }[] | null {
  const d = ctDevice(slug);
  const h = d ? ctHeader(d) : [];
  if (!d || data.length < h.length + 2) return null;
  if (h.some((b, i) => data[i] !== b)) return null;
  const n = h.length;
  const c = d.controls.find((c) => {
    if (!c.args || c.local || c.cmd !== data[n]) return false;
    const pre = ctArgBytes(d, c, null, values);
    return pre.every((b, i) => data[n + 1 + i] === b);
  });
  if (!c) return null;
  const out: { id: number; value: number }[] = [];
  let i = n + 1;
  for (const a of c.args!) {
    if (i >= data.length - 1) break;
    const r = a.value
      ? c
      : a.peer
        ? d.controls.find((x) => x.method === a.peer)
        : undefined;
    if (!r) {
      i++;
      continue;
    }
    if (r.wide) {
      const [f, hi, lo] = [data[i], data[i + 1], data[i + 2]];
      out.push({
        id: ctId(r),
        value: ((((f & 1) << 7) | hi) << 8) | ((f & 2) << 6) | lo,
      });
      i += 3;
    } else {
      out.push({ id: ctId(r), value: data[i] });
      i++;
    }
  }
  return out;
}

// device reply -> { id: ctId of the control, value }, or null if not ours
export function parseCtReply(
  slug: string,
  data: Uint8Array,
  values: Record<number, number> = {},
): { id: number; value: number } | null {
  const d = ctDevice(slug);
  const h = d ? ctHeader(d) : [];
  if (!d || data.length < h.length + 3) return null;
  if (h.some((b, i) => data[i] !== b)) return null;
  const n = h.length;
  // args controls: cmd + the expected bytes before the value
  const a = d.controls.find((c) => {
    if (!c.args || c.local || c.cmd !== data[n]) return false;
    const pre = ctArgBytes(d, c, null, values);
    return pre.every((b, i) => data[n + 1 + i] === b);
  });
  if (a) {
    const i = n + 1 + ctArgBytes(d, a, null, values).length;
    return i < data.length - 1 ? { id: ctId(a), value: data[i] } : null;
  }
  const c =
    d.controls.find((c) => c.page === data[n] && c.cmd === data[n + 1]) ??
    d.controls.find(
      (c) => c.page === undefined && !c.args && c.cmd === data[n],
    );
  if (!c) return null;
  const i = c.page === undefined ? n + 1 : n + 2;
  if (data.length < i + 2) return null;
  const v =
    c.max > 0x7f && data.length === i + 4
      ? ((((data[i] & 1) << 7) | data[i + 1]) << 8) |
        ((data[i] & 2) << 6) |
        data[i + 2]
      : data[i];
  return { id: ctId(c), value: v };
}

// raw frame for a device action: header + bytes
export function buildCtAction(slug: string, bytes: number[]): Uint8Array {
  const d = ctDevice(slug);
  if (!d) throw new Error(`unknown Control Tribe device: ${slug}`);
  return Uint8Array.from([...ctHeader(d), ...bytes, 0xf7]);
}

// persist current settings to device memory
export function buildCtStore(slug: string): Uint8Array {
  return buildCtSet(slug, CT_CMD.store, 0);
}

// non-step controls grouped by section, cmd order preserved (step controls
// render in the step grid via ctStepRows)
export function ctSections(
  slug: string,
): { section: string; controls: CtControl[] }[] {
  const d = ctDevice(slug);
  if (!d) return [];
  const order: string[] = [];
  const map = new Map<string, CtControl[]>();
  for (const c of d.controls) {
    if (c.kind === 'step') continue;
    if (!map.has(c.section)) {
      map.set(c.section, []);
      order.push(c.section);
    }
    map.get(c.section)!.push(c);
  }
  return order.map((section) => ({ section, controls: map.get(section)! }));
}

// true when the device has a step sequencer grid (1601 / BQ10)
export function ctHasSteps(slug: string): boolean {
  return (ctDevice(slug)?.controls ?? []).some((c) => c.kind === 'step');
}

// step controls grouped into rows: 1601 -> one 16-step row, BQ10 -> three
// 8-step rows (Ch A/B/C), derived from the control labels
export function ctStepRows(slug: string): CtStepRow[] {
  const d = ctDevice(slug);
  if (!d) return [];
  const order: string[] = [];
  const map = new Map<string, CtControl[]>();
  for (const c of d.controls) {
    if (c.kind !== 'step') continue;
    const m = /^Ch\s+([ABC])\s+Step/.exec(c.label);
    const row = m ? `Ch ${m[1]}` : 'Steps';
    if (!map.has(row)) {
      map.set(row, []);
      order.push(row);
    }
    map.get(row)!.push(c);
  }
  return order.map((label) => ({
    label,
    controls: map
      .get(label)!
      .slice()
      .sort((a, b) => a.cmd - b.cmd),
  }));
}

// "F0 00 20 32 7F 42 10 00 F7" for logs
export function ctHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}
