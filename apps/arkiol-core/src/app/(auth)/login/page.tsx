// src/app/(auth)/login/page.tsx
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: "#06070d", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 32, height: 32, border: "2px solid rgba(79,142,247,0.3)", borderTopColor: "#4f8ef7", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </div>
      }
    >
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
