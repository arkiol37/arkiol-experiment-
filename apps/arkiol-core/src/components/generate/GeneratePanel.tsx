"use client";
// src/components/generate/GeneratePanel.tsx — v10
// Floating generate panel with archetype intelligence, rich AI stage experience

import React, { useState, useRef } from "react";
import { ARKIOL_CATEGORIES, CATEGORY_LABELS } from "../../lib/types";
import { AIGenerationStage } from "./AIGenerationStage";

interface GeneratePanelProps {
  onClose:    () => void;
  onComplete?: (jobId: string) => void;
}

const STYLE_PRESETS = [
  { id: "auto",         label: "✦ Auto (AI selects)" },
  { id: "clean",        label: "Clean" },
  { id: "bold",         label: "Bold" },
  { id: "professional", label: "Professional" },
  { id: "minimal",      label: "Minimal" },
  { id: "expressive",   label: "Expressive" },
];

const ARCHETYPE_OPTIONS = [
  { id: "auto",                    label: "✦ Auto (AI selects)" },
  { id: "AGGRESSIVE_POWER",        label: "Aggressive Power" },
  { id: "MINIMAL_CLEAN",           label: "Minimal Clean" },
  { id: "CURIOSITY_MYSTERY",       label: "Curiosity & Mystery" },
  { id: "PRODUCT_FOCUS",           label: "Product Focus" },
  { id: "TRUST_FRIENDLY",          label: "Trust & Friendly" },
  { id: "NEWS_URGENT",             label: "News Urgent" },
  { id: "CINEMATIC_DARK",          label: "Cinematic Dark" },
  { id: "SPORTS_ACTION",           label: "Sports Action" },
  { id: "MUSIC_ARTISTIC",          label: "Music Artistic" },
  { id: "COMPARISON_VS",           label: "Comparison VS" },
  { id: "BOLD_CLAIM",              label: "Bold Claim" },
  { id: "FACE_CLOSEUP",            label: "Face Closeup" },
  { id: "EDUCATIONAL_EXPLAINER",   label: "Educational Explainer" },
  { id: "KIDS_PLAYFUL",            label: "Kids Playful" },
  { id: "LUXURY_PREMIUM",          label: "Luxury Premium" },
  { id: "AUTHORITY_EXPERT",        label: "Authority Expert" },
  { id: "TECH_FUTURISTIC",         label: "Tech Futuristic" },
  { id: "FUN_PLAYFUL",             label: "Fun Playful" },
  { id: "EMOTIONAL_STORY",         label: "Emotional Story" },
];

