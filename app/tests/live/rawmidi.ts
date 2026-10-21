// ALSA raw-MIDI transport for live hardware tests (Linux only): opens
// /dev/snd/midiC<card>D<dev> and exposes the MidiIO interface the app's
// protocol links use, delivering complete SysEx frames.
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';
import type { MidiIO } from '../../src/devices/_shared/midi-io';

export class RawMidi implements MidiIO {
  private fd: number;
  private buf: number[] = [];
  private listeners = new Set<(b: Uint8Array) => void>();
  private polling = false;
  private chunk = Buffer.alloc(4096);

  // hw: "hw:3,0,0" | "hw:3,0" | "/dev/snd/midiC3D0"
  constructor(hw: string) {
    const m = /^hw:(\d+),(\d+)/.exec(hw);
    const path = m ? `/dev/snd/midiC${m[1]}D${m[2]}` : hw;
    this.fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
    this.drain();
  }

  drain() {
    try {
      while (readSync(this.fd, this.chunk, 0, this.chunk.length, null) > 0);
    } catch {
      /* EAGAIN: empty */
    }
    this.buf = [];
  }

  send(bytes: Uint8Array) {
    writeSync(this.fd, bytes);
  }

  listen(cb: (b: Uint8Array) => void) {
    this.listeners.add(cb);
    this.startPolling();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private startPolling() {
    if (this.polling) return;
    this.polling = true;
    const tick = () => {
      if (!this.listeners.size) {
        this.polling = false;
        return;
      }
      this.pump();
      setImmediate(tick);
    };
    setImmediate(tick);
  }

  private pump() {
    let n = 0;
    try {
      n = readSync(this.fd, this.chunk, 0, this.chunk.length, null);
    } catch {
      return; // EAGAIN
    }
    for (let i = 0; i < n; i++) {
      const b = this.chunk[i];
      if (b >= 0xf8) continue; // realtime (clock) may interleave anywhere
      if (b === 0xf0) this.buf = [b];
      else if (this.buf.length) {
        this.buf.push(b);
        if (b === 0xf7) {
          const f = Uint8Array.from(this.buf);
          this.buf = [];
          for (const l of [...this.listeners]) l(f);
        }
      }
    }
  }

  close() {
    this.listeners.clear();
    closeSync(this.fd);
  }
}
