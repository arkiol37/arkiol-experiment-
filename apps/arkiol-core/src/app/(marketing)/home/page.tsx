// src/app/(marketing)/home/page.tsx
// Marketing landing page at /home — mirrors root / behaviour:
// redirects authenticated users to /dashboard, shows landing otherwise.
import { redirect }           from 'next/navigation';
import { detectCapabilities } from '@arkiol/shared';
import { getServerSession }   from 'next-auth';
import { authOptions }        from '../../../lib/auth';
import LandingPage            from '../../../components/marketing/LandingPage';
import type { Metadata }      from 'next';

export const metadata: Metadata = {
  title:       'Arkiol — AI Design Platform for Teams',
  description: 'Generate on-brand logos, social content, flyers, thumbnails and more in seconds.',
};

export default async function HomePage() {
  if (detectCapabilities().auth && detectCapabilities().database) {
    try {
      const session = await getServerSession(authOptions).catch(() => null);
      if (session?.user) redirect('/dashboard');
    } catch { /* auth unavailable — fall through */ }
  }
  return <LandingPage />;
}
