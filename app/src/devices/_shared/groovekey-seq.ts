// GROOVE KEY sequencer project (Control Tribe 1.12.4 GrooveKeySeqSync,
// GrooveKey::ProjectData). The project lives in one byte image laid out as
// Control Tribe's ProjectData; device blocks and the .gkseq JSON both map
// onto it. Frame: F0 00 20 32 00 01 42 00 74 <sub> ..
//   read:  30 <index> project, 31 <track> track, 32 <track> <pattern>
//   reply: 50 <'0'|'2'> header, then 51 <count> <n> <len> <data> chunks;
//          tracks answer 31 <track> <data> in one frame
//   write: 50 <'0'|'2'>, 51 <count> <n+1> <(len+14) & 7F> <<= 0x72 bytes>,
//          tracks 31 <track> <data>; every frame waits for an 01 ACK
// Block data is 8-to-7 packed: a byte of MSBs, then 7 data bytes.

import { midi } from '../../lib/midi/webmidi';

const GK_HDR = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x42, 0x00];
export const GK_TRACKS = 4; // + the drum track
export const GK_PATTERNS = 16;
export const GK_SIZE = 124907;

export const TRACK = (t: number) => 2568 + t * 24942;
export const PATTERN = (t: number, p: number) => 2582 + t * 24942 + p * 1558;
export const DRUM_TRACK = 102336;
export const DRUM_PATTERN = (p: number) => 102347 + p * 1410;

export const gkImage = () => new Uint8Array(GK_SIZE);
const gkFrame = (...body: number[]) =>
  Uint8Array.from([...GK_HDR, 0x74, ...body.map((b) => b & 0x7f), 0xf7]);

// device byte order of each block: runs of [image offset, length]
// (ProjectData::toBytes, trackDataToBytes, *PatternData::toBytes)
const PROJECT: [number, number][] = [
  [2, 2],
  [8, 2560],
  [4, 4],
];
const TRACK_RUNS: [number, number][] = [[0, 14]];
const DRUM_TRACK_RUNS: [number, number][] = [
  [2, 8],
  [1, 1],
  [0, 1],
  [10, 1],
];
// prettier-ignore
const PATTERN_RUNS: [number, number][] = [
  [1, 1], [0, 1], [3, 1], [2, 1], [5, 1], [4, 1], [7, 1], [6, 1], [8, 3],
  [15, 7], [11, 4], [22, 1536],
];
// prettier-ignore
const DRUM_RUNS: [number, number][] = [
  [64, 2], [130, 1280], [66, 64], [0, 29], [37, 2], [29, 4], [39, 1], [33, 4],
  [40, 24],
];

const gather = (img: Uint8Array, base: number, runs: [number, number][]) =>
  runs.flatMap(([o, n]) => Array.from(img.subarray(base + o, base + o + n)));
function scatter(
  img: Uint8Array,
  base: number,
  runs: [number, number][],
  d: ArrayLike<number>,
) {
  let i = 0;
  for (const [o, n] of runs)
    for (let k = 0; k < n && i < d.length; k++) img[base + o + k] = d[i++];
}

export function gkPack(d: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 7) {
    const g = Array.from(
      { length: Math.min(7, d.length - i) },
      (_, k) => d[i + k],
    );
    out.push(
      g.reduce((m, b, k) => m | ((b >> 7) << (6 - k)), 0),
      ...g.map((b) => b & 0x7f),
    );
  }
  return out;
}

export function gkUnpack(d: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 8)
    for (let k = 1; k < 8 && i + k < d.length; k++)
      out.push(((d[i] << k) & 0x80) | (d[i + k] & 0x7f));
  return out;
}

// item n of a full transfer: 0 project, 1-5 tracks (4 = drums), 6-85 patterns
export const GK_ITEMS = 1 + 5 + 80;
function gkItem(n: number): {
  type: 0 | 1 | 2;
  track: number;
  pattern: number;
} {
  if (n === 0) return { type: 0, track: 0, pattern: 0 };
  if (n < 6) return { type: 1, track: n - 1, pattern: 0 };
  return { type: 2, track: (n - 6) >> 4, pattern: (n - 6) & 15 };
}

