// Poly-chain status view (read-only): queries with SysEx 0x7e and shows the
// reply plus the last operation-mode change (cmd 0x03).
import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { DeviceVariant } from '../lib/types';
import { midi } from '../lib/midi/webmidi';
import { actions } from '../lib/store-solid';
import {
  queryPolyChain,
  decodePolyChain,
  operationModeLabel,
} from '../devices/_shared/polychain';
import { parseFrame, hex } from '../lib/midi/sysex';

interface Props {
  variant: DeviceVariant;
  outputId: () => string | undefined;
}

export default function PolyChainView(props: Props) {
  const [status, setStatus] = createSignal<{
    a: number;
    b: number;
    c: number;
    d: number;
    raw: number[];
  } | null>(null);
  const [mode, setMode] = createSignal<number | null>(null);
  const [waiting, setWaiting] = createSignal(false);

  onMount(() => {
    const off = midi.onMessage((data) => {
      const pc = decodePolyChain(props.variant, data);
      if (pc) {
        setStatus(pc);
        setWaiting(false);
        actions().pushLog({ dir: 'in', text: `poly-chain: ${hex(pc.raw)}` });
        return;
      }
      // operation-mode change (cmd 0x03) - keep the displayed mode in sync
      const r = parseFrame(props.variant, data);
      if (r && r.cmd === 0x03) setMode(r.payload[0] ?? 0);
    });
    onCleanup(off);
  });

  const query = () => {
    const out = props.outputId();
    if (!out) {
      actions().pushLog({
        dir: 'info',
        text: 'poly-chain query: no MIDI output',
      });
      return;
    }
    setWaiting(true);
    const msg = queryPolyChain(props.variant);
    midi.send(out, msg);
    actions().pushLog({ dir: 'out', text: `poly-chain query  >  ${hex(msg)}` });
    setTimeout(() => setWaiting(false), 2500);
  };

  return (
    <div class="stack">
      <p class="hot">Poly-chain</p>
      <p class="muted tiny">
        Chain multiple identical units to share voices. Engage poly-chain from
        the device's own panel; this queries and displays the chain status the
        unit reports (SysEx 0x7e).
      </p>
      <div class="flex wrap" style={{ 'align-items': 'center', gap: '0.5rem' }}>
        <button
          class="btn"
          disabled={!props.outputId() || waiting()}
          onClick={query}
        >
          {waiting() ? 'querying...' : 'QUERY CHAIN'}
        </button>
        <Show when={mode() !== null}>
          <span class="pill tiny">mode: {operationModeLabel(mode()!)}</span>
        </Show>
      </div>
      <Show
        when={status()}
        fallback={
          <p class="tiny dim">
            No status yet - connect a chained unit and query.
          </p>
        }
      >
        {(s) => (
          <table class="mono-table">
            <thead>
              <tr>
                <th>field</th>
                <th>value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="hot">a</td>
                <td>{s().a}</td>
              </tr>
              <tr>
                <td class="hot">b (voice index)</td>
                <td>{s().b}</td>
              </tr>
              <tr>
                <td class="hot">c</td>
                <td>{s().c}</td>
              </tr>
              <tr>
                <td class="hot">d</td>
                <td>{s().d}</td>
              </tr>
              <tr>
                <td class="dim">raw</td>
                <td class="tiny">{hex(s().raw)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Show>
    </div>
  );
}
