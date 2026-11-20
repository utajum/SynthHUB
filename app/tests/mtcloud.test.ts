import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudGet, getToken } from '../src/lib/mtcloud.server.ts';

process.env.CLOUD_API_BASE = 'https://cloud.test';
process.env.CLOUD_CLIENT_VERSION_ID = 'id';
process.env.CLOUD_CLIENT_SECRET = 'ab';

// fake cloud: each auth hands out tok1, tok2, ...; only the newest is valid
let auths = 0;
const calls: string[] = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  if (url.endsWith('/auth/tokens'))
    return ok({ client: { salt: 'cd' }, responsePath: '/auth/r' });
  if (url.endsWith('/auth/r')) return ok({ token: `tok${++auths}` });
  const auth = new Headers(init?.headers).get('Authorization');
  calls.push(String(auth));
  return ok({}, auth === `Bearer tok${auths}` ? 200 : 401);
}) as typeof fetch;

test('token: one auth for concurrent and later calls', async () => {
  const [a, b] = await Promise.all([getToken(), getToken()]);
  assert.equal(a, 'tok1');
  assert.equal(b, 'tok1');
  assert.equal(await getToken(), 'tok1');
  assert.equal(auths, 1);
});

test('token: a 401 drops the cached token and retries once', async () => {
  auths++; // the cloud expires tok1
  const res = await cloudGet('/firmware/x/y', await getToken());
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ['Bearer tok1', 'Bearer tok3']);
  assert.equal(await getToken(), 'tok3');
});
