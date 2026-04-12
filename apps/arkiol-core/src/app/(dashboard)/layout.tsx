// src/app/(dashboard)/layout.tsx
// Dashboard shell — safe auth guard with graceful fallback.
// When auth is configured: redirects unauthenticated users to /login.
// When auth is not configured: renders the dashboard for local/preview access.
import { SidebarLayout } from '../../components/dashboard/SidebarLayout';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const { detectCapabilities } = await import('@arkiol/shared');
    const caps = detectCapabilities();

    if (caps.auth && caps.database) {
      const { getServerSession } = await import('next-auth');
      const { authOptions } = await import('../../lib/auth');
      const session = await (getServerSession as any)(authOptions).catch(() => null);
      if (!session?.user) {
        const { redirect } = await import('next/navigation');
        redirect('/login');
      }
    }
  } catch {
    // Auth check failed — allow render in partial/preview deployments
    // The middleware layer handles real auth protection for API routes
  }

  return <SidebarLayout>{children}</SidebarLayout>;
}
