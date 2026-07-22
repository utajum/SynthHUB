// DeviceList: detected synths (live) plus the searchable catalogue.
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { deviceIndex } from '../devices/registry';
import { actions, useApp } from '../lib/store-solid';
import { deviceImage } from '../lib/deviceImages';
import { onCommand } from '../lib/hotkeys';
import { deviceHref, isPlainLeftClick, markUserNav } from '../lib/nav';

export default function DeviceList() {
  const detected = useApp((s) => s.detected);
  const selected = useApp((s) => s.selectedSlug);
  const [query, setQuery] = createSignal('');
  let filterInput: HTMLInputElement | undefined;

  // rows are real <a> links (crawlable, middle-click works); a plain left
  // click selects in-app without a reload
  const pick = (e: MouseEvent, slug: string) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    markUserNav();
    actions().select(slug);
  };

  const detectedSlugs = createMemo(
    () => new Set(detected().map((d) => d.slug)),
  );

  const catalogue = createMemo(() => {
    const q = query().trim().toLowerCase();
    return deviceIndex
      .filter(
        (d) => !q || d.name.toLowerCase().includes(q) || d.slug.includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // group the catalogue by source app (SynthTribe synths vs Control Tribe)
  const APP_ORDER = ['synthtribe', 'controltribe', 'guitartribe'] as const;
  const APP_LABELS: Record<string, string> = {
    synthtribe: 'SynthTribe',
    controltribe: 'Control Tribe',
    guitartribe: 'GuitarTribe',
  };
  const grouped = createMemo(() => {
    const g: Record<string, typeof deviceIndex> = {};
    for (const d of catalogue()) {
      const app = d.app ?? 'synthtribe';
      (g[app] ??= [] as unknown as typeof deviceIndex).push(d);
    }
    return g;
  });

  // keyboard navigation must follow the exact visual (grouped) order, or j/k
  // jump between rows that sit far apart on screen
  let scrollBody: HTMLDivElement | undefined;
  const navList = createMemo(() => {
    const g = grouped();
    return APP_ORDER.flatMap((app) => (g[app] ?? []).map((d) => d.slug));
  });
  const step = (delta: number) => {
    const list = navList();
    if (!list.length) return;
    const cur = list.indexOf(selected() ?? '');
    // wrap around at the ends
    const next =
      cur < 0
        ? delta > 0
          ? 0
          : list.length - 1
        : (cur + delta + list.length) % list.length;
    if (next === cur) return;
    markUserNav();
    actions().select(list[next]);
    // scroll only within this list's own container so the page never moves
    const container = scrollBody;
    const el = container?.querySelector<HTMLElement>(
      `[data-slug="${list[next]}"]`,
    );
    if (el && container) {
      // pin to top on wrap so the group header stays visible
      if (next === 0) {
        container.scrollTop = 0;
      } else {
        const c = container.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        if (e.top < c.top) container.scrollTop -= c.top - e.top;
        else if (e.bottom > c.bottom)
          container.scrollTop += e.bottom - c.bottom;
      }
    }
  };
  onMount(() => {
    const subs = [
      onCommand('device:next', () => step(1)),
      onCommand('device:prev', () => step(-1)),
      onCommand('filter:focus', () => filterInput?.focus()),
    ];
    onCleanup(() => subs.forEach((u) => u()));
  });

  return (
    <div
      class="panel"
      style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}
    >
      <header>
        <span>devices</span>
        <span class="pill tiny">{deviceIndex.length} models</span>
      </header>
      <div class="body" style={{ 'padding-bottom': '0.4rem' }}>
        {/* live-detected */}
        <Show when={detected().length}>
          <div class="tiny dim" style={{ 'margin-bottom': '0.3rem' }}>
            ONLINE
          </div>
          <div class="online-grid">
            <For each={detected()}>
              {(d) => (
                <div class={`dev-card ${selected() === d.slug ? 'sel' : ''}`}>
                  <a
                    class="dev-card-link"
                    href={deviceHref(d.slug)}
                    data-slug={d.slug}
                    onClick={(e) => pick(e, d.slug)}
                    title={`${d.variant} - ${d.via.join('+')}`}
                  >
                    <span class="dev-card-media">
                      <Show
                        when={deviceImage(d.slug, d.variant)}
                        fallback={<span class="dev-card-noimg">no image</span>}
                      >
                        {(src) => (
                          <img src={src()} alt={d.variant} loading="lazy" />
                        )}
                      </Show>
                      <span class="dot on live-dot" />
                    </span>
                    <span class="dev-card-name">{d.variant}</span>
                    <span class="dev-card-via tiny">
                      <span class="hot">{d.via.join('+')}</span>
                      <Show when={d.usbPid}> - {d.usbPid}</Show>
                    </span>
                  </a>
                  {/* USB-detected units can have their grant revoked here */}
                  <Show when={d.usbPid}>
                    <button
                      class="btn danger tiny dev-card-disc"
                      onClick={() => actions().forgetUsb(d.usbPid)}
                      title={`Disconnect ${d.variant} (${d.usbPid}) - revoke USB access`}
                    >
                      DISCONNECT
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <div class="hr" />
        </Show>

        <input
          ref={filterInput}
          type="search"
          placeholder="/ filter catalogue..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          style={{ 'margin-bottom': '0.4rem' }}
        />
      </div>

      <div
        ref={scrollBody}
        class="body scroll"
        style={{ flex: '1', 'padding-top': 0 }}
      >
        <For each={APP_ORDER}>
          {(app) => (
            <Show when={grouped()[app]?.length}>
              <div class="tiny dim device-app-hdr">{APP_LABELS[app]}</div>
              <For each={grouped()[app]}>
                {(d) => (
                  <a
                    class={`dev-row ${selected() === d.slug ? 'sel' : ''} ${
                      detectedSlugs().has(d.slug) ? 'is-online' : ''
                    }`}
                    href={deviceHref(d.slug)}
                    data-slug={d.slug}
                    onClick={(e) => pick(e, d.slug)}
                    title={d.functions.join(', ')}
                  >
                    <Show
                      when={deviceImage(d.slug)}
                      fallback={
                        <span
                          class={`dot ${detectedSlugs().has(d.slug) ? 'on' : ''}`}
                        />
                      }
                    >
                      {(src) => (
                        <img
                          class="dev-thumb"
                          src={src()}
                          alt=""
                          loading="lazy"
                        />
                      )}
                    </Show>
                    <span class="name">{d.name}</span>
                    <span class="tags tiny">
                      <Show when={d.hasSequencer}>
                        <span class="pill tiny">seq</span>
                      </Show>
                      <span class="dim">p{d.protocols.join('/')}</span>
                    </span>
                  </a>
                )}
              </For>
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}
