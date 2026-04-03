// src/hooks/useFontPreloader.ts
// B6: Pre-cache fonts used by the brand kit/template to reduce flicker
// Loads Google Fonts or system fonts using the CSS Font Loading API

"use client";

import { useEffect } from "react";

const SYSTEM_FONTS = new Set([
  "Arial", "Georgia", "Impact", "Verdana", "Trebuchet MS",
  "Courier New", "Times New Roman", "Helvetica",
]);

export function useFontPreloader(fontFamilies: string[]) {
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;

    const uniqueFonts = [...new Set(fontFamilies)].filter(Boolean);

    for (const family of uniqueFonts) {
      if (SYSTEM_FONTS.has(family)) continue; // Skip system fonts

      // Try to preload via FontFace API
      try {
        const font = new FontFace(family, `local("${family}")`);
        font.load().then(loadedFont => {
          document.fonts.add(loadedFont);
        }).catch(() => {
          // Font not available locally — try Google Fonts as fallback
          const link = document.createElement("link");
          link.rel  = "stylesheet";
          link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
          if (!document.querySelector(`link[href="${link.href}"]`)) {
            document.head.appendChild(link);
          }
        });
      } catch {
        // FontFace API not available
      }
    }
  }, [fontFamilies.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}
