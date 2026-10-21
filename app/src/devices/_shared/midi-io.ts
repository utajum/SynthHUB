// Byte-level port seen by the paced protocol links (Arturia, Swing). The app
// binds it to WebMIDI (lib/midi/port-io.ts); tests bind fakes or raw ALSA.
export interface MidiIO {
  send(bytes: Uint8Array): void;
  // subscribe to complete SysEx frames from the device; returns unsubscribe
  listen(cb: (bytes: Uint8Array) => void): () => void;
}

export type Progress = (done: number, total: number) => void;