function gkRequest(img: Uint8Array, n: number): Uint8Array {
  const it = gkItem(n);
  if (it.type === 0) return gkFrame(0x30, img[0]);
  if (it.type === 1) return gkFrame(0x31, it.track);
  return gkFrame(0x32, it.track, it.pattern);
}

// device data of one item -> image (handleResponse)
export function gkApply(img: Uint8Array, n: number, raw: number[]) {
  const it = gkItem(n);
  if (it.type === 0) {
    img[0] = raw[0];
    scatter(img, 0, PROJECT, gkUnpack(raw.slice(1)));
  } else if (it.type === 1) {
    const d = gkUnpack(raw);
    if (it.track === 4) scatter(img, DRUM_TRACK, DRUM_TRACK_RUNS, d);
    else scatter(img, TRACK(it.track), TRACK_RUNS, d);
  } else {
    const d = gkUnpack(raw.slice(2));
    if (raw[0] === 4) scatter(img, DRUM_PATTERN(raw[1]), DRUM_RUNS, d);
    else if (raw[0] < 4) scatter(img, PATTERN(raw[0], raw[1]), PATTERN_RUNS, d);
  }
}

// write frames of one item (buildWriteBlock + sendNextWritePacket)
export function gkWriteFrames(img: Uint8Array, n: number): Uint8Array[] {
  const it = gkItem(n);
  if (it.type === 1) {
    const d =
      it.track === 4
        ? gather(img, DRUM_TRACK, DRUM_TRACK_RUNS)
        : gather(img, TRACK(it.track), TRACK_RUNS);
    return [gkFrame(0x31, it.track, ...gkPack(d))];
  }
  const raw =
    it.type === 0
      ? [img[0], ...gkPack(gather(img, 0, PROJECT))]
      : [
          it.track,
          it.pattern,
          ...gkPack(
            it.track === 4
              ? gather(img, DRUM_PATTERN(it.pattern), DRUM_RUNS)
              : gather(img, PATTERN(it.track, it.pattern), PATTERN_RUNS),
          ),
        ];
  const count = Math.ceil(raw.length / 0x72);
  const out = [gkFrame(0x50, it.type === 0 ? 0x30 : 0x32)];
  for (let i = 0; i < count; i++) {
    const c = raw.slice(i * 0x72, (i + 1) * 0x72);
    out.push(gkFrame(0x51, count, i + 1, c.length + 14, ...c));
  }
  return out;
}

