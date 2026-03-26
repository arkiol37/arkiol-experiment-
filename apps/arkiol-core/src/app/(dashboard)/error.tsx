'use client';
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isMissingService = error.message?.includes('not configured') || 
    error.message?.includes('DATABASE_URL') ||
    error.message?.includes('unavailable');
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ color: '#fff', fontSize: 20, marginBottom: 8 }}>
        {isMissingService ? 'Service Not Available' : 'Something went wrong'}
      </h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
        {isMissingService
          ? 'This feature requires additional configuration. Add the required environment variables in your Vercel project settings.'
          : error.message || 'An unexpected error occurred.'}
      </p>
      <button onClick={reset} style={{ padding: '10px 20px', background: 'var(--accent, #4f46e5)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  );
}
