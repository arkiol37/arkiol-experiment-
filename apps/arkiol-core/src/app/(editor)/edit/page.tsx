// src/app/(editor)/edit/page.tsx
// Full-page editor entry point — mounts FullPageEditor outside dashboard layout.
"use client";

import dynamic from "next/dynamic";

const FullPageEditor = dynamic(
  () => import("../../../components/editor/FullPageEditor").then(m => m.FullPageEditor),
  { ssr: false },
);

export default function EditPage() {
  return <FullPageEditor />;
}
