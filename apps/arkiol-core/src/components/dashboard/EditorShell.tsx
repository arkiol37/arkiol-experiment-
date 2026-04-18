"use client";
// src/components/dashboard/EditorShell.tsx
// Generation wizard + ArkiolEditor integration
//
// Pipeline:
//   1. User picks format → writes brief → hits "Generate"
//   2. POST /api/generate → jobId
//   3. Poll /api/jobs?id=<jobId> every 2s until COMPLETED
//   4. GET  /api/editor/load?assetId=<id> → EditorElement[]
//   5. Mount ArkiolEditor with initialElements + initialBgColor
//   6. Editor autosaves to /api/editor/autosave using assetId as projectId
//   7. Version history, multi-page, templates all work normally

import React, { useState, useEffect, useCallback } from "react";
import {
  CATEGORY_LABELS, ARKIOL_CATEGORIES, ArkiolCategory, FORMAT_DIMS,
} from "../../lib/types";
import dynamic from "next/dynamic";
import type { EditorElement } from "../editor/ArkiolEditor";

const ArkiolEditor = dynamic(
  () => import("../editor/ArkiolEditor").then(m => ({ default: m.default ?? m.ArkiolEditor })),
  { ssr: false, loading: () => <EditorLoadingScreen /> }
);

type Step = "format" | "brief" | "generating" | "loading" | "edit";

interface EditorInit {
  projectId:    string;
  elements:     EditorElement[];
  bgColor:      string;
  canvasWidth:  number;
  canvasHeight: number;
}

