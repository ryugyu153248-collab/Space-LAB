import { useRef } from 'react';

/** Thin drag handle between docks. `onDrag` receives the incremental pointer movement along the axis (px). */
export function ResizeHandle({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef(0);
  const start = (e: React.PointerEvent) => {
    last.current = dir === 'x' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => { const cur = dir === 'x' ? ev.clientX : ev.clientY; onDrag(cur - last.current); last.current = cur; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize'; document.body.style.userSelect = 'none';
    e.preventDefault();
  };
  return <div onPointerDown={start} title="Drag to resize" className={`shrink-0 z-20 bg-edge hover:bg-accent/60 transition-colors ${dir === 'x' ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize'}`} />;
}
