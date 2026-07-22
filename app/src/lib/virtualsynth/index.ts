// Virtual synth registry: which slugs have an in-browser engine, the
// virtual output port id convention, and the MIDI byte sink that lets every
// existing play path (sequencer, pianos, panic) drive an engine unchanged.
import type { VirtualEngine } from './base';
import { Td3Engine } from './td3';
import { Ms1Engine } from './ms1';
import { PolyDEngine } from './polyd';

export type { VirtualEngine, VParam } from './base';

const ENGINES: Record<string, { make: () => VirtualEngine; title: string }> = {
  'poly-d': { make: () => new PolyDEngine(), title: 'Virtual Poly D' },
  'td-3': { make: () => new Td3Engine(), title: 'Virtual TD-3' },
  'td-3-mo': { make: () => new Td3Engine(), title: 'Virtual TD-3-MO' },
  'ms-1': { make: () => new Ms1Engine(), title: 'Virtual MS-1' },
  'ms-1-mk-ii': { make: () => new Ms1Engine(), title: 'Virtual MS-1 MK II' },
};

export function hasVirtualSynth(slug: string): boolean {
  return slug in ENGINES;
}

export function virtualTitle(slug: string): string {
  return ENGINES[slug]?.title ?? 'Virtual synth';
}

export function createVirtualEngine(slug: string): VirtualEngine | null {
  return ENGINES[slug]?.make() ?? null;
}

export function virtualId(slug: string): string {
  return `virtual:${slug}`;
}

export function isVirtualId(id: string | undefined): boolean {
  return !!id && id.startsWith('virtual:');
}

// Interpret bytes sent to the virtual output as the hardware would: channel
// voice note on/off on ANY channel, CC 120/123 = all off. SysEx is ignored
// (pattern sync has nothing to do for a virtual device).
export function makeVirtualSink(
  engine: VirtualEngine,
): (data: Uint8Array) => void {
  return (data) => {
    if (!data.length || data[0] >= 0xf0) return;
    const status = data[0] & 0xf0;
    if (status === 0x90 && data[2] > 0) {
      engine.noteOn(data[1] & 0x7f, data[2] & 0x7f);
    } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
      engine.noteOff(data[1] & 0x7f);
    } else if (status === 0xb0 && (data[1] === 0x7b || data[1] === 0x78)) {
      engine.allOff();
    }
  };
}
