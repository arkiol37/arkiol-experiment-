"use client";
// src/components/generate/GeneratePanel.tsx — v11
// Floating generate panel with archetype intelligence, rich AI stage experience,
// and unified polling/stale/retry state from useJobPolling.

import React, { useEffect, useState } from "react";
import { ARKIOL_CATEGORIES, CATEGORY_LABELS } from "../../lib/types";
import { GALLERY_DEFAULT_CANDIDATE_COUNT } from "../../lib/gallery-config";
import { AIGenerationStage } from "./AIGenerationStage";
import { useJobPolling } from "../../lib/useJobPolling";
import { formatSilentDuration } from "../../lib/jobPollState";
import { resolveUserStage } from "../../lib/generationStages";

interface GeneratePanelProps {
  onClose:    () => void;
  onComplete?: (jobId: string) => void;
}

/** Best-effort renderer for the `details` payload that
 *  /api/generate forwards from the Render backend on validation
 *  failures. Render uses Zod's `flatten()` shape:
 *    { formErrors: string[], fieldErrors: { [field]: string[] } }
 *  We turn that into a single human-readable line so the UI shows
 *  "stylePreset: Required, prompt: String must contain..." instead
 *  of just "Invalid request". Returns null when the input is
 *  missing or unrecognisable. */
