// Thin wrapper around the WebMIDI API: SysEx-enabled access, port enumeration
// with hot-plug events, and a pub/sub for incoming messages. All hardware I/O
// funnels through here.
import { midiActivity } from './activity';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  state: MIDIPortDeviceState;
}

type MidiMessageListener = (data: Uint8Array, input: MidiPortInfo) => void;

type PortsListener = (ports: {
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
}) => void;

function info(p: MIDIPort): MidiPortInfo {
  return {
    id: p.id,
    name: p.name ?? '(unnamed)',
    manufacturer: p.manufacturer ?? '',
    type: p.type,
    state: p.state,
  };
}

class MidiEngine {
  private access: MIDIAccess | null = null;
  private msgListeners = new Set<MidiMessageListener>();
  private portListeners = new Set<PortsListener>();
  private boundInputs = new WeakSet<MIDIInput>();
  // in-app pseudo-outputs (virtual synths): listed next to hardware ports and
  // routed by send(); they work even when WebMIDI itself is unavailable
  private virtualOuts = new Map<
    string,
    { info: MidiPortInfo; sink: (data: Uint8Array) => void }
  >();

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get ready(): boolean {
    return this.access !== null;
  }

  // request SysEx-enabled MIDI access; idempotent
  async init(): Promise<boolean> {
    if (this.access) return true;
    if (!MidiEngine.supported) return false;
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => this.emitPorts();
    this.bindInputs();
    this.emitPorts();
    return true;
  }

  private bindInputs() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (this.boundInputs.has(input)) continue;
      this.boundInputs.add(input);
      // compute port info once per binding (MIDI clock is ~48 msg/s)
      const src = info(input);
      input.onmidimessage = (e: MIDIMessageEvent) => {
        if (!e.data) return;
        midiActivity.bumpRx();
        const data = new Uint8Array(e.data);
        for (const l of this.msgListeners) l(data, src);
      };
    }
  }

  private emitPorts() {
    this.bindInputs();
    const ports = this.listPorts();
    for (const l of this.portListeners) l(ports);
  }

  // Release the MIDI session: detach handlers, drop the MIDIAccess, emit an
  // empty port list. Subscribers stay registered so init() reconnects.
  disconnect(): void {
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = null;
      }
      this.access.onstatechange = null;
    }
    this.access = null;
    this.boundInputs = new WeakSet<MIDIInput>();
    this.emitPorts();
  }

  listPorts(): { inputs: MidiPortInfo[]; outputs: MidiPortInfo[] } {
    const virtual = [...this.virtualOuts.values()].map((v) => v.info);
    if (!this.access) return { inputs: [], outputs: virtual };
    return {
      inputs: [...this.access.inputs.values()].map(info),
      outputs: [...this.access.outputs.values()].map(info).concat(virtual),
    };
  }

  // add/remove an in-app output (id convention: "virtual:<slug>")
  registerVirtualOutput(
    id: string,
    name: string,
    sink: (data: Uint8Array) => void,
  ): void {
    this.virtualOuts.set(id, {
      info: {
        id,
        name,
        manufacturer: 'SynthHUB',
        type: 'output',
        state: 'connected',
      },
      sink,
    });
    this.emitPorts();
  }

  unregisterVirtualOutput(id: string): void {
    if (this.virtualOuts.delete(id)) this.emitPorts();
  }

  send(outputId: string, data: Uint8Array): boolean {
    const v = this.virtualOuts.get(outputId);
    if (v) {
      v.sink(data);
      midiActivity.bumpTx();
      return true;
    }
    const out = this.access?.outputs.get(outputId);
    if (!out) return false;
    out.send(data);
    midiActivity.bumpTx();
    return true;
  }

  // send to the first output whose name matches the predicate
  sendToNamed(predicate: (name: string) => boolean, data: Uint8Array): boolean {
    if (!this.access) return false;
    for (const out of this.access.outputs.values()) {
      if (predicate(out.name ?? '')) {
        out.send(data);
        midiActivity.bumpTx();
        return true;
      }
    }
    return false;
  }

  onMessage(l: MidiMessageListener): () => void {
    this.msgListeners.add(l);
    return () => this.msgListeners.delete(l);
  }

  onPorts(l: PortsListener): () => void {
    this.portListeners.add(l);
    return () => this.portListeners.delete(l);
  }
}

// process-wide singleton
export const midi = new MidiEngine();
