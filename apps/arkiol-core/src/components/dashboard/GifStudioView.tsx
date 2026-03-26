"use client";
// src/components/dashboard/GifStudioView.tsx — v13 ULTIMATE
// Dedicated Arkiol Studio — animate, configure, generate, manage

import React, { useState, useEffect, useRef } from "react";

const GIF_FORMATS = [
  { id: "instagram_post",  label: "Instagram Post (1:1)",   ratio: "1/1"  },
  { id: "instagram_story", label: "Instagram Story (9:16)", ratio: "9/16" },
  { id: "square_loop",     label: "Square Loop (1:1)",      ratio: "1/1"  },
  { id: "banner_loop",     label: "Banner Loop (16:9)",     ratio: "16/9" },
];

const GIF_SPEEDS  = ["Slow (0.5×)", "Normal (1×)", "Fast (1.5×)", "Very Fast (2×)"];
const GIF_STYLES  = ["Smooth", "Snappy", "Bounce", "Cinematic", "Glitch", "Fade Loop"];

const GIF_MOODS = [
  { id: "energetic", label: "Energetic", emoji: "⚡", color: "#f97316" },
  { id: "calm",      label: "Calm",      emoji: "🌊", color: "#06b6d4" },
  { id: "playful",   label: "Playful",   emoji: "🎉", color: "#a855f7" },
  { id: "luxury",    label: "Luxury",    emoji: "✦",  color: "#eab308" },
  { id: "bold",      label: "Bold",      emoji: "🔥", color: "#ef4444" },
  { id: "minimal",   label: "Minimal",   emoji: "◇",  color: "#8b8ca6" },
];

const STAGES = [
  "Analysing prompt…",
  "Generating frames…",
  "Applying motion…",
  "Compositing layers…",
  "Encoding GIF…",
];

interface GifAsset {
  id: string; jobId: string; name: string;
  format: string; duration: number; frames: number;
  fileSize?: number; thumbnailUrl?: string;
  createdAt: string; status: "COMPLETED" | "FAILED";
}

