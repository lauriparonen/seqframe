import type { Frame, RenderSettings, Vec2 } from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

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

/**
 * Keep pan/zoom inside the content box so the image always fills the crop
 * window — no background bleeds into the frame when repositioning.
 */
export function clampCrop(
  frame: Frame,
  settings: RenderSettings,
): { offset: Vec2; zoom: number } {
  const { w, h } = settings.preset;
  let zoom = frame.zoom ?? 1;
  if (settings.fit === "cover") {
    zoom = clamp(zoom, 1, 6);
  } else {
    zoom = clamp(zoom, 0.2, 6);
  }

  const atZoom = { ...frame, zoom };
  const { pad, boxW, boxH, dw, dh } = frameLayout(atZoom, settings);

  let ox = frame.offset?.x ?? 0;
  let oy = frame.offset?.y ?? 0;

  if (dw >= boxW) {
    const minX = pad + boxW - dw / 2 - w / 2;
    const maxX = pad + dw / 2 - w / 2;
    ox = clamp(ox, Math.min(minX, maxX), Math.max(minX, maxX));
  } else {
    ox = 0;
  }

  if (dh >= boxH) {
    const minY = pad + boxH - dh / 2 - h / 2;
    const maxY = pad + dh / 2 - h / 2;
    oy = clamp(oy, Math.min(minY, maxY), Math.max(minY, maxY));
  } else {
    oy = 0;
  }

  return { offset: { x: ox, y: oy }, zoom };
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
  const radius = Math.min(
    Math.min(w, h) * settings.borderRadius,
    boxW / 2,
    boxH / 2,
  );
  ctx.beginPath();
  if (radius > 0) {
    ctx.roundRect(pad, pad, boxW, boxH, radius);
  } else {
    ctx.rect(pad, pad, boxW, boxH);
  }
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
