"use client";
// src/components/editor/ExplorationPanel.tsx
// Creative Exploration Panel — Progressive Previews, Mode Controls, Credit Feedback
//
// Shows a live exploration session with:
//   • Progressive rendering previews as candidates are evaluated
//   • Safe vs Experimental mode toggle
//   • Diversity cluster visualisation
//   • Per-candidate scores with explainability
//   • Credit usage feedback
//   • Real-time stats from the exploration engine

import React, { useState, useEffect, useCallback, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors exploration engine types)
// ─────────────────────────────────────────────────────────────────────────────

interface EvaluationScores {
  readability:            number;
  visualHierarchyClarity: number;
  platformOptimization:   number;
  brandAlignment:         number;
  visualBalance:          number;
  attentionPotential:     number;
  compositeScore:         number;
  weakestDimension:       string;
}

interface RankedCandidate {
  candidateId:     string;
  rank:            number;
  explorationScore:number;
  noveltyScore:    number;
  confidenceTier:  "high_confidence" | "experimental" | "speculative";
  scores:          EvaluationScores;
  genome: {
    archetype:          string;
    preset:             string;
    hookStrategy:       string;
    densityProfile:     string;
    compositionPattern: string;
    motionEligible:     boolean;
  };
}

interface ExploreStats {
  poolGenerated:         number;
  poolAfterConstraints:  number;
  finalCurated:          number;
  totalExploreMs:        number;
  averageCompositeScore: number;
  explorationTemperature:number;
}

interface ExploreResult {
  runId:         string;
  highConfidence:RankedCandidate[];
  experimental:  RankedCandidate[];
  stats:         ExploreStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  const pct = Math.round(value * 100);
  const color = accent ? "var(--accent)" : value >= 0.75 ? "var(--success)" : value >= 0.50 ? "var(--warning)" : "var(--error)";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "var(--surface-raised)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function ConfidenceBadge({ tier }: { tier: string }) {
  const config = {
    high_confidence: { label: "High Confidence", cls: "ak-badge-success" },
    experimental:    { label: "Experimental",    cls: "ak-badge-warning" },
    speculative:     { label: "Speculative",      cls: "ak-badge-muted" },
  }[tier] ?? { label: tier, cls: "ak-badge-muted" };

