// GET /api/manuals?slug=<device-slug>[&live=1]
// Manual PDF location(s) for a device. Default source is the committed
// manifest; live=1 re-scrapes the Behringer storefront server-side (the
// browser cannot - Cloudflare). See lib/manuals.server + MANUALS.md.
import type { APIRoute } from 'astro';
import { json, cacheHeaders, NO_STORE } from '../../lib/mtcloud.server';
import { bakedManuals, fetchManualsLive } from '../../lib/manuals.server';

export const prerender = false;

const BAKED_CACHE = cacheHeaders({
  browser: 300,
  cdn: 86400,
  swr: 604800,
  tag: 'manuals',
});

export const GET: APIRoute = async ({ url }) => {
  const slug = (
    url.searchParams.get('slug') ||
    url.searchParams.get('device') ||
    ''
  )
    .trim()
    .toLowerCase();
  const live = url.searchParams.get('live') === '1';
  console.log('[api/manuals] request', { slug, live });
  if (!slug) return json({ error: 'slug is required' }, 400);

  const entry = bakedManuals(slug);
  // unknown device / no manual on the store: 200 + empty so the client can
  // simply hide the Manuals tab (deterministic per deploy -> cacheable)
  if (!entry)
    return json({ slug, name: null, count: 0, manuals: [] }, 200, BAKED_CACHE);

  try {
    let docs = entry.docs;
    if (live) {
      const fresh = await fetchManualsLive(entry.handles);
      if (fresh.length) docs = fresh;
    }
    const manuals = docs.map((d) => ({
      title: d.title,
      type: d.downloadType,
      language: d.language,
      filename: d.file,
      url: d.fileUrl,
    }));
    console.log('[api/manuals] result', { slug, count: manuals.length });
    return json(
      {
        slug,
        name: entry.name,
        handles: entry.handles,
        count: manuals.length,
        manuals,
      },
      200,
      live ? NO_STORE : BAKED_CACHE,
    );
  } catch (e) {
    console.error('[api/manuals] error:', e);
    return json(
      { error: (e as Error).message || 'manuals lookup failed' },
      502,
    );
  }
};
