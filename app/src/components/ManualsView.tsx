// Manuals panel (info only): lists the official Behringer PDF manuals / QSGs
// for the device and links out to them - this app hosts nothing.
import { For, Show } from 'solid-js';
import type { ManualItem } from '../lib/manuals';

// friendlier label for the raw storefront downloadType
function typeLabel(t: string | null): string {
  if (!t) return 'PDF';
  if (t === 'Quick Start') return 'Quick start';
  return t;
}

export default function ManualsView(props: { manuals: ManualItem[] }) {
  return (
    <div class="stack">
      <div class="flex" style={{ 'justify-content': 'space-between' }}>
        <p class="hot" style={{ margin: 0 }}>
          Manuals
        </p>
        <span class="pill tiny">official Behringer PDFs</span>
      </div>

      <table class="mono-table">
        <thead>
          <tr>
            <th>Document</th>
            <th style={{ width: '7rem' }}>Type</th>
            <th style={{ width: '4rem' }}>Lang</th>
            <th style={{ width: '5rem' }} />
          </tr>
        </thead>
        <tbody>
          <For each={props.manuals}>
            {(m) => (
              <tr>
                <td>
                  <span class="hot">{m.title ?? m.filename}</span>
                  <br />
                  <span class="tiny dim">{m.filename}</span>
                </td>
                <td class="tiny dim">{typeLabel(m.type)}</td>
                <td class="tiny dim">{m.language ?? '-'}</td>
                <td>
                  <a
                    class="btn tiny fw-btn"
                    href={m.url}
                    download={m.filename}
                    target="_blank"
                    rel="noopener"
                  >
                    open
                  </a>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <p class="tiny dim">
        Official Behringer quick-start guides / manuals (PDF), hosted by
        Behringer. Links open the document in a new tab.
      </p>
    </div>
  );
}