  return <span className={`ak-badge ${config.cls}`} style={{ fontSize: 9 }}>{config.label}</span>;
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
  index,
}: {
  candidate:  RankedCandidate;
  selected:   boolean;
  onSelect:   (id: string) => void;
  index:      number;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = Math.round(candidate.explorationScore * 100);

  return (
    <div
      onClick={() => onSelect(candidate.candidateId)}
      style={{
        border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        background: selected ? "color-mix(in srgb, var(--accent) 6%, var(--surface))" : "var(--surface)",
        transition: "border-color 0.15s, background 0.15s",
        marginBottom: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `hsl(${(index * 47) % 360},60%,${candidate.confidenceTier === "high_confidence" ? "45%" : "35%"})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800, color: "#fff",
          flexShrink: 0,
        }}>
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <ConfidenceBadge tier={candidate.confidenceTier} />
            {candidate.genome.motionEligible && (
              <span className="ak-badge ak-badge-accent" style={{ fontSize: 9 }}>GIF</span>
            )}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {candidate.genome.archetype.replace(/_/g, " ")} · {candidate.genome.preset}
          </p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, fontFamily: "var(--font-display)", color: score >= 75 ? "var(--success)" : score >= 55 ? "var(--warning)" : "var(--error)" }}>
            {score}
          </p>
          <p style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>SCORE</p>
        </div>
      </div>

      {/* Novelty chip */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {[
          { label: "Hook",     value: candidate.genome.hookStrategy.replace(/_/g, " ") },
          { label: "Layout",   value: candidate.genome.compositionPattern.replace(/_/g, " ") },
          { label: "Density",  value: candidate.genome.densityProfile },
        ].map(({ label, value }) => (
          <span key={label} style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 4,
            background: "var(--surface-raised)", color: "var(--text-secondary)",
            textTransform: "capitalize",
          }}>
            <span style={{ color: "var(--text-muted)" }}>{label}: </span>{value}
          </span>
        ))}
      </div>

      {/* Expand button */}
      <button
        onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
        style={{
          fontSize: 10, color: "var(--accent)", background: "none", border: "none",
          cursor: "pointer", padding: 0, letterSpacing: "0.03em",
        }}
      >
        {expanded ? "▲ Hide scores" : "▼ Show scores"}
      </button>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <ScoreBar label="Readability"   value={candidate.scores.readability} />
          <ScoreBar label="Hierarchy"     value={candidate.scores.visualHierarchyClarity} />
          <ScoreBar label="Platform Fit"  value={candidate.scores.platformOptimization} />
          <ScoreBar label="Brand Align"   value={candidate.scores.brandAlignment} />
          <ScoreBar label="Balance"       value={candidate.scores.visualBalance} />
          <ScoreBar label="Attention"     value={candidate.scores.attentionPotential} accent />
          {candidate.scores.weakestDimension && (
            <p style={{ fontSize: 9, color: "var(--warning)", marginTop: 6 }}>
              ⚠ Weakest: {candidate.scores.weakestDimension.replace(/([A-Z])/g, " $1").trim()}
            </p>
          )}
          <p style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
            Novelty: {Math.round(candidate.noveltyScore * 100)}%
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────────────────────

interface ExplorationPanelProps {
  jobId:        string;
  format:       string;
  onSelect?:    (candidateId: string, candidate: RankedCandidate) => void;
  onClose?:     () => void;
}

type ExploreMode = "safe" | "experimental";

export function ExplorationPanel({ jobId, format, onSelect, onClose }: ExplorationPanelProps) {
  const [mode,        setMode]        = useState<ExploreMode>("safe");
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState<ExploreResult | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<"safe" | "experimental">("safe");
  const [progressPct, setProgressPct] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval>>();

  const runExploration = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgressPct(0);

    // Simulate progressive loading
    progressRef.current = setInterval(() => {
      setProgressPct(p => p < 85 ? p + Math.random() * 8 : p);
    }, 300);

    try {
      const res  = await fetch("/api/explore", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          format,
          poolSize:            mode === "safe" ? 32 : 64,
          targetResultCount:   mode === "safe" ? 8  : 16,
          highConfidenceRatio: mode === "safe" ? 0.80 : 0.40,
          pipelineContext: {
            intent:          `Generate ${format} design`,
            format,
            audienceSegment: "general",
            tonePreference:  "neutral",
            layoutType:      "standard",
          },
        }),
      });

      const data = await res.json();
      clearInterval(progressRef.current);
      setProgressPct(100);

      if (!res.ok) {
        setError(data.error ?? "Exploration failed");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      clearInterval(progressRef.current);
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }, [jobId, format, mode]);

  useEffect(() => {
    runExploration();
    return () => clearInterval(progressRef.current);
  }, []);

  const displayCandidates = activeTab === "safe"
    ? (result?.highConfidence ?? [])
    : (result?.experimental ?? []);

  const creditCost = result
    ? mode === "safe" ? 0 : 1
    : 0;

  return (
    <div style={{
      width: 320, height: "100%", display: "flex", flexDirection: "column",
      background: "var(--surface)", borderLeft: "1px solid var(--border)",
      fontFamily: "var(--font-body)",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>
            Creative Exploration
          </h3>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, lineHeight: 1 }}>
              ×
            </button>
          )}
        </div>

        {/* Mode toggle */}
        <div style={{
          display: "flex", background: "var(--surface-raised)", borderRadius: 8, padding: 2, marginBottom: 10,
        }}>
          {(["safe", "experimental"] as ExploreMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); }}
              style={{
                flex: 1, padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700,
                textTransform: "capitalize", letterSpacing: "0.02em",
                background: mode === m ? "var(--accent)" : "transparent",
                color:      mode === m ? "#fff" : "var(--text-muted)",
                transition: "all 0.15s",
              }}
            >
              {m === "safe" ? "🛡 Safe" : "🧪 Experimental"}
            </button>
          ))}
        </div>

        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
          {mode === "safe"
            ? "High-confidence designs optimised for platform compliance."
            : "Creative stretch — unexpected combinations with higher novelty."}
        </p>

        {/* Credit cost */}
        <div style={{
          marginTop: 10, padding: "6px 8px", borderRadius: 6,
          background: creditCost > 0 ? "color-mix(in srgb, var(--warning) 12%, var(--surface))" : "var(--surface-raised)",
          border: `1px solid ${creditCost > 0 ? "var(--warning)" : "var(--border)"}`,
        }}>
          <span style={{ fontSize: 10, color: creditCost > 0 ? "var(--warning)" : "var(--text-muted)" }}>
            {creditCost === 0 ? "✓ No credit cost" : `⚡ Uses ${creditCost} credit${creditCost !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {loading && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Generating candidates…</span>
            <span style={{ fontSize: 10, color: "var(--accent)" }}>{Math.round(progressPct)}%</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: "var(--surface-raised)" }}>
            <div style={{ width: `${progressPct}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: "width 0.3s ease" }} />
          </div>
          <p style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
            Evaluating readability, hierarchy, platform fit…
          </p>
        </div>
      )}

      {/* Stats bar */}
      {result && !loading && (
        <div style={{
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", gap: 12,
        }}>
          {[
            { label: "Pool",   value: result.stats.poolGenerated },
            { label: "Valid",  value: result.stats.poolAfterConstraints ?? result.stats.poolGenerated },
            { label: "Curated",value: result.stats.finalCurated },
            { label: "Avg",    value: `${Math.round(result.stats.averageCompositeScore * 100)}%` },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", color: "var(--text-primary)" }}>
                {s.value}
              </p>
              <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</p>
            </div>
          ))}
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)" }}>{result.stats.totalExploreMs}ms</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      {result && !loading && (
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[
            { id: "safe",         label: `Safe (${result.highConfidence.length})` },
            { id: "experimental", label: `Experimental (${result.experimental.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as "safe" | "experimental")}
              style={{
                flex: 1, padding: "8px 6px", border: "none", cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 700,
                letterSpacing: "0.02em", textTransform: "uppercase",
                background: "none",
                color:      activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
                borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Candidate list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
        {error && (
          <div style={{ padding: "12px", background: "color-mix(in srgb, var(--error) 10%, var(--surface))", borderRadius: 8, marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--error)" }}>⚠ {error}</p>
          </div>
        )}

        {loading && !result && (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                height: 80, borderRadius: 10, background: "var(--surface-raised)",
                marginBottom: 8, animation: "ak-pulse 1.5s ease-in-out infinite",
                animationDelay: `${i * 0.15}s`,
              }} />
            ))}
          </div>
        )}

        {displayCandidates.map((candidate, i) => (
          <CandidateCard
            key={candidate.candidateId}
            candidate={candidate}
            selected={selected === candidate.candidateId}
            index={i}
            onSelect={(id) => {
              setSelected(id);
              onSelect?.(id, candidate);
            }}
          />
        ))}

        {result && !loading && displayCandidates.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 11 }}>
            No candidates in this tier.
          </div>
        )}
      </div>

      {/* Footer — regenerate */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        <button
          onClick={() => { setMode(m => m); runExploration(); }}
          disabled={loading}
          className="ak-btn ak-btn-secondary"
          style={{ width: "100%", fontSize: 11 }}
        >
          {loading ? "Exploring…" : "↻ Re-explore"}
        </button>
        {result && (
          <p style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
            Temp: {result.stats.explorationTemperature?.toFixed(2)}
            {" · "}
            <span title="Exploration temperature adapts as you make selections">Adaptive learning active</span>
          </p>
        )}
      </div>
    </div>
  );
}
