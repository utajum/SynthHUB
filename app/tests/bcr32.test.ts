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
