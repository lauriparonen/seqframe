export type FitMode = "contain" | "cover";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Frame {
  id: string;
  name: string;
  url: string;
  img: HTMLImageElement;
  /** Per-frame duration override in seconds. Falls back to the global duration. */
  duration?: number;
  /** Pan offset in canvas pixels from centre (for repositioning the crop). */
  offset?: Vec2;
  /** Zoom multiplier over the fit-mode base scale. Default 1. */
  zoom?: number;
}

export interface Preset {
  label: string;
  w: number;
  h: number;
}

export interface RenderSettings {
  preset: Preset;
  background: string;
  /** Padding as a fraction (0–0.4) of the shorter canvas side. */
  padding: number;
  /** Corner radius as a fraction (0–0.5) of the shorter canvas side. */
  borderRadius: number;
  fit: FitMode;
}
