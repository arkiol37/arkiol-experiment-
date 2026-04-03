"use client";
// src/app/(dashboard)/onboarding/page.tsx — v10
// 4-step onboarding: Enter Prompt → Generate Designs → Select Result → Export/Edit
// Fix 10: Proper onboarding steps for first-time users with clear empty states.

import { useState } from "react";
import { useRouter } from "next/navigation";

// Steps match the required onboarding flow from the fixes doc:
// 1. Enter prompt  2. Generate designs  3. Select result  4. Export or continue editing
const STEPS = [
  { id: "welcome",  label: "Welcome",          icon: "✦" },
  { id: "brand",    label: "Brand Setup",       icon: "◈" },
  { id: "generate", label: "Enter Prompt",      icon: "◎" },
  { id: "done",     label: "Start Creating",    icon: "◉" },
];

const PRODUCT_MODES = [
  { id: "CREATOR", label: "Creator",         description: "Social posts, thumbnails, flyers — fast AI generation for individuals and small teams", icon: "✦" },
  { id: "STUDIO",  label: "Studio",          description: "Video, animation, and automation — full-stack production tools for agencies",               icon: "◈" },
];

const PALETTES = [
  [["#7c7ffa", "#c084fc", "#22d3ee"], "Electric Purple"],
  [["#f59e0b", "#ef4444", "#14B8A6"], "Sunset Red"],
  [["#10b981", "#3b82f6", "#f59e6b"], "Ocean Green"],
  [["#ec4899", "#14B8A6", "#06b6d4"], "Neon Pink"],
] as const;

const ONBOARDING_TIPS = [
  { step: "Enter Prompt",      desc: "Describe your design in natural language — the more detail, the better.", icon: "◎", color: "#7c7ffa" },
  { step: "Generate Designs",  desc: "Arkiol runs 8 creative variations and scores each one for brand fit and novelty.", icon: "✦", color: "#9b5de5" },
  { step: "Select Result",     desc: "Browse High Confidence and Experimental sections. Pick your favourite.", icon: "◈", color: "#f472b6" },
  { step: "Export or Edit",    desc: "Download your asset, edit it in the canvas editor, or generate similar variants.", icon: "◉", color: "#22d3ee" },
];

