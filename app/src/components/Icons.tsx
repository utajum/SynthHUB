// Inline SVG icon set (no network fetch, inherits theme colour via
// currentColor). Used across the sequencer and transport UI.
import type { JSX } from 'solid-js';

export type IconName =
  | 'play'
  | 'stop'
  | 'record'
  | 'trash'
  | 'dice'
  | 'ratchet'
  | 'accent'
  | 'slide'
  | 'gate'
  | 'velocity'
  | 'fwd'
  | 'rev'
  | 'pingpong'
  | 'random'
  | 'copy'
  | 'check'
  | 'plus'
  | 'minus'
  | 'piano'
  | 'metronome'
  | 'shift-l'
  | 'shift-r'
  | 'usb'
  | 'chip'
  | 'pencil'
  | 'panic'
  | 'wand'
  | 'save'
  | 'folder'
  | 'star'
  | 'search';

// Glyph FACTORIES, not shared JSX: in Solid a JSX expression is a real DOM
// node created once, so sharing one node across two <Icon>s would move it and
// make the first usage vanish. () => JSX builds fresh nodes each time.
const P: Record<IconName, () => JSX.Element> = {
  play: () => <path d="M6 4l14 8-14 8z" />,
  stop: () => <rect x="5" y="5" width="14" height="14" rx="1" />,
  record: () => <circle cx="12" cy="12" r="6" />,
  trash: () => (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3M6 7l1 13h10l1-13" />
    </>
  ),
  dice: () => (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.2" />
      <circle cx="15" cy="15" r="1.2" />
      <circle cx="15" cy="9" r="1.2" />
      <circle cx="9" cy="15" r="1.2" />
    </>
  ),
  ratchet: () => (
    <>
      <path d="M4 18V8M9 18V6M14 18V9M19 18V5" />
    </>
  ),
  accent: () => <path d="M12 4l7 14H5z" />,
  slide: () => (
    <>
      <path d="M4 16c5 0 5-8 10-8 3 0 6 8 6 8" />
    </>
  ),
  gate: () => <path d="M3 16V9h5v7M8 9h5V5h5v11" />,
  velocity: () => (
    <>
      <path d="M5 18V13M10 18V8M15 18V11M20 18V5" />
    </>
  ),
  fwd: () => <path d="M4 12h14M13 7l5 5-5 5" />,
  rev: () => <path d="M20 12H6M11 7l-5 5 5 5" />,
  pingpong: () => <path d="M6 8l-3 4 3 4M18 8l3 4-3 4M3 12h18" />,
  random: () => (
    <>
      <path d="M4 7h4l8 10h4M4 17h4l3-4M16 7h4M17 4l3 3-3 3M17 20l3-3-3-3" />
    </>
  ),
  copy: () => (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: () => <path d="M4 12l5 5L20 6" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  piano: () => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M9 5v14M15 5v14" />
      <rect
        x="6.6"
        y="5"
        width="2.8"
        height="8"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="12.6"
        y="5"
        width="2.8"
        height="8"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  metronome: () => <path d="M9 3h6l3 18H6zM12 3v10M12 13l4-3" />,
  'shift-l': () => <path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />,
  'shift-r': () => <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />,
  usb: () => (
    <>
      <circle cx="12" cy="19" r="2" />
      <path d="M12 17V4M12 4l-3 3M12 4l3 3M12 11l4-2v-2M8 13l-4-2" />
    </>
  ),
  chip: () => (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
    </>
  ),
  pencil: () => (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  panic: () => (
    <>
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  wand: () => (
    <>
      <path d="M5 19L17 7" />
      <path d="M15 5l4 4" />
      <path d="M5 5v2M4 6h2M19 15v2M18 16h2M11 3v2M10 4h2" />
    </>
  ),
  save: () => (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  folder: () => (
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  ),
  star: () => (
    <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
  ),
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
};

export function Icon(props: {
  name: IconName;
  size?: number;
  fill?: boolean;
  class?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill={props.fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={props.fill ? 0 : 1.7}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
      style={{ 'vertical-align': 'middle', 'flex-shrink': 0 }}
    >
      {P[props.name]()}
    </svg>
  );
}
