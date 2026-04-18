// src/app/(editor)/layout.tsx
// Editor layout — full-screen, no sidebar, no dashboard chrome.
// This route group gives the editor its own isolated layout.

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}
