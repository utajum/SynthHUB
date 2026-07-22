// keyboard-shortcut help modal ("?" to open, Esc to close), grouped by segment
import { For, Show, createMemo } from 'solid-js';
import { HOTKEYS } from '../lib/hotkeys';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal(props: Props) {
  const groups = createMemo(() => {
    const by = new Map<string, typeof HOTKEYS>();
    for (const h of HOTKEYS) {
      const arr = by.get(h.segment) ?? [];
      arr.push(h);
      by.set(h.segment, arr);
    }
    return [...by.entries()];
  });

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={props.onClose} role="presentation">
        <div
          class="modal panel"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={(e) => e.stopPropagation()}
        >
          <header>
            <span>keyboard shortcuts // accessibility</span>
            <button
              class="btn ghost tiny"
              onClick={props.onClose}
              aria-label="Close help"
            >
              Esc
            </button>
          </header>
          <div class="body modal-grid">
            <For each={groups()}>
              {([segment, keys]) => (
                <section class="hk-group">
                  <h3 class="hk-seg">{segment}</h3>
                  <For each={keys}>
                    {(h) => (
                      <div class="hk-row">
                        <span class="hk-keys">
                          <For each={h.keys}>
                            {(k) => (
                              <Show when={k === '-'} fallback={<kbd>{k}</kbd>}>
                                <span class="hk-sep">to</span>
                              </Show>
                            )}
                          </For>
                        </span>
                        <span class="hk-label">{h.label}</span>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
          <div class="body tiny dim">
            Shortcuts are ignored while typing in a field. Scroll the wheel over
            any control to nudge its value; double-click a control to reset it.
          </div>
        </div>
      </div>
    </Show>
  );
}
