// src/app/layout.tsx
import type { Metadata } from "next";
import { SessionProvider } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title:       "Arkiol — AI Design Platform",
  description: "Intelligent creative infrastructure. One brief. Every format. Always on-brand.",
  robots:      "index, follow",
  icons:       { icon: "/favicon.svg" },
  openGraph: {
    title:       "Arkiol — AI Design Platform",
    description: "Intelligent creative infrastructure. One brief. Every format. Always on-brand.",
    type:        "website",
    siteName:    "Arkiol",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "Arkiol — AI Design Platform",
    description: "Intelligent creative infrastructure. One brief. Every format. Always on-brand.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#06070d" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Primary UI font + new display font (Instrument Serif) + mono */}
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
