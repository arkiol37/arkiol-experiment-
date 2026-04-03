"use client";
// src/components/dashboard/BrandKitView.tsx — v13 ULTIMATE

import React, { useState, useEffect } from "react";

interface Brand {
  id: string; name: string; primaryColor: string; secondaryColor: string;
  fontDisplay: string; fontBody: string; voiceAttribs: Record<string, number>;
  logoUrl?: string; toneTag?: string;
}

const TONE_TAGS = ["bold", "luxury", "corporate", "playful", "minimal", "energetic"];

const VOICE_ATTRS = [
  { key: "bold",        label: "Bold" },
  { key: "playful",     label: "Playful" },
  { key: "luxury",      label: "Luxury" },
  { key: "minimal",     label: "Minimal" },
  { key: "energetic",   label: "Energetic" },
  { key: "trustworthy", label: "Trustworthy" },
];

const FONT_OPTIONS = [
  "Syne", "DM Sans", "Inter", "Georgia", "Playfair Display", "Space Grotesk",
  "Cabinet Grotesk", "Satoshi", "Bricolage Grotesque", "Outfit",
];

export function BrandKitView() {
  const [brands,  setBrands]  = useState<Brand[]>([]);
  const [active,  setActive]  = useState<Brand | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);
  const [form,    setForm]    = useState<Partial<Brand>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/brand").then(r => r.json())
      .then(d => { setBrands(d.brands ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const open = (b: Brand | null) => {
    setActive(b);
    setForm(b ?? {
      primaryColor: "#7c7ffa", secondaryColor: "#c084fc",
      fontDisplay: "Syne", fontBody: "DM Sans",
      voiceAttribs: { bold: 0.8, playful: 0.4, luxury: 0.6, minimal: 0.7, energetic: 0.5, trustworthy: 0.9 },
      toneTag: "bold",
    });
    setMsg(null);
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const method = active ? "PATCH" : "POST";
      const url    = active ? `/api/brand?id=${active.id}` : "/api/brand";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMsg("Brand kit saved!");
      if (!active) { setBrands(d => [...d, data.brand]); setActive(data.brand); }
      else { setBrands(d => d.map(b => b.id === active.id ? { ...b, ...form } as Brand : b)); }
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const setVoice = (key: string, val: number) =>
    setForm(f => ({ ...f, voiceAttribs: { ...f.voiceAttribs, [key]: val } }));

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>Brand Kit</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
            Define your brand&apos;s visual DNA — every AI generation locks to it automatically
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => open(null)} className="ak-btn ak-btn-secondary">+ New Brand</button>
          {form.name !== undefined && (
            <button onClick={save} disabled={saving} className="ak-btn ak-btn-primary">
              {saving ? "Saving…" : "Save Brand Kit"}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`ak-toast ${msg.startsWith("Error") ? "ak-toast-error" : "ak-toast-success"}`} style={{ marginBottom: 20 }}>
          <span>{msg.startsWith("Error") ? "⚠" : "✓"}</span><span>{msg}</span>
        </div>
      )}

      {/* Brand selector */}
      {brands.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
          {brands.map(b => (
            <button key={b.id} onClick={() => open(b)} className={`ak-pill${active?.id === b.id ? " active" : ""}`}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: b.primaryColor, marginRight: 6 }} />
              {b.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[0,1,2,3].map(i => <div key={i} className="ak-shimmer" style={{ height: 200, borderRadius: "var(--radius-xl)" }} />)}
        </div>
      ) : form.primaryColor === undefined ? (
        <div style={{ textAlign: "center", padding: "60px 24px", background: "var(--bg-elevated)", borderRadius: "var(--radius-2xl)", border: "1px dashed var(--border-strong)" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>◈</div>
          <h3 style={{ fontSize: 18, fontWeight: 400, fontFamily: "var(--font-display)", margin: "0 0 8px", letterSpacing: "-0.04em" }}>No brand kit yet</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, maxWidth: 320, margin: "0 auto 22px" }}>Create your first brand kit to make every generation on-brand.</p>
          <button onClick={() => open(null)} className="ak-btn ak-btn-primary">+ Create Brand Kit</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Brand Name */}
          <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
            <div className="ak-label" style={{ marginBottom: 16 }}>Brand Identity</div>
            <div className="ak-form-group" style={{ marginBottom: 16 }}>
              <label className="ak-form-label">Brand Name</label>
              <input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="ak-input" placeholder="e.g. Acme Corp" />
            </div>

            {/* Colors */}
            <div className="ak-label" style={{ marginBottom: 12 }}>Colors</div>
            {([["primaryColor","Primary Color"],["secondaryColor","Secondary Color"]] as [keyof Brand, string][]).map(([key, label]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 7 }}>{label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: (form[key] as string) ?? "#7c7ffa", border: "1px solid var(--border-strong)", flexShrink: 0 }} />
                  <input type="color" value={(form[key] as string) ?? "#7c7ffa"}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", height: 36, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", cursor: "pointer", background: "transparent", padding: "2px" }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-secondary)", minWidth: 60 }}>{((form[key] as string) ?? "").toUpperCase()}</span>
                </div>
              </div>
            ))}

            {/* Color preview */}
            <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)", marginTop: 8 }}>
              <div style={{ height: 52, background: `linear-gradient(135deg, ${form.primaryColor ?? "#7c7ffa"}, ${form.secondaryColor ?? "#c084fc"})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>
                {form.name ?? "Your Brand"}
              </div>
              <div style={{ padding: "12px 14px", background: "var(--bg-input)", display: "flex", gap: 8 }}>
                <div style={{ padding: "5px 13px", background: form.primaryColor, borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#fff" }}>Primary</div>
                <div style={{ padding: "5px 13px", background: form.secondaryColor, borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#fff" }}>Secondary</div>
              </div>
            </div>
          </div>

          {/* Voice */}
          <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
            <div className="ak-label" style={{ marginBottom: 16 }}>Brand Voice</div>
            <div className="ak-voice-bar" style={{ marginBottom: 22 }}>
              {VOICE_ATTRS.map(({ key, label }) => (
                <div key={key} className="ak-voice-item">
                  <span className="ak-voice-label">{label}</span>
                  <input type="range" min="0" max="100"
                    value={Math.round(((form.voiceAttribs?.[key] ?? 0.5) * 100))}
                    onChange={e => setVoice(key, Number(e.target.value) / 100)}
                    style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }} />
                  <span className="ak-voice-val">{Math.round((form.voiceAttribs?.[key] ?? 0.5) * 100)}</span>
                </div>
              ))}
            </div>

            <div className="ak-label" style={{ marginBottom: 12 }}>Tone Tag</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 20 }}>
              {TONE_TAGS.map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, toneTag: t }))} style={{
                  padding: "5px 14px", borderRadius: 99, border: "1px solid",
                  borderColor: form.toneTag === t ? "var(--border-accent)" : "var(--border-strong)",
                  background: form.toneTag === t ? "var(--accent-tint-md)" : "transparent",
                  color: form.toneTag === t ? "var(--accent-light)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-body)",
                  transition: "all var(--transition-fast)",
                }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
            <div className="ak-label" style={{ marginBottom: 16 }}>Typography</div>
            {([["fontDisplay","Display Font","Headings & titles"],["fontBody","Body Font","Body text & UI"]] as [keyof Brand, string, string][]).map(([key, label, desc]) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <label className="ak-form-label" style={{ marginBottom: 7 }}>{label}</label>
                <select value={(form[key] as string) ?? ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="ak-input ak-select" style={{ marginBottom: 8 }}>
                  {FONT_OPTIONS.map(f => <option key={f}>{f}</option>)}
                </select>
                <div style={{ padding: "12px 14px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: `'${form[key] as string}', sans-serif`, fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em" }}>{form[key] as string}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* AI Learning */}
          <div className="ak-card ak-card-elevated" style={{ padding: 24 }}>
            <div className="ak-label" style={{ marginBottom: 16 }}>AI Brand Learning</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Brand Score</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--accent-light)" }}>87 / 100</span>
              </div>
              <div className="ak-progress"><div className="ak-progress-fill" style={{ width: "87%" }} /></div>
            </div>
            {[
              { label: "Assets Analyzed",   val: "124" },
              { label: "Patterns Learned",  val: "38" },
              { label: "Style Accuracy",    val: "94%" },
              { label: "Last Updated",      val: "2h ago" },
            ].map(({ label, val }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{val}</span>
              </div>
            ))}
            <button className="ak-btn ak-btn-secondary" style={{ width: "100%", marginTop: 16, fontSize: 13 }}>◉ Re-train Brand AI</button>
          </div>
        </div>
      )}
    </div>
  );
}
