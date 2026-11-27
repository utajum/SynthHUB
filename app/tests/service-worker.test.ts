import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// runs src/lib/service-worker.js (as pages/sw.js.ts serves it) against a
// fake network and a fake CacheStorage
const ORIGIN = 'https://hub.test';
const source = readFileSync(
  new URL('../src/lib/service-worker.js', import.meta.url),
  'utf8',
);

type Req = { url: string; method: string; mode: string };
const req = (path: string, mode = 'cors', method = 'GET'): Req => ({
  url: new URL(path, ORIGIN).href,
  method,
  mode,
});

function worker(
  build: string,
  store = new Map<string, Map<string, Response>>(),
) {
  const net = { online: true, body: 'v1' };
  const key = (r: Req | string) =>
    typeof r === 'string' ? new URL(r, ORIGIN).href : r.url;
  const fetch = async (r: Req | string) => {
    if (!net.online) throw new TypeError('offline');
    const res = new Response(`${net.body} ${key(r)}`);
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        add: async (r: string) => void m.set(key(r), await fetch(r)),
        put: async (r: Req, res: Response) => void m.set(key(r), res),
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (r: Req | string) => {
      for (const m of store.values()) {
        const hit = m.get(key(r));
        if (hit) return hit.clone();
      }
    },
  };
  const on: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, f: (e: unknown) => void) => (on[t] = f),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  vm.runInNewContext(source.replace('__BUILD__', build), {
    self,
    caches,
    fetch,
    URL,
    Response,
  });
  const lifecycle = async (t: string) => {
    const wait: Promise<unknown>[] = [];
    on[t]({ waitUntil: (p: Promise<unknown>) => wait.push(p) });
    await Promise.all(wait);
  };
  // the response the worker gives, or null when it leaves the request alone
  const get = async (r: Req): Promise<string | null> => {
    const wait: Promise<unknown>[] = [];
    let out: Promise<Response> | null = null;
    on.fetch({
      request: r,
      respondWith: (p: Promise<Response>) => (out = p),
      waitUntil: (p: Promise<unknown>) => wait.push(p),
    });
    if (!out) return null;
    const res: Response = await out;
    await Promise.all(wait);
    return res.type === 'error' ? 'error' : res.text();
  };
  return { net, store, lifecycle, get };
}

test('sw: online is network first, never the cached copy', async () => {
  const w = worker('b1');
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert.equal(await w.get(req('/app.js')), 'v1 https://hub.test/app.js');
  w.net.body = 'v2'; // a new deploy
  assert.equal(await w.get(req('/app.js')), 'v2 https://hub.test/app.js');
});

test('sw: offline serves the cache, unknown pages get the shell', async () => {
  const w = worker('b1');
  await w.lifecycle('install');
  await w.get(req('/device/td-3', 'navigate'));
  w.net.online = false;
  assert.equal(
    await w.get(req('/device/td-3', 'navigate')),
    'v1 https://hub.test/device/td-3',
  );
  assert.equal(await w.get(req('/about', 'navigate')), 'v1 https://hub.test/');
  assert.equal(await w.get(req('/never.js')), 'error');
});

test('sw: /api, other origins and POST are left to the browser', async () => {
  const w = worker('b1');
  assert.equal(await w.get(req('/api/firmware?family=a&model=b')), null);
  assert.equal(await w.get(req('https://cdn.test/x.js')), null);
  assert.equal(await w.get(req('/x', 'cors', 'POST')), null);
  assert.deepEqual([...w.store.keys()], []);
});

test('sw: a new build deletes the caches of older builds', async () => {
  const old = worker('b1');
  await old.lifecycle('install');
  await old.get(req('/app.js'));
  const next = worker('b2', old.store);
  await next.lifecycle('install');
  await next.lifecycle('activate');
  assert.deepEqual([...old.store.keys()], ['synthhub-b2']);
  assert.match(source, /'synthhub-__BUILD__'/);
});
