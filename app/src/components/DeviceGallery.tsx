// visual device picker shown on the empty state
import { For, Show } from 'solid-js';
import { deviceIndex } from '../devices/registry';
import { deviceImage } from '../lib/deviceImages';
import { actions } from '../lib/store-solid';
import { deviceHref, isPlainLeftClick, markUserNav } from '../lib/nav';

export default function DeviceGallery() {
  const devices = deviceIndex
    .filter((d) => deviceImage(d.slug))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const pick = (e: MouseEvent, slug: string) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    markUserNav();
    actions().select(slug);
    // land at the top of the new device page (gallery only; sidebar clicks
    // and j/k preserve scroll)
    window.scrollTo(0, 0);
  };

  return (
    <div class="gallery">
      <For each={devices}>
        {(d) => (
          <a
            class="gallery-card"
            href={deviceHref(d.slug)}
            onClick={(e) => pick(e, d.slug)}
          >
            <img src={deviceImage(d.slug)!} alt={d.name} loading="lazy" />
            <div class="cap">
              <span class="name">{d.name}</span>
              <Show when={d.hasSequencer}>
                <span class="pill tiny">seq</span>
              </Show>
            </div>
          </a>
        )}
      </For>
    </div>
  );
}
