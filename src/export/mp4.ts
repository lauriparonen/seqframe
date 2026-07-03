import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { Frame, RenderSettings } from "../types";
import { drawFrame, frameDuration } from "../render";

export interface Mp4Options {
  globalDuration: number;
  /** Target bitrate in bits per second. */
  bitrate: number;
  onProgress?: (done: number, total: number) => void;
}

export function mp4Supported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

/**
 * Encode frames as an H.264 MP4 via WebCodecs. Each image is a single encoded
 * frame held for its duration, so the output honours the "low framerate,
 * high resolution" goal without wasting bits on duplicate frames.
 */
export async function exportMp4(
  frames: Frame[],
  settings: RenderSettings,
  opts: Mp4Options,
): Promise<Blob> {
  if (!mp4Supported()) {
    throw new Error(
      "MP4 export needs the WebCodecs API (Chrome, Edge or Safari 16+).",
    );
  }

  // H.264 requires even dimensions.
  const w = settings.preset.w & ~1;
  const h = settings.preset.h & ~1;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: w, height: h },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });

  encoder.configure({
    codec: "avc1.640033", // High profile, level 5.1 — supports up to 4K.
    width: w,
    height: h,
    bitrate: opts.bitrate,
    framerate: 30,
  });

  let timeUs = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    drawFrame(ctx, frame, { ...settings, preset: { ...settings.preset, w, h } });

    const durUs = Math.round(frameDuration(frame, opts.globalDuration) * 1_000_000);
    const vf = new VideoFrame(canvas, { timestamp: timeUs, duration: durUs });
    encoder.encode(vf, { keyFrame: true });
    vf.close();
    timeUs += durUs;

    opts.onProgress?.(i + 1, frames.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  return new Blob([buffer], { type: "video/mp4" });
}
