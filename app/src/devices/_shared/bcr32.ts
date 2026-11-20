// BCR32 presets over BCL (Control Tribe 1.12.4 BCR32 / BCR32BclTransfer).
// Frame: F0 00 20 32 7F 64 <cmd> [data] F7. BCL text moves one line per
// frame: `20 <idx hi> <idx lo> <ascii>`; the device answers each line it
// receives with `21 <idx hi> <idx lo> <error>`.
import { midi } from '../../lib/midi/webmidi';

export const BCR_HDR = [0xf0, 0x00, 0x20, 0x32, 0x7f, 0x64];
export const BCR_PRESETS = 64;
// BCL export targets besides a preset number (startBclExport)
export const BCL_WORKING = 0x7f;
export const BCL_ALL = 0x7e;
export const BCL_GLOBAL = 0x100;
const LINE_MAX = 600;

const frame = (...body: number[]) =>
  Uint8Array.from([...BCR_HDR, ...body.map((b) => b & 0x7f), 0xf7]);

export const bcrControllerMode = () => frame(0x0c);
export const bcrZaquencerMode = () => frame(0x0b);
export const bcrSelectPreset = (p: number) => frame(0x22, p);
// all preset names; the device answers `21 00 <preset> <24 chars>` each
export const bcrNamesRequest = () => frame(0x42, 0x7f);
export const bcrSnapshot = () => frame(0x43);
export const bcrErasePreset = (p: number) => frame(0x14, p);
export const bcrFactoryReset = () => frame(0x7a, 0x0b, 0x0c, 0x32);

// `41` global, else `40 <preset | 7E all | 7F working>`
export const bclExportRequest = (target: number) =>
  target === BCL_GLOBAL ? frame(0x41) : frame(0x40, target);

export function bclLine(idx: number, text: string): Uint8Array {
  const chars = Array.from(text.slice(0, LINE_MAX), (c) => c.charCodeAt(0));
  return frame(0x20, idx >> 7, idx, ...chars);
}

function body(d: ArrayLike<number>): number[] | null {
  if (d.length < BCR_HDR.length + 2) return null;
  for (let i = 0; i < BCR_HDR.length; i++) if (d[i] !== BCR_HDR[i]) return null;
  return Array.from(d).slice(
    BCR_HDR.length,
    d[d.length - 1] === 0xf7 ? -1 : undefined,
  );
}

// `20 idx text` from the device (BCL export)
export function parseBclLine(
  d: ArrayLike<number>,
): { idx: number; text: string } | null {
  const b = body(d);
  if (!b || b[0] !== 0x20 || b.length < 3) return null;
  return {
    idx: ((b[1] & 0x7f) << 7) | (b[2] & 0x7f),
    text: String.fromCharCode(...b.slice(3).map((c) => c & 0x7f)),
  };
}

// `21 idx err` (line reply); long `21 00 ...` frames are preset names
export function parseBclReply(
  d: ArrayLike<number>,
): { idx: number; err: number } | null {
  const b = body(d);
  if (!b || b[0] !== 0x21 || b.length < 4) return null;
  if (b.length >= 0x1a && b[1] === 0) return null;
  return { idx: ((b[1] & 0x7f) << 7) | (b[2] & 0x7f), err: b[3] };
}

// `21 00 <preset> <24 chars>`: preset 0-63, 7F = the working preset
export function parsePresetName(
  d: ArrayLike<number>,
): { preset: number; name: string } | null {
  const b = body(d);
  if (!b || b[0] !== 0x21 || b.length < 0x1a || b[1] !== 0) return null;
  const name = String.fromCharCode(
    ...b.slice(3, 27).map((c) => (c < 0x20 || c > 0x7e ? 0x20 : c)),
  );
  return { preset: b[2], name: name.trim() };
}

const ERRORS = [
  'OK',
  'unknown keyword',
  'data without a keyword',
  'missing argument',
  'wrong device',
  'wrong revision',
  'missing $rev',
  'internal error (sequencer running or flash busy)',
  'missing $preset / $encoder / $button',
  'wrong element number',
  'not a number',
  'value out of range',
  'invalid argument (or a combination the BCR32 does not support)',
  'command not allowed now (device not in Controller mode)',
  'wrong number of arguments',
  'too much data',
];

export function bclErrorText(err: number): string {
  if (err === 0x16) return 'sequence error';
  return ERRORS[err] ?? `error 0x${err.toString(16).toUpperCase()}`;
}

