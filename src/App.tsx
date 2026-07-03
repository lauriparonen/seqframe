import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableThumb } from "./components/SortableThumb";
import { PRESETS } from "./presets";
import { drawFrame, frameDuration, frameLayout } from "./render";
import { exportGif } from "./export/gif";
import { exportMp4, mp4Supported } from "./export/mp4";
import type { Frame, FitMode, RenderSettings } from "./types";
import "./App.css";

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));

function loadFrame(file: File): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ id: uid(), name: file.name, url, img });
    img.onerror = () => reject(new Error(`Could not load ${file.name}`));
    img.src = url;
  });
}

type Format = "gif" | "mp4";
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const FALLBACK_ACCENT = "#c9c2b4";

function dominantHueAccent(frame: Frame): string {
  const sample = document.createElement("canvas");
  const size = 28;
  sample.width = size;
  sample.height = size;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FALLBACK_ACCENT;

  ctx.drawImage(frame.img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const bins = Array.from({ length: 36 }, () => ({ weight: 0, sat: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const light = (max + min) / 2;
    if (chroma < 0.04 || light < 0.08 || light > 0.92) continue;

    let hue = 0;
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;

    hue = (hue * 60 + 360) % 360;
    const sat = chroma / (1 - Math.abs(2 * light - 1));
    const weight = sat * (1 - Math.abs(light - 0.5));
    const bin = Math.min(35, Math.floor(hue / 10));
    bins[bin].weight += weight;
    bins[bin].sat += sat * weight;
  }

  const dominant = bins.reduce<{ idx: number; weight: number; sat: number }>(
    (best, cur, idx) => (cur.weight > best.weight ? { ...cur, idx } : best),
    { idx: -1, weight: 0, sat: 0 },
  );

  if (dominant.idx < 0 || dominant.weight < 0.01) return FALLBACK_ACCENT;
  const hue = dominant.idx * 10 + 5;
  const sat = clamp((dominant.sat / dominant.weight) * 100, 28, 58);
  return `hsl(${Math.round(hue)} ${Math.round(sat)}% 72%)`;
}

export default function App() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [presetIdx, setPresetIdx] = useState(0);
  const [background, setBackground] = useState("#000000");
  const [padding, setPadding] = useState(0); // fraction of shorter side
  const [fit, setFit] = useState<FitMode>("cover");
  const [duration, setDuration] = useState(0.5);

  const [format, setFormat] = useState<Format>("gif");
  const [maxColors, setMaxColors] = useState(256);
  const [mbps, setMbps] = useState(12);

  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [accent, setAccent] = useState(FALLBACK_ACCENT);

  const [area, setArea] = useState({ w: 0, h: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(
    null,
  );

  const preset = PRESETS[presetIdx];
  const settings: RenderSettings = useMemo(
    () => ({ preset, background, padding, fit }),
    [preset, background, padding, fit],
  );

  const totalDuration = frames.reduce(
    (sum, f) => sum + frameDuration(f, duration),
    0,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // The frame currently shown / edited.
  const editing =
    frames.find((f) => f.id === selectedId) ?? frames[0] ?? null;
  const previewFrame = playing ? frames[playIdx] ?? editing : editing;

  useEffect(() => {
    if (!editing) {
      setAccent(FALLBACK_ACCENT);
      return;
    }

    try {
      setAccent(dominantHueAccent(editing));
    } catch {
      setAccent(FALLBACK_ACCENT);
    }
  }, [editing]);

  // ---- deterministic preview sizing --------------------------------------
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // display px per canvas px — the frame is ALWAYS the preset's exact shape.
  const ds =
    area.w > 0 && area.h > 0
      ? Math.min(area.w / preset.w, area.h / preset.h)
      : 0;
  const frameW = preset.w * ds;
  const frameH = preset.h * ds;
  const layout = previewFrame ? frameLayout(previewFrame, settings) : null;

  // ---- file intake --------------------------------------------------------
  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const loaded = await Promise.all(files.map(loadFrame));
    setFrames((prev) => [...prev, ...loaded]);
    setSelectedId((cur) => cur ?? loaded[0]?.id ?? null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  // ---- reorder / remove ---------------------------------------------------
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFrames((prev) => {
      const from = prev.findIndex((f) => f.id === active.id);
      const to = prev.findIndex((f) => f.id === over.id);
      return arrayMove(prev, from, to);
    });
  };

  const removeFrame = (id: string) => {
    setFrames((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const patchFrame = (id: string, patch: Partial<Frame>) =>
    setFrames((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );

  // ---- crop: drag to pan, wheel / slider to zoom -------------------------
  const onPanDown = (e: React.PointerEvent) => {
    if (!editing || playing || ds === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      ox: editing.offset?.x ?? 0,
      oy: editing.offset?.y ?? 0,
    };
  };
  const onPanMove = (e: React.PointerEvent) => {
    if (!drag.current || !editing) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px) / ds;
    const ny = drag.current.oy + (e.clientY - drag.current.py) / ds;
    patchFrame(editing.id, { offset: { x: nx, y: ny } });
  };
  const onPanUp = (e: React.PointerEvent) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onWheelZoom = (e: React.WheelEvent) => {
    if (!editing || playing) return;
    const z = clamp((editing.zoom ?? 1) * (1 - e.deltaY * 0.0015), 0.2, 6);
    patchFrame(editing.id, { zoom: z });
  };
  const resetCrop = () => {
    if (editing) patchFrame(editing.id, { offset: undefined, zoom: undefined });
  };

  // ---- preview rendering --------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = preset.w;
    canvas.height = preset.h;
    const ctx = canvas.getContext("2d")!;
    if (previewFrame) {
      drawFrame(ctx, previewFrame, settings);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, preset.w, preset.h);
    }
  }, [previewFrame, settings, preset, background]);

  // playback loop
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const cur = frames[playIdx] ?? frames[0];
    const ms = frameDuration(cur, duration) * 1000;
    const t = setTimeout(
      () => setPlayIdx((i) => (i + 1) % frames.length),
      ms,
    );
    return () => clearTimeout(t);
  }, [playing, playIdx, frames, duration]);

  const togglePlay = () => {
    if (frames.length === 0) return;
    setPlayIdx(0);
    setPlaying((p) => !p);
  };

  // ---- export -------------------------------------------------------------
  const doExport = async () => {
    if (frames.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: frames.length });
    try {
      const onProgress = (done: number, total: number) =>
        setProgress({ done, total });
      let blob: Blob;
      let ext: string;
      if (format === "gif") {
        blob = await exportGif(frames, settings, {
          maxColors,
          globalDuration: duration,
          onProgress,
        });
        ext = "gif";
      } else {
        blob = await exportMp4(frames, settings, {
          globalDuration: duration,
          bitrate: mbps * 1_000_000,
          onProgress,
        });
        ext = "mp4";
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sequence-${Date.now()}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const mp4Ok = mp4Supported();
  const showGhost = !!(previewFrame && !playing && layout && ds > 0);

  return (
    <div
      className="app"
      style={{ "--accent": accent } as React.CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">▚ seqframe</div>
        <label className="preset-select">
          <span>Preset</span>
          <select
            value={presetIdx}
            onChange={(e) => setPresetIdx(Number(e.target.value))}
          >
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label} · {p.w}×{p.h}
              </option>
            ))}
          </select>
        </label>
        <div className="spacer" />
        <button
          className="export-btn"
          onClick={doExport}
          disabled={busy || frames.length === 0}
        >
          {busy
            ? progress
              ? `Exporting ${progress.done}/${progress.total}`
              : "Exporting…"
            : `Export ${format.toUpperCase()}`}
        </button>
      </header>

      <main className="stage">
        <div className="editor-area" ref={areaRef}>
          {frames.length === 0 ? (
            <button
              className="dropzone"
              style={{ aspectRatio: `${preset.w}/${preset.h}` }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div>
                <strong>Drop images here</strong>
                <span>or click to choose files</span>
              </div>
            </button>
          ) : (
            ds > 0 && (
              <div
                className={`editor ${playing ? "" : "editor--grab"}`}
                style={{ width: frameW, height: frameH }}
                onPointerDown={onPanDown}
                onPointerMove={onPanMove}
                onPointerUp={onPanUp}
                onPointerCancel={onPanUp}
                onWheel={onWheelZoom}
                onDoubleClick={resetCrop}
              >
                {showGhost && layout && (
                  <img
                    className="crop-ghost"
                    src={previewFrame!.url}
                    alt=""
                    draggable={false}
                    style={{
                      left: layout.dx * ds,
                      top: layout.dy * ds,
                      width: layout.dw * ds,
                      height: layout.dh * ds,
                    }}
                  />
                )}
                <canvas
                  ref={canvasRef}
                  className="crop-canvas"
                  style={{ width: frameW, height: frameH }}
                />
                <span className="res-badge">
                  <span className="res-badge__label">Raster</span>
                  <span className="res-badge__value mono">
                    {preset.w}×{preset.h}
                  </span>
                </span>
              </div>
            )
          )}
        </div>
        {frames.length > 0 && !playing && (
          <p className="stage-hint">drag to reposition · scroll to zoom · double-click to reset</p>
        )}
      </main>

      {/* Sequence / timeline panel */}
      <section className="timeline">
        <div className="timeline__controls">
          <button className="play" onClick={togglePlay} title="Play / pause">
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="field">
            <label>Image duration</label>
            <div className="dur-row">
              <input
                type="range"
                min={0.05}
                max={3}
                step={0.05}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
              <span className="mono">{duration.toFixed(2)}s</span>
            </div>
          </div>
          <div className="field small">
            <label>Total</label>
            <span className="mono">{totalDuration.toFixed(2)}s</span>
          </div>
          <div className="spacer" />
          {frames.length > 0 && (
            <span className="count mono">{frames.length} images</span>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={frames.map((f) => f.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="thumbs">
              {frames.map((f, i) => (
                <SortableThumb
                  key={f.id}
                  frame={f}
                  index={i}
                  selected={f.id === editing?.id}
                  onSelect={() => setSelectedId(f.id)}
                  onRemove={() => removeFrame(f.id)}
                />
              ))}
              <button
                className="add-thumb"
                onClick={() => fileInputRef.current?.click()}
                title="Add images"
              >
                +
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </section>

      {/* Settings sidebar */}
      <aside className="sidebar">
        <h3>Canvas</h3>
        <div className="field">
          <label>Fit</label>
          <div className="seg">
            {(["contain", "cover"] as FitMode[]).map((m) => (
              <button
                key={m}
                className={fit === m ? "on" : ""}
                onClick={() => setFit(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Background</label>
          <div className="dur-row">
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            />
            <button className="btn-ghost" onClick={() => setBackground("#ffffff")}>
              white
            </button>
            <button className="btn-ghost" onClick={() => setBackground("#000000")}>
              black
            </button>
          </div>
        </div>
        <div className="field">
          <label>Padding</label>
          <div className="dur-row">
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.01}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
            />
            <span className="mono">{Math.round(padding * 100)}%</span>
          </div>
        </div>

        {editing && (
          <>
            <h3>Selected image</h3>
            <div className="field">
              <label>Zoom</label>
              <div className="dur-row">
                <input
                  type="range"
                  min={0.2}
                  max={6}
                  step={0.01}
                  value={editing.zoom ?? 1}
                  onChange={(e) =>
                    patchFrame(editing.id, { zoom: Number(e.target.value) })
                  }
                />
                <span className="mono">{(editing.zoom ?? 1).toFixed(2)}×</span>
              </div>
            </div>
            <div className="field">
              <label>Duration override</label>
              <div className="dur-row">
                <input
                  type="range"
                  min={0.05}
                  max={3}
                  step={0.05}
                  value={editing.duration ?? duration}
                  onChange={(e) =>
                    patchFrame(editing.id, { duration: Number(e.target.value) })
                  }
                />
                <span className="mono">
                  {(editing.duration ?? duration).toFixed(2)}s
                </span>
              </div>
            </div>
            <button className="btn-ghost" onClick={resetCrop}>
              reset position &amp; zoom
            </button>
          </>
        )}

        <h3>Export</h3>
        <div className="field">
          <label>Format</label>
          <div className="seg">
            <button
              className={format === "gif" ? "on" : ""}
              onClick={() => setFormat("gif")}
            >
              GIF
            </button>
            <button
              className={format === "mp4" ? "on" : ""}
              onClick={() => setFormat("mp4")}
              disabled={!mp4Ok}
              title={mp4Ok ? "" : "WebCodecs not available in this browser"}
            >
              MP4
            </button>
          </div>
        </div>

        {format === "gif" ? (
          <div className="field">
            <label>Colors (quality vs. size)</label>
            <div className="dur-row">
              <input
                type="range"
                min={16}
                max={256}
                step={8}
                value={maxColors}
                onChange={(e) => setMaxColors(Number(e.target.value))}
              />
              <span className="mono">{maxColors}</span>
            </div>
            <p className="hint">
              One frame per image at full resolution — file size scales with
              colors &amp; image count, not framerate.
            </p>
          </div>
        ) : (
          <div className="field">
            <label>Bitrate</label>
            <div className="dur-row">
              <input
                type="range"
                min={2}
                max={40}
                step={1}
                value={mbps}
                onChange={(e) => setMbps(Number(e.target.value))}
              />
              <span className="mono">{mbps} Mbps</span>
            </div>
            <p className="hint">H.264 MP4 via WebCodecs.</p>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </aside>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