// ---- .gkseq (ProjectData::exportToFile): JSON of the image -----------------
// [path, base, strides, dims, u16] in Control Tribe's key order
// prettier-ignore
const SCHEMA: [string, number, number[], number[], number?][] = [
  ["index", 0, [], []],
  ["version", 2, [], [], 1],
  ["bpm", 4, [], [], 1],
  ["swing", 6, [], []],
  ["curSong", 7, [], []],
  ["songs.#.#.#.#", 8, [512, 32, 2, 1], [5, 16, 16, 2]],
  ["tracks.#.curPattern", 2568, [24942], [4]],
  ["tracks.#.seqArp", 2569, [24942], [4]],
  ["tracks.#.muteSolo", 2570, [24942], [4]],
  ["tracks.#.swing", 2571, [24942], [4]],
  ["tracks.#.preset", 2572, [24942], [4]],
  ["tracks.#.presetConfig.#", 2573, [24942, 1], [4, 8]],
  ["tracks.#.cvRouteVoice", 2581, [24942], [4]],
  ["tracks.#.patterns.#.stepPages.#", 2582, [24942, 1558, 2], [4, 16, 4], 1],
  ["tracks.#.patterns.#.length", 2590, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.playMode", 2591, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.style", 2592, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.custStyleSeq.#", 2597, [24942, 1558, 1], [4, 16, 7]],
  ["tracks.#.patterns.#.octave", 2593, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.scale", 2594, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.scaleRoot", 2595, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.timeDivision", 2596, [24942, 1558], [4, 16]],
  ["tracks.#.patterns.#.notes.#.#", 2604, [24942, 1558, 12, 1], [4, 16, 128, 12]],
  ["drumTrack.muteSolo", 102336, [], []],
  ["drumTrack.swing", 102337, [], []],
  ["drumTrack.curPattern", 102346, [], []],
  ["drumTrack.presetConfig.#", 102338, [1], [8]],
  ["drumTrack.patterns.#.length", 102347, [1410], [16]],
  ["drumTrack.patterns.#.polyLength.#", 102348, [1410, 1], [16, 10]],
  ["drumTrack.patterns.#.randomTrack.#", 102358, [1410, 1], [16, 10]],
  ["drumTrack.patterns.#.randomStep.#", 102368, [1410, 1], [16, 8]],
  ["drumTrack.patterns.#.probability", 102376, [1410], [16]],
  ["drumTrack.patterns.#.flam", 102377, [1410], [16]],
  ["drumTrack.patterns.#.polymeter", 102378, [1410], [16]],
  ["drumTrack.patterns.#.stepSize", 102379, [1410], [16]],
  ["drumTrack.patterns.#.mute.#", 102380, [1410, 1], [16, 2]],
  ["drumTrack.patterns.#.solo.#", 102382, [1410, 1], [16, 2]],
  ["drumTrack.patterns.#.tempo", 102384, [1410], [16]],
  ["drumTrack.patterns.#.swing", 102385, [1410], [16]],
  ["drumTrack.patterns.#.autoScroll", 102386, [1410], [16]],
  ["drumTrack.patterns.#.totalAccentEn.#", 102387, [1410, 1], [16, 8]],
  ["drumTrack.patterns.#.accentValue.#", 102395, [1410, 1], [16, 11]],
  ["drumTrack.patterns.#.reserved.#", 102406, [1410, 1], [16, 5]],
  ["drumTrack.patterns.#.autoCV.#", 102413, [1410, 1], [16, 64]],
  ["drumTrack.patterns.#.active.#.#", 102477, [1410, 64, 1], [16, 10, 64]],
  ["drumTrack.patterns.#.quantization.#.#", 103117, [1410, 64, 1], [16, 10, 64]],
];

type J = Record<string, unknown>;

export function gkToJson(img: Uint8Array): J {
  const root: J = {};
  for (const [path, base, strides, dims, u16] of SCHEMA) {
    const keys = path.split('.');
    const walk = (node: unknown, k: number, idx: number[]): unknown => {
      if (k === keys.length) {
        const o = base + idx.reduce((s, x, i) => s + x * strides[i], 0);
        return u16 ? img[o] | (img[o + 1] << 8) : img[o];
      }
      if (keys[k] === '#') {
        const n = dims[idx.length];
        const arr = (node as unknown[]) ?? [];
        for (let i = 0; i < n; i++) arr[i] = walk(arr[i], k + 1, [...idx, i]);
        return arr;
      }
      const obj = (node as J) ?? {};
      obj[keys[k]] = walk(obj[keys[k]], k + 1, idx);
      return obj;
    };
    walk(root, 0, []);
  }
  return root;
}

function gkFromJson(j: unknown): Uint8Array {
  const img = gkImage();
  for (const [path, base, strides, dims, u16] of SCHEMA) {
    const keys = path.split('.');
    const walk = (node: unknown, k: number, idx: number[]) => {
      if (node === undefined || node === null) return;
      if (k === keys.length) {
        const o = base + idx.reduce((s, x, i) => s + x * strides[i], 0);
        const v = typeof node === 'number' ? node | 0 : 0;
        img[o] = v & 0xff;
        if (u16) img[o + 1] = (v >> 8) & 0xff;
        return;
      }
      if (keys[k] === '#') {
        if (!Array.isArray(node)) return;
        for (let i = 0; i < Math.min(dims[idx.length], node.length); i++)
          walk(node[i], k + 1, [...idx, i]);
        return;
      }
      walk((node as J)[keys[k]], k + 1, idx);
    };
    walk(j, 0, []);
  }
  return img;
}

// juce::JSON::toString(var, allOnOneLine = true)
function jsonLine(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonLine).join(', ')}]`;
  if (v && typeof v === 'object')
    return `{${Object.entries(v)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonLine(x)}`)
      .join(', ')}}`;
  return JSON.stringify(v);
}

