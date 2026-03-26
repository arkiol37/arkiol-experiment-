'use client';
// src/app/providers.tsx - Safe SessionProvider wrapper
import React from 'react';

// Only render SessionProvider when auth is configured
// We detect this client-side by attempting to use it
export function SessionProvider({ children }: { children: React.ReactNode }) {
  try {
    const { SessionProvider: NextAuthSessionProvider } = require('next-auth/react');
    return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
  } catch {
    return <>{children}</>;
  }
}
