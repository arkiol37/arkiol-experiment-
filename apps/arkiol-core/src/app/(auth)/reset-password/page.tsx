"use client";
import { useState, FormEvent } from "react";
import Link from "next/link";
import { ArkiolLogo } from "../../../components/ArkiolLogo";

export default function ResetPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const res  = await fetch("/api/auth/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Request failed"); setLoading(false); return; }
    setSent(true);
  }

  const iStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px",
    background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 9, color: "#eaedf5",
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    fontSize: 14, outline: "none", transition: "border-color .15s, box-shadow .15s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#06070d", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", position: "relative" }}>
      <style>{`
        @keyframes ark-orbit { to { transform: rotate(360deg); } }
        .auth-input:focus { border-color: rgba(79,142,247,0.6) !important; box-shadow: 0 0 0 3px rgba(79,142,247,0.1) !important; }
        .auth-input::placeholder { color: rgba(115,122,150,0.6); }
      `}</style>
      <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)", width: 500, height: 300, background: "radial-gradient(ellipse, rgba(79,142,247,0.07) 0%, transparent 65%)", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32, gap: 14 }}>
          <ArkiolLogo size="lg" animate />
        </div>

        <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "36px 28px", backdropFilter: "blur(20px)", boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06) inset" }}>
          {sent ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>✉️</div>
              <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#eaedf5", marginBottom: 10, letterSpacing: "-0.02em" }}>Check your email</h2>
              <p style={{ color: "#737a96", fontSize: 13.5, lineHeight: 1.7, marginBottom: 24 }}>
                If an account exists for <strong style={{ color: "#eaedf5" }}>{email}</strong>, you&apos;ll receive a reset link shortly.
              </p>
              <Link href="/login" style={{ color: "#4f8ef7", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>← Back to sign in</Link>
            </div>
          ) : (
            <>
              <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#eaedf5", marginBottom: 8, letterSpacing: "-0.02em" }}>Reset password</h2>
              <p style={{ color: "#737a96", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>Enter your email and we&apos;ll send a reset link.</p>
              {error && <div style={{ fontSize: 13, color: "#fca5a5", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>{error}</div>}
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#737a96", marginBottom: 7, letterSpacing: "0.02em" }}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required style={iStyle} className="auth-input" />
                </div>
                <button type="submit" disabled={loading} style={{ width: "100%", padding: "11px", background: loading ? "rgba(79,142,247,0.4)" : "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 650, cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : "0 4px 16px rgba(79,142,247,0.32)", transition: "all .15s", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <Link href="/login" style={{ color: "#4f8ef7", fontSize: 13, fontWeight: 500, textDecoration: "none", opacity: 0.8 }}>← Back to sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
