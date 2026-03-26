// src/app/(dashboard)/dashboard/page.tsx
export const dynamic = "force-dynamic";

import { DashboardHome } from "../../../components/dashboard/DashboardHome";

export default async function DashboardPage() {
  let user: any = null;
  try {
    const { detectCapabilities } = await import('@arkiol/shared');
    const caps = detectCapabilities();
    if (caps.auth && caps.database) {
      const { getServerSession } = await import('next-auth');
      const { authOptions } = await import('../../../lib/auth');
      const session = await (getServerSession as any)(authOptions).catch(() => null);
      if (session?.user) {
        const u = session.user as any;
        user = { id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.orgId };
      }
    }
  } catch { /* render without user context */ }

  return <DashboardHome user={user} />;
}
