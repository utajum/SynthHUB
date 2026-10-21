// WebMIDI binding for the paced protocol links (devices/_shared/midi-io.ts).
// Replies are taken from the input whose name matches the output's (KS37 and
// BSP share one SysEx header); if no input matches, any input is accepted.
import { midi } from './webmidi';
import type { MidiIO } from '../../devices/_shared/midi-io';

export function portIO(outputId: string): MidiIO {
  return {
    send(bytes) {
      midi.send(outputId, bytes);
    },
    listen(cb) {
      const { inputs, outputs } = midi.listPorts();
      const name = outputs.find((o) => o.id === outputId)?.name;
      const paired = !!name && inputs.some((i) => i.name === name);
      return midi.onMessage((data, input) => {
        if (data[0] !== 0xf0) return;
        if (paired && input.name !== name) return;
        cb(data);
      });
    },
  };
}

// offer a file download
export function saveFile(
  name: string,
  data: string | Uint8Array,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
