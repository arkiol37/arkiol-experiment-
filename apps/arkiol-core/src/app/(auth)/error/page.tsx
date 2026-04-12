"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ArkiolLogo } from "../../../components/ArkiolLogo";

const ERROR_MESSAGES: Record<string, { title: string; message: string }> = {
  Configuration:         { title: "Configuration error",    message: "Authentication isn't fully configured. Contact support if this persists." },
  AccessDenied:          { title: "Access denied",          message: "Your account doesn't have permission to sign in." },
  Verification:          { title: "Link expired",           message: "This sign-in link has expired or already been used." },
  OAuthSignin:           { title: "Sign-in failed",         message: "Couldn't connect to the sign-in provider. Please try again." },
  OAuthCallback:         { title: "Sign-in failed",         message: "Something went wrong during sign-in. Please try again." },
  OAuthCreateAccount:    { title: "Account error",          message: "Couldn't create an account with this provider." },
  EmailCreateAccount:    { title: "Account error",          message: "Couldn't create an account with this email." },
  Callback:              { title: "Sign-in error",          message: "A sign-in callback error occurred. Please try again." },
  OAuthAccountNotLinked: { title: "Account already exists", message: "This email is linked to a different sign-in method." },
  SessionRequired:       { title: "Sign in required",       message: "You need to be signed in to access that page." },
  Default:               { title: "Authentication error",   message: "Something went wrong during sign-in. Please try again." },
};

function AuthErrorContent() {
  const params   = useSearchParams();
  const errorKey = params.get("error") ?? "Default";
  const { title, message } = ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.Default;

  return (
    <div style={{ minHeight: "100vh", background: "#06070d", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`@keyframes ark-orbit { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <ArkiolLogo size="lg" animate />
        <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 16, padding: "36px 28px", backdropFilter: "blur(20px)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)", width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#eaedf5", marginBottom: 10, letterSpacing: "-0.02em" }}>{title}</h1>
          <p style={{ color: "#737a96", fontSize: 13.5, lineHeight: 1.7, marginBottom: 24 }}>{message}</p>
          <Link href="/login" style={{ display: "inline-block", background: "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff", borderRadius: 9, padding: "10px 24px", fontSize: 13.5, fontWeight: 650, textDecoration: "none", boxShadow: "0 4px 16px rgba(79,142,247,0.3)" }}>
            Try signing in again
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return <Suspense fallback={null}><AuthErrorContent /></Suspense>;
}
