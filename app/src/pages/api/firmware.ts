// GET /api/firmware?family=<cloudFamily>&model=<cloudModel>
// Server-side firmware lookup (client never sees credentials, no CORS).
// Returns the full version list.
// &download=<version> / &notes=<version>: 302 to a fresh cloud link. The
// cloud links expire after about 55 min, sooner than the cached list.
import type { APIRoute } from 'astro';
import {
  getToken,
  cloudGet,
  cloudCreds,
  verCompare,
  json,
  cacheHeaders,
  NO_STORE,
} from '../../lib/mtcloud.server';

export const prerender = false;

interface Release {
  version?: string;
  s3Url?: string;
  binary?: string;
  notes?: string;
  filename?: string;
  checksum?: string;
  bytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s);

type Kind = 'download' | 'notes';

// pre-signed cloud URL of a release file (or the plain-text notes)
const cloudUrl = (r: Release, kind: Kind): string =>
  ((kind === 'download' ? (r.s3Url ?? r.binary) : r.notes) ?? '').trim();

// ISO timestamp -> YYYY-MM-DD, or undefined
function fmtDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

function mapRelease(r: Release, link: (kind: Kind) => string) {
  // the cloud notes field is inconsistent (URL / blank / plain text): expose
  // a link only for real http URLs, pass other text through as notesText
  const notes = cloudUrl(r, 'notes');
  const download = cloudUrl(r, 'download');
  return {
    version: r.version ?? null,
    downloadUrl: isHttpUrl(download) ? link('download') : undefined,
    filename: r.filename,
    notesUrl: isHttpUrl(notes) ? link('notes') : undefined,
    notesText: !isHttpUrl(notes) && notes ? notes : undefined,
    releaseDate: fmtDate(r.createdAt ?? r.updatedAt),
    checksum: r.checksum,
    bytes: r.bytes,
  };
}

function releaseList(data: unknown): Release[] {
  const list: Release[] = Array.isArray(data)
    ? data
    : data
      ? [data as Release]
      : [];
  return list.filter((r) => typeof r?.version === 'string');
}

// file links point back to this route, which redirects to a fresh cloud link
function mapReleases(data: unknown, family: string, model: string) {
  const releases = releaseList(data)
    .map((r) =>
      mapRelease(
        r,
        (kind) =>
          `/api/firmware?${new URLSearchParams({ family, model, [kind]: r.version! })}`,
      ),
    )
    .sort((a, b) => verCompare(b.version as string, a.version as string));
  const latest = releases[0] ?? { version: null };
  return { ...latest, releases };
}

export const GET: APIRoute = async ({ url }) => {
  const family = (url.searchParams.get('family') || '').trim();
  const model = (url.searchParams.get('model') || '').trim();
  const kind = (['download', 'notes'] as const).find((k) =>
    url.searchParams.has(k),
  );
  console.log('[api/firmware] request', { family, model });
  if (!family || !model)
    return json({ error: 'family and model are required' }, 400);
  if (!cloudCreds())
    return json({ error: 'server has no cloud credentials configured' }, 501);

  try {
    const token = await getToken();
    const res = await cloudGet(
      `/firmware/behringer/${encodeURIComponent(family)}/${encodeURIComponent(model)}`,
      token,
    );
    if (!res.ok)
      return json({ error: `firmware request failed (${res.status})` }, 502);
    const data = await res.json();
    if (kind) {
      const v = url.searchParams.get(kind);
      const r = releaseList(data).find((x) => x.version === v);
      const to = r ? cloudUrl(r, kind) : '';
      if (!isHttpUrl(to))
        return json({ error: `no ${kind} for version ${v}` }, 404, NO_STORE);
      return new Response(null, {
        status: 302,
        headers: { Location: to, ...NO_STORE },
      });
    }
    const parsed = mapReleases(data, family, model);
    console.log('[api/firmware] result', {
      version: parsed.version,
      versions: parsed.releases.length,
    });
    return json(
      parsed,
      200,
      cacheHeaders({
        browser: 300,
        cdn: 3600,
        swr: 86400,
        durable: true,
        tag: 'firmware',
      }),
    );
  } catch (e) {
    console.error('[api/firmware] error:', e);
    return json(
      { error: (e as Error).message || 'firmware lookup failed' },
      502,
    );
  }
};
