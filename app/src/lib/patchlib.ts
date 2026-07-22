// Patch library: named per-device presets in IndexedDB. An entry stores
// either decoded params (savable from the editor, diffable) or raw .syx
// bytes (imported files), plus tags/favorite/timestamps.
import { idbAll, idbBySlug, idbDelete, idbPut, newId } from './idb';

export interface PatchEntry {
  id: string;
  slug: string;
  name: string;
  tags: string[];
  fav: boolean;
  ts: number;
  // decoded control values (paramKey -> value); diffable
  params?: Record<string, number>;
  // raw .syx bytes (imported file); sent as-is
  syx?: number[];
}

export async function listPatches(slug: string): Promise<PatchEntry[]> {
  const rows = await idbBySlug<PatchEntry>('patches', slug);
  return rows.sort((a, b) => Number(b.fav) - Number(a.fav) || b.ts - a.ts);
}

export async function listAllPatches(): Promise<PatchEntry[]> {
  return idbAll<PatchEntry>('patches');
}

export function savePatch(
  entry: Omit<PatchEntry, 'id' | 'ts'>,
): Promise<PatchEntry> {
  const full: PatchEntry = { ...entry, id: newId(), ts: Date.now() };
  return idbPut('patches', full).then(() => full);
}

export function updatePatch(entry: PatchEntry): Promise<PatchEntry> {
  return idbPut('patches', entry).then(() => entry);
}

export function deletePatch(id: string): Promise<undefined> {
  return idbDelete('patches', id);
}

// case-insensitive name/tag filter
export function filterPatches(rows: PatchEntry[], q: string): PatchEntry[] {
  const n = q.trim().toLowerCase();
  if (!n) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(n) ||
      r.tags.some((t) => t.toLowerCase().includes(n)),
  );
}

export interface ParamDiff {
  key: string;
  a: number | undefined;
  b: number | undefined;
}

// changed params between two decoded entries
export function diffPatches(a: PatchEntry, b: PatchEntry): ParamDiff[] {
  const pa = a.params ?? {};
  const pb = b.params ?? {};
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  const out: ParamDiff[] = [];
  for (const key of [...keys].sort()) {
    if (pa[key] !== pb[key]) out.push({ key, a: pa[key], b: pb[key] });
  }
  return out;
}

// "a, b, c" -> ['a','b','c']
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
