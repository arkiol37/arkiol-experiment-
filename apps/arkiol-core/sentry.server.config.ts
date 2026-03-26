// sentry.server.config.ts
// This file configures the Sentry SDK for the server-side (Node.js).

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: process.env.NODE_ENV === "development",

  // Don't send PII
  sendDefaultPii: false,

  beforeSend(event) {
    // Strip sensitive headers
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }
    // Never capture OpenAI key patterns
    if (event.message?.includes("sk-") || JSON.stringify(event).includes("sk-")) {
      return null; // Drop this event
    }
    return event;
  },

  integrations: [
    Sentry.prismaIntegration(),
  ],
});