export function GifStudioView() {
  const [tab,        setTab]        = useState<"create" | "library">("create");
  const [prompt,     setPrompt]     = useState("");
  const [format,     setFormat]     = useState(GIF_FORMATS[0].id);
  const [speed,      setSpeed]      = useState(GIF_SPEEDS[1]);
  const [style,      setStyle]      = useState(GIF_STYLES[0]);
  const [mood,       setMood]       = useState("energetic");
  const [loop,       setLoop]       = useState(true);
  const [frames,     setFrames]     = useState(24);
  const [duration,   setDuration]   = useState(3);
  const [generating, setGenerating] = useState(false);
  const [prog,       setProg]       = useState(0);
  const [progLabel,  setProgLabel]  = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [gifAssets,  setGifAssets]  = useState<GifAsset[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const selectedMood   = GIF_MOODS.find(m => m.id === mood)!;
  const selectedFormat = GIF_FORMATS.find(f => f.id === format)!;

  // Load GIF library
  useEffect(() => {
    if (tab !== "library") return;
    setLoadingLib(true);
    fetch("/api/assets?format=gif&limit=24")
      .then(r => r.json())
      .then(d => { setGifAssets(d.assets ?? []); setLoadingLib(false); })
      .catch(() => setLoadingLib(false));
  }, [tab]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true); setError(null); setProg(0); setProgLabel(STAGES[0]);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          formats: [format],
          includeGif: true,
          gifOptions: { speed, style, mood, loop, frames, duration },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      const jobId = data.jobId;
      let stageIdx = 0;

      pollRef.current = setInterval(async () => {
        const r   = await fetch(`/api/jobs?id=${jobId}`).catch(() => null);
        const d   = r ? await r.json().catch(() => ({})) : {};
        const job = d.jobs?.[0] ?? d.job ?? null;
        if (!job) return;

        const p        = job.progress ?? 0;
        const newStage = Math.min(Math.floor((p / 100) * STAGES.length), STAGES.length - 1);
        if (newStage !== stageIdx) { stageIdx = newStage; setProgLabel(STAGES[stageIdx]); }
        setProg(p);

        if (job.status === "COMPLETED" || job.status === "SUCCEEDED") {
          clearInterval(pollRef.current);
          setGenerating(false); setProg(100);
          setTab("library");
        } else if (job.status === "FAILED") {
          clearInterval(pollRef.current);
          setGenerating(false);
          setError(job.result?.message ?? "Generation failed");
        }
      }, 1500);
    } catch (e: any) {
      setGenerating(false);
      setError(e.message);
    }
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const creditCost = 2 + (frames > 30 ? 1 : 0) + (duration > 5 ? 1 : 0);

  return (
    <div style={{ padding: "36px 44px", maxWidth: 1300, fontFamily: "var(--font-body)" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.045em", display: "flex", alignItems: "center", gap: 10 }}>
            <span>⚡</span> Arkiol Studio
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
            Create motion-ready animated GIFs for social media — no After Effects needed
          </p>
        </div>
        {/* Tab switcher */}
        <div style={{ display: "flex", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", overflow: "hidden" }}>
          {(["create", "library"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: tab === t ? "var(--accent-tint-md)" : "transparent",
              color: tab === t ? "var(--accent-light)" : "var(--text-secondary)",
              fontFamily: "var(--font-body)", transition: "all var(--transition-fast)",
              borderRight: t === "create" ? "1px solid var(--border-strong)" : "none",
            }}>{t === "create" ? "✦ Create" : "◫ Library"}</button>
          ))}
        </div>
      </div>

      {tab === "create" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, alignItems: "start" }}>

          {/* ── LEFT: Config ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Prompt */}
            <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
              <div className="ak-label" style={{ marginBottom: 14 }}>Describe Your GIF</div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={generating}
                className="ak-input"
                placeholder={`e.g. "Neon logo reveal with electric pulse effect, dark background, brand accent colors flowing in"`}
                style={{ resize: "vertical", minHeight: 88, fontFamily: "var(--font-body)", marginBottom: 0 }} />
            </div>

            {/* Format + Speed */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
                <div className="ak-label" style={{ marginBottom: 12 }}>Format</div>
                <select value={format} onChange={e => setFormat(e.target.value)} disabled={generating} className="ak-input ak-select">
                  {GIF_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
                <div className="ak-label" style={{ marginBottom: 12 }}>Playback Speed</div>
                <select value={speed} onChange={e => setSpeed(e.target.value)} disabled={generating} className="ak-input ak-select">
                  {GIF_SPEEDS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Motion Style */}
            <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
              <div className="ak-label" style={{ marginBottom: 14 }}>Motion Style</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {GIF_STYLES.map(s => (
                  <button key={s} onClick={() => !generating && setStyle(s)} style={{
                    padding: "7px 16px", borderRadius: "var(--radius-md)", border: "1px solid",
                    borderColor: style === s ? "var(--border-accent)" : "var(--border-strong)",
                    background: style === s ? "var(--accent-tint-md)" : "transparent",
                    color: style === s ? "var(--accent-light)" : "var(--text-secondary)",
                    fontSize: 13, fontWeight: 500, cursor: generating ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-body)", transition: "all var(--transition-fast)",
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Mood */}
            <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
              <div className="ak-label" style={{ marginBottom: 14 }}>Mood / Energy</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9 }}>
                {GIF_MOODS.map(m => (
                  <button key={m.id} onClick={() => !generating && setMood(m.id)} style={{
                    padding: "10px 12px", borderRadius: "var(--radius-md)", border: "2px solid",
                    borderColor: mood === m.id ? m.color : "var(--border-strong)",
                    background: mood === m.id ? `${m.color}18` : "transparent",
                    cursor: generating ? "not-allowed" : "pointer",
                    transition: "all var(--transition-fast)",
                    display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-body)",
                  }}>
                    <span style={{ fontSize: 18 }}>{m.emoji}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: mood === m.id ? m.color : "var(--text-secondary)" }}>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced: sliders + loop */}
            <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
              <div className="ak-label" style={{ marginBottom: 16 }}>Advanced Settings</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 18 }}>
                {/* Duration */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Duration</span>
                    <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--accent-light)" }}>{duration}s</span>
                  </div>
                  <input type="range" min={1} max={10} value={duration} disabled={generating}
                    onChange={e => setDuration(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                    <span>1s</span><span>10s</span>
                  </div>
                </div>
                {/* Frame rate */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Frame Rate</span>
                    <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--accent-light)" }}>{frames} fps</span>
                  </div>
                  <input type="range" min={8} max={60} step={4} value={frames} disabled={generating}
                    onChange={e => setFrames(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                    <span>8 fps</span><span>60 fps</span>
                  </div>
                </div>
              </div>

              {/* Seamless loop toggle */}
              <div style={{ paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Seamless Loop</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>First and last frame blend smoothly</div>
                </div>
                <div onClick={() => !generating && setLoop(l => !l)} style={{
                  width: 42, height: 23, borderRadius: 99, position: "relative", flexShrink: 0,
                  background: loop ? "var(--accent)" : "var(--bg-overlay)",
                  border: `1px solid ${loop ? "var(--accent)" : "var(--border-strong)"}`,
                  cursor: generating ? "not-allowed" : "pointer",
                  transition: "all var(--transition-fast)",
                }}>
                  <div style={{
                    position: "absolute", top: 2.5, left: loop ? 20 : 2.5, width: 16, height: 16,
                    borderRadius: "50%", background: "#fff", transition: "left var(--transition-fast)",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Preview + Generate ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 20 }}>

            {/* Preview card */}
            <div className="ak-card ak-card-elevated" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{
                aspectRatio: selectedFormat.ratio,
                maxHeight: 320,
                background: "var(--bg-overlay)",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  background: `radial-gradient(ellipse at 30% 40%, ${selectedMood.color}28, transparent 60%), radial-gradient(ellipse at 70% 65%, var(--accent-glow), transparent 60%)`,
                  animation: "ak-pulse 3s ease-in-out infinite",
                }} />
                {generating ? (
                  <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 36, marginBottom: 12, display: "inline-block" }} className="ak-spin">⚡</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>{progLabel}</div>
                    <div style={{ width: 160, margin: "0 auto" }}>
                      <div className="ak-progress"><div className="ak-progress-fill" style={{ width: `${prog}%` }} /></div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--accent-light)", marginTop: 8, fontFamily: "var(--font-mono)" }}>{prog}%</div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 52, marginBottom: 8 }}>{selectedMood.emoji}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>Preview appears here</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>after generation</div>
                  </div>
                )}
              </div>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                      {selectedFormat.label.split(" ")[0]} · {style} · {selectedMood.label}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                      {duration}s · {frames} fps · {loop ? "Seamless loop" : "No loop"}
                    </div>
                  </div>
                  <span className="ak-badge ak-badge-accent" style={{ fontSize: 9.5 }}>GIF</span>
                </div>
              </div>
            </div>

            {/* Credit cost */}
            <div style={{
              background: "var(--accent-tint-md)", border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-lg)", padding: "12px 18px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2 }}>Credit cost</div>
                {creditCost > 2 && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Base 2 + quality add-ons</div>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--accent-light)", letterSpacing: "-0.05em" }}>{creditCost}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>credits</span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="ak-toast ak-toast-error"><span>⚠</span><span>{error}</span></div>
            )}

            {/* Generate */}
            <button onClick={generate} disabled={generating || !prompt.trim()} className="ak-btn ak-btn-primary"
              style={{ padding: "13px", fontSize: 15, width: "100%" }}>
              {generating ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="ak-spin" style={{ width: 15, height: 15, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
                  Generating GIF…
                </span>
              ) : "⚡ Generate GIF"}
            </button>

            {/* Pro tips */}
            <div className="ak-card ak-card-elevated" style={{ padding: "16px 18px" }}>
              <div className="ak-label" style={{ marginBottom: 12 }}>Pro Tips</div>
              {[
                "Use brand colors for maximum consistency",
                "Keep it under 4s for social feeds",
                "Seamless loops perform 3× better",
                "60fps looks premium on OLED screens",
              ].map((tip, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 12.5, color: "var(--text-secondary)", alignItems: "flex-start", lineHeight: 1.5 }}>
                  <span style={{ color: "var(--accent-light)", flexShrink: 0, marginTop: 1 }}>✦</span>{tip}
                </div>
              ))}
            </div>
          </div>
        </div>

      ) : (
        /* ── LIBRARY TAB ── */
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {gifAssets.length} GIF{gifAssets.length !== 1 ? "s" : ""} generated
            </p>
            <button onClick={() => setTab("create")} className="ak-btn ak-btn-primary">⚡ Create New</button>
          </div>

          {loadingLib ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="ak-shimmer" style={{ borderRadius: "var(--radius-xl)", aspectRatio: "1" }} />
              ))}
            </div>
          ) : gifAssets.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 24px", background: "var(--bg-elevated)", borderRadius: "var(--radius-2xl)", border: "1px dashed var(--border-strong)" }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>⚡</div>
              <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-display)", margin: "0 0 8px", letterSpacing: "-0.04em" }}>No GIFs yet</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13.5, maxWidth: 300, margin: "0 auto 22px" }}>
                Create your first animated GIF in the Create tab.
              </p>
              <button onClick={() => setTab("create")} className="ak-btn ak-btn-primary">⚡ Create GIF</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              {gifAssets.map(gif => (
                <div key={gif.id} className="ak-gallery-card">
                  <div style={{ aspectRatio: "1", background: "var(--bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                    {gif.thumbnailUrl
                      ? <img src={gif.thumbnailUrl} alt={gif.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 32 }}>⚡</span>
                    }
                    <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, backdropFilter: "blur(4px)", letterSpacing: "0.06em" }}>GIF</div>
                    <div className="ak-gallery-overlay">
                      <button className="ak-btn ak-btn-secondary ak-btn-sm" style={{ fontSize: 11 }}>Preview</button>
                      <a href={`/api/assets/${gif.id}/download`} className="ak-btn ak-btn-primary ak-btn-sm" style={{ fontSize: 11 }}>↓ Download</a>
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{gif.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                      {gif.duration}s · {gif.frames} frames
                      {gif.fileSize && ` · ${(gif.fileSize / 1024 / 1024).toFixed(1)} MB`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
