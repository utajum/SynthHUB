// TransportBar: connect buttons + live status for WebUSB (discovery) and
// WebMIDI (SysEx management channel). Both need a user gesture/permission.
// Also hosts the RX/TX activity LEDs and the MIDI panic button.
import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { actions, useApp } from '../lib/store-solid';
import { toggleDrawer, logOpen, toggleLog } from '../lib/ui';
import { midiActivity } from '../lib/midi/activity';
import { Icon } from './Icons';

function dotClass(state: string): string {
  switch (state) {
    case 'ready':
      return 'dot on';
    case 'requesting':
      return 'dot warn';
    case 'denied':
    case 'unsupported':
      return 'dot err';
    default:
      return 'dot';
  }
}

export default function TransportBar() {
  const midiState = useApp((s) => s.midiState);
  const usbState = useApp((s) => s.usbState);
  const detected = useApp((s) => s.detected);
  const usbCount = useApp((s) => s.usbDevices.length);
  const inputs = useApp((s) => s.midiInputs.length);
  const outputs = useApp((s) => s.midiOutputs.length);

  const summary = createMemo(() => `${detected().length} synth(s)`);

  // wire activity LEDs: poll the activity timestamps on a short ticker
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 130);
    onCleanup(() => clearInterval(id));
  });
  const rxLit = () => now() - midiActivity.rxAt() < 200;
  const txLit = () => now() - midiActivity.txAt() < 200;

  return (
    <div class="panel">
      <header>
        <span>transport // usb bus</span>
        <span class="pill tiny">
          <span class="dot on" /> {summary()}
        </span>
      </header>
      <div class="body flex wrap">
        {/* mobile-only: open the device catalogue drawer */}
        <button
          class="btn primary drawer-btn"
          onClick={toggleDrawer}
          aria-label="Show all devices"
        >
          &#9776; DEVICES
        </button>
        <button
          class="btn primary"
          disabled={usbState() === 'unsupported'}
          onClick={() => actions().requestUsb()}
        >
          CONNECT USB
        </button>
        <Show
          when={midiState() === 'ready'}
          fallback={
            <button
              class="btn"
              disabled={midiState() === 'unsupported'}
              onClick={() => actions().initTransports()}
            >
              ENABLE MIDI
            </button>
          }
        >
          <button
            class="btn danger"
            onClick={() => actions().disconnectMidi()}
            title="Disconnect MIDI - release every MIDI port the app opened"
          >
            DISCONNECT MIDI
          </button>
        </Show>
        <button class="btn ghost" onClick={() => actions().refresh()}>
          SCAN
        </button>
        <button
          class="btn ghost icon-btn"
          disabled={!outputs()}
          onClick={() => actions().panic()}
          title="MIDI panic - all notes off + all sound off on every output, all 16 channels"
        >
          <Icon name="panic" /> PANIC
        </button>

        <span class="spacer" />

        {/* live wire activity */}
        <span
          class={`midi-activity tiny ${rxLit() ? 'lit' : ''}`}
          title="MIDI in activity"
        >
          <span class="led" /> RX
        </span>
        <span
          class={`midi-activity tiny tx ${txLit() ? 'lit' : ''}`}
          title="MIDI out activity"
        >
          <span class="led" /> TX
        </span>

        <span class="pill" title="WebUSB discovery (VID 0x1397)">
          <span class={dotClass(usbState())} /> USB:{usbState()} ({usbCount()})
        </span>
        <span class="pill" title="WebMIDI SysEx management channel">
          <span class={dotClass(midiState())} /> MIDI:{midiState()} - in{' '}
          {inputs()} / out {outputs()}
        </span>
        <button
          class={`btn icon-btn ${logOpen() ? 'ghost' : 'primary'}`}
          onClick={toggleLog}
          title={
            logOpen()
              ? 'Hide the monitor/log column (device panel goes full width)'
              : 'Show the monitor/log column'
          }
          aria-pressed={logOpen()}
        >
          <Icon name="chip" /> LOG
        </button>
      </div>
      <Show
        when={usbState() === 'unsupported' && midiState() === 'unsupported'}
      >
        <div class="body tiny red">
          This browser exposes neither WebUSB nor WebMIDI. Use a Chromium-based
          browser (Chrome/Edge/Brave/Opera) over HTTPS or localhost.
        </div>
      </Show>
    </div>
  );
}
