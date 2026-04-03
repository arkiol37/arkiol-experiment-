// src/app/(dashboard)/animation-studio/page.tsx
// Animation Studio — full-page experience, rendered OUTSIDE the SidebarLayout.
// The (dashboard) layout wraps this in SidebarLayout, so we override visually
// by rendering a full-screen overlay that covers the sidebar.
// Auth is still provided by the parent layout — no new auth complexity.

import { AnimationStudioPage } from "../../../components/dashboard/AnimationStudioPage";
export default function Page() { return <AnimationStudioPage />; }
