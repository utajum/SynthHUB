import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/pages/api/firmware.ts';

process.env.CLOUD_API_BASE = 'https://cloud.test';
process.env.CLOUD_CLIENT_VERSION_ID = 'id';
process.env.CLOUD_CLIENT_SECRET = 'ab';

// fake cloud: every firmware call signs its links again (sig=1, 2, ...)
let signs = 0;
globalThis.fetch = (async (url: string) => {
  const ok = (body: unknown) => new Response(JSON.stringify(body));
  if (url.endsWith('/auth/tokens'))
    return ok({ client: { salt: 'cd' }, responsePath: '/auth/r' });
  if (url.endsWith('/auth/r')) return ok({ token: 'tok' });
  const sig = ++signs;
  return ok([
    {
      version: '1.1.3',
      s3Url: `https://oss.test/fw-1.1.3.syx?sig=${sig}`,
      notes: `https://oss.test/notes-1.1.3.pdf?sig=${sig}`,
    },
    {
      version: '1.0.5',
      s3Url: `https://oss.test/fw-1.0.5.syx?sig=${sig}`,
      notes: 'V1.0.5',
    },
  ]);
}) as typeof fetch;

const get = (path: string) =>
  GET({ url: new URL(path, 'https://hub.test') } as unknown as Parameters<
    typeof GET
  >[0]) as Promise<Response>;

const at = (q: string) => `/api/firmware?family=poly-d&model=poly-d&${q}`;

test('firmware list: file links point back to the route', async () => {
  const res = await get('/api/firmware?family=poly-d&model=poly-d');
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(
    d.downloadUrl,
    '/api/firmware?family=poly-d&model=poly-d&download=1.1.3',
  );
  assert.equal(
    d.releases[0].notesUrl,
    '/api/firmware?family=poly-d&model=poly-d&notes=1.1.3',
  );
  assert.equal(d.releases[1].notesUrl, undefined);
  assert.equal(d.releases[1].notesText, 'V1.0.5');
  assert.doesNotMatch(JSON.stringify(d), /oss\.test/);
});

test('firmware link: 302 to a fresh cloud link, not cached', async () => {
  const a = await get(at('download=1.1.3'));
  const b = await get(at('notes=1.1.3'));
  assert.equal(a.status, 302);
  assert.equal(a.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    a.headers.get('Location'),
    `https://oss.test/fw-1.1.3.syx?sig=${signs - 1}`,
  );
  assert.equal(
    b.headers.get('Location'),
    `https://oss.test/notes-1.1.3.pdf?sig=${signs}`,
  );
  // no notes URL, unknown version: 404
  assert.equal((await get(at('notes=1.0.5'))).status, 404);
  assert.equal((await get(at('download=9.9.9'))).status, 404);
});
