// MIDI wire activity timestamps (RX/TX LEDs). Plain module state polled by
// the UI on a short ticker - no store updates per message (clock is ~48/s).

let rx = 0;
let tx = 0;

export const midiActivity = {
  bumpRx() {
    rx = Date.now();
  },
  bumpTx() {
    tx = Date.now();
  },
  rxAt(): number {
    return rx;
  },
  txAt(): number {
    return tx;
  },
};
