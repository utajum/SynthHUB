// Keyboard command bus: one global keydown listener maps keys to commands;
// components subscribe per segment. Keys are only intercepted when a
// subscriber handles them, so scrolling and typing stay intact.

export type Command =
  | 'help:toggle'
  | 'help:close'
  | 'palette:toggle'
  | 'usb:connect'
  | 'midi:enable'
  | 'scan'
  | 'filter:focus'
  | 'device:next'
  | 'device:prev'
  | 'tab:next'
  | 'tab:prev'
  | 'tab:1'
  | 'tab:2'
  | 'tab:3'
  | 'tab:4'
  | 'tab:5'
  | 'tab:6'
  | 'tab:7'
  | 'tab:8'
  | 'tab:9'
  | 'seq:playstop'
  | 'seq:rec'
  | 'seq:clear'
  | 'seq:rand'
  | 'seq:tempo-up'
  | 'seq:tempo-down';

type Handler = () => void;
const handlers = new Map<Command, Set<Handler>>();

export function onCommand(cmd: Command, handler: Handler): () => void {
  let set = handlers.get(cmd);
  if (!set) handlers.set(cmd, (set = new Set()));
  set.add(handler);
  return () => set!.delete(handler);
}

// emit a command; true if at least one subscriber handled it
export function emitCommand(cmd: Command): boolean {
  const set = handlers.get(cmd);
  if (!set || set.size === 0) return false;
  for (const h of set) h();
  return true;
}

// documentation model for the help modal
interface HotkeyDoc {
  segment: string;
  keys: string[];
  label: string;
}

export const HOTKEYS: HotkeyDoc[] = [
  { segment: 'Global', keys: ['?'], label: 'Toggle this help' },
  { segment: 'Global', keys: ['Ctrl', 'K'], label: 'Command palette' },
  { segment: 'Global', keys: ['Esc'], label: 'Close dialog' },
  { segment: 'Global', keys: ['u'], label: 'Connect USB device' },
  { segment: 'Global', keys: ['e'], label: 'Enable MIDI access' },
  { segment: 'Global', keys: ['s'], label: 'Scan / rescan devices' },
  { segment: 'Global', keys: ['/'], label: 'Focus device filter' },
  { segment: 'Devices', keys: ['j'], label: 'Select next device' },
  { segment: 'Devices', keys: ['k'], label: 'Select previous device' },
  { segment: 'Device editor', keys: [']'], label: 'Next function tab' },
  { segment: 'Device editor', keys: ['['], label: 'Previous function tab' },
  { segment: 'Device editor', keys: ['1', '-', '9'], label: 'Jump to tab N' },
  { segment: 'Sequencer', keys: ['Space'], label: 'Play / stop' },
  { segment: 'Sequencer', keys: ['r'], label: 'Toggle MIDI record panel' },
  { segment: 'Sequencer', keys: ['c'], label: 'Clear pattern' },
  { segment: 'Sequencer', keys: ['x'], label: 'Randomize pattern' },
  { segment: 'Sequencer', keys: ['.'], label: 'Tempo up' },
  { segment: 'Sequencer', keys: [','], label: 'Tempo down' },
];

const KEYMAP: Record<string, Command> = {
  '?': 'help:toggle',
  u: 'usb:connect',
  e: 'midi:enable',
  s: 'scan',
  '/': 'filter:focus',
  j: 'device:next',
  k: 'device:prev',
  ']': 'tab:next',
  '[': 'tab:prev',
  ' ': 'seq:playstop',
  r: 'seq:rec',
  c: 'seq:clear',
  x: 'seq:rand',
  '.': 'seq:tempo-up',
  ',': 'seq:tempo-down',
  '1': 'tab:1',
  '2': 'tab:2',
  '3': 'tab:3',
  '4': 'tab:4',
  '5': 'tab:5',
  '6': 'tab:6',
  '7': 'tab:7',
  '8': 'tab:8',
  '9': 'tab:9',
};

// Only genuine text-entry fields swallow hotkeys; a focused select / slider /
// checkbox / button must still let navigation keys through.
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT')
    return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

// Piano-style panels suspend single-letter hotkeys so playing notes never
// triggers nav (j/k), record (r) or clear (c). Counted so overlapping panels
// stack; Space / digits / brackets / ? / Esc keep working.
let letterSuspend = 0;
export function suspendLetterHotkeys(on: boolean) {
  letterSuspend = Math.max(0, letterSuspend + (on ? 1 : -1));
}
export function letterHotkeysSuspended(): boolean {
  return letterSuspend > 0;
}

// install the global keyboard listener; returns an uninstaller
export function installGlobalHotkeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      emitCommand('help:close');
      return;
    }
    // Ctrl/Cmd+K: command palette (works even while typing)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      emitCommand('palette:toggle');
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // allow "?" even from nowhere; block the rest while typing
    if (isTypingTarget(e.target) && e.key !== '?') return;
    if (letterSuspend > 0 && /^[a-z]$/i.test(e.key)) return;
    const cmd = KEYMAP[e.key];
    if (!cmd) return;
    const handled = emitCommand(cmd);
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
