// apps/arkiol-core/instrumentation.ts
// Next.js instrumentation hook — runs once at server startup.
// Validates critical env vars and logs capability status.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { detectCapabilities } = await import('@arkiol/shared');
    const caps = detectCapabilities();

    const available   = Object.entries(caps).filter(([,v]) => v).map(([k]) => k);
    const unavailable = Object.entries(caps).filter(([,v]) => !v).map(([k]) => k);

    console.log('🚀 [arkiol-core] Server starting...');
    if (available.length)   console.log(`✅ Available:   ${available.join(', ')}`);
    if (unavailable.length) console.log(`⚠️  Unavailable: ${unavailable.join(', ')} (configure env vars to enable)`);

    // Fail-fast for absolutely required env vars in production
    if (process.env.NODE_ENV === 'production') {
      const missing: string[] = [];
      if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
      if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) {
        missing.push('NEXTAUTH_SECRET (must be ≥32 chars)');
      }
      if (!process.env.NEXTAUTH_URL) missing.push('NEXTAUTH_URL');

      if (missing.length > 0) {
        const msg = `[arkiol-core] FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}`;
        console.error(msg);
        throw new Error(msg);
      }
    }
  }
}
