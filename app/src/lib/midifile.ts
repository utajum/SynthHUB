// Minimal Standard MIDI File support for the pattern library: write one
// pattern as an SMF type-0 file and read notes back from any type-0/1 file.
// 16th-note grid, TPQN 480.

export const TPQN = 480;
const TICKS_16TH = TPQN / 4;

export interface MidiNote {
  step: number; // 16th-grid index
  note: number;
  velocity: number;
  gateSteps: number; // duration in 16th steps (fraction ok)
}

// variable-length quantity
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

function str(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

// build an SMF type-0 file from grid notes
export function writeMidi(
  notes: MidiNote[],
  tempo: number,
  channel = 0,
): Uint8Array {
  interface Ev {
    tick: number;
    bytes: number[];
  }
  const evs: Ev[] = [];
  for (const n of notes) {
    const on = Math.round(n.step * TICKS_16TH);
    const off = Math.round((n.step + Math.max(0.05, n.gateSteps)) * TICKS_16TH);
    evs.push({
      tick: on,
      bytes: [0x90 | channel, n.note & 0x7f, n.velocity & 0x7f],
    });
    evs.push({ tick: off, bytes: [0x80 | channel, n.note & 0x7f, 0] });
  }
  evs.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);

  const track: number[] = [];
  // tempo meta (microseconds per quarter)
  const usq = Math.round(60000000 / Math.max(1, tempo));
  track.push(
    0,
    0xff,
    0x51,
    0x03,
    (usq >> 16) & 0xff,
    (usq >> 8) & 0xff,
    usq & 0xff,
  );
  let last = 0;
  for (const ev of evs) {
    track.push(...vlq(ev.tick - last), ...ev.bytes);
    last = ev.tick;
  }
  track.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track

  const bytes: number[] = [
    ...str('MThd'),
    ...u32(6),
    ...u16(0), // format 0
    ...u16(1), // one track
    ...u16(TPQN),
    ...str('MTrk'),
    ...u32(track.length),
    ...track,
  ];
  return Uint8Array.from(bytes);
}

// parse an SMF (format 0/1); returns grid notes quantized to 16ths + tempo
export function readMidi(
  buf: Uint8Array,
): { notes: MidiNote[]; tempo: number } | null {
  if (buf.length < 14 || String.fromCharCode(...buf.slice(0, 4)) !== 'MThd')
    return null;
  const tracks = (buf[10] << 8) | buf[11];
  const division = (buf[12] << 8) | buf[13];
  if (division & 0x8000) return null; // SMPTE time not supported
  const tpq = division || TPQN;

  let tempo = 120;
  const notes: MidiNote[] = [];
  const open = new Map<number, { tick: number; velocity: number }>();
  let p = 14;

  for (let t = 0; t < tracks && p + 8 <= buf.length; t++) {
    if (String.fromCharCode(...buf.slice(p, p + 4)) !== 'MTrk') break;
    const len =
      (buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7];
    let q = p + 8;
    const end = q + len;
    let tick = 0;
    let running = 0;
    while (q < end) {
      // delta time
      let dt = 0;
      while (q < end) {
        const b = buf[q++];
        dt = (dt << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      tick += dt;
      let status = buf[q];
      if (status < 0x80) {
        status = running; // running status
      } else {
        q++;
        running = status;
      }
      const kind = status & 0xf0;
      if (status === 0xff) {
        const type = buf[q++];
        let mlen = 0;
        while (q < end) {
          const b = buf[q++];
          mlen = (mlen << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        if (type === 0x51 && mlen === 3) {
          const usq = (buf[q] << 16) | (buf[q + 1] << 8) | buf[q + 2];
          if (usq > 0) tempo = Math.round(60000000 / usq);
        }
        q += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        let mlen = 0;
        while (q < end) {
          const b = buf[q++];
          mlen = (mlen << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        q += mlen;
      } else if (kind === 0x90 || kind === 0x80) {
        const note = buf[q++];
        const vel = buf[q++];
        if (kind === 0x90 && vel > 0) {
          if (!open.has(note)) open.set(note, { tick, velocity: vel });
        } else {
          const o = open.get(note);
          if (o) {
            open.delete(note);
            notes.push({
              step: Math.round((o.tick / tpq) * 4),
              note,
              velocity: o.velocity,
              gateSteps: Math.max(0.1, ((tick - o.tick) / tpq) * 4),
            });
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) {
        q += 1;
      } else {
        q += 2;
      }
    }
    p = end;
  }
  notes.sort((a, b) => a.step - b.step || a.note - b.note);
  return { notes, tempo };
}
