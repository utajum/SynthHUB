// Latest official Behringer desktop app version + a table of all versions
// (macOS + Windows downloads), from /api/app-update. `app` selects which
// desktop app; this PWA just points users at the official builds.
import { For, Show, createSignal, onMount } from 'solid-js';

interface Row {
  version: string | null;
  releaseDate: string | null;
  macos: string | null;
  windows: string | null;
}
interface AppInfo extends Row {
  name?: string;
  macExt?: string;
  winExt?: string;
  releases?: Row[];
}

type AppId = 'synthtribe' | 'controltribe' | 'guitartribe' | 'musictribejam';

const APP_LABELS: Record<AppId, string> = {
  synthtribe: 'SynthTribe',
  controltribe: 'Control Tribe',
  guitartribe: 'GuitarTribe',
  musictribejam: 'MusicTribe Jam',
};

interface Props {
  app?: AppId;
  name?: string;
}

export default function AppUpdate(props: Props) {
  const app = props.app ?? 'synthtribe';
  const label = props.name ?? APP_LABELS[app] ?? 'SynthTribe';
  const [info, setInfo] = createSignal<AppInfo | null>(null);
  const [err, setErr] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const res = await fetch(`/api/app-update?app=${app}`, {
        headers: { Accept: 'application/json' },
      });
      const d = (await res.json().catch(() => null)) as
        (AppInfo & { error?: string }) | null;
      if (!res.ok || !d || d.error)
        throw new Error(d?.error || `failed (${res.status})`);
      setInfo(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  });

  return (
    <div class="stack" style={{ gap: '0.5rem' }}>
      <Show when={loading()}>
        <span class="tiny dim">checking {label} versions...</span>
      </Show>
      <Show when={err()}>
        <span class="tiny amber">
          {label} app info unavailable: {err()}
        </span>
      </Show>
      <Show when={info()}>
        <p class="tiny dim" style={{ margin: 0 }}>
          Official Behringer {label} desktop app - latest{' '}
          <span class="hot">v{info()!.version}</span>
          <Show when={info()!.releaseDate}>{` (${info()!.releaseDate})`}</Show>
          <Show
            when={info()!.releases}
          >{` - ${info()!.releases!.length} versions`}</Show>
        </p>
        <div class="scroll fw-versions-wrap">
          <table class="mono-table fw-versions">
            <thead>
              <tr>
                <th>Version</th>
                <th>Date</th>
                <th>macOS</th>
                <th>Windows</th>
              </tr>
            </thead>
            <tbody>
              <For each={info()!.releases ?? []}>
                {(r) => (
                  <tr>
                    <td class="hot">{r.version}</td>
                    <td class="tiny dim">{r.releaseDate ?? '-'}</td>
                    <td>
                      <Show
                        when={r.macos}
                        fallback={<span class="tiny dim">-</span>}
                      >
                        <a
                          class="btn tiny fw-btn"
                          href={r.macos!}
                          target="_blank"
                          rel="noopener"
                        >
                          .{extOf(r.macos, info()?.macExt ?? 'dmg')}
                        </a>
                      </Show>
                    </td>
                    <td>
                      <Show
                        when={r.windows}
                        fallback={<span class="tiny dim">-</span>}
                      >
                        <a
                          class="btn tiny fw-btn"
                          href={r.windows!}
                          target="_blank"
                          rel="noopener"
                        >
                          .{extOf(r.windows, info()?.winExt ?? 'exe')}
                        </a>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );

  function extOf(url: string | null, fb: string): string {
    const m = url && url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i);
    return m ? m[1].toLowerCase() : fb;
  }
}
