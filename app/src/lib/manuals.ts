// Client helper for GET /api/manuals. The server resolves the PDF URLs (the
// storefront is Cloudflare-fronted and cannot be fetched from the browser).
export interface ManualItem {
  title: string | null;
  type: string | null;
  language: string | null;
  filename: string;
  url: string;
}
interface ManualsResult {
  slug: string;
  name: string | null;
  handles?: string[];
  count: number;
  manuals: ManualItem[];
}

export async function fetchManuals(slug: string): Promise<ManualsResult> {
  const res = await fetch(`/api/manuals?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`manuals request failed (${res.status})`);
  return (await res.json()) as ManualsResult;
}
