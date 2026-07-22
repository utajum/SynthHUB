// Pattern library: named sequencer patterns in IndexedDB, portable across
// devices with a compatible grid. Content mirrors the engine's SlotContent.
import { idbAll, idbBySlug, idbDelete, idbPut, newId } from './idb';
import type { SlotContent, SeqRow } from './sequencer';

export interface PatternEntry {
  id: string;
  slug: string;
  name: string;
  tags: string[];
  ts: number;
  mode: 'drum' | 'mono';
  tempo: number;
  rows: SeqRow[]; // drum row labels/notes at save time
  content: SlotContent;
}

export async function listPatterns(slug: string): Promise<PatternEntry[]> {
  const rows = await idbBySlug<PatternEntry>('patterns', slug);
  return rows.sort((a, b) => b.ts - a.ts);
}

export async function listAllPatterns(): Promise<PatternEntry[]> {
  const rows = await idbAll<PatternEntry>('patterns');
  return rows.sort((a, b) => b.ts - a.ts);
}

export function savePattern(
  entry: Omit<PatternEntry, 'id' | 'ts'>,
): Promise<PatternEntry> {
  const full: PatternEntry = { ...entry, id: newId(), ts: Date.now() };
  return idbPut('patterns', full).then(() => full);
}

export function deletePattern(id: string): Promise<undefined> {
  return idbDelete('patterns', id);
}
