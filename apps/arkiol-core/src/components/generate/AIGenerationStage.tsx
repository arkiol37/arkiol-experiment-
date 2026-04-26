"use client";
// src/components/generate/AIGenerationStage.tsx — v10
// Visually rich AI generation stage experience

import React, { useState, useEffect, useRef } from "react";

// Stage colors use CSS custom property values resolved at runtime.
// Using string literals that match the design token values for type safety
// while keeping color management in globals.css (Fix 9: theme consistency).
const STAGE_COLOR_TOKENS = [
  "var(--accent)",         // analyze
  "var(--secondary-light,#9b5de5)", // layout — falls back to secondary
  "var(--accent-light)",  // variations
  "var(--pink)",           // ranking
  "var(--tertiary)",       // render
] as const;

// Resolved hex fallbacks for canvas/SVG contexts (CSS vars don't work in SVG)
const STAGE_COLORS_HEX = ["#7c7ffa", "#9b5de5", "#c084fc", "#f472b6", "#22d3ee"] as const;

const STAGES = [
  {
    id: "analyze",
    label: "Analyzing prompt",
    subtext: "Understanding intent, mood & context",
    icon: "◎",
    color: STAGE_COLORS_HEX[0],
    cssColor: STAGE_COLOR_TOKENS[0],
    duration: 1800,
  },
  {
    id: "layout",
    label: "Applying layout intelligence",
    subtext: "Selecting optimal composition & hierarchy",
    icon: "⬡",
    color: STAGE_COLORS_HEX[1],
    cssColor: STAGE_COLOR_TOKENS[1],
    duration: 2000,
  },
  {
    id: "variations",
    label: "Exploring creative directions",
    subtext: "Generating 3-4 strong candidate templates",
    icon: "✦",
    color: STAGE_COLORS_HEX[2],
    cssColor: STAGE_COLOR_TOKENS[2],
    duration: 2200,
  },
  {
    id: "ranking",
    label: "Ranking candidates",
    subtext: "Scoring by brand fit, domain match & impact",
    icon: "◈",
    color: STAGE_COLORS_HEX[3],
    cssColor: STAGE_COLOR_TOKENS[3],
    duration: 1600,
  },
  {
    id: "render",
    // Free-tier flow ships SVG previews fast; high-res PNG/PDF
    // happens lazily on download. Don't tell the user we're
    // rendering at full resolution when we aren't.
    label: "Saving previews",
    subtext: "Storing SVG templates · high-res export runs on download",
    icon: "◉",
    color: STAGE_COLORS_HEX[4],
    cssColor: STAGE_COLOR_TOKENS[4],
    duration: 2000,
  },
] as const;

interface AIGenerationStageProps {
  progress: number;
  status: "queued" | "running" | "done" | "error";
}

