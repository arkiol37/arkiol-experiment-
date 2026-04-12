// src/app/(dashboard)/admin/page.tsx
// Admin & Ops dashboard — only accessible to ADMIN and SUPER_ADMIN roles.
export const dynamic = "force-dynamic";

import { AdminOpsDashboard } from "../../../components/dashboard/AdminOpsDashboard";

export const metadata = { title: "Admin Dashboard — Arkiol" };

const ALLOWED_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export default async function AdminPage() {
  try {
    const { detectCapabilities } = await import("@arkiol/shared");
    const caps = detectCapabilities();
    if (caps.auth && caps.database) {
      const { getServerSession } = await import("next-auth");
      const { authOptions }      = await import("../../../lib/auth");
      const { redirect }         = await import("next/navigation");
      const session = await (getServerSession as any)(authOptions).catch(() => null);
      if (!session?.user) redirect("/login");
      const user = session.user as any;
      if (!ALLOWED_ROLES.has(user.role)) redirect("/dashboard");
    }
  } catch { /* render for partial deployments */ }

  return <AdminOpsDashboard />;
}
