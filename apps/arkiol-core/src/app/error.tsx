"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("App error:", error); }, [error]);

  const isConfigError = error.message?.includes("not configured") ||
    error.message?.includes("DATABASE_URL") ||
    error.message?.includes("unavailable") ||
    error.message?.includes("NEXTAUTH");

  return (
    <div style={{
      minHeight: "100vh", background: "#06070d",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 400, height: 250, background: "radial-gradient(ellipse, rgba(79,142,247,0.06) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 42, marginBottom: 16 }}>{isConfigError ? "⚙️" : "⚠️"}</div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 26, fontWeight: 400, letterSpacing: "-0.025em", color: "#eaedf5", marginBottom: 12 }}>
          {isConfigError ? "Setup required" : "Something went wrong"}
        </h1>
        <p style={{ color: "#737a96", fontSize: 14, lineHeight: 1.7, marginBottom: 8 }}>
          {isConfigError
            ? "This environment needs configuration. Check your environment variables (DATABASE_URL, NEXTAUTH_SECRET, etc.)."
            : "An unexpected error occurred. We've been notified."}
        </p>
        {error?.digest && <p style={{ fontSize: 11.5, color: "#3e4358", marginBottom: 28, fontFamily: "monospace" }}>Error ID: {error.digest}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={reset} style={{ padding: "10px 24px", background: "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 650, cursor: "pointer", boxShadow: "0 4px 14px rgba(79,142,247,0.3)" }}>
            Try again
          </button>
          <Link href="/" style={{ padding: "10px 24px", background: "rgba(255,255,255,0.05)", color: "#737a96", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, textDecoration: "none", fontSize: 13.5, fontWeight: 500 }}>
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
