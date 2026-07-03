import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { Frame, RenderSettings } from "../types";
import { drawFrame, frameDuration } from "../render";

type Rgb = [number, number, number];

const BLACK: Rgb = [0, 0, 0];

/** Pixels this dark or darker are snapped to pure black before quantization. */
const BLACK_SNAP_THRESHOLD = 32;

function parseHexColor(hex: string): Rgb {
  const h = hex.replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Collapse warm near-blacks (common in JPEGs) to true black. */
function snapNearBlack(data: Uint8ClampedArray, threshold = BLACK_SNAP_THRESHOLD) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.max(r, g, b) <= threshold) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

/** Reserve key colours in the palette so quantizer drift cannot wash them out. */
function ensurePaletteHasColors(palette: number[][], colors: Rgb[]) {
  for (const color of colors) {
    const exists = palette.some(
      (p) => p[0] === color[0] && p[1] === color[1] && p[2] === color[2],
    );
    if (exists) continue;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dist =
        (p[0] - color[0]) ** 2 + (p[1] - color[1]) ** 2 + (p[2] - color[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    palette[bestIdx] = [...color];
  }
}

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

    snapNearBlack(data);

    const palette = quantize(data, opts.maxColors);
    const bg = parseHexColor(settings.background);
    ensurePaletteHasColors(palette, bg[0] === 0 && bg[1] === 0 && bg[2] === 0 ? [BLACK] : [BLACK, bg]);
    const index = applyPalette(data, palette);

    const delayMs = Math.round(frameDuration(frame, opts.globalDuration) * 1000);
    gif.writeFrame(index, w, h, { palette, delay: delayMs });

    opts.onProgress?.(i + 1, frames.length);
    // Yield so the UI/progress bar can paint between frames.
    await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return new Blob([gif.bytesView()], { type: "image/gif" });
}
