// Command palette (Ctrl+K): fuzzy jump to any device, jump to a function tab
// of the open device, or run an app action. Self-contained - subscribes to
// the palette:toggle command and renders nothing while closed.
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { onCommand, emitCommand, type Command } from '../lib/hotkeys';
import { deviceIndex, meta } from '../devices/registry';
import { actions, useApp } from '../lib/store-solid';
import { Icon, type IconName } from './Icons';

interface Item {
  kind: 'device' | 'tab' | 'action';
  label: string;
  hint: string;
  icon: IconName;
  keywords: string;
  run: () => void;
}

// substring beats subsequence; earlier match beats later
function fuzzy(q: string, text: string): number {
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return -1;
    gaps += f - ti;
    ti = f + 1;
  }
  return 500 - gaps;
}

export default function CommandPalette() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [cursor, setCursor] = createSignal(0);
  const selectedSlug = useApp((s) => s.selectedSlug);
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    const off = onCommand('palette:toggle', () => {
      setOpen((v) => !v);
      setQuery('');
      setCursor(0);
    });
    onCleanup(off);
  });
  createEffect(() => {
    if (open()) queueMicrotask(() => inputEl?.focus());
  });

  const allItems = createMemo<Item[]>(() => {
    const items: Item[] = [];
    // app actions
    const act = (
      label: string,
      hint: string,
      icon: IconName,
      run: () => void,
    ) =>
      items.push({ kind: 'action', label, hint, icon, keywords: label, run });
    act('Connect USB device', 'request WebUSB access', 'usb', () =>
      actions().requestUsb(),
    );
    act('Enable MIDI', 'request WebMIDI access', 'chip', () =>
      actions().initTransports(),
    );
    act('Scan / rescan devices', 'refresh discovery', 'search', () =>
      actions().refresh(),
    );
    act('MIDI panic', 'all notes off on every output', 'panic', () =>
      actions().panic(),
    );
    act('Keyboard help', 'show the hotkey list', 'star', () =>
      emitCommand('help:toggle'),
    );
    // tabs of the open device
    const slug = selectedSlug();
    if (slug) {
      const m = meta(slug);
      (m?.functions ?? []).slice(0, 9).forEach((fn, i) => {
        items.push({
          kind: 'tab',
          label: fn,
          hint: `${m?.name ?? slug} tab`,
          icon: 'chip',
          keywords: `${fn} tab`,
          run: () => emitCommand(`tab:${i + 1}` as Command),
        });
      });
    }
    // devices
    for (const d of deviceIndex) {
      items.push({
        kind: 'device',
        label: d.name,
        hint: d.functions.join(', ').toLowerCase(),
        icon: 'piano',
        keywords: `${d.name} ${d.slug} ${(d.aliases ?? []).join(' ')}`,
        run: () => actions().select(d.slug),
      });
    }
    return items;
  });

  const results = createMemo(() => {
    const q = query().trim().toLowerCase();
    return allItems()
      .map((it) => ({ it, score: fuzzy(q, it.keywords) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.it);
  });

  const close = () => setOpen(false);
  const runItem = (it: Item) => {
    close();
    it.run();
  };

  const onKey = (e: KeyboardEvent) => {
    // the palette owns the keyboard while open
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results().length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = results()[cursor()];
      if (it) runItem(it);
    }
  };

  return (
    <Show when={open()}>
      <div class="modal-backdrop" onClick={close}>
        <div class="palette panel" onClick={(e) => e.stopPropagation()}>
          <div class="palette-input flex">
            <Icon name="search" size={15} />
            <input
              ref={inputEl}
              type="text"
              placeholder="jump to device, tab or action..."
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setCursor(0);
              }}
              onKeyDown={onKey}
            />
            <span class="pill tiny dim">esc</span>
          </div>
          <div class="palette-list">
            <For
              each={results()}
              fallback={<div class="body tiny dim">no matches</div>}
            >
              {(it, i) => (
                <button
                  class={`palette-item ${i() === cursor() ? 'sel' : ''}`}
                  onMouseEnter={() => setCursor(i())}
                  onClick={() => runItem(it)}
                >
                  <Icon name={it.icon} size={14} />
                  <span class="hot">{it.label}</span>
                  <span class="tiny dim palette-hint">{it.hint}</span>
                  <span class="spacer" />
                  <span class="pill tiny">{it.kind}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
