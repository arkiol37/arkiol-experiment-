// src/app/page.tsx
// Root page — redirects authenticated users to dashboard, shows landing otherwise.
// Server Component (Node.js runtime): may use detectCapabilities().
import { redirect }           from 'next/navigation';
import { detectCapabilities } from '@arkiol/shared';
import { getServerSession }   from 'next-auth';
import { authOptions }        from '../lib/auth';
import LandingPage            from '../components/marketing/LandingPage';
import type { Metadata }      from 'next';

export const metadata: Metadata = {
  title:       'Arkiol — AI Design Platform for Teams',
  description: 'Generate on-brand logos, social content, flyers, thumbnails and more in seconds.',
  robots:      'index, follow',
};

export default async function RootPage() {
  // Only attempt session lookup when auth is fully configured.
  // Uses the centralized capability system — no raw process.env here.
  if (detectCapabilities().auth && detectCapabilities().database) {
    try {
      const session = await (getServerSession as any)(authOptions).catch(() => null);
      if (session?.user) redirect('/dashboard');
    } catch { /* auth unavailable — fall through to landing */ }
  }
  return <LandingPage />;
}
