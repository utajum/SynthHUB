// Bespoke frame (no 3-byte model id): F0 00 20 32 <deviceId> <productId> <cmd>
// [<value>] F7 - value byte omitted for queries. Cmds + (deviceId, productId)
// pairs live in data/controltribe.json.
import data from '../../data/controltribe.json';

type CtKind = 'enum' | 'range' | 'step';
interface CtControl {
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

// set message: F0 00 20 32 devId prod cmd value F7
export function buildCtSet(
  slug: string,
  cmd: number,
  value: number,
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
    cmd & 0x7f,
    value & 0x7f,
    0xf7,
  ]);
}

// query message (no value byte): F0 00 20 32 devId prod cmd F7
export function buildCtQuery(slug: string, cmd: number): Uint8Array {
  const d = ctDevice(slug);
  if (!d) throw new Error(`unknown Control Tribe device: ${slug}`);
  return Uint8Array.from([
    0xf0,
    0x00,
    0x20,
    0x32,
    d.deviceId & 0x7f,
    d.productId & 0x7f,
    cmd & 0x7f,
    0xf7,
  ]);
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
