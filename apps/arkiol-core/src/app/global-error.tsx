"use client";
// src/app/global-error.tsx — Top-level error boundary
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body style={{ margin: 0, background: "#0a0a0f", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Application Error</h2>
            <p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>
              {error.message?.includes('not configured') || error.message?.includes('DATABASE_URL')
                ? error.message
                : "A critical error occurred. Check your environment configuration."}
            </p>
            {error.digest && <p style={{ color: "#555", fontSize: 12, marginBottom: 16 }}>Error ID: {error.digest}</p>}
            <button onClick={reset} style={{ padding: "10px 24px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
