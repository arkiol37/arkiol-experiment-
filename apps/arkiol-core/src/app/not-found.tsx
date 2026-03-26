import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", background: "#06070d",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: "#eaedf5",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 500, height: 300, background: "radial-gradient(ellipse, rgba(79,142,247,0.07) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ textAlign: "center", padding: "48px 32px", position: "relative", zIndex: 1 }}>
        <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 100, fontWeight: 400, color: "rgba(255,255,255,0.06)", lineHeight: 1, marginBottom: 16, letterSpacing: "-0.04em" }}>404</div>
        <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 400, fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: "-0.025em", color: "#eaedf5" }}>Page not found</h1>
        <p style={{ margin: "0 0 32px", color: "#737a96", fontSize: 14.5, maxWidth: 360, lineHeight: 1.7 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/dashboard" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "11px 28px", background: "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff",
          borderRadius: 10, textDecoration: "none", fontSize: 14, fontWeight: 650,
          boxShadow: "0 4px 16px rgba(79,142,247,0.3)", letterSpacing: "-0.01em",
        }}>
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
