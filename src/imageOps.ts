import type { Frame } from "./types";

export type ImageTransform = "flipH" | "flipV" | "rotate";

/** Bake a flip/rotate into new image data so crop math stays unchanged. */
export async function bakeTransform(
  frame: Frame,
  op: ImageTransform,
): Promise<{ url: string; img: HTMLImageElement }> {
  const { img } = frame;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const rotate = op === "rotate";
  const cw = rotate ? ih : iw;
  const ch = rotate ? iw : ih;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(cw / 2, ch / 2);
  if (rotate) ctx.rotate(Math.PI / 2);
  else if (op === "flipH") ctx.scale(-1, 1);
  else if (op === "flipV") ctx.scale(1, -1);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Transform failed"))),
      "image/png",
    );
  });
  const url = URL.createObjectURL(blob);
  const newImg = new Image();
  await new Promise<void>((resolve, reject) => {
    newImg.onload = () => resolve();
    newImg.onerror = () => reject(new Error("Transform failed"));
    newImg.src = url;
  });
  return { url, img: newImg };
}

export function revokeUrlIfUnused(url: string, frames: Frame[]) {
  if (!frames.some((f) => f.url === url)) URL.revokeObjectURL(url);
}
