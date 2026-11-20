// BCR32 presets over BCL (Control Tribe 1.12.4 BCR32 / BCR32BclTransfer).
// Frame: F0 00 20 32 7F 64 <cmd> [data] F7. BCL text moves one line per
// frame: `20 <idx hi> <idx lo> <ascii>`; the device answers each line it
// receives with `21 <idx hi> <idx lo> <error>`.

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
