const env = (k: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[k];

// cloud API base URL; no hardcoded fallback, throws when unset
function cloudBase(): string {
  const base = env('CLOUD_API_BASE');
  if (!base) throw new Error('server missing CLOUD_API_BASE');
  return base;
}

interface CloudCreds {
  clientVersionId: string;
  clientSecret: string;
}

export function cloudCreds(): CloudCreds | null {
  const clientSecret = env('CLOUD_CLIENT_SECRET');
  const clientVersionId = env('CLOUD_CLIENT_VERSION_ID');
  if (!clientSecret || !clientVersionId) return null;
  return { clientVersionId, clientSecret };
}

function hexToBuffer(hexStr: string): ArrayBuffer {
  const s = hexStr.trim();
  const buf = new ArrayBuffer(s.length >> 1);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  return buf;
}
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function sha256OfHex(hexStr: string): Promise<string> {
  return bufToHex(await crypto.subtle.digest('SHA-256', hexToBuffer(hexStr)));
}

interface Challenge {
  client?: { proof?: string; proofSalt?: string; salt?: string };
  responsePath?: string;
}

// 2-step SHA-256 challenge-response; returns a bearer token
export async function getToken(): Promise<string> {
  const creds = cloudCreds();
  if (!creds)
    throw new Error(
      'server missing CLOUD_CLIENT_VERSION_ID / CLOUD_CLIENT_SECRET',
    );
  const base = cloudBase();
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };

  console.log('[mtcloud] auth step 1 POST', `${base}/auth/tokens`);
  const r1 = await fetch(`${base}/auth/tokens`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ Client: creds.clientVersionId }),
  });
  console.log('[mtcloud] auth step 1 <-', r1.status, r1.statusText);
  if (!r1.ok) throw new Error(`auth step 1 failed (${r1.status})`);
  const ch = (await r1.json()) as Challenge;
  const salt = ch.client?.salt;
  const responsePath = ch.responsePath;
  if (!salt || !responsePath)
    throw new Error('auth step 1: malformed challenge');

  const clientResponse = await sha256OfHex(creds.clientSecret + salt);
  console.log('[mtcloud] auth step 2 POST', `${base}${responsePath}`);
  const r2 = await fetch(`${base}${responsePath}`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ clientResponse }),
  });
  console.log('[mtcloud] auth step 2 <-', r2.status, r2.statusText);
  if (!r2.ok) throw new Error(`auth step 2 failed (${r2.status})`);
  const j2 = (await r2.json()) as { token?: string };
  if (!j2.token) throw new Error('auth step 2: no token returned');
  return j2.token;
}

// authenticated GET against the cloud (path begins with '/')
export async function cloudGet(path: string, token: string): Promise<Response> {
  const url = `${cloudBase()}${path}`;
  console.log('[mtcloud] GET', url);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  console.log('[mtcloud] GET <-', res.status, res.statusText);
  return res;
}

// numeric dotted-version compare: >0 if a is newer than b
export function verCompare(a: string, b: string): number {
  const na = (a.match(/\d+/g) ?? []).map(Number);
  const nb = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const json = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });

export function cacheHeaders(o: {
  browser?: number; // seconds the browser may reuse without revalidating
  cdn: number; // seconds the CDN serves a fresh copy
  swr?: number; // seconds the CDN may serve stale while refetching
  durable?: boolean; // persist across deploys (Netlify Durable Cache)
  tag?: string; // Cache-Tag for targeted purge
}): Record<string, string> {
  const swr = o.swr ?? o.cdn;
  const cdn =
    `public, ${o.durable ? 'durable, ' : ''}s-maxage=${o.cdn}, ` +
    `stale-while-revalidate=${swr}, stale-if-error=${swr}`;
  const h: Record<string, string> = {
    'Cache-Control': `public, max-age=${o.browser ?? 0}`,
    'CDN-Cache-Control': cdn,
    'Netlify-CDN-Cache-Control': cdn,
  };
  if (o.tag) h['Cache-Tag'] = o.tag;
  return h;
}

// Explicit no-cache (for live/forced-refresh responses).
export const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store' };