export function GeneratePanel({ onClose, onComplete }: GeneratePanelProps) {
  const [prompt,    setPrompt]    = useState("");
  const [format,    setFormat]    = useState(ARKIOL_CATEGORIES[0]);
  const [preset,    setPreset]    = useState("auto");
  const [archetype, setArchetype] = useState("auto");
  const [gif,       setGif]       = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [jobId,     setJobId]     = useState<string | null>(null);
  const [progress,  setProgress]  = useState(0);
  const [status,    setStatus]    = useState<"idle"|"queued"|"running"|"done"|"error">("idle");
  const [error,     setError]     = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const gifEligible = ["instagram_post", "instagram_story"].includes(format);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setLoading(true); setError(null); setStatus("queued"); setProgress(0);

    const res  = await fetch("/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, formats: [format],
        stylePreset: preset === "auto" ? undefined : preset,
        includeGif:  gif && gifEligible,
        archetypeOverride: { archetypeId: archetype, presetId: preset },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Handle capability unavailable (503) with a helpful message
      const errMsg = res.status === 503
        ? (data.message ?? `${data.feature ?? 'Generation'} requires ${data.configure ?? 'additional configuration'}. Add the required environment variables.`)
        : (data.error ?? "Generation failed");
      setError(errMsg);
      setStatus("error"); setLoading(false); return;
    }

    const jid = data.jobId;
    setJobId(jid); setStatus("running");

    pollRef.current = setInterval(async () => {
      const r   = await fetch(`/api/jobs?id=${jid}`).catch(() => null);
      const d   = r ? await r.json().catch(() => ({})) : {};
      const job = d.jobs?.[0] ?? d.job ?? null;
      if (!job) return;
      setProgress(job.progress ?? 0);
      if (job.status === "COMPLETED" || job.status === "SUCCEEDED") {
        clearInterval(pollRef.current);
        setStatus("done"); setLoading(false);
        onComplete?.(jid);
      } else if (job.status === "FAILED") {
        clearInterval(pollRef.current);
        setError(job.result?.message ?? "Job failed");
        setStatus("error"); setLoading(false);
      }
    }, 1500);
  }

  function handleClose() {
    clearInterval(pollRef.current);
    onClose();
  }

  return (
    <div className="ak-modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ak-modal ak-fade-in" style={{ maxWidth: 560, position: "relative" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 26 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}
              className="ak-gradient-text">Generate Assets</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>Describe your design — AI builds it in seconds</p>
          </div>
          <button onClick={handleClose} className="ak-btn ak-btn-ghost ak-btn-icon" style={{ borderRadius: "50%", marginTop: -4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {status === "done" ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>✨</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px", fontFamily: "var(--font-display)", letterSpacing: "-0.04em" }}>Assets Ready!</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 26 }}>Your designs have been saved to your Gallery.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <a href="/gallery" className="ak-btn ak-btn-primary" style={{ padding: "10px 24px" }}>View in Gallery</a>
              <button onClick={() => { setStatus("idle"); setJobId(null); setPrompt(""); }} className="ak-btn ak-btn-secondary">Generate More</button>
            </div>
          </div>
        ) : (
          <>
            {/* Prompt */}
            <div className="ak-form-group" style={{ marginBottom: 16 }}>
              <label className="ak-form-label">Describe your design</label>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={loading}
                className="ak-input" placeholder='e.g. "Bold product launch post for a minimalist skincare brand — warm neutral tones, elegant typography"'
                style={{ resize: "vertical", minHeight: 96, fontFamily: "var(--font-body)" }} />
            </div>

            {/* Format */}
            <div className="ak-form-group" style={{ marginBottom: 16 }}>
              <label className="ak-form-label">Format</label>
              <select value={format} onChange={e => setFormat(e.target.value as any)} disabled={loading}
                className="ak-input ak-select">
                {ARKIOL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>

            {/* Archetype + Style */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div className="ak-form-group">
                <label className="ak-form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Archetype <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>AI-powered</span>
                </label>
                <select value={archetype} onChange={e => setArchetype(e.target.value)} disabled={loading}
                  className="ak-input ak-select">
                  {ARCHETYPE_OPTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div className="ak-form-group">
                <label className="ak-form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Style <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>AI-powered</span>
                </label>
                <select value={preset} onChange={e => setPreset(e.target.value)} disabled={loading}
                  className="ak-input ak-select">
                  {STYLE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* GIF toggle */}
            {gifEligible && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: loading ? "default" : "pointer" }}>
                <div onClick={() => !loading && setGif(g => !g)} style={{
                  width: 38, height: 21, borderRadius: 10, position: "relative",
                  background: gif ? "var(--accent)" : "var(--bg-overlay)",
                  border: `1px solid ${gif ? "var(--accent)" : "var(--border-strong)"}`,
                  transition: "all var(--transition-fast)", cursor: loading ? "default" : "pointer", flexShrink: 0,
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: gif ? 18 : 2, width: 15, height: 15,
                    borderRadius: "50%", background: "#fff", transition: "left var(--transition-fast)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </div>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  Include animated GIF <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>(+2 credits)</span>
                </span>
              </label>
            )}

            {/* AI Generation Stage Experience */}
            {loading && (
              <div style={{
                marginBottom: 18, padding: "20px 16px",
                background: "var(--bg-overlay)",
                borderRadius: "var(--radius-xl)",
                border: "1px solid rgba(124,127,250,0.12)",
              }}>
                <AIGenerationStage
                  progress={status === "queued" ? 0 : Math.max(5, progress)}
                  status={status as "queued" | "running" | "done" | "error"}
                />
              </div>
            )}

            {error && (
              <div className="ak-toast ak-toast-error" style={{ marginBottom: 16 }}>
                <span>⚠</span><span>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={handleClose} className="ak-btn ak-btn-ghost" style={{ flexShrink: 0 }}>Cancel</button>
              <button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="ak-btn ak-btn-primary" style={{ flex: 1, padding: "11px" }}>
                {loading ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ak-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
                    Generating…
                  </span>
                ) : "✦ Generate Now"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
