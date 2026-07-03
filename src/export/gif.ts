import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { Frame, RenderSettings } from "../types";
import { drawFrame, frameDuration } from "../render";

export interface GifOptions {
  /** Max palette colours per frame (2–256). Lower = smaller file. */
  maxColors: number;
  /** Global fallback duration per image, in seconds. */
  globalDuration: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Encode frames as a GIF using ONE frame per image with a long delay.
 * This keeps the file tiny while preserving full resolution — perfect for
 * static sequences that don't need a real framerate.
 */
export async function exportGif(
  frames: Frame[],
  settings: RenderSettings,
  opts: GifOptions,
): Promise<Blob> {
  const { w, h } = settings.preset;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const gif = GIFEncoder();

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    drawFrame(ctx, frame, settings);
    const { data } = ctx.getImageData(0, 0, w, h);

    const palette = quantize(data, opts.maxColors, { format: "rgb444" });
    const index = applyPalette(data, palette, "rgb444");

    const delayMs = Math.round(frameDuration(frame, opts.globalDuration) * 1000);
    gif.writeFrame(index, w, h, { palette, delay: delayMs });

    opts.onProgress?.(i + 1, frames.length);
    // Yield so the UI/progress bar can paint between frames.
    await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return new Blob([gif.bytesView()], { type: "image/gif" });
}