// errors that stop an import (handleReply): wrong device / revision,
// sequence error; "not in Controller mode" on the first line
export function bclFatal(err: number, idx: number): boolean {
  return err === 4 || err === 5 || err === 0x16 || (err === 13 && idx === 0);
}

export const isEndLine = (s: string) =>
  s.trim().split(' ')[0].toLowerCase() === '$end';

// .bcl file -> lines to send, or the problems found (startImport): tabs
// become spaces, blank lines are dropped, ASCII only, <= 600 chars, and
// "$end" is added when missing
export function prepareBcl(
  text: string,
): { lines: string[] } | { errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const s = raw.replace(/\t/g, ' ').trimEnd();
    if (!s.trim()) return;
    if (!/^[\x20-\x7e]*$/.test(s))
      errors.push(`Line ${i + 1}: non-ASCII characters`);
    else if (s.length > LINE_MAX)
      errors.push(
        `Line ${i + 1}: ${s.length} characters (at most ${LINE_MAX})`,
      );
    else lines.push(s);
  });
  if (!lines.length && !errors.length)
    errors.push('The file has no BCL lines.');
  if (errors.length) return { errors };
  if (!lines.some(isEndLine)) lines.push('$end');
  return { lines };
}

// ---- .syx preset files (BCR32ImportExportThread) --------------------------
// Export: one request per block (06 global, 07 current preset, 08 current
// page, 09 all presets, 0A <part> preset parameters); each `04 <type> ..`
// block the device sends goes into the file as is. Import: one block at a
// time; the device answers `04 <type> <status>` (0 refused, 1 accepted,
// 2 stored) or `0E <error>`. Type 0B = Zaquencer, 0C = Controller.

export const ZAQ = 0x0b;
export const CTRL = 0x0c;

export interface SyxExport {
  label: string;
  type: number;
  req: number;
  blocks: number;
  // part byte of the preset-parameter requests (firmware 1.0.3+)
  part?: number;
}

export const SYX_EXPORTS: SyxExport[] = [
  {
    label: 'Zaquencer Current Preset',
    type: ZAQ,
    req: 0x07,
    blocks: 8,
    part: 1,
  },
  {
    label: 'Zaquencer Current Page',
    type: ZAQ,
    req: 0x08,
    blocks: 0x80,
    part: 2,
  },
  {
    label: 'Zaquencer All Presets',
    type: ZAQ,
    req: 0x09,
    blocks: 0x600,
    part: 0,
  },
  { label: 'Zaquencer Global Data', type: ZAQ, req: 0x06, blocks: 2 },
  { label: 'Controller Current Preset', type: CTRL, req: 0x07, blocks: 8 },
  { label: 'Controller All Presets', type: CTRL, req: 0x09, blocks: 0x200 },
];

const kind = (type: number) => (type === CTRL ? 'Controller' : 'Zaquencer');

// a `04 <type>` block: F0 00 20 32 xx 64 04 <type> <part> ..
export const isBlock = (m: ArrayLike<number>) =>
  m.length >= 12 &&
  m[1] === 0x00 &&
  m[2] === 0x20 &&
  m[3] === 0x32 &&
  m[5] === 0x64 &&
  m[6] === 0x04 &&
  (m[7] === ZAQ || m[7] === CTRL);

export const isParamBlock = (m: ArrayLike<number>) =>
  isBlock(m) && m[7] === ZAQ && m[8] === 0x04;

// request frames of one export, preset-parameter requests last
export function syxRequests(e: SyxExport, params: boolean): Uint8Array[] {
  const n =
    params && e.part !== undefined ? e.blocks + (e.blocks >> 2) : e.blocks;
  return Array.from({ length: n }, (_, i) =>
    i < e.blocks ? frame(e.req) : frame(0x0a, e.part!),
  );
}

const IMPORT_ERRORS = [
  '',
  'The block header is wrong - this is not a BCR32 preset file, or it is damaged.',
  'A block is truncated or does not end correctly - the file is damaged.',
  'Checksum error - the file is damaged.',
  'The blocks arrived out of order. Please try again.',
  'The preset data is not valid (out-of-range values, or a seal / CRC that does not match).',
  'The preset was made by an incompatible firmware version.',
  'The device could not write its flash memory, so the preset was not stored.\nRestart the device and try again.',
];

export const importErrorText = (code: number) =>
  IMPORT_ERRORS[code] || `Unspecified error (code ${code}).`;

