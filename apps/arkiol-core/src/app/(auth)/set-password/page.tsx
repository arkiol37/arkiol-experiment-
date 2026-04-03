"use client";
import { useState, FormEvent, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArkiolLogo } from "../../../components/ArkiolLogo";

function SetPasswordForm() {
  const router  = useRouter();
  const params  = useSearchParams();
  const token   = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [done,     setDone]     = useState(false);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }
    setLoading(true); setError(null);
    const res  = await fetch("/api/auth/set-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Failed to set password"); setLoading(false); return; }
    setDone(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  const iStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px",
    background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 9, color: "#eaedf5",
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    fontSize: 14, outline: "none", transition: "border-color .15s, box-shadow .15s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#06070d", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`
        @keyframes ark-orbit { to { transform: rotate(360deg); } }
        .auth-input:focus { border-color: rgba(79,142,247,0.6) !important; box-shadow: 0 0 0 3px rgba(79,142,247,0.1) !important; }
        .auth-input::placeholder { color: rgba(115,122,150,0.6); }
      `}</style>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <ArkiolLogo size="lg" animate />
        <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "36px 28px", backdropFilter: "blur(20px)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)", width: "100%" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>✅</div>
              <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#eaedf5", marginBottom: 8 }}>Password set!</h2>
              <p style={{ color: "#737a96", fontSize: 13.5 }}>Redirecting you to sign in…</p>
            </div>
          ) : (
            <>
              <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#eaedf5", marginBottom: 8, letterSpacing: "-0.02em" }}>Set new password</h2>
              <p style={{ color: "#737a96", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>Choose a strong password for your account.</p>
              {!token && <div style={{ fontSize: 13, color: "#fca5a5", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>Invalid or expired reset link.</div>}
              {error && <div style={{ fontSize: 13, color: "#fca5a5", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>{error}</div>}
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#737a96", marginBottom: 7, letterSpacing: "0.02em" }}>New password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" required disabled={!token} style={iStyle} className="auth-input" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#737a96", marginBottom: 7, letterSpacing: "0.02em" }}>Confirm password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required disabled={!token} style={iStyle} className="auth-input" />
                </div>
                <button type="submit" disabled={loading || !token} style={{ width: "100%", padding: "11px", background: (loading || !token) ? "rgba(79,142,247,0.4)" : "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 650, cursor: (loading || !token) ? "not-allowed" : "pointer", boxShadow: (loading || !token) ? "none" : "0 4px 16px rgba(79,142,247,0.32)", transition: "all .15s", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {loading ? "Saving…" : "Set password"}
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

export default function SetPasswordPage() {
  return <Suspense fallback={null}><SetPasswordForm /></Suspense>;
}
