import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BCL_ALL,
  BCL_GLOBAL,
  bclErrorText,
  bclExportRequest,
  bclFatal,
  bclLine,
  bcrFactoryReset,
  bcrNamesRequest,
  bcrSelectPreset,
  parseBclLine,
  parseBclReply,
  parsePresetName,
  prepareBcl,
} from '../src/devices/_shared/bcr32.ts';

const hex = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const H = 'f0 00 20 32 7f 64';
const dev = (...b: number[]) =>
  Uint8Array.from([0xf0, 0, 0x20, 0x32, 0x7f, 0x64, ...b, 0xf7]);

test('BCR32 frames: select, names, export requests, reset', () => {
  assert.equal(hex(bcrSelectPreset(5)), `${H} 22 05 f7`);
  assert.equal(hex(bcrNamesRequest()), `${H} 42 7f f7`);
  assert.equal(hex(bclExportRequest(3)), `${H} 40 03 f7`);
  assert.equal(hex(bclExportRequest(BCL_ALL)), `${H} 40 7e f7`);
  assert.equal(hex(bclExportRequest(BCL_GLOBAL)), `${H} 41 f7`);
  assert.equal(hex(bcrFactoryReset()), `${H} 7a 0b 0c 32 f7`);
});

test('BCL line: 14-bit index, then the ASCII text', () => {
  assert.equal(
    hex(bclLine(130, '$rev R1')),
    `${H} 20 01 02 24 72 65 76 20 52 31 f7`,
  );
  assert.deepEqual(parseBclLine(bclLine(130, '$end')), {
    idx: 130,
    text: '$end',
  });
});

test('replies: line ACK vs preset name', () => {
  assert.deepEqual(parseBclReply(dev(0x21, 0x00, 0x05, 0x0a)), {
    idx: 5,
    err: 10,
  });
  const name = Array.from('Mixer'.padEnd(24, ' '), (c) => c.charCodeAt(0));
  const n = dev(0x21, 0x00, 0x03, ...name);
  assert.deepEqual(parsePresetName(n), { preset: 3, name: 'Mixer' });
  assert.equal(parseBclReply(n), null);
});

test('errors: texts and the ones that stop an import', () => {
  assert.equal(
    bclErrorText(13),
    'command not allowed now (device not in Controller mode)',
  );
  assert.equal(bclErrorText(0x16), 'sequence error');
  assert.equal(bclErrorText(0x11), 'error 0x11');
  assert.equal(bclFatal(4, 7), true);
  assert.equal(bclFatal(13, 0), true);
  assert.equal(bclFatal(13, 3), false);
  assert.equal(bclFatal(10, 0), false);
});

test('prepareBcl: tabs, blank lines, $end, ASCII and length checks', () => {
  assert.deepEqual(prepareBcl('$rev R1\r\n\n\t$preset\n'), {
    lines: ['$rev R1', ' $preset', '$end'],
  });
  assert.deepEqual(prepareBcl('$rev R1\n$end\n'), {
    lines: ['$rev R1', '$end'],
  });
  assert.deepEqual(prepareBcl('a\u00e9\n' + 'x'.repeat(601)), {
    errors: [
      'Line 1: non-ASCII characters',
      'Line 2: 601 characters (at most 600)',
    ],
  });
  assert.deepEqual(prepareBcl('\n \n'), {
    errors: ['The file has no BCL lines.'],
  });
});

test('settings table: 705 params, targets from templates', async () => {
  const { ctDevice, buildCtControl, parseCtReplies, ctId } =
    await import('../src/devices/_shared/controltribe.ts');
  const d = ctDevice('bcr32')!;
  assert.equal(d.controls.length, 705);
  const c = (m: string) => d.controls.find((x) => x.method === m)!;
  assert.equal(new Set(d.controls.map(ctId)).size, 705);
  // global: <cmd> <value>, queried with <cmd>
  assert.equal(
    hex(buildCtControl('bcr32', c('OperatingMode'), 2)),
    `${H} 1f 02 f7`,
  );
  assert.equal(
    hex(buildCtControl('bcr32', c('OperatingMode'), null)),
    `${H} 1f f7`,
  );
  // track param with a second selector: query stops after the track
  const a = c('Track2CtrlAlpha');
  assert.equal(hex(buildCtControl('bcr32', a, 6)), `${H} 2c 01 01 06 f7`);
  assert.equal(hex(buildCtControl('bcr32', a, null)), `${H} 2c 01 f7`);
  // controller target 3-byte values; Enc1 is target 0x32
  const p = c('Enc1Param');
  assert.equal(p.section, 'Encoder 1');
  assert.equal(hex(buildCtControl('bcr32', p, 1000)), `${H} 33 32 02 03 68 f7`);
  assert.equal(
    hex(buildCtControl('bcr32', c('BtnEnc1Type'), null)),
    `${H} 31 10 f7`,
  );
  // signed button option
  const o = c('Btn2Option');
  assert.equal(hex(buildCtControl('bcr32', o, -127)), `${H} 37 01 03 7f 01 f7`);
  assert.deepEqual(parseCtReplies('bcr32', buildCtControl('bcr32', o, -127)), [
    { id: ctId(o), value: -127 },
  ]);
});

