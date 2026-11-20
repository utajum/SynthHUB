import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { paramKey } from '../src/devices/_shared/paramKey.ts';
import type { DeviceDef } from '../src/lib/types.ts';

const dir = new URL('../src/data/devices/', import.meta.url);
const defs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as DeviceDef);

const keysOf = (d: DeviceDef) =>
  d.functions.flatMap((fn) =>
    (fn.settings ?? []).map((s, i) => paramKey(fn.name, s, i)),
  );

test('paramKey: unique within every device', () => {
  for (const d of defs) {
    const keys = keysOf(d);
    assert.equal(new Set(keys).size, keys.length, d.name);
  }
});

test('paramKey: settings without pkt key on the dump index, not position', () => {
  const wave = defs.find((d) => d.name === 'Behringer Wave')!;
  const fn = wave.functions[0];
  const i = fn.settings!.findIndex((s) => s.title === 'Tuning');
  assert.equal(paramKey(fn.name, fn.settings![i], i), 'general.wave-custom.x1');
});
