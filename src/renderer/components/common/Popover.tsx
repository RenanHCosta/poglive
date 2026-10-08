import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface Anchor {
  x: number;
  y: number;
}

/** Floating panel positioned at a point and kept inside the window. */
export function Popover({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
    });
  }, [anchor]);
  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    const onBlur = () => close.current();
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return (
    <div
      ref={panel}
      className="popover"
      role="dialog"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
    >
      {children}
    </div>
  );
}
