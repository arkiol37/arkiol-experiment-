"use client";
// src/components/dashboard/ContentAIView.tsx — v13 ULTIMATE

import React, { useState } from "react";

const PLATFORMS = ["instagram","youtube","linkedin","twitter","general"] as const;
const TONES     = ["professional","bold","friendly","luxury","playful"] as const;

interface ContentResult {
  caption: string; hooks: string[]; hashtags: string[];
  adCopy: Array<{ variant: string; headline: string; body: string }>;
}

export function ContentAIView() {
  const [prompt,   setPrompt]   = useState("");
  const [platform, setPlatform] = useState<typeof PLATFORMS[number]>("instagram");
  const [tone,     setTone]     = useState<typeof TONES[number]>("professional");
  const [result,   setResult]   = useState<ContentResult | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [copied,   setCopied]   = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"caption"|"hooks"|"hashtags"|"adCopy">("caption");

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res  = await fetch("/api/content-ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, platform, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Arkiol Design failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 1100 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>Arkiol Design</h1>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
          Generate scroll-stopping captions, hooks, CTAs, and ad copy in seconds
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, alignItems: "start" }}>
        {/* Config panel */}
        <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
          <div className="ak-label" style={{ marginBottom: 16 }}>Generate Content</div>

          <div className="ak-form-group" style={{ marginBottom: 14 }}>
            <label className="ak-form-label">Topic or Product</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              className="ak-input" placeholder="e.g. skincare routine, SaaS launch, fitness coaching…"
              style={{ resize: "vertical", minHeight: 90, fontFamily: "var(--font-body)" }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div className="ak-form-group" style={{ marginBottom: 0 }}>
              <label className="ak-form-label">Platform</label>
              <select value={platform} onChange={e => setPlatform(e.target.value as any)} className="ak-input ak-select">
                {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div className="ak-form-group" style={{ marginBottom: 0 }}>
              <label className="ak-form-label">Tone</label>
              <select value={tone} onChange={e => setTone(e.target.value as any)} className="ak-input ak-select">
                {TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <button onClick={generate} disabled={loading || !prompt.trim()} className="ak-btn ak-btn-primary" style={{ width: "100%", padding: 12, fontSize: 14 }}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="ak-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
                Generating…
              </span>
            ) : "◉ Generate Content"}
          </button>

          {/* Quick prompts */}
          <div style={{ marginTop: 20 }}>
            <div className="ak-label" style={{ marginBottom: 10 }}>Quick Prompts</div>
            {[
              "Viral product reveal hook",
              "Engagement-boosting question",
              "Limited time offer CTA",
              "Personal transformation story",
            ].map(p => (
              <div key={p} onClick={() => setPrompt(p)} style={{
                padding: "9px 14px", background: "var(--bg-input)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, color: "var(--text-secondary)",
                marginBottom: 6, transition: "all var(--transition-fast)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
                {p}
              </div>
            ))}
          </div>
        </div>

        {/* Output panel */}
        <div className="ak-card ak-card-elevated" style={{ padding: 24, minHeight: 400 }}>
          {error && <div className="ak-toast ak-toast-error" style={{ marginBottom: 16 }}><span>⚠</span><span>{error}</span></div>}

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="ak-label" style={{ marginBottom: 6 }}>Writing your content…</div>
              {[100,80,90,65,75,55].map((w,i) => (
                <div key={i} className="ak-shimmer" style={{ height: 18, width: `${w}%`, borderRadius: 6 }} />
              ))}
            </div>
          ) : !result ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, flexDirection: "column", color: "var(--text-muted)", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>◉</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Your AI-generated content will appear here</div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>Fill in the form and click Generate</div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
                {(["caption","hooks","hashtags","adCopy"] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer",
                    fontSize: 13, fontWeight: 500, color: activeTab === tab ? "var(--accent-light)" : "var(--text-muted)",
                    borderBottom: `2px solid ${activeTab === tab ? "var(--accent)" : "transparent"}`,
                    marginBottom: -1, fontFamily: "var(--font-body)", transition: "all var(--transition-fast)",
                  }}>
                    {tab === "adCopy" ? "Ad Copy" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {activeTab === "caption" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div className="ak-label">Caption</div>
                    <button onClick={() => copy(result.caption, "caption")} className="ak-btn ak-btn-ghost ak-btn-sm">
                      {copied === "caption" ? "✓ Copied!" : "Copy"}
                    </button>
                  </div>
                  <div style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18, fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                    {result.caption}
                  </div>
                </div>
              )}

              {activeTab === "hooks" && (
                <div>
                  <div className="ak-label" style={{ marginBottom: 12 }}>Hooks</div>
                  {result.hooks.map((hook, i) => (
                    <div key={i} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 8, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)", position: "relative" }}>
                      <div style={{ position: "absolute", top: 12, right: 12 }}>
                        <button onClick={() => copy(hook, `hook-${i}`)} className="ak-btn ak-btn-ghost ak-btn-xs">
                          {copied === `hook-${i}` ? "✓" : "Copy"}
                        </button>
                      </div>
                      {hook}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "hashtags" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div className="ak-label">Hashtags</div>
                    <button onClick={() => copy(result.hashtags.join(" "), "hashtags")} className="ak-btn ak-btn-ghost ak-btn-sm">
                      {copied === "hashtags" ? "✓ Copied!" : "Copy All"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {result.hashtags.map((tag, i) => (
                      <span key={i} className="ak-badge ak-badge-accent" style={{ cursor: "pointer", fontSize: 12 }}
                        onClick={() => copy(tag, `tag-${i}`)}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "adCopy" && (
                <div>
                  <div className="ak-label" style={{ marginBottom: 12 }}>Ad Copy Variants</div>
                  {result.adCopy.map((ad, i) => (
                    <div key={i} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span className="ak-badge ak-badge-accent" style={{ fontSize: 10 }}>{ad.variant}</span>
                        <button onClick={() => copy(`${ad.headline}\n\n${ad.body}`, `ad-${i}`)} className="ak-btn ak-btn-ghost ak-btn-xs">
                          {copied === `ad-${i}` ? "✓" : "Copy"}
                        </button>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 400, fontFamily: "var(--font-display)", color: "var(--text-primary)", marginBottom: 6, letterSpacing: "-0.03em" }}>{ad.headline}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text-secondary)" }}>{ad.body}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button onClick={generate} className="ak-btn ak-btn-secondary ak-btn-sm" style={{ flex: 1 }}>Regenerate</button>
                <button className="ak-btn ak-btn-primary ak-btn-sm" style={{ flex: 1 }}>Use in Editor →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
