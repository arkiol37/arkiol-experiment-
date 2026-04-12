"use client";
// src/components/dashboard/CampaignDirectorView.tsx
// Campaign Creative Director UI — Multi-format campaign generation from one prompt

import React, { useState } from "react";
import type { CampaignPlan, CampaignFormatPlan } from "../../engines/campaign/creative-director";

const OBJECTIVE_ICONS: Record<string, string> = {
  awareness:    "📣",
  engagement:   "💬",
  conversion:   "🎯",
  retention:    "🔄",
  announcement: "🚀",
};

const ROLE_ICONS: Record<string, string> = {
  hero:       "⭐",
  supporting: "📌",
  cta:        "👆",
  awareness:  "👁",
};

function FormatPlanCard({ plan, index }: { plan: CampaignFormatPlan; index: number }) {
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "12px 14px",
      background: "var(--bg-surface)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 5,
          background: `hsl(${index * 43 % 360},55%,40%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0,
        }}>
          {index + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {plan.format.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </p>
          <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)" }}>{plan.platform}</p>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <span className="ak-badge ak-badge-muted" style={{ fontSize: 8 }}>
            {ROLE_ICONS[plan.role]} {plan.role}
          </span>
          {plan.includeMotion && <span className="ak-badge ak-badge-accent" style={{ fontSize: 8 }}>GIF</span>}
        </div>
      </div>

      <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
        "{plan.headline}"
      </p>
      <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)", lineHeight: 1.3 }}>
        {plan.subMessage.length > 60 ? plan.subMessage.slice(0, 57) + "…" : plan.subMessage}
      </p>

      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
        {[
          { label: plan.archetypeId.replace(/_/g, " ") },
          { label: plan.presetId },
        ].map((t, i) => (
          <span key={i} style={{
            fontSize: 8, padding: "1px 5px", borderRadius: 3,
            background: "var(--bg-elevated)", color: "var(--text-secondary)",
            textTransform: "capitalize",
          }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CampaignDirectorView() {
  const [prompt,      setPrompt]      = useState("");
  const [formats,     setFormats]     = useState<string[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [plan,        setPlan]        = useState<CampaignPlan | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [queueing,    setQueueing]    = useState(false);
  const [queueDone,   setQueueDone]   = useState(false);
  const [jobIds,      setJobIds]      = useState<string[]>([]);

  async function handleGenerate() {
    if (!prompt.trim() || prompt.length < 10) return;
    setLoading(true);
    setError(null);
    setPlan(null);

    try {
      const res  = await fetch("/api/campaigns/director", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, requestedFormats: formats.length > 0 ? formats : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generation failed");
      } else {
        setPlan(data.campaignPlan);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function handleQueueAll() {
    if (!plan) return;
    setQueueing(true);
    try {
      const res  = await fetch("/api/campaigns/director", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, queueJobs: true }),
      });
      const data = await res.json();
      if (res.ok && data.jobIds) {
        setJobIds(data.jobIds);
        setQueueDone(true);
      }
    } catch {}
    setQueueing(false);
  }

  return (
    <div className="ak-fade-in" style={{ padding: "32px 40px", maxWidth: 960 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>
          Arkiol Ads
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
          Generate a complete multi-platform campaign from a single prompt
        </p>
      </div>

      {/* Input */}
      <div className="ak-card" style={{ padding: "20px 24px", marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 8 }}>
          Campaign Brief
        </label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g. Launch our new fitness app targeting young professionals. Drive sign-ups with urgency and high energy."
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", padding: "10px 12px",
            borderRadius: 8, border: "1.5px solid var(--border)",
            background: "var(--bg-elevated)", color: "var(--text-primary)",
            fontSize: 13, fontFamily: "var(--font-body)", lineHeight: 1.5,
            resize: "vertical", outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 10, color: prompt.length < 10 ? "var(--error)" : "var(--text-muted)" }}>
            {prompt.length}/2000 chars {prompt.length < 10 ? "· minimum 10" : ""}
          </span>
          <button
            onClick={handleGenerate}
            disabled={loading || prompt.length < 10}
            className="ak-btn ak-btn-primary"
            style={{ fontSize: 12 }}
          >
            {loading ? "Planning…" : "✦ Generate Campaign Plan"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(220,38,38,0.07)", borderRadius: 8 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--error)" }}>⚠ {error}</p>
        </div>
      )}

      {plan && (
        <>
          {/* Identity */}
          <div className="ak-card" style={{ padding: "16px 20px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>{OBJECTIVE_ICONS[plan.objective]}</span>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "-0.03em" }}>
                  {plan.objective.charAt(0).toUpperCase() + plan.objective.slice(1)} Campaign
                </p>
                <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
                  {plan.formats.length} formats · ~{plan.estimatedCredits} credits
                </p>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  background: plan.identity.primaryColor, border: "1px solid var(--border)",
                }} title={`Primary: ${plan.identity.primaryColor}`} />
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  background: plan.identity.accentColor, border: "1px solid var(--border)",
                }} title={`Accent: ${plan.identity.accentColor}`} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Tone",       value: plan.identity.tone },
                { label: "Hook",       value: plan.identity.hookStrategy.replace(/_/g, " ") },
                { label: "Composition",value: plan.identity.compositionPattern.replace(/_/g, " ") },
                { label: "Typography", value: ["Clean", "Expressive", "Editorial", "Playful", "Luxury"][plan.identity.typographyPersonality] },
              ].map(f => (
                <div key={f.label} style={{ background: "var(--bg-elevated)", borderRadius: 6, padding: "6px 10px" }}>
                  <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{f.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{f.value}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--bg-elevated)", borderRadius: 6 }}>
              <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>Headline</p>
              <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" }}>"{plan.identity.headline}"</p>
              <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>{plan.identity.subMessage}</p>
            </div>
          </div>

          {/* Format plans */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 10 }}>
              Format Plans ({plan.formats.length})
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
              {plan.formats.map((f, i) => (
                <FormatPlanCard key={f.format} plan={f} index={i} />
              ))}
            </div>
          </div>

          {/* Queue all button */}
          {queueDone ? (
            <div style={{ padding: "12px 16px", background: "color-mix(in srgb, var(--success) 10%, var(--bg-surface))", borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--success)", fontWeight: 700 }}>
                ✓ {jobIds.length} jobs queued — check Campaigns & Jobs for progress
              </p>
            </div>
          ) : (
            <button
              onClick={handleQueueAll}
              disabled={queueing}
              className="ak-btn ak-btn-primary"
              style={{ fontSize: 12 }}
            >
              {queueing ? "Queuing…" : `⚡ Generate All ${plan.formats.length} Formats`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
