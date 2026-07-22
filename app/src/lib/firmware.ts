// Firmware status (info only - never flashes). Device version is queried over
// WebMIDI with cmd 0x08; the server version comes from our backend route
// (GET /api/firmware)
import { frameHeader, hex, isMusicTribeSysex, EOX } from './midi/sysex';
import { midi } from './midi/webmidi';
import type { DeviceVariant } from './types';

const FW_QUERY_CMD = 0x08;

export interface DeviceFirmware {
  version: string | null;
  raw: string;
}

// all candidate version queries for a variant: model-addressed plus the
// app's broadcast fallback, maximizing the chance of a reply
function firmwareQueries(variant: DeviceVariant): Uint8Array[] {
  const h = frameHeader(variant);
  return [
    Uint8Array.from([...h, FW_QUERY_CMD, EOX]),
    Uint8Array.from([...h.slice(0, 7), 0x7f, FW_QUERY_CMD, EOX]),
    Uint8Array.from([
      0xf0,
      0x00,
      0x20,
      0x32,
      0x00,
      0x7f,
      0x70,
      0x00,
      0x00,
      0x00,
      0x02,
      0x31,
      EOX,
    ]),
  ];
}

// extract a "1.2.3"-style version from a Music Tribe SysEx reply
function parseDeviceVersion(data: Uint8Array): string | null {
  const body = data.slice(4, data.length - 1);
  const ascii = Array.from(body, (b) =>
    b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ',
  ).join('');
  const m = ascii.match(/\d+\.\d+(?:\.\d+)?/);
  if (m) return m[0];
  const p = Array.from(body).filter((b) => b < 0x80);
  if (p.length >= 3) return p.slice(-3).join('.');
  return null;
}

// send the query candidates and resolve with the first Music Tribe reply
export function queryDeviceFirmware(
  variant: DeviceVariant,
  outputId: string | undefined,
  timeoutMs = 1500,
): Promise<DeviceFirmware | null> {
  return new Promise((resolve) => {
    if (!outputId) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (r: DeviceFirmware | null) => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(r);
    };
    const unsub = midi.onMessage((d) => {
      if (d[0] === 0xf0 && isMusicTribeSysex(d)) {
        done({ version: parseDeviceVersion(d), raw: hex(d) });
      }
    });
    for (const q of firmwareQueries(variant)) midi.send(outputId, q);
    setTimeout(() => done(null), timeoutMs);
  });
}

// cloud firmware check via the backend route

interface FirmwareRelease {
  version: string | null;
  // pre-signed .syx blob URL (time-limited, no auth)
  downloadUrl?: string;
  filename?: string;
  // pre-signed release-notes URL (only when it is a real http URL)
  notesUrl?: string;
  // inline release-notes text, when the cloud notes field is not a URL
  notesText?: string;
  // YYYY-MM-DD from the cloud createdAt/updatedAt
  releaseDate?: string;
  checksum?: string;
  bytes?: number;
}

// top-level fields mirror the latest release; `releases` lists all (desc)
export interface ServerFirmware extends FirmwareRelease {
  releases?: FirmwareRelease[];
}

// fetch the latest firmware release via the backend route; throws with the
// server-provided message on failure
export async function fetchServerFirmware(
  cloudFamily: string,
  cloudModel: string,
): Promise<ServerFirmware> {
  const qs = new URLSearchParams({ family: cloudFamily, model: cloudModel });
  const res = await fetch(`/api/firmware?${qs}`, {
    headers: { Accept: 'application/json' },
  });
  const data = (await res.json().catch(() => null)) as
    (ServerFirmware & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error || `firmware lookup failed (${res.status})`);
  }
  return data;
}

export type CompareResult =
  'up-to-date' | 'update-available' | 'ahead' | 'unknown';

export function compareFirmware(
  device: string | null,
  server: string | null,
): CompareResult {
  if (!device || !server) return 'unknown';
  const norm = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const a = norm(device);
  const b = norm(server);
  if (!a.length || !b.length) return 'unknown';
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return 'update-available';
    if (x > y) return 'ahead';
  }
  return 'up-to-date';
}
