// Server-only Behringer manuals lookup (never import from client code).
// Default source is the committed manifest (../data/manuals.json); live mode
// re-scrapes the storefront: reassemble the Next.js RSC payload chunks, then
// slice out the downloads[] array (it can span two chunks - see MANUALS.md).
import manifest from '../data/manuals.json';

const SITE = 'https://www.behringer.com/en/products/';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface ManualDoc {
  title: string | null;
  downloadType: string | null;
  language: string | null;
  fileUrl: string;
  file: string;
}
interface ManualEntry {
  name: string;
  handles: string[];
  docs: ManualDoc[];
}
const MANIFEST = manifest as unknown as Record<string, ManualEntry>;

// committed (offline) manuals for a device slug, or null
export function bakedManuals(slug: string): ManualEntry | null {
  return MANIFEST[slug] ?? null;
}

interface RawDoc {
  title?: string | null;
  downloadType?: string | null;
  language?: string | null;
  fileUrl?: string | null;
}

// reassemble Next.js RSC streamed chunks into one decoded string
function rscText(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(m[1]) as string);
    } catch {
      // ignore a non-string chunk
    }
  }
  return parts.length ? parts.join('') : html.replace(/\\"/g, '"');
}

// balanced JSON array substring starting at text[start]==='[' (string/escape
// aware so brackets inside values do not end it early), or null
function sliceArray(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseDownloads(rsc: string): RawDoc[] {
  const at = rsc.indexOf('"downloads":');
  if (at < 0) return [];
  const br = rsc.indexOf('[', at);
  if (br < 0) return [];
  const slice = sliceArray(rsc, br);
  if (!slice) return [];
  try {
    const arr = JSON.parse(slice) as unknown;
    return Array.isArray(arr) ? (arr as RawDoc[]) : [];
  } catch {
    return [];
  }
}

function isManual(d: RawDoc): boolean {
  const url = String(d.fileUrl ?? '')
    .split('?')[0]
    .toLowerCase();
  return url.endsWith('.pdf') && d.downloadType !== 'Firmware';
}

function baseName(url: string): string {
  const p = url.split('?')[0].split('/').pop() ?? 'manual.pdf';
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

// fetch a product page; retry when a Cloudflare interstitial (no 'downloads'
// token) came back instead of the real payload
async function fetchPageDownloads(
  handle: string,
  tries = 5,
): Promise<RawDoc[]> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(SITE + handle.toUpperCase(), {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const rsc = rscText(await res.text());
    if (rsc.includes('"downloads"')) return parseDownloads(rsc);
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return [];
}

// live storefront scrape for the given product handles; deduped by fileUrl
export async function fetchManualsLive(
  handles: string[],
): Promise<ManualDoc[]> {
  const lists = await Promise.all(handles.map((h) => fetchPageDownloads(h)));
  const seen = new Set<string>();
  const out: ManualDoc[] = [];
  for (const list of lists)
    for (const d of list) {
      const url = String(d.fileUrl ?? '');
      if (url && isManual(d) && !seen.has(url)) {
        seen.add(url);
        out.push({
          title: d.title ?? null,
          downloadType: d.downloadType ?? null,
          language: d.language ?? null,
          fileUrl: url,
          file: baseName(url),
        });
      }
    }
  return out;
}