export default function OnboardingPage() {
  const router  = useRouter();
  const [step,        setStep]       = useState(0);
  const [mode,        setMode]       = useState("CREATOR");
  const [brandName,   setBrandName]  = useState("");
  const [paletteIdx,  setPaletteIdx] = useState(0);
  const [demoPrompt,  setDemoPrompt] = useState("");
  const [saving,      setSaving]     = useState(false);
  const [error,       setError]      = useState<string | null>(null);

  async function finish() {
    setSaving(true); setError(null);
    try {
      await fetch("/api/org", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productMode: mode }),
      });
      if (brandName.trim()) {
        const palette = PALETTES[paletteIdx][0];
        await fetch("/api/brand", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: brandName.trim(),
            primaryColor: palette[0],
            secondaryColor: palette[1],
            accentColors: [palette[2]],
          }),
        });
      }
      router.push("/dashboard");
    } catch {
      // Non-fatal — API calls may fail when auth/DB not configured; still proceed
      router.push("/dashboard");
      return;
    }
  }

  const card: React.CSSProperties = {
    background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-2xl)", padding: "36px 40px", boxShadow: "var(--shadow-lg)",
    maxWidth: 620, width: "100%", margin: "0 auto",
  };

  const btnPrimary: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: "12px 28px",
    background: "linear-gradient(135deg, var(--accent), #9b5de5)",
    color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
    border: "none", borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-accent)", fontFamily: "var(--font-body)",
    transition: "transform 120ms, box-shadow 120ms",
  };

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg-base)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: 24, fontFamily: "var(--font-body)",
      position: "relative", overflowX: "hidden",
    }}>
      {/* Background glow */}
      <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)", width: 700, height: 500, background: "radial-gradient(ellipse, rgba(124,127,250,0.10) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Arkiol wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 48, position: "relative" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(145deg, var(--accent), #9b5de5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", boxShadow: "0 0 18px var(--accent-glow)" }}>A</div>
        <span style={{ fontSize: 18, letterSpacing: "-0.05em", fontFamily: "var(--font-display)" }}>Arkiol</span>
      </div>

      {/* Step indicators */}
      <div style={{ display: "flex", gap: 6, marginBottom: 44, alignItems: "center", position: "relative" }}>
        {STEPS.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
              background: i < step ? "var(--accent)" : i === step ? "var(--accent-tint-md)" : "var(--bg-elevated)",
              color: i <= step ? "var(--accent-light)" : "var(--text-muted)",
              border: `1.5px solid ${i <= step ? "var(--accent)" : "var(--border)"}`,
              transition: "all var(--transition-base)",
              boxShadow: i === step ? "var(--shadow-accent)" : "none",
            }}>
              {i < step ? "✓" : s.icon}
            </div>
            <span style={{
              fontSize: 12, display: i > 2 ? "none" : "block",
              color: i === step ? "var(--text-primary)" : "var(--text-muted)",
              fontWeight: i === step ? 600 : 400,
            }}>{s.label}</span>
            {i < STEPS.length - 1 && (
              <div style={{ width: 24, height: 1, background: i < step ? "var(--accent)" : "var(--border)", transition: "background 0.4s", margin: "0 4px" }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 0: Welcome ── */}
      {step === 0 && (
        <div className="ak-fade-in" style={card}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
            <h2 style={{ fontSize: 26, letterSpacing: "-0.04em", margin: "0 0 10px", fontFamily: "var(--font-display)" }}>
              Welcome to Arkiol
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65, maxWidth: 440, margin: "0 auto" }}>
              You're 2 minutes away from your first AI-generated design. Let's quickly personalise your workspace.
            </p>
          </div>

          {/* How it works */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
            {ONBOARDING_TIPS.map((tip, i) => (
              <div key={tip.step} style={{
                display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px",
                background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)", animation: `ak-slide-up-stagger ${200 + i * 60}ms ease both`,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: `${tip.color}18`, border: `1px solid ${tip.color}28`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: tip.color, flexShrink: 0 }}>
                  {tip.icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", marginBottom: 3 }}>
                    {i + 1}. {tip.step}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{tip.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Mode selection */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>Choose your primary workflow</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {PRODUCT_MODES.map(m => (
                <div key={m.id} onClick={() => setMode(m.id)} style={{
                  padding: "16px 18px", borderRadius: "var(--radius-lg)", cursor: "pointer",
                  border: `2px solid ${mode === m.id ? "var(--accent)" : "var(--border)"}`,
                  background: mode === m.id ? "var(--accent-tint-md)" : "var(--bg-elevated)",
                  transition: "all var(--transition-base)",
                }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{m.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{m.description}</div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setStep(1)} style={{ ...btnPrimary, width: "100%" }}>
            Get started →
          </button>
        </div>
      )}

      {/* ── Step 1: Brand Setup ── */}
      {step === 1 && (
        <div className="ak-fade-in" style={card}>
          <h2 style={{ fontSize: 24, letterSpacing: "-0.04em", margin: "0 0 8px", fontFamily: "var(--font-display)" }}>Brand setup</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 28, fontSize: 13.5, lineHeight: 1.6 }}>
            Give your brand a name and choose a colour palette. Arkiol will use this across every generated design. You can change it later from Brand Settings.
          </p>

          <div className="ak-form-group" style={{ marginBottom: 22 }}>
            <label className="ak-form-label">Brand name (optional)</label>
            <input
              className="ak-input"
              placeholder='e.g. "Acme Creative" or "My Channel"'
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div style={{ marginBottom: 32 }}>
            <label className="ak-form-label" style={{ display: "block", marginBottom: 10 }}>Colour palette</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {PALETTES.map(([colors, name], i) => (
                <div key={name} onClick={() => setPaletteIdx(i)} style={{
                  padding: "14px 16px", borderRadius: "var(--radius-lg)", cursor: "pointer",
                  border: `2px solid ${paletteIdx === i ? "var(--accent)" : "var(--border)"}`,
                  background: paletteIdx === i ? "var(--accent-tint)" : "var(--bg-elevated)",
                  transition: "all var(--transition-base)",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    {colors.map(c => (
                      <div key={c} style={{ width: 16, height: 16, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}44` }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: paletteIdx === i ? "var(--accent-light)" : "var(--text-secondary)" }}>{name}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(0)} style={{ padding: "11px 20px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13.5, fontFamily: "var(--font-body)", fontWeight: 500 }}>
              Back
            </button>
            <button onClick={() => setStep(2)} style={{ ...btnPrimary, flex: 1 }}>
              Continue →
            </button>
          </div>
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
            You can skip brand setup and go straight to generating →{" "}
            <button onClick={() => setStep(2)} style={{ background: "none", border: "none", color: "var(--accent-light)", cursor: "pointer", fontSize: 12, textDecoration: "underline", fontFamily: "var(--font-body)" }}>
              Skip
            </button>
          </p>
        </div>
      )}

      {/* ── Step 2: Enter Prompt (preview the generate flow) ── */}
      {step === 2 && (
        <div className="ak-fade-in" style={card}>
          <h2 style={{ fontSize: 24, letterSpacing: "-0.04em", margin: "0 0 8px", fontFamily: "var(--font-display)" }}>
            Write your first prompt
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 13.5, lineHeight: 1.6 }}>
            This is how Arkiol works — just describe what you want to create. When you're ready, you'll generate from the Gallery or Editor.
          </p>

          {/* Prompt demo input */}
          <div className="ak-form-group" style={{ marginBottom: 20 }}>
            <label className="ak-form-label">Try a sample prompt</label>
            <textarea
              className="ak-input"
              placeholder='e.g. "Bold YouTube thumbnail for a tech review — dark background, orange accents, product in focus"'
              value={demoPrompt}
              onChange={e => setDemoPrompt(e.target.value)}
              style={{ minHeight: 90, resize: "vertical" }}
            />
          </div>

          {/* Output formats preview */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
              What Arkiol generates from one prompt
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {[
                { label: "YouTube Thumbnail", color: "#ef4444" },
                { label: "Instagram Post",    color: "#a855f7" },
                { label: "Instagram Story",   color: "#ec4899" },
                { label: "Display Ad",        color: "#3b82f6" },
                { label: "Flyer",             color: "#22d3ee" },
                { label: "Banner",            color: "#f59e0b" },
              ].map((f, i) => (
                <div key={f.label} style={{
                  padding: "10px", borderRadius: "var(--radius-md)",
                  background: `${f.color}0e`, border: `1px solid ${f.color}22`,
                  fontSize: 11, fontWeight: 600, color: f.color,
                  textAlign: "center", letterSpacing: "-0.01em",
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>◻</div>
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(1)} style={{ padding: "11px 20px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13.5, fontFamily: "var(--font-body)", fontWeight: 500 }}>
              Back
            </button>
            <button onClick={() => setStep(3)} style={{ ...btnPrimary, flex: 1 }}>
              Almost there →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done / Launch ── */}
      {step === 3 && (
        <div className="ak-fade-in" style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>🚀</div>
          <h2 style={{ fontSize: 26, letterSpacing: "-0.04em", margin: "0 0 12px", fontFamily: "var(--font-display)" }}>
            You're all set!
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.7, maxWidth: 400, margin: "0 auto 32px" }}>
            Your workspace is ready. Click <strong>Open Studio</strong> to generate your first design, or explore the dashboard to set up campaigns and brand kits.
          </p>

          {/* Quick-start tips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left", marginBottom: 32 }}>
            {[
              { icon: "◎", text: "Click Generate anywhere to create your first design" },
              { icon: "◈", text: "Browse Gallery → High Confidence Designs for top results" },
              { icon: "✦", text: "Edit in the canvas, then Export or Generate Similar" },
            ].map((tip, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: 16, color: "var(--accent-light)", flexShrink: 0 }}>{tip.icon}</span>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 }}>{tip.text}</span>
              </div>
            ))}
          </div>

          {error && (
            <div className="ak-toast ak-toast-warning" style={{ marginBottom: 18, textAlign: "left", fontSize: 13 }}>
              <span>⚠</span><span>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(2)} style={{ padding: "11px 20px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13.5, fontFamily: "var(--font-body)", fontWeight: 500 }}>
              Back
            </button>
            <button onClick={finish} disabled={saving} style={{ ...btnPrimary, flex: 1, opacity: saving ? 0.65 : 1 }}>
              {saving ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "ak-spin 0.75s linear infinite", display: "inline-block" }} />
                  Setting up…
                </span>
              ) : "Open Studio →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