function formatFieldErrors(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { formErrors?: unknown; fieldErrors?: unknown; raw?: unknown };
  const parts: string[] = [];
  if (Array.isArray(d.formErrors)) {
    for (const m of d.formErrors) if (typeof m === "string") parts.push(m);
  }
  if (d.fieldErrors && typeof d.fieldErrors === "object") {
    for (const [field, msgs] of Object.entries(d.fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(msgs)) {
        const flat = msgs.filter((m): m is string => typeof m === "string").join(", ");
        if (flat) parts.push(`${field}: ${flat}`);
      }
    }
  }
  if (parts.length === 0 && typeof d.raw === "string") return d.raw.slice(0, 200);
  return parts.length ? parts.join("; ") : null;
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
  // Local "we're dispatching the initial POST /api/generate" flag —
  // distinct from the hook's polling states because before the server
  // returns a jobId there's nothing to poll.
  const [dispatching, setDispatching] = useState(false);
  // Pre-poll error (hit when /api/generate itself returns non-2xx).
  // Once the hook has a jobId it owns error surfacing through its view.
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // Unified polling hook owns: progress tracking, stale detection,
  // hard-abandon timeout, terminal-state cleanup, retry dispatch.
  const poll = useJobPolling();

  const gifEligible = ["instagram_post", "instagram_story"].includes(format);
  // `isBusy` covers: initial POST in flight OR hook is polling OR
  // a retry is in flight. The AIGenerationStage component and every
  // form-field `disabled` prop key off this single flag.
  const isBusy = dispatching || poll.isRetrying ||
    (poll.jobId !== null && !poll.shouldStopPolling);

  // Fire the success callback exactly once — when the hook's view
  // transitions to COMPLETED. Done via effect so re-renders don't
  // re-fire it.
  useEffect(() => {
    if (poll.state === "completed" && poll.jobId) onComplete?.(poll.jobId);
  }, [poll.state, poll.jobId, onComplete]);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setDispatching(true); setDispatchError(null);
    poll.stop();

    // Idempotency key — ensures a fast double-click (or a stale UI
    // refresh while the previous POST is still in-flight) reuses
    // the existing job instead of starting a second one. Without
    // this, the second POST went through pre-generation cost
    // checks against the (already-deducted) credit balance and
    // sometimes returned a misleading 402 even though the FIRST
    // job was completing successfully. The /api/generate route
    // already supports idempotency — it short-circuits with the
    // existing job's status when the same key arrives within 24h.
    // The key includes the prompt + format + variations + a
    // 60-second window so DIFFERENT prompts in the same minute
    // each get their own key, but a duplicate of the SAME prompt
    // is dedupd.
    const idempotencyWindow = Math.floor(Date.now() / 60_000);
    const idempotencyKey =
      `gen:${prompt.slice(0, 80)}:${format}:${preset}:${archetype}:` +
      `${gif && gifEligible ? "gif" : "static"}:${idempotencyWindow}`;

    const res  = await fetch("/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, formats: [format],
        stylePreset: preset === "auto" ? undefined : preset,
        includeGif:  gif && gifEligible,
        archetypeOverride: { archetypeId: archetype, presetId: preset },
        variations: GALLERY_DEFAULT_CANDIDATE_COUNT,
        idempotencyKey,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setDispatching(false);
    if (!res.ok) {
      // Handle capability unavailable (503) with a helpful message.
      // For all other errors, prefer the most specific message
      // available: Render's per-field `details` (Zod flattened) >
      // the backend's short `detail` string > top-level `error`.
      // Without this the UI used to show a vague "Invalid request"
      // when the real failure was a single field name mismatch.
      let message: string;
      if (res.status === 503) {
        message = data.message ?? `${data.feature ?? 'Generation'} requires ${data.configure ?? 'additional configuration'}. Add the required environment variables.`;
      } else {
        const top = data.error ?? "Generation failed";
        const detail = typeof data.detail === "string" && data.detail !== top ? data.detail : null;
        const fieldErrors = formatFieldErrors(data.details);
        message = [top, detail, fieldErrors].filter(Boolean).join(" — ");
      }
      setDispatchError(message);
      return;
    }

    const jid = data.jobId;
    if (!jid) { setDispatchError("Server did not return a job id."); return; }

    // Fast paths: the inline runner may finish before we even start
    // polling when the worker already had warm state. Treat these like
    // synthetic terminal ticks and skip interval setup.
    if (data.status === "COMPLETED" || data.status === "SUCCEEDED") {
      onComplete?.(jid);
      return;
    }
    if (data.status === "FAILED") {
      // Surface through the hook so the retry button + stale rules
      // still apply. The hook's first poll tick will pick up the real
      // FAILED row from /api/jobs.
      poll.start(jid);
      return;
    }

    poll.start(jid);
  }

  function handleClose() {
    poll.stop();
    onClose();
  }

  // Derived UI surface. The hook returns `state` with six cases; we
  // fan out to the specific visuals + messaging.
  const showSuccess = poll.state === "completed";
  const showError   = poll.state === "failed" || dispatchError !== null;
  const errorTitle  = dispatchError ? "Generation failed" : poll.errorTitle;
  const errorMsg    = dispatchError ?? poll.errorMessage ?? null;
  const canRetry    = !dispatchError && poll.retryable && poll.jobId !== null;
  const showStaleBanner = poll.state === "stale";
  const showRetryingBanner = poll.state === "retrying";
  const stageStatus = showSuccess ? "done"
    : showError ? "error"
    : poll.state === "queued" ? "queued"
    : "running";

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

        {showSuccess ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>✨</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px", fontFamily: "var(--font-display)", letterSpacing: "-0.04em" }}>Assets Ready!</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 26 }}>Your designs have been saved to your Gallery.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <a href="/gallery" className="ak-btn ak-btn-primary" style={{ padding: "10px 24px" }}>View in Gallery</a>
              <button onClick={() => { poll.stop(); setPrompt(""); setDispatchError(null); }} className="ak-btn ak-btn-secondary">Generate More</button>
            </div>
          </div>
        ) : (
          <>
            {/* Prompt */}
            <div className="ak-form-group" style={{ marginBottom: 16 }}>
              <label className="ak-form-label">Describe your design</label>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={isBusy}
                className="ak-input" placeholder='e.g. "Bold product launch post for a minimalist skincare brand — warm neutral tones, elegant typography"'
                style={{ resize: "vertical", minHeight: 96, fontFamily: "var(--font-body)" }} />
            </div>

            {/* Format */}
            <div className="ak-form-group" style={{ marginBottom: 16 }}>
              <label className="ak-form-label">Format</label>
              <select value={format} onChange={e => setFormat(e.target.value as any)} disabled={isBusy}
                className="ak-input ak-select">
                {ARKIOL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>

            {/* Archetype + Style */}
            <div className="ak-generate-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div className="ak-form-group">
                <label className="ak-form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Archetype <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>AI-powered</span>
                </label>
                <select value={archetype} onChange={e => setArchetype(e.target.value)} disabled={isBusy}
                  className="ak-input ak-select">
                  {ARCHETYPE_OPTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div className="ak-form-group">
                <label className="ak-form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Style <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>AI-powered</span>
                </label>
                <select value={preset} onChange={e => setPreset(e.target.value)} disabled={isBusy}
                  className="ak-input ak-select">
                  {STYLE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* GIF toggle */}
            {gifEligible && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: isBusy ? "default" : "pointer" }}>
                <div onClick={() => !isBusy && setGif(g => !g)} style={{
                  width: 38, height: 21, borderRadius: 10, position: "relative",
                  background: gif ? "var(--accent)" : "var(--bg-overlay)",
                  border: `1px solid ${gif ? "var(--accent)" : "var(--border-strong)"}`,
                  transition: "all var(--transition-fast)", cursor: isBusy ? "default" : "pointer", flexShrink: 0,
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
            {isBusy && (
              <div style={{
                marginBottom: 18, padding: "20px 16px",
                background: "var(--bg-overlay)",
                borderRadius: "var(--radius-xl)",
                border: "1px solid rgba(124,127,250,0.12)",
              }}>
                <AIGenerationStage
                  progress={poll.state === "queued" ? 0 : Math.max(5, poll.progress)}
                  status={stageStatus as "queued" | "running" | "done" | "error"}
                />
                {/* User-facing stage label — server-persisted on every
                    pipeline transition, so the text here is always in
                    sync with what the worker is actually doing (rather
                    than guessed from a progress %). Falls back to the
                    progress-range heuristic while PENDING before the
                    first transition write. */}
                {(poll.state === "running" || poll.state === "stale") && (() => {
                  const { label } = resolveUserStage(poll.progressStage, poll.progress);
                  return (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                      <span>{label}…</span>
                    </div>
                  );
                })()}
                {showRetryingBanner && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "var(--accent-light)" }}>
                    ↻ Retrying — previous attempt recovered from a transient error.
                  </div>
                )}
                {showStaleBanner && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#fbbf24" }}>
                    ⏳ Taking longer than usual — {formatSilentDuration(poll.silentForMs)} since the last update. We're still checking.
                  </div>
                )}
              </div>
            )}

            {showError && (
              <div className="ak-toast ak-toast-error" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <span>⚠</span>
                <span style={{ flex: 1 }}>
                  {errorTitle && <strong style={{ marginRight: 4 }}>{errorTitle}:</strong>}
                  {errorMsg}
                </span>
                {canRetry && (
                  <button
                    onClick={() => { void poll.retry(); }}
                    disabled={poll.isRetrying}
                    className="ak-btn ak-btn-secondary"
                    style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}>
                    {poll.isRetrying ? "Retrying…" : "↻ Retry"}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={handleClose} className="ak-btn ak-btn-ghost" style={{ flexShrink: 0 }}>Cancel</button>
              <button onClick={handleGenerate} disabled={isBusy || !prompt.trim()} className="ak-btn ak-btn-primary" style={{ flex: 1, padding: "11px" }}>
                {isBusy ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ak-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
                    {poll.state === "retrying" ? "Retrying…" : poll.state === "stale" ? "Still working…" : "Generating…"}
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
