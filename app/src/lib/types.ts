// Core domain types. These mirror the normalized device definitions produced
// by scripts/extract_features.py from the SynthTribe app resources.

// hex byte string such as "0x00" or "0x1e"
type HexByte = string;

// SysEx protocol family
export type ProtocolId = 0 | 1 | 2 | 3 | 4 | 5;

// UI widget a setting renders as
type ControlKind =
  | 'dropdown'
  | 'dual-dropdown'
  | 'toggle'
  | 'spinbox'
  | 'radio'
  | 'slider'
  | 'composite'
  | 'button'
  | 'control';

// SysEx addressing recovered for a parameter
export interface SysexAddress {
  // primary command / parameter selector byte
  pkt?: number;
  // sub-selector, used when pkt is the extended command (116)
  spkt?: number;
  // parameter subtype flag used by some protocols
  subtype?: number;
}

// a normalized, renderable device setting
export interface DeviceSetting {
  type: string;
  kind: ControlKind;
  title: string;
  control?: string;
  options?: string[];
  min?: number;
  max?: number;
  default?: number | string;
  sysex?: SysexAddress;
  minFirmware?: string;
  // full original setting object from the SynthTribe config
  raw: Record<string, unknown>;
}

// a functional area of a device (General, Sequencer, Calibration, ...)
export interface DeviceFunction {
  name: string;
  // sequencer layout id when name === 'Sequencer'
  type?: number;
  rows?: number;
  columns?: number;
  numofkey?: number;
  supportdump?: boolean;
  lengthlabel?: string;
  banklabel?: string;
  patternlabel?: string;
  pattern_count?: number;
  settings?: DeviceSetting[];
  cvchannels?: unknown[];
}

// one physical/branding variant of a device (e.g. "2600 Blue Marvin")
export interface DeviceVariant {
  name: string;
  aliases: string[];
  // USB product ids (with Behringer VID 0x1397), lower-cased hex
  pids: HexByte[];
  protocol: ProtocolId;
  modelId: HexByte[];
  deviceId: HexByte;
  cloudFamily?: string;
  cloudModel?: string;
  introImg?: string;
}

// which official desktop app a device belongs to (default synthtribe)
type DeviceApp = 'synthtribe' | 'controltribe' | 'guitartribe';

// named preset: control values keyed by store param key (GuitarTribe pedals)
interface DevicePreset {
  name: string;
  values: Record<string, number>;
}

// a complete normalized device definition
export interface DeviceDef {
  slug: string;
  name: string;
  app?: DeviceApp;
  manufacturerId: HexByte[];
  variants: DeviceVariant[];
  functions: DeviceFunction[];
  // factory presets (GuitarTribe pedals ship these)
  presets?: DevicePreset[];
}

// lightweight discovery/routing index entry
export interface DeviceIndexEntry {
  slug: string;
  name: string;
  app?: DeviceApp;
  pids: HexByte[];
  aliases?: string[];
  protocols: ProtocolId[];
  functions: string[];
  hasSequencer: boolean;
  variantCount: number;
}

// Behringer / Music Tribe USB vendor id
export const BEHRINGER_VID = 0x1397;

// Music Tribe SysEx manufacturer id bytes
export const MUSIC_TRIBE_MFR = [0x00, 0x20, 0x32] as const;
