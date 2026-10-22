// Bespoke frame (no 3-byte model id): F0 00 20 32 <deviceId> <productId>
// [<page>] <cmd> [<value>] F7 - value omitted for queries; values >= 0x80
// (QT32 BPM) go as <flags> <hi> <lo>, flags bit1/bit0 = bit 7 of lo/hi. Cmds
// + (deviceId, productId) pairs live in data/controltribe.json.
import data from '../../data/controltribe.json';

type CtKind = 'enum' | 'range' | 'step';
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
  return ((c.page ?? 0) << 8) | c.cmd;
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
    0xf0,
    0x00,
    0x20,
    0x32,
    d.deviceId & 0x7f,
    d.productId & 0x7f,
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
    0xf0,
    0x00,
    0x20,
    0x32,
    d.deviceId & 0x7f,
    d.productId & 0x7f,
    ...(page === undefined ? [] : [page & 0x7f]),
    cmd & 0x7f,
    0xf7,
  ]);
}

// device reply -> { id: ctId of the control, value }, or null if not ours
export function parseCtReply(
  slug: string,
  data: Uint8Array,
): { id: number; value: number } | null {
  const d = ctDevice(slug);
  if (!d || data.length < 9) return null;
  if (
    data[0] !== 0xf0 ||
    data[1] !== 0x00 ||
    data[2] !== 0x20 ||
    data[3] !== 0x32 ||
    data[4] !== d.deviceId ||
    data[5] !== d.productId
  )
    return null;
  const c =
    d.controls.find((c) => c.page === data[6] && c.cmd === data[7]) ??
    d.controls.find((c) => c.page === undefined && c.cmd === data[6]);
  if (!c) return null;
  const i = c.page === undefined ? 7 : 8;
  if (data.length < i + 2) return null;
  const v =
    c.max > 0x7f && data.length === i + 4
      ? ((((data[i] & 1) << 7) | data[i + 1]) << 8) |
        ((data[i] & 2) << 6) |
        data[i + 2]
      : data[i];
  return { id: ctId(c), value: v };
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
