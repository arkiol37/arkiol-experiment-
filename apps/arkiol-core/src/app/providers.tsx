'use client';
// src/app/providers.tsx - Safe SessionProvider wrapper
// Uses top-level import with an error boundary fallback instead of try/catch
// require() at render time, which causes React hydration mismatches (#418, #425).
import React from 'react';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * Wraps next-auth SessionProvider safely.
 *
 * On the server, NextAuthSessionProvider renders its children (session=undefined
 * is fine — it just means "no session yet, fetch on mount"). On the client,
 * the same component hydrates identically, avoiding mismatch errors.
 *
 * If next-auth is truly not installed (won't happen in this repo since it's a
 * dependency), the import itself would fail at build time — which is the correct
 * signal, not a silent runtime swallow.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProviderErrorBoundary>
      <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
    </SessionProviderErrorBoundary>
  );
}

/**
 * Error boundary that catches runtime SessionProvider failures (e.g. missing
 * NEXTAUTH_URL in edge cases) and renders children without the provider.
 */
class SessionProviderErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[providers] SessionProvider failed, rendering without auth context:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return <>{this.props.children}</>;
    }
    return this.props.children;
  }
}
