"use client";
import React, { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArkiolLogo } from "../../../components/ArkiolLogo";
import Link from "next/link";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim())          { setError("Please enter your name."); return; }
    if (!email.trim())         { setError("Please enter your email address."); return; }
    if (password.length < 8)   { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)  { setError("Passwords don't match — please re-enter."); return; }
    setLoading(true);

    let data: any = {};
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the real backend message — never show raw Prisma errors
        const msg = data.error ?? "Registration failed";
        // Map known patterns to friendly messages
        if (msg.includes("already exists") || res.status === 409) {
          setError("An account with this email already exists. Try signing in instead.");
        } else if (res.status === 503) {
          setError("Service temporarily unavailable. Please try again in a moment.");
        } else if (res.status === 429) {
          setError("Too many attempts. Please wait a few minutes and try again.");
        } else if (res.status === 400) {
          setError(msg); // Validation errors are already friendly
        } else {
          // Include detail in development; hide in production
          const detail = data.detail ? ` (${data.detail})` : "";
          setError(`Account creation failed.${detail} Please try again or contact support.`);
        }
        setLoading(false);
        return;
      }
    } catch {
      setError("Network error — please check your connection and try again.");
      setLoading(false);
      return;
    }

    const isOwner = data.user?.role === "SUPER_ADMIN";
    try {
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (result?.ok) {
        router.push(isOwner ? "/dashboard" : "/onboarding");
        router.refresh();
      } else {
        // Account created but auto sign-in failed — redirect to login with success banner
        router.push("/login?registered=1");
      }
    } catch {
      router.push("/login?registered=1");
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setLoading(true); setError(null);
    try {
      const { signIn } = await import("next-auth/react");
      await signIn("google", { callbackUrl: "/onboarding" });
    } catch {
      setError("Google sign-in failed. Please try again or use email/password.");
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:"#06070d", display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 20px", fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes glow-pulse { 0%,100%{opacity:.55} 50%{opacity:.8} }
        .ark-field {
          width:100%; padding:13px 16px; font-size:15px; font-family:inherit;
          background:rgba(255,255,255,0.05); border:1.5px solid rgba(255,255,255,0.09);
          border-radius:11px; color:#eaedf5; outline:none; box-sizing:border-box;
          transition:border-color .18s, box-shadow .18s, background .18s;
        }
        .ark-field::placeholder { color:rgba(115,122,150,0.5); }
        .ark-field:hover { background:rgba(255,255,255,0.065); border-color:rgba(255,255,255,0.14); }
        .ark-field:focus {
          background:rgba(255,255,255,0.07);
          border-color:rgba(79,142,247,0.7);
          box-shadow:0 0 0 4px rgba(79,142,247,0.11), 0 1px 3px rgba(0,0,0,0.3);
        }
        .pw-wrap { position:relative; }
        .pw-wrap .ark-field { padding-right:48px; }
        .pw-eye {
          position:absolute; right:0; top:0; bottom:0; width:46px;
          display:flex; align-items:center; justify-content:center;
          background:none; border:none; cursor:pointer;
          color:rgba(115,122,150,0.6); transition:color .15s;
          border-radius:0 11px 11px 0;
        }
        .pw-eye:hover { color:#9aa0b8; }
        .ark-btn {
          width:100%; padding:14px; font-size:15px; font-weight:700; font-family:inherit;
          background:linear-gradient(135deg,#4f8ef7 0%,#2b5ce6 100%);
          color:#fff; border:none; border-radius:11px; cursor:pointer;
          letter-spacing:-0.01em;
          box-shadow:0 4px 16px rgba(79,142,247,0.38), 0 1px 0 rgba(255,255,255,0.12) inset;
          transition:transform .15s, box-shadow .15s, opacity .15s;
        }
        .ark-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 7px 22px rgba(79,142,247,0.5), 0 1px 0 rgba(255,255,255,0.12) inset; }
        .ark-btn:active:not(:disabled) { transform:translateY(0); }
        .ark-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; box-shadow:none; }
        .ark-label { display:block; font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#5a6180; margin-bottom:7px; }
        .google-btn {
          width:100%; padding:13px 16px; font-size:14.5px; font-weight:500; font-family:inherit;
          background:rgba(255,255,255,0.055); border:1.5px solid rgba(255,255,255,0.1);
          border-radius:11px; color:#9aa0b8; cursor:pointer;
          display:flex; align-items:center; justify-content:center; gap:10px;
          transition:background .15s, border-color .15s, color .15s;
        }
        .google-btn:hover:not(:disabled) { background:rgba(255,255,255,0.09); border-color:rgba(255,255,255,0.18); color:#d8dae8; }
        .google-btn:disabled { opacity:.5; cursor:not-allowed; }
        .divider { display:flex; align-items:center; gap:14px; }
        .divider-line { flex:1; height:1px; background:rgba(255,255,255,0.07); }
        .divider-text { font-size:12px; color:#333b55; letter-spacing:.06em; }
        .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media(max-width:540px) { .two-col { grid-template-columns:1fr; } }
      `}</style>

      {/* Background effects */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:"-10%", left:"50%", transform:"translateX(-50%)", width:800, height:600, background:"radial-gradient(ellipse,rgba(79,142,247,0.07) 0%,transparent 55%)", animation:"glow-pulse 5s ease-in-out infinite" }}/>
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.013) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.013) 1px,transparent 1px)", backgroundSize:"80px 80px" }}/>
      </div>

      <div style={{ width:"100%", maxWidth:560, position:"relative", zIndex:1 }}>

        {/* Logo + heading */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, marginBottom:34 }}>
          <ArkiolLogo size="lg" animate />
          <div style={{ textAlign:"center" }}>
            <h1 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontStyle:"italic", fontSize:30, fontWeight:400, color:"#eaedf5", margin:"0 0 7px", letterSpacing:"-0.02em" }}>
              Create your account
            </h1>
            <p style={{ color:"#4e5670", fontSize:14, margin:0, lineHeight:1.5 }}>
              Start generating on-brand creative content today
            </p>
          </div>
        </div>

        {/* Card */}
        <div style={{ background:"rgba(255,255,255,0.034)", border:"1px solid rgba(255,255,255,0.082)", borderRadius:20, padding:"36px 40px 32px", backdropFilter:"blur(28px)", boxShadow:"0 28px 80px rgba(0,0,0,0.48), 0 1px 0 rgba(255,255,255,0.06) inset" }}>

          <form onSubmit={handleSubmit}>
            <div style={{ display:"flex", flexDirection:"column", gap:18 }}>

              {/* Row 1: Name + Email side by side */}
              <div className="two-col">
                <div>
                  <label className="ark-label" htmlFor="reg-name">Full name</label>
                  <input id="reg-name" className="ark-field" type="text" value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="Your name"
                    required autoComplete="name" autoFocus />
                </div>
                <div>
                  <label className="ark-label" htmlFor="reg-email">Email address</label>
                  <input id="reg-email" className="ark-field" type="email" value={email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} placeholder="you@company.com"
                    required autoComplete="email" />
                </div>
              </div>

              {/* Row 2: Password + Confirm side by side */}
              <div className="two-col">
                <div>
                  <label className="ark-label" htmlFor="reg-pw">Password</label>
                  <div className="pw-wrap">
                    <input id="reg-pw" className="ark-field" type={showPw?"text":"password"} value={password}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} placeholder="8+ characters"
                      required autoComplete="new-password" />
                    <button type="button" className="pw-eye" onClick={() => setShowPw((v: boolean) => !v)}
                      title={showPw?"Hide":"Show"}>
                      <EyeIcon open={showPw} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="ark-label" htmlFor="reg-confirm">Confirm password</label>
                  <div className="pw-wrap">
                    <input id="reg-confirm" className="ark-field" type={showConfirm?"text":"password"} value={confirm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} placeholder="Repeat password"
                      required autoComplete="new-password" />
                    <button type="button" className="pw-eye" onClick={() => setShowConfirm((v: boolean) => !v)}
                      title={showConfirm?"Hide":"Show"}>
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div style={{ background:"rgba(220,38,38,0.09)", border:"1px solid rgba(220,38,38,0.2)", borderRadius:10, padding:"12px 15px", display:"flex", alignItems:"flex-start", gap:9, color:"#fca5a5", fontSize:13.5, lineHeight:1.5 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0, marginTop:1}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="ark-btn" disabled={loading} style={{ marginTop:2 }}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </div>
          </form>

          {googleEnabled && (
            <>
              <div className="divider" style={{ margin:"24px 0" }}>
                <div className="divider-line"/><span className="divider-text">OR CONTINUE WITH</span><div className="divider-line"/>
              </div>
              <button className="google-btn" onClick={handleGoogle} disabled={loading}>
                <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continue with Google
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign:"center", marginTop:20, fontSize:14, color:"#333b55" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color:"#4f8ef7", fontWeight:600, textDecoration:"none" }}>Sign in</Link>
        </p>
        <p style={{ textAlign:"center", marginTop:8, fontSize:12, color:"#272e45" }}>
          By signing up you agree to our{" "}
          <Link href="/terms" style={{ color:"#3a4260", textDecoration:"none" }}>Terms</Link>
          {" · "}
          <Link href="/privacy" style={{ color:"#3a4260", textDecoration:"none" }}>Privacy</Link>
        </p>
      </div>
    </div>
  );
}