test('.syx: requests, file checks, emulated import and export', async () => {
  const { midi } = await import('../src/lib/midi/webmidi.ts');
  const m = await import('../src/devices/_shared/bcr32.ts');
  const blk = (type: number, part: number, n: number) =>
    Uint8Array.from([
      0xf0,
      0,
      0x20,
      0x32,
      0x7f,
      0x64,
      4,
      type,
      part,
      0,
      0,
      n,
      0x55,
      0xf7,
    ]);
  // requests: 07 x8, then 0A 01 x2 with preset parameters
  const r = m.syxRequests(m.SYX_EXPORTS[0], true);
  assert.equal(r.length, 10);
  assert.equal(hex(r[0]), `${H} 07 f7`);
  assert.equal(hex(r[9]), `${H} 0a 01 f7`);
  assert.equal(m.syxRequests(m.SYX_EXPORTS[4], true).length, 8);
  // file checks
  assert.match(String(m.syxImportPlan([], m.ZAQ, true)), /no SysEx/);
  assert.match(
    String(m.syxImportPlan([blk(m.CTRL, 1, 0)], m.ZAQ, true)),
    /Controller page/,
  );
  assert.match(
    String(m.syxImportPlan([blk(m.ZAQ, 4, 1)], m.ZAQ, false)),
    /v1.0.3/,
  );
  const plan = m.syxImportPlan(
    [blk(m.ZAQ, 1, 0), blk(m.ZAQ, 4, 1)],
    m.ZAQ,
    false,
  );
  assert.equal((plan as Uint8Array[]).length, 1);

  const ls = new Set<(d: Uint8Array) => void>();
  let onSend: (d: Uint8Array) => void = () => {};
  Object.assign(midi, {
    onMessage: (l: (d: Uint8Array) => void) => (ls.add(l), () => ls.delete(l)),
    send: (_o: string, d: Uint8Array) => onSend(d),
  });
  const reply = (...b: number[]) =>
    setTimeout(
      () =>
        ls.forEach((l) =>
          l(Uint8Array.from([0xf0, 0, 0x20, 0x32, 0x7f, 0x64, ...b, 0xf7])),
        ),
      1,
    );
  // import: status 1 per block, 2 after the last; device must hold the last
  const sent: number[] = [];
  onSend = (d) => {
    sent.push(d[11]);
    reply(4, m.ZAQ, 1);
    if (sent.length === 3) reply(4, m.ZAQ, 2);
  };
  const three = [0, 1, 2].map((n) => blk(m.ZAQ, 1, n));
  assert.equal(await m.syxImport('o', three, m.ZAQ), null);
  assert.deepEqual(sent, [0, 1, 2]);
  // refusal followed by an error code
  onSend = () => (reply(4, m.ZAQ, 0), reply(0x0e, 3));
  assert.match(
    String(await m.syxImport('o', three, m.ZAQ)),
    /block 1 of 3:\n\nChecksum error/,
  );
  // wrong mode
  onSend = () => reply(4, m.CTRL, 0);
  assert.match(
    String(await m.syxImport('o', three, m.ZAQ)),
    /not in Zaquencer mode/,
  );
  // export: one block per request, other replies ignored
  let k = 0;
  onSend = () => (reply(4, m.CTRL, 1, 0, 0, 9), reply(4, m.ZAQ, 3, 0, 0, k++));
  const got = await m.syxExport('o', m.SYX_EXPORTS[3]);
  assert.deepEqual(
    (got as Uint8Array[]).map((b) => b[11]),
    [0, 1],
  );
});
