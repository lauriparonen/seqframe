import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MARGIN = 8;

interface Props {
  x: number;
  y: number;
  onDuplicate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onRotate: () => void;
  onClose: () => void;
}

export function ThumbMenu({
  x,
  y,
  onDuplicate,
  onFlipH,
  onFlipV,
  onRotate,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    let top = y;

    if (top + height + MARGIN > window.innerHeight) {
      top = y - height;
    }
    if (top < MARGIN) top = MARGIN;

    if (left + width + MARGIN > window.innerWidth) {
      left = window.innerWidth - width - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;

    setPos({ left, top, ready: true });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="thumb-menu"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" onClick={act(onDuplicate)}>
        Duplicate
      </button>
      <button type="button" onClick={act(onFlipH)}>
        Flip horizontal
      </button>
      <button type="button" onClick={act(onFlipV)}>
        Flip vertical
      </button>
      <button type="button" onClick={act(onRotate)}>
        Rotate 90°
      </button>
    </div>
  );
}
