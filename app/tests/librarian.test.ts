import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFileGet,
  buildFileWrite,
  buildPresetSyx,
  buildStPreset,
  FileReceiver,
  FILE_EOF,
  NAMES_FILE,
  parseNames,
  parsePresetSyx,
  parseStPreset,
  patchFile,
  slotTag,
  type PresetFile,
} from '../src/devices/_shared/librarian.ts';
import type { DeviceDef } from '../src/lib/types.ts';
import ubxa from '../src/data/devices/ub-xa-16.json';

const v = (ubxa as unknown as DeviceDef).variants[0];
const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const asc = (s: string) => hex(Array.from(s, (c) => c.charCodeAt(0)));

// 7 bytes -> msb byte + 7 low bytes (inverse of unpack87)
function pack87(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const g = bytes.slice(i, i + 7);
    while (g.length < 7) g.push(0);
    out.push(g.reduce((m, b, j) => m | (((b >> 7) & 1) << j), 0));
    out.push(...g.map((b) => b & 0x7f));
  }
  return out;
}

test('slot tags and file names follow formatSlotTag', () => {
  assert.equal(slotTag(0), 'A001');
  assert.equal(slotTag(127), 'A128');
  assert.equal(slotTag(130), 'B003');
  assert.equal(patchFile(130), 'PatchX B003     ');
});

test('get request: 7f 74 07 03 7f "BIN " + name16 + firmware bytes', () => {
  assert.equal(
    hex(buildFileGet(v, NAMES_FILE, [1, 2, 3])),
    'f0 00 20 32 00 01 21 7f 74 07 03 7f ' +
      asc('BIN Patch Names     ') +
      ' 01 02 03 f7',
  );
});

test('write stream: header, 128-byte XOR chunks; receiver round-trips', () => {
  const data = Array.from({ length: 300 }, (_, i) => (i * 7) & 0x7f);
  const frames = buildFileWrite(v, patchFile(5), 0x1234, data, [1, 0, 2]);
  assert.equal(frames.length, 4);
  assert.equal(
    hex(frames[0].slice(7, 20)),
    '7f 74 07 01 7f 42 49 4e 20 34 12 00 00',
  );
  assert.equal(hex(frames[1].slice(7, 13)), '7f 74 07 02 00 7f');
  assert.equal(hex(frames[3].slice(11, 13)), '02 2b');
  const rx = new FileReceiver(v);
  for (const f of frames) assert.equal(rx.feed(f), true);
  assert.equal(rx.feed(FILE_EOF), 'eof');
  assert.equal(rx.ok, true);
  assert.equal(rx.size, 0x1234);
  assert.equal(rx.name, patchFile(5));
  assert.deepEqual(rx.data, data);
  const bad = Uint8Array.from(frames[1]);
  bad[20] ^= 1;
  const rx2 = new FileReceiver(v);
  rx2.feed(frames[0]);
  rx2.feed(bad);
  assert.equal(rx2.ok, false);
});

test('names file: two 7-bit chars per u16le word, 16 per name', () => {
  const words = (s: string) =>
    Array.from({ length: 8 }, (_, i) => {
      const w = (s.charCodeAt(2 * i) << 7) | s.charCodeAt(2 * i + 1);
      return [w & 0xff, w >> 8];
    }).flat();
  const file = pack87([
    ...words('Brass Pad       '),
    ...words('Lead 2          '),
  ]);
  assert.deepEqual(parseNames(file).slice(0, 2), ['Brass Pad', 'Lead 2']);
});

const presets: PresetFile[] = [
  { slot: 3, name: 'Brass', size: 512, data: [1, 2, 3, 0x7f] },
  { slot: 200, name: 'Lead', size: 9, data: [9, 8] },
];

test('.stpreset: format 3 round-trip; other versions and PRO 16 rejected', () => {
  const f = buildStPreset(presets);
  assert.equal(
    hex(f.subarray(0, 17)),
    asc('STPRESET') + ' 03 00 00 00 01 02 00 00 00',
  );
  assert.deepEqual(parseStPreset(f), presets);
  const v4 = Uint8Array.from(f);
  v4[8] = 4;
  assert.match(String(parseStPreset(v4)), /unsupported format/);
  const pro = Uint8Array.from(f);
  pro[12] = 0;
  assert.match(String(parseStPreset(pro)), /PRO 16/);
  assert.match(String(parseStPreset(f.subarray(0, 30))), /corrupted/);
});

test('.syx: write streams per preset round-trip to slots', () => {
  const f = buildPresetSyx(v, presets, [1, 0, 2]);
  assert.deepEqual(
    parsePresetSyx(v, f).map((p) => [p.slot, p.size, p.data]),
    presets.map((p) => [p.slot, p.size, p.data]),
  );
});

// minimal UB-Xa: ACKs a get and sends the file after the host EOF, NAKs a
// missing file, ACKs writes (NAKs once) but never the final EOF
test('transfers: readFile/writeFile against an emulated device', async () => {
  const { midi } = await import('../src/lib/midi/webmidi.ts');
  const { readFile, writeFile } =
    await import('../src/devices/_shared/librarian.ts');
  const listeners = new Set<(d: Uint8Array) => void>();
  const reply = (d: Uint8Array) =>
    setTimeout(() => listeners.forEach((l) => l(d)), 1);
  const ack = Uint8Array.from([0xf0, 0x7e, 0x00, 0x7f, 0x00, 0xf7]);
  const nak = Uint8Array.from([0xf0, 0x7e, 0x00, 0x7e, 0x00, 0xf7]);
  const store = new Map<string, { size: number; data: number[] }>();
  let rx = new FileReceiver(v);
  let naks = 1;
  let pending: string | null = null;
  Object.assign(midi, {
    onMessage: (l: (d: Uint8Array) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    send: (_out: string, d: Uint8Array) => {
      if (d[10] === 0x03) {
        const name = String.fromCharCode(...d.slice(16, 32));
        pending = store.has(name) ? name : null;
        reply(pending ? ack : nak);
        return true;
      }
      if (pending && d[3] === 0x7b) {
        const f = store.get(pending)!;
        const name = pending;
        pending = null;
        for (const m of [
          ...buildFileWrite(v, name, f.size, f.data, []),
          FILE_EOF,
        ])
          reply(m);
        return true;
      }
      if (d[10] === 0x02 && naks-- > 0) {
        reply(nak);
        return true;
      }
      if (rx.feed(d) === 'eof') {
        store.set(rx.name, { size: rx.size, data: rx.data });
        rx = new FileReceiver(v);
        return true;
      }
      reply(ack);
      return true;
    },
  });
  const data = Array.from({ length: 200 }, (_, i) => i & 0x7f);
  assert.equal(
    await writeFile(v, 'o', patchFile(9), 77, data, [1, 2, 3]),
    true,
  );
  assert.deepEqual(store.get(patchFile(9)), { size: 77, data });
  assert.deepEqual(await readFile(v, 'o', patchFile(9), [1, 2, 3]), {
    size: 77,
    data,
  });
  // a missing file is NAKed at once, not after the timeout
  const t0 = Date.now();
  assert.equal(await readFile(v, 'o', patchFile(10), []), null);
  assert.ok(Date.now() - t0 < 1000);
});
