// Device registry: lazily resolves a slug to its logic module. import.meta.glob
// code-splits every src/devices/<slug>/index.ts into its own chunk.
import type { DeviceDef, DeviceVariant } from '../lib/types';
import type { DriverFactory } from './_shared/driver';
import indexData from '../data/devices.index.json';
import type { DeviceIndexEntry } from '../lib/types';

export interface DeviceModule {
  definition: DeviceDef;
  driver: DriverFactory;
  hasSequencer: boolean;
}

const modules = import.meta.glob<DeviceModule>('./*/index.ts');

export const deviceIndex = indexData as unknown as DeviceIndexEntry[];

const bySlug = new Map(deviceIndex.map((d) => [d.slug, d]));

// device metadata (synchronous, from the prebuilt index)
export function meta(slug: string): DeviceIndexEntry | undefined {
  return bySlug.get(slug);
}

// load a device's full logic module (async, code-split)
export async function loadDevice(slug: string): Promise<DeviceModule | null> {
  const key = `./${slug}/index.ts`;
  const loader = modules[key];
  if (!loader) return null;
  return await loader();
}

// Pick the concrete variant for a detected device: exact USB PID match first,
// then the variant name/alias from the MIDI port (a MIDI-only "2600 Blue
// Marvin" must use that variant's model id, not the base 2600's), else the
// first variant.
export function pickVariant(
  def: DeviceDef,
  pid?: string,
  variantName?: string,
): DeviceVariant {
  if (pid) {
    const hit = def.variants.find((v) =>
      v.pids.map((p) => p.toLowerCase()).includes(pid.toLowerCase()),
    );
    if (hit) return hit;
  }
  if (variantName) {
    const n = variantName.trim().toLowerCase();
    const hit = def.variants.find(
      (v) =>
        v.name.trim().toLowerCase() === n ||
        v.aliases.some((a) => a.trim().toLowerCase() === n),
    );
    if (hit) return hit;
  }
  return def.variants[0];
}
