// zoom/pan modal for device artwork: wheel zoom, drag pan, +/-/0 keys, Esc
import { createSignal, onCleanup, onMount } from 'solid-js';

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

const MIN = 0.25;
const MAX = 10;

export default function ImageZoomModal(props: Props) {
  const [scale, setScale] = createSignal(1);
  const [tx, setTx] = createSignal(0);
  const [ty, setTy] = createSignal(0);
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;

  const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));
  const zoomBy = (f: number) => setScale((s) => clamp(s * f));
  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    baseX = tx();
    baseY = ty();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    setTx(baseX + (e.clientX - startX));
    setTy(baseY + (e.clientY - startY));
  };
  const onPointerUp = () => {
    dragging = false;
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
      else if (e.key === '+' || e.key === '=') zoomBy(1.2);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
      else if (e.key === '0') reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <div class="img-modal-backdrop" onClick={props.onClose}>
      <div class="img-modal" onClick={(e) => e.stopPropagation()}>
        <div class="img-modal-bar">
          <span class="tiny dim">{props.alt}</span>
          <span class="spacer" />
          <button
            class="btn ghost tiny"
            title="Zoom out (-)"
            onClick={() => zoomBy(1 / 1.2)}
          >
            -
          </button>
          <button class="btn ghost tiny" title="Reset (0)" onClick={reset}>
            {Math.round(scale() * 100)}%
          </button>
          <button
            class="btn ghost tiny"
            title="Zoom in (+)"
            onClick={() => zoomBy(1.2)}
          >
            +
          </button>
          <button class="btn tiny" title="Close (Esc)" onClick={props.onClose}>
            close
          </button>
        </div>
        <div
          class="img-modal-stage"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDblClick={reset}
        >
          <img
            src={props.src}
            alt={props.alt}
            draggable={false}
            style={{
              transform: `translate(${tx()}px, ${ty()}px) scale(${scale()})`,
              cursor: scale() > 1 ? 'grab' : 'zoom-in',
            }}
          />
        </div>
      </div>
    </div>
  );
}