export function EditorShell() {
  const [step,       setStep]       = useState<Step>("format");
  const [format,     setFormat]     = useState<ArkiolCategory>("instagram_post");
  const [prompt,     setPrompt]     = useState("");
  const [style,      setStyle]      = useState("modern_minimal");
  const [vars,       setVars]       = useState(1);
  const [ytMode,     setYtMode]     = useState<"auto"|"face"|"product">("auto");
  const [jobId,      setJobId]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [error,      setError]      = useState<string | null>(null);
  const [editorInit, setEditorInit] = useState<EditorInit | null>(null);

  // On mount: if ?assetId=... is in the URL, skip generation and load directly into editor
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params  = new URLSearchParams(window.location.search);
    const assetId = params.get("assetId");
    if (assetId) {
      setStep("loading");
      loadEditorElements(assetId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Poll until COMPLETED, then hand off to loadEditorElements
  useEffect(() => {
    if (!jobId || step !== "generating") return;
    const iv = setInterval(async () => {
      try {
        const res  = await fetch(`/api/jobs?id=${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.job) return;
        setProgress(data.job.progress ?? 0);
        if (data.job.status === "COMPLETED") {
          clearInterval(iv);
          const assetId = (data.job?.result?.assets?.[0]?.id ?? data.job?.result?.assetIds?.[0]) as string | undefined;
          if (!assetId) { setError("Generation completed but no asset was returned."); setStep("brief"); return; }
          setStep("loading");
          loadEditorElements(assetId);
        } else if (data.job.status === "FAILED") {
          clearInterval(iv);
          setError(data.job.error ?? "Generation failed");
          setStep("brief");
        }
      } catch { /* network hiccup — keep polling */ }
    }, 2000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, step]);

  const loadEditorElements = useCallback(async (assetId: string) => {
    const fallbackDims = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };
    const fallback: EditorInit = {
      projectId:    assetId,
      elements:     [],
      bgColor:      "#f8f7f4",
      canvasWidth:  fallbackDims.width,
      canvasHeight: fallbackDims.height,
    };

    try {
      const res  = await fetch(`/api/editor/load?assetId=${encodeURIComponent(assetId)}`);
      const data = await res.json();
      if (!res.ok) { setEditorInit(fallback); setStep("edit"); return; }

      const bgEl = (data.elements as EditorElement[]).find(
        el => el.name === "Background" && el.type === "rect"
      );

      setEditorInit({
        projectId:    data.projectId ?? assetId,
        elements:     data.elements  ?? [],
        bgColor:      bgEl?.fill ?? "#f8f7f4",
        canvasWidth:  data.canvasWidth  ?? fallbackDims.width,
        canvasHeight: data.canvasHeight ?? fallbackDims.height,
      });
      setStep("edit");
    } catch {
      setEditorInit(fallback);
      setStep("edit");
    }
  }, [format]);

  const generate = useCallback(async () => {
    setError(null); setStep("generating"); setProgress(0);
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt, formats: [format], stylePreset: style, variations: vars,
          ...(format === "youtube_thumbnail" && { youtubeThumbnailMode: ytMode }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setJobId(data.jobId);
    } catch (e: any) { setError(e.message); setStep("brief"); }
  }, [format, prompt, style, vars, ytMode]);

  return (
    <div style={{ padding: 0, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
        <button onClick={() => setStep("format")} style={crumbBtn}>Format</button>
        <span>›</span>
        <button onClick={() => step !== "format" && setStep("brief")} style={crumbBtn}>Brief</button>
        <span>›</span>
        <span style={{ color: ["generating","loading","edit"].includes(step) ? "var(--text-primary)" : "var(--border-strong)" }}>
          {step === "generating" ? "Generating…" : step === "loading" ? "Loading editor…" : step === "edit" ? "Edit" : "Generate"}
        </span>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {step === "format" && <FormatStep selected={format} onSelect={f => { setFormat(f as ArkiolCategory); setStep("brief"); }} />}

        {step === "brief" && (
          <BriefStep
            format={format} prompt={prompt} setPrompt={setPrompt}
            style={style} setStyle={setStyle} vars={vars} setVars={setVars}
            ytMode={ytMode} setYtMode={setYtMode} error={error}
            onBack={() => setStep("format")} onGenerate={generate}
          />
        )}

        {step === "generating" && <GeneratingStep progress={progress} format={format} />}
        {step === "loading"    && <LoadingEditorStep />}

        {step === "edit" && editorInit && (
          <div style={{ height: "calc(100vh - 48px)", position: "relative" }}>
            {/* Quick link to full-page editor */}
            <a
              href={`/edit?format=${format}&projectId=${editorInit.projectId}&w=${editorInit.canvasWidth}&h=${editorInit.canvasHeight}`}
              style={{
                position: "absolute", top: 8, right: 12, zIndex: 50,
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 6,
                background: "rgba(79,142,247,0.10)", border: "1px solid rgba(79,142,247,0.22)",
                color: "#4f8ef7", fontSize: 11.5, fontWeight: 600, textDecoration: "none",
                cursor: "pointer", transition: "background 0.15s",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M14 10l6.1-6.1M10 3H6a3 3 0 00-3 3v12a3 3 0 003 3h12a3 3 0 003-3v-4"/></svg>
              Full-Page Editor
            </a>
            <ArkiolEditor
              key={editorInit.projectId}
              projectId={editorInit.projectId}
              initialElements={editorInit.elements}
              canvasWidth={editorInit.canvasWidth}
              canvasHeight={editorInit.canvasHeight}
              canvasBg={editorInit.bgColor}
              readOnly={false}
              onSave={(_els) => {}}
            />
          </div>
        )}

        {step === "edit" && !editorInit && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
            <p>Something went wrong opening the editor.</p>
            <button onClick={() => setStep("format")} style={primaryBtn}>Start Over</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Format picker ────────────────────────────────────────────────────────────

const FORMAT_ICONS: Record<ArkiolCategory, string> = {
  instagram_post: "📷", instagram_story: "📱", youtube_thumbnail: "🎬",
  flyer: "📄", poster: "🖼️", presentation_slide: "📊",
  business_card: "💳", resume: "📋", logo: "✦",
  facebook_post: "📘", twitter_post: "🐦", display_banner: "🖥️",
  linkedin_post: "💼", tiktok_video: "🎵",
};
const FORMAT_DESC: Record<ArkiolCategory, string> = {
  instagram_post: "1080×1080 · Square post", instagram_story: "1080×1920 · Vertical story",
  youtube_thumbnail: "1280×720 · 16:9 thumbnail", flyer: "2550×3300 · Letter flyer",
  poster: "2480×3508 · A4 poster", presentation_slide: "1920×1080 · Widescreen slide",
  business_card: "1050×600 · Standard card", resume: "2550×3300 · Letter resume",
  logo: "1000×1000 · Square logo",
  facebook_post: "1200×630 · Landscape post", twitter_post: "1200×675 · Tweet image",
  display_banner: "1200×628 · Standard banner", linkedin_post: "1200×627 · Feed post",
  tiktok_video: "1080×1920 · Vertical video",
};

function FormatStep({ selected, onSelect }: { selected: string; onSelect: (f: string) => void }) {
  return (
    <div style={{ padding: "40px 40px", maxWidth: 900 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 24, color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>Choose a format</h2>
      <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: 14 }}>Pick the canvas you want the AI to design for</p>
      <div style={{ background: "var(--accent-tint)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-lg)", padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>Want to design manually?</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Skip AI generation and open a blank Canva-like canvas instead.</div>
        </div>
        <a href="/canvas" style={{ flexShrink: 0, padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-md)", background: "var(--bg-surface)", border: "1px solid var(--border-accent)", color: "var(--accent-light)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          ✏ Open Canvas →
        </a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {ARKIOL_CATEGORIES.map(cat => (
          <button key={cat} onClick={() => onSelect(cat)} style={{
            background: selected === cat ? "var(--accent-tint)" : "var(--bg-elevated)",
            border: selected === cat ? "1.5px solid var(--accent)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: "var(--radius-lg)", padding: "18px 16px", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{FORMAT_ICONS[cat]}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{CATEGORY_LABELS[cat]}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{FORMAT_DESC[cat]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Brief form ───────────────────────────────────────────────────────────────

const STYLES = ["modern_minimal","bold_editorial","luxury_elegant","playful_vibrant","corporate_clean","retro_vintage"];

function BriefStep({ format, prompt, setPrompt, style, setStyle, vars, setVars, ytMode, setYtMode, error, onBack, onGenerate }: any) {
  const isYt = format === "youtube_thumbnail";
  return (
    <div style={{ padding: "40px 40px", maxWidth: 640 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>← Back</button>
      <h2 style={{ margin: "0 0 6px", fontSize: 24, color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>Describe your design</h2>
      <p style={{ margin: "0 0 28px", color: "var(--text-muted)", fontSize: 14 }}>{CATEGORY_LABELS[format as ArkiolCategory]}</p>

      <label style={labelSt}>Design brief</label>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="E.g. Bold summer sale announcement for a luxury streetwear brand, dark palette with electric accents…"
        rows={4} style={{ ...inputSt, resize: "vertical", width: "100%", marginBottom: 18 }} />

      <label style={labelSt}>Style preset</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {STYLES.map(s => (
          <button key={s} onClick={() => setStyle(s)} style={{
            borderRadius: "var(--radius-sm)", padding: "5px 11px", fontSize: 12, cursor: "pointer", transition: "all 0.15s",
            background: "var(--accent-tint)",
            color: style === s ? "var(--accent-light)" : "var(--text-muted)",
            border: style === s ? "1px solid rgba(79,142,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
          }}>{s.replace(/_/g, " ")}</button>
        ))}
      </div>

      <label style={labelSt}>Variations</label>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[1,2,3].map(n => (
          <button key={n} onClick={() => setVars(n)} style={{
            borderRadius: "var(--radius-sm)", padding: "5px 14px", fontSize: 12, cursor: "pointer",
            background: "var(--accent-tint)",
            color: vars === n ? "var(--accent-light)" : "var(--text-muted)",
            border: vars === n ? "1px solid rgba(79,142,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
          }}>{n}</button>
        ))}
      </div>

      {isYt && (
        <>
          <label style={labelSt}>Thumbnail layout</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {["auto","face","product"].map(m => (
              <button key={m} onClick={() => setYtMode(m)} style={{
                borderRadius: "var(--radius-sm)", padding: "5px 14px", fontSize: 12, cursor: "pointer",
                background: "var(--accent-tint)",
                color: ytMode === m ? "var(--accent-light)" : "var(--text-muted)",
                border: ytMode === m ? "1px solid rgba(79,142,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
              }}>{m}</button>
            ))}
          </div>
        </>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--error-tint)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-md)", fontSize: 13, color: "var(--error)" }}>⚠ {error}</div>
      )}

      <button onClick={onGenerate} disabled={!prompt.trim()}
        style={{ ...primaryBtn, opacity: prompt.trim() ? 1 : 0.5, cursor: prompt.trim() ? "pointer" : "not-allowed" }}>
        Generate Design →
      </button>
    </div>
  );
}

function GeneratingStep({ progress, format }: { progress: number; format: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 20 }}>
      <div style={{ fontSize: 36, animation: "spin 2s linear infinite" }}>✦</div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Generating {CATEGORY_LABELS[format as ArkiolCategory]}…</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>AI is crafting your design</div>
      </div>
      <div style={{ width: 280, height: 4, borderRadius: 2, background: "var(--border-strong)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(5, progress)}%`, background: "linear-gradient(90deg, var(--accent), var(--tertiary))", borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{progress}%</div>
    </div>
  );
}

function LoadingEditorStep() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
      <div style={{ fontSize: 28, animation: "spin 1.5s linear infinite" }}>⟳</div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>Preparing your editable canvas…</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Converting generated layers to editor elements</div>
      </div>
    </div>
  );
}

function EditorLoadingScreen() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading editor…</div>
    </div>
  );
}

const crumbBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: "inherit" };
const primaryBtn: React.CSSProperties = { background: "linear-gradient(135deg, var(--accent), var(--tertiary))", border: "none", borderRadius: "var(--radius-md)", color: "#fff", padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const labelSt: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6, letterSpacing: "0.02em", textTransform: "uppercase" };
const inputSt: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", padding: "10px 14px", fontSize: 13 };
