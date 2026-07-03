import type { Preset } from "./types";

export const PRESETS: Preset[] = [
  { label: "Portrait 4:5", w: 1080, h: 1350 },
  { label: "Vertical 9:16", w: 1080, h: 1920 },
  { label: "Square 1:1", w: 1080, h: 1080 },
  { label: "Landscape 16:9", w: 1920, h: 1080 },
  { label: "Story 9:16 (720)", w: 720, h: 1280 },
];
