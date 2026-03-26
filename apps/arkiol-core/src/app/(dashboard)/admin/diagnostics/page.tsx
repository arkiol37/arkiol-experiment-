// src/app/(dashboard)/admin/diagnostics/page.tsx
import { DiagnosticsDashboard } from "../../../../components/dashboard/DiagnosticsDashboard";

export default function DiagnosticsPage() {
  return <DiagnosticsDashboard />;
}

export const metadata = {
  title: "Engine Diagnostics — Arkiol Admin",
  description: "Real-time engine health, metrics and diagnostics",
};