// file blocks -> the blocks to send for page `type`, or the problem
export function syxImportPlan(
  msgs: Uint8Array[],
  type: number,
  params: boolean,
): Uint8Array[] | string {
  if (!msgs.length) return 'The file contains no SysEx data.';
  for (const m of msgs) {
    if (!isBlock(m)) return 'The file is not a BCR32 preset file.';
    if (m[7] !== type)
      return `This file holds ${kind(m[7])} presets. Import it on the ${kind(m[7])} page.`;
  }
  const out = params ? msgs : msgs.filter((m) => !isParamBlock(m));
  if (!out.length)
    return "This file only holds Zaquencer preset parameters, which this device's firmware does not keep - they need firmware v1.0.3 or later.";
  return out;
}

type Wait = (ms: number) => Promise<Uint8Array | null>;

// next `04 <type>` block or `0E` error from the device
function replies(): { next: Wait; off: () => void } {
  const q: Uint8Array[] = [];
  let wake: (() => void) | null = null;
  const off = midi.onMessage((d) => {
    const ours =
      d.length > 8 && BCR_HDR.slice(1, 4).every((b, i) => d[i + 1] === b);
    if (ours && d[5] === 0x64 && (d[6] === 0x04 || d[6] === 0x0e)) {
      q.push(Uint8Array.from(d));
      wake?.();
    }
  });
  const next: Wait = async (ms) => {
    if (!q.length)
      await new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        wake = () => {
          clearTimeout(t);
          r();
        };
      });
    wake = null;
    return q.shift() ?? null;
  };
  return { next, off };
}

// export blocks; the frames for the file, or an error text
export async function syxExport(
  out: string,
  e: SyxExport,
  params: boolean,
  progress: (i: number, n: number) => void = () => {},
): Promise<Uint8Array[] | string> {
  const reqs = syxRequests(e, params);
  const got: Uint8Array[] = [];
  const r = replies();
  try {
    for (let i = 0; i < reqs.length; i++) {
      midi.send(out, reqs[i]);
      for (;;) {
        const m = await r.next(3000);
        if (!m)
          return `The device did not answer block ${i + 1} of ${reqs.length}.`;
        if (m[6] !== 0x04 || m[7] !== e.type) continue;
        // a status byte above 0F ends the export (device error)
        if (m[11] > 0x0f)
          return `The device stopped the export at block ${i + 1} of ${reqs.length} (status 0x${m[11].toString(16)}).`;
        got.push(m);
        break;
      }
      progress(i + 1, reqs.length);
    }
    return got;
  } finally {
    r.off();
  }
}

// import blocks; null when stored, else the error text
export async function syxImport(
  out: string,
  blocks: Uint8Array[],
  type: number,
  progress: (i: number, n: number) => void = () => {},
): Promise<string | null> {
  const r = replies();
  const n = blocks.length;
  try {
    for (let i = 0; i < n; i++) {
      const m = blocks[i];
      // wait for "stored" after the last block, before the first
      // preset-parameter block, and after preset-parameter block 1
      const hold =
        i === n - 1 ||
        (!isParamBlock(m) && isParamBlock(blocks[i + 1])) ||
        (isParamBlock(m) && m[11] === 1);
      midi.send(out, m);
      for (;;) {
        const a = await r.next(5000);
        if (!a) return `The device did not answer block ${i + 1} of ${n}.`;
        if (a[6] === 0x0e)
          return `The device reported an import error at block ${i + 1} of ${n}:\n\n${importErrorText(a[7])}`;
        if (a[7] !== type)
          return `The device refused block ${i + 1} of ${n}.\n\nThe device is not in ${kind(type)} mode. Switch it to ${kind(type)} and try again.`;
        if (a[8] === 0) {
          // a refusal may be followed by the error code
          const e = await r.next(200);
          if (e && e[6] === 0x0e)
            return `The device reported an import error at block ${i + 1} of ${n}:\n\n${importErrorText(e[7])}`;
          return `The device refused block ${i + 1} of ${n}.\n\nPossible reasons:\n- the Zaquencer is playing - stop it and try again\n- the device's front panel is in an IMPORT menu waiting for a different kind of import (IMPORT CURRENT / IMPORT ALL) - leave the menu and try again`;
        }
        if (a[8] === 2 || !hold) break;
      }
      progress(i + 1, n);
    }
    return null;
  } finally {
    r.off();
  }
}
