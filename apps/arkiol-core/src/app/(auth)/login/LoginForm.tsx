"use client";
import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArkiolLogo } from "../../../components/ArkiolLogo";

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

const FRIENDLY_ERRORS: Record<string, string> = {
  CredentialsSignin:       "Incorrect email or password.",
  OAuthSignin:             "Could not connect to sign-in provider. Try again.",
  OAuthCallback:           "Sign-in was interrupted. Please try again.",
  OAuthAccountNotLinked:   "This email is already registered with a different sign-in method.",
  EmailCreateAccount:      "Could not create account. Contact support.",
  SessionRequired:         "Please sign in to continue.",
  Default:                 "Something went wrong. Please try again.",
};

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router         = useRouter();
  const params         = useSearchParams();
  const justRegistered = params.get("registered") === "1";
  const urlError       = params.get("error");

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState(urlError ? (FRIENDLY_ERRORS[urlError] ?? FRIENDLY_ERRORS.Default) : "");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim())    { setError("Please enter your email address."); return; }
    if (!password)        { setError("Please enter your password."); return; }
    setLoading(true); setError("");
    try {
      // First check if the auth endpoint is actually up
      const healthCheck = await fetch("/api/auth/providers").catch(() => null);
      if (!healthCheck || !healthCheck.ok) {
        setError("The authentication service is temporarily unavailable. Please try again in a moment.");
        return;
      }

      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(FRIENDLY_ERRORS[result.error] ?? "Incorrect email or password. Please try again.");
      } else if (result?.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        // result is null or ok=false with no error — server issue
        setError("Sign-in failed. Please check your connection and try again.");
      }
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true); setError("");
    try {
      const { signIn } = await import("next-auth/react");
      await signIn("google", { callbackUrl: "/dashboard" });
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
          color:rgba(115,122,150,0.6); transition:color .15s; border-radius:0 11px 11px 0;
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
      `}</style>

      {/* Background effects */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:"-10%", left:"50%", transform:"translateX(-50%)", width:800, height:600, background:"radial-gradient(ellipse,rgba(79,142,247,0.07) 0%,transparent 55%)", animation:"glow-pulse 5s ease-in-out infinite" }}/>
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.013) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.013) 1px,transparent 1px)", backgroundSize:"80px 80px" }}/>
      </div>

      <div style={{ width:"100%", maxWidth:520, position:"relative", zIndex:1 }}>

        {/* Logo + heading */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, marginBottom:36 }}>
          <ArkiolLogo size="lg" animate />
          <div style={{ textAlign:"center" }}>
            <h1 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontStyle:"italic", fontSize:30, fontWeight:400, color:"#eaedf5", margin:"0 0 7px", letterSpacing:"-0.02em" }}>
              Welcome back
            </h1>
            <p style={{ color:"#4e5670", fontSize:14, margin:0, lineHeight:1.5 }}>
              Sign in to your Arkiol workspace
            </p>
          </div>
        </div>

        {/* Success banner */}
        {justRegistered && (
          <div style={{ background:"rgba(34,197,94,0.09)", border:"1px solid rgba(34,197,94,0.22)", borderRadius:12, padding:"13px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:10, color:"#86efac", fontSize:14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><polyline points="20 6 9 17 4 12"/></svg>
            Account created — sign in to get started.
          </div>
        )}

        {/* Card */}
        <div style={{ background:"rgba(255,255,255,0.034)", border:"1px solid rgba(255,255,255,0.082)", borderRadius:20, padding:"36px 40px 32px", backdropFilter:"blur(28px)", boxShadow:"0 28px 80px rgba(0,0,0,0.48), 0 1px 0 rgba(255,255,255,0.06) inset" }}>

          {error && (
            <div style={{ background:"rgba(220,38,38,0.09)", border:"1px solid rgba(220,38,38,0.2)", borderRadius:10, padding:"12px 15px", marginBottom:22, display:"flex", alignItems:"flex-start", gap:9, color:"#fca5a5", fontSize:13.5, lineHeight:1.5 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0, marginTop:1}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display:"flex", flexDirection:"column", gap:18 }}>

              {/* Email */}
              <div>
                <label className="ark-label" htmlFor="login-email">Email address</label>
                <input id="login-email" className="ark-field" type="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
                  required autoComplete="email" autoFocus />
              </div>

              {/* Password */}
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                  <label className="ark-label" htmlFor="login-pw" style={{ margin:0 }}>Password</label>
                  <Link href="/reset-password" style={{ fontSize:12.5, color:"#4f8ef7", textDecoration:"none", opacity:.8 }}
                    onMouseEnter={e=>(e.currentTarget.style.opacity="1")}
                    onMouseLeave={e=>(e.currentTarget.style.opacity=".8")}>
                    Forgot password?
                  </Link>
                </div>
                <div className="pw-wrap">
                  <input id="login-pw" className="ark-field" type={showPw?"text":"password"} value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                    required autoComplete="current-password" />
                  <button type="button" className="pw-eye" onClick={() => setShowPw(v => !v)}
                    title={showPw ? "Hide password" : "Show password"}>
                    <EyeIcon open={showPw} />
                  </button>
                </div>
              </div>

              <button type="submit" className="ark-btn" disabled={loading} style={{ marginTop:2 }}>
                {loading ? "Signing in…" : "Sign in"}
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

        <p style={{ textAlign:"center", marginTop:22, fontSize:14, color:"#333b55" }}>
          Don&apos;t have an account?{" "}
          <Link href="/register" style={{ color:"#4f8ef7", fontWeight:600, textDecoration:"none" }}>
            Create account →
          </Link>
        </p>
      </div>
    </div>
  );
}
