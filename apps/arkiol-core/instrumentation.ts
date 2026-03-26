// apps/arkiol-core/instrumentation.ts
// Next.js instrumentation hook — runs once at server startup.
// Logs which services are available without blocking startup for missing ones.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { detectCapabilities } = await import('@arkiol/shared');
    const caps = detectCapabilities();

    const available   = Object.entries(caps).filter(([,v]) => v).map(([k]) => k);
    const unavailable = Object.entries(caps).filter(([,v]) => !v).map(([k]) => k);

    console.log('🚀 [arkiol-core] Server starting...');
    if (available.length)   console.log(`✅ Available:   ${available.join(', ')}`);
    if (unavailable.length) console.log(`⚠️  Unavailable: ${unavailable.join(', ')} (configure env vars to enable)`);
  }
}
