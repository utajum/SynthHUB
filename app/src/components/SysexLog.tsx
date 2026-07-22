// live SysEx / MIDI activity console
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { actions, useApp } from '../lib/store-solid';
import { Icon } from './Icons';

const DIR_CLASS: Record<string, string> = {
  out: 'hot',
  in: 'amber',
  info: 'dim',
};
const DIR_ARROW: Record<string, string> = { out: '>>', in: '<<', info: '-' };

// one log entry -> one plain-text line
const line = (e: { ts: number; dir: string; text: string }) =>
  `${new Date(e.ts).toLocaleTimeString()} ${DIR_ARROW[e.dir]} ${e.text}`;

// copy via clipboard API, falling back to a temp textarea
async function toClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

export default function SysexLog() {
  const log = useApp((s) => s.log);
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => timer && clearTimeout(timer));

  // copy the whole log (oldest first) and flash a check
  const copy = async () => {
    const entries = log();
    if (!entries.length) return;
    if (await toClipboard(entries.map(line).join('\n'))) {
      setCopied(true);
      timer && clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div
      class="panel"
      style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}
    >
      <header>
        <span>midi monitor</span>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button
            class="btn ghost icon-btn tiny"
            onClick={copy}
            disabled={!log().length}
            title="Copy log to clipboard"
          >
            <Icon name={copied() ? 'check' : 'copy'} />
          </button>
          <button class="btn ghost tiny" onClick={() => actions().clearLog()}>
            clear
          </button>
        </div>
      </header>
      <div
        class="body scroll"
        style={{ flex: '1', 'font-size': '11px', 'min-height': '120px' }}
      >
        <Show
          when={log().length}
          fallback={
            <p class="dim">
              no traffic yet - change a setting or connect a device.
            </p>
          }
        >
          <For each={log().slice().reverse()}>
            {(e) => (
              <div class="log-line">
                <span class="dim">{new Date(e.ts).toLocaleTimeString()}</span>{' '}
                <span class={DIR_CLASS[e.dir]}>{DIR_ARROW[e.dir]}</span>{' '}
                <span class={DIR_CLASS[e.dir]}>{e.text}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
