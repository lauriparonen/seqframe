import type { Frame, RenderSettings } from "./types";

export interface FrameLayout {
  /** Padded content box (the crop window) in canvas pixels. */
  pad: number;
  boxW: number;
  boxH: number;
  /** Image draw rect in canvas pixels (may extend outside the canvas). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Compute where the image lands inside the canvas, honouring fit mode, padding,
 * per-frame zoom and pan offset. Shared by the live preview and the exporters
 * so what you see is exactly what gets rendered.
 */
export function frameLayout(frame: Frame, settings: RenderSettings): FrameLayout {
  const { w, h } = settings.preset;
  const pad = Math.min(w, h) * settings.padding;
  const boxW = Math.max(1, w - pad * 2);
  const boxH = Math.max(1, h - pad * 2);

  const img = frame.img;
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;

  const base =
    settings.fit === "cover"
      ? Math.max(boxW / iw, boxH / ih)
      : Math.min(boxW / iw, boxH / ih);
  const scale = base * (frame.zoom ?? 1);

  const dw = iw * scale;
  const dh = ih * scale;
  const cx = w / 2 + (frame.offset?.x ?? 0);
  const cy = h / 2 + (frame.offset?.y ?? 0);

  return { pad, boxW, boxH, dw, dh, dx: cx - dw / 2, dy: cy - dh / 2 };
}

/** Draw a single frame into a canvas context at the target (preset) size. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  settings: RenderSettings,
) {
  const { w, h } = settings.preset;
  const { pad, boxW, boxH, dx, dy, dw, dh } = frameLayout(frame, settings);

  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  // Clip to the padded content box so the image never bleeds into the padding.
  ctx.beginPath();
  ctx.rect(pad, pad, boxW, boxH);
  ctx.clip();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame.img, dx, dy, dw, dh);
  ctx.restore();
}

/** Effective duration (seconds) for a frame given the global default. */
export function frameDuration(frame: Frame, globalDuration: number): number {
  return frame.duration ?? globalDuration;
}