export function AIGenerationStage({ progress, status }: AIGenerationStageProps) {
  const [activeStage, setActiveStage] = useState(0);
  const [completedStages, setCompletedStages] = useState<Set<number>>(new Set());
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; opacity: number }>>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const particleRef = useRef(0);

  // Progress → stage mapping
  useEffect(() => {
    const stage = Math.min(
      STAGES.length - 1,
      Math.floor((progress / 100) * STAGES.length)
    );
    // Mark everything before current as complete
    const completed = new Set<number>();
    for (let i = 0; i < stage; i++) completed.add(i);
    setCompletedStages(completed);
    setActiveStage(stage);
  }, [progress]);

  // Particle system
  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(() => {
      const id = ++particleRef.current;
      setParticles(p => [
        ...p.slice(-18),
        {
          id,
          x: 20 + Math.random() * 60,
          y: 20 + Math.random() * 60,
          size: 2 + Math.random() * 4,
          opacity: 0.3 + Math.random() * 0.5,
        },
      ]);
    }, 280);
    return () => clearInterval(interval);
  }, [status]);

  const currentStage = STAGES[activeStage];
  const overallPct = Math.round(progress);

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Main visual orb */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        marginBottom: 28, position: "relative", paddingTop: 8,
      }}>
        {/* Orbital rings */}
        <div style={{ position: "relative", width: 96, height: 96, marginBottom: 18 }}>
          {/* Outer ring */}
          <div style={{
            position: "absolute", inset: -8,
            borderRadius: "50%",
            border: `1px solid rgba(124,127,250,0.12)`,
            animation: "ak-spin 8s linear infinite",
          }}>
            <div style={{
              position: "absolute", top: "10%", left: "50%",
              width: 6, height: 6, borderRadius: "50%",
              background: currentStage.color,
              transform: "translate(-50%, -50%)",
              boxShadow: `0 0 8px ${currentStage.color}`,
              transition: "background 0.6s, box-shadow 0.6s",
            }} />
          </div>
          {/* Inner ring */}
          <div style={{
            position: "absolute", inset: 4,
            borderRadius: "50%",
            border: `1px solid rgba(124,127,250,0.08)`,
            animation: "ak-spin 5s linear infinite reverse",
          }}>
            <div style={{
              position: "absolute", top: "10%", left: "50%",
              width: 4, height: 4, borderRadius: "50%",
              background: "rgba(244,114,182,0.7)",
              transform: "translate(-50%, -50%)",
            }} />
          </div>
          {/* Core orb */}
          <div style={{
            position: "absolute", inset: 16,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 35%, ${currentStage.color}cc, ${currentStage.color}44)`,
            boxShadow: `0 0 24px ${currentStage.color}55, inset 0 0 16px rgba(255,255,255,0.08)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, transition: "background 0.6s, box-shadow 0.6s",
            animation: "ak-glow-pulse 2s ease-in-out infinite",
          }}>
            <span style={{ fontSize: 20, opacity: 0.9 }}>{currentStage.icon}</span>
          </div>
          {/* Ripple */}
          {status === "running" && (
            <div style={{
              position: "absolute", inset: 16, borderRadius: "50%",
              border: `1.5px solid ${currentStage.color}`,
              animation: "ak-ripple 2s ease-out infinite",
              pointerEvents: "none",
            }} />
          )}
          {/* Scattered particles */}
          {particles.slice(-6).map(p => (
            <div key={p.id} style={{
              position: "absolute",
              left: `${p.x}%`, top: `${p.y}%`,
              width: p.size, height: p.size,
              borderRadius: "50%",
              background: currentStage.color,
              opacity: p.opacity,
              transform: "translate(-50%,-50%)",
              transition: "opacity 0.8s",
              pointerEvents: "none",
            }} />
          ))}
        </div>

        {/* Stage label */}
        <div style={{ textAlign: "center", animation: "ak-fade-in 250ms ease both" }} key={activeStage}>
          <div style={{
            fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)",
            letterSpacing: "-0.03em", marginBottom: 4,
            color: currentStage.color,
          }}>
            {currentStage.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "-0.01em" }}>
            {currentStage.subtext}
          </div>
        </div>
      </div>

      {/* Progress bar with shimmer */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11.5 }}>
          <span style={{ color: "var(--text-muted)", letterSpacing: "0.02em" }}>
            {status === "queued" ? "Waiting in queue…" : "Processing"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", color: currentStage.color, fontWeight: 600 }}>
            {overallPct}%
          </span>
        </div>
        <div style={{
          height: 5, background: "var(--bg-overlay)", borderRadius: "var(--radius-full)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${overallPct}%`,
            background: `linear-gradient(90deg, ${currentStage.color}, ${STAGES[Math.min(activeStage + 1, STAGES.length - 1)].color})`,
            borderRadius: "var(--radius-full)",
            transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
            boxShadow: `0 0 8px ${currentStage.color}66`,
            position: "relative",
          }}>
            {/* Shimmer sweep */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "ak-shimmer 1.8s ease-in-out infinite",
            }} />
          </div>
        </div>
      </div>

      {/* Stage markers */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 0, position: "relative",
      }}>
        {/* Connecting line */}
        <div style={{
          position: "absolute",
          top: 12, left: "calc(10% + 2px)",
          right: "calc(10% + 2px)", height: 1,
          background: "var(--bg-overlay)",
          zIndex: 0,
        }} />
        <div style={{
          position: "absolute",
          top: 12, left: "calc(10% + 2px)",
          width: `${(overallPct / 100) * 80}%`, height: 1,
          background: `linear-gradient(90deg, ${STAGES[0].color}, ${currentStage.color})`,
          transition: "width 0.6s ease",
          zIndex: 1,
        }} />

        {STAGES.map((stage, i) => {
          const isDone = completedStages.has(i);
          const isActive = i === activeStage;
          return (
            <div key={stage.id} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 6, position: "relative", zIndex: 2,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: isDone
                  ? stage.color
                  : isActive
                  ? `radial-gradient(circle, ${stage.color}33, ${stage.color}11)`
                  : "var(--bg-overlay)",
                border: `1.5px solid ${isDone || isActive ? stage.color : "rgba(255,255,255,0.08)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, transition: "all 0.4s ease",
                boxShadow: isActive ? `0 0 12px ${stage.color}55` : "none",
                animation: isActive ? "ak-glow-pulse 2s ease-in-out infinite" : "none",
              }}>
                {isDone ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : isActive ? (
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: stage.color,
                    animation: "ak-stage-pulse 1.2s ease-in-out infinite",
                  }} />
                ) : (
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.15)" }} />
                )}
              </div>
              <div style={{
                fontSize: 9.5, fontWeight: 600, letterSpacing: "0.02em",
                color: isDone ? stage.color : isActive ? "var(--text-secondary)" : "var(--text-muted)",
                textAlign: "center", lineHeight: 1.3, maxWidth: 52,
                transition: "color 0.4s",
              }}>
                {stage.label.split(" ").slice(0, 2).join(" ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
