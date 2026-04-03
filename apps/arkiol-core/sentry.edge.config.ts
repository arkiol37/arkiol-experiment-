// sentry.edge.config.ts
// This file configures the Sentry SDK for the Edge runtime (middleware).

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
  debug: false,
});
