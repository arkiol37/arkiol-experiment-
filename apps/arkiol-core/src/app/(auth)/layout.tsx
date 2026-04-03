// src/app/(auth)/layout.tsx
// Safe auth layout — never crashes even when NEXTAUTH_SECRET is missing.
// Guards redirect-if-logged-in behind capability check to prevent runtime errors.
import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Sign In — Arkiol",
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Only check session when auth IS configured — prevents crash when
  // NEXTAUTH_SECRET is absent (returns undefined from Proxy, crashes nextauth).
  try {
    const { detectCapabilities } = await import("@arkiol/shared");
    const caps = detectCapabilities();
    if (caps.auth && caps.database) {
      const { getServerSession } = await import("next-auth");
      const { authOptions }      = await import("../../lib/auth");
      const session: { user?: unknown } | null = await getServerSession(authOptions).catch(() => null);
      if (session?.user) {
        const { redirect } = await import("next/navigation");
        redirect("/dashboard");
      }
    }
  } catch {
    // Auth not configured — render children normally, no crash
  }

  return <>{children}</>;
}
