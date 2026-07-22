// GET /api/app-update?app=synthtribe|controltribe|guitartribe|musictribejam
// Latest official desktop app version + full version history with macOS /
// Windows links, via the apps' own self-update mechanism (server-side, creds
// never reach the client). synthtribe uses a manifest JSON per release;
// the others are per-platform models where s3Url IS the installer.
import type { APIRoute } from 'astro';
import {
  getToken,
  cloudGet,
  cloudCreds,
  verCompare,
  json,
  cacheHeaders,
} from '../../lib/mtcloud.server';

export const prerender = false;

interface Rel {
  version?: string;
  s3Url?: string;
  releaseDate?: string;
  createdAt?: string;
}
interface Manifest {
  latest_version?: string;
  release_date?: string;
  downloads?: { windows?: { url?: string }; macos?: { url?: string } };
}
interface Row {
  version: string | null;
  releaseDate: string | null;
  macos: string | null;
  windows: string | null;
}

async function releaseList(path: string, token: string): Promise<Rel[]> {
  const res = await cloudGet(path, token);
  if (!res.ok) return [];
  const list = (await res.json().catch(() => null)) as unknown;
  return (Array.isArray(list) ? list : []).filter(
    (r): r is Rel => !!r && typeof (r as Rel).version === 'string',
  );
}

const extOf = (url: string | null, fb: string): string => {
  const m = url && url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : fb;
};
const dateOf = (r?: Rel): string | null =>
  (r?.releaseDate ?? r?.createdAt ?? '')?.slice(0, 10) || null;

async function synthtribe(token: string) {
  const list = await releaseList(
    '/firmware/behringer/synthtribe/synthtribe',
    token,
  );
  list.sort((a, b) => verCompare(b.version as string, a.version as string));
  const rows = await Promise.all(
    list.map(async (r): Promise<Row> => {
      let man: Manifest = {};
      if (r.s3Url)
        man = (await (
          await fetch(r.s3Url)
        )
          .json()
          .catch(() => ({}))) as Manifest;
      return {
        version: man.latest_version ?? r.version ?? null,
        releaseDate: man.release_date ?? dateOf(r),
        macos: man.downloads?.macos?.url ?? null,
        windows: man.downloads?.windows?.url ?? null,
      };
    }),
  );
  return finalize('synthtribe', 'SynthTribe', rows, 'dmg', 'zip');
}

// Apps whose releases are per-platform models (s3Url IS the installer).
// Sources merge by version; the first source with a version wins, so list the
// preferred family first.
const PER_PLATFORM: Record<
  string,
  { name: string; mac: string[]; win: string[]; macExt: string; winExt: string }
> = {
  controltribe: {
    name: 'Control Tribe',
    mac: ['/firmware/behringer/controltribe/osx'],
    win: ['/firmware/behringer/controltribe/windows'],
    macExt: 'dmg',
    winExt: 'exe',
  },
  guitartribe: {
    name: 'GuitarTribe',
    mac: ['/firmware/behringer/guitartribe/mac'],
    win: ['/firmware/behringer/guitartribe/win'],
    macExt: 'dmg',
    winExt: 'zip',
  },
  musictribejam: {
    name: 'MusicTribe Jam',
    mac: [
      '/firmware/behringer/jam/osx',
      '/firmware/behringer/musictribejam/osx',
      '/firmware/behringer/musictribejam/osx-intel',
    ],
    win: [
      '/firmware/behringer/jam/windows',
      '/firmware/behringer/musictribejam/windows',
    ],
    macExt: 'zip',
    winExt: 'exe',
  },
};

async function perPlatformApp(app: string, token: string) {
  const cfg = PER_PLATFORM[app];
  const [macLists, winLists] = await Promise.all([
    Promise.all(cfg.mac.map((p) => releaseList(p, token))),
    Promise.all(cfg.win.map((p) => releaseList(p, token))),
  ]);
  // first source that has a version wins (preferred family listed first)
  const pick = (lists: Rel[][]): Map<string, Rel> => {
    const m = new Map<string, Rel>();
    for (const list of lists)
      for (const r of list) {
        const v = r.version as string;
        if (!m.has(v)) m.set(v, r);
      }
    return m;
  };
  const macMap = pick(macLists);
  const winMap = pick(winLists);
  const versions = [...new Set([...macMap.keys(), ...winMap.keys()])].sort(
    (a, b) => verCompare(b, a),
  );
  const rows: Row[] = versions.map((v) => ({
    version: v,
    releaseDate: dateOf(macMap.get(v) ?? winMap.get(v)),
    macos: macMap.get(v)?.s3Url ?? null,
    windows: winMap.get(v)?.s3Url ?? null,
  }));
  return finalize(app, cfg.name, rows, cfg.macExt, cfg.winExt);
}

function finalize(
  app: string,
  name: string,
  rows: Row[],
  macExtFb = 'dmg',
  winExtFb = 'exe',
) {
  // dedupe by resolved version, keeping the first (newest) occurrence
  const seen = new Set<string>();
  const releases = rows.filter((r) => {
    const key = r.version ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const latest = releases[0] ?? {
    version: null,
    releaseDate: null,
    macos: null,
    windows: null,
  };
  return {
    app,
    name,
    version: latest.version,
    releaseDate: latest.releaseDate,
    macos: latest.macos,
    windows: latest.windows,
    macExt: extOf(latest.macos, macExtFb),
    winExt: extOf(latest.windows, winExtFb),
    releases,
  };
}

export const GET: APIRoute = async ({ url }) => {
  const app = (url.searchParams.get('app') || 'synthtribe').toLowerCase();
  console.log('[api/app-update] request', { app });
  if (!cloudCreds())
    return json({ error: 'server has no cloud credentials configured' }, 501);
  try {
    const token = await getToken();
    const out =
      app in PER_PLATFORM
        ? await perPlatformApp(app, token)
        : await synthtribe(token);
    if (!out.releases.length) return json({ error: 'no releases found' }, 502);
    console.log('[api/app-update] result', {
      app,
      versions: out.releases.length,
    });
    // desktop-app versions change rarely and are independent of our deploy ->
    // durable CDN cache, 1h fresh + 24h stale-while-revalidate.
    return json(
      out,
      200,
      cacheHeaders({
        browser: 300,
        cdn: 3600,
        swr: 86400,
        durable: true,
        tag: 'app-update',
      }),
    );
  } catch (e) {
    console.error('[api/app-update] error:', e);
    return json(
      { error: (e as Error).message || 'app-update lookup failed' },
      502,
    );
  }
};