export const GK_EXT = 'gkseq';

export const gkFileText = (img: Uint8Array) =>
  jsonLine({
    format: 'GrooveKeySequencer',
    formatVersion: 1,
    device: 'Groove Key',
    project: gkToJson(img),
  });

export function gkFromFile(text: string): Uint8Array | string {
  const bad = 'This file is not a valid GrooveKey sequencer project.';
  let j: J;
  try {
    j = JSON.parse(text);
  } catch {
    return bad;
  }
  if (!j || j.format !== 'GrooveKeySequencer' || j.device !== 'Groove Key')
    return bad;
  if (typeof j.formatVersion === 'number' && j.formatVersion >= 2) return bad;
  if (!j.project || typeof j.project !== 'object') return bad;
  return gkFromJson(j.project);
}

// ---- transfer ---------------------------------------------------------------

const isGk = (d: ArrayLike<number>) =>
  d.length > 9 && GK_HDR.slice(1).every((b, i) => d[i + 1] === b);

// read every item (or `items`); items the device does not answer stay as
// they were
export async function gkRead(
  out: string,
  img: Uint8Array,
  progress: (i: number, n: number) => void = () => {},
  items: number[] = Array.from({ length: GK_ITEMS }, (_, i) => i),
): Promise<number> {
  let missed = 0;
  for (const [i, n] of items.entries()) {
    const it = gkItem(n);
    const raw = await new Promise<number[] | null>((resolve) => {
      let acc: number[] = [];
      let open = false;
      let ticks = 0;
      let chunks = 0;
      const req = gkRequest(img, n);
      const off = midi.onMessage((d) => {
        if (!isGk(d) || d[8] !== 0x74) return;
        if (it.type === 1 && d[9] === 0x31 && d[10] === it.track)
          return done(Array.from(d.slice(11, -1)));
        if (d[9] === 0x50 && d[10] === 0x30 + it.type) {
          [acc, open, chunks] = [[], true, 0];
          return;
        }
        if (d[9] === 0x51 && open && d.length > 13) {
          acc.push(...Array.from(d.slice(13, -1)));
          // the last chunk, or as many chunks as announced
          if (d[11] >= d[10] || ++chunks >= d[10]) done(acc);
        }
      });
      // resend every 100 ms; give up after 0.8 s (GrooveKeySeqSync::tick)
      const timer = setInterval(() => {
        if (++ticks > 8) return done(null);
        midi.send(out, req);
      }, 100);
      const done = (r: number[] | null) => {
        clearInterval(timer);
        off();
        resolve(r);
      };
      midi.send(out, req);
    });
    if (raw) gkApply(img, n, raw);
    else missed++;
    progress(i + 1, items.length);
  }
  return missed;
}

// write every item (or `items`), one ACK per frame (1 s, 3 resends)
export async function gkWrite(
  out: string,
  img: Uint8Array,
  progress: (i: number, n: number) => void = () => {},
  items: number[] = Array.from({ length: GK_ITEMS }, (_, i) => i),
): Promise<string | null> {
  for (const [i, n] of items.entries()) {
    for (const f of gkWriteFrames(img, n)) {
      let ok = false;
      for (let t = 0; t < 4 && !ok; t++)
        ok = await new Promise<boolean>((resolve) => {
          const off = midi.onMessage((d) => {
            if (!isGk(d) || d[8] !== 0x01) return;
            clearTimeout(timer);
            off();
            resolve(true);
          });
          const timer = setTimeout(() => {
            off();
            resolve(false);
          }, 1000);
          midi.send(out, f);
        });
      if (!ok)
        return `The device did not acknowledge item ${n + 1} of ${GK_ITEMS}.`;
    }
    progress(i + 1, items.length);
  }
  return null;
}
