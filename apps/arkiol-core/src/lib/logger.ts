// src/lib/logger.ts
//
// Logger bootstrap: initializes BEFORE validateSharedEnv() runs so that
// startup validation errors can themselves be logged.
//
// Only reads through bootstrapEnv() — the typed allowlist in @arkiol/shared
// that permits pre-validation access to non-secret observability vars
// (NODE_ENV, LOG_LEVEL, SENTRY_DSN, npm_package_version). All other env
// access in production code must go through getEnv() after validation.
import pino from "pino";
import { bootstrapEnv } from "@arkiol/shared";

const isDev = bootstrapEnv("NODE_ENV") !== "production";

export const logger = pino({
  level: bootstrapEnv("LOG_LEVEL") ?? (isDev ? "debug" : "info"),

  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } }
    : undefined,

  redact: {
    paths: [
      "*.password", "*.passwordHash", "*.token", "*.apiKey",
      "*.OPENAI_API_KEY", "*.PADDLE_API_KEY", "*.STRIPE_SECRET_KEY",
      "*.secret", "*.keyHash",
      "req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']",
    ],
    censor: "[REDACTED]",
  },

  base: {
    env:     bootstrapEnv("NODE_ENV"),
    version: bootstrapEnv("npm_package_version") ?? "unknown",
  },

  serializers: {
    err:   pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req:   (req: { method?: string; url?: string; id?: string }) => ({ method: req.method, url: req.url, id: req.id }),
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
export function logRequest(method: string, path: string, userId?: string, durationMs?: number) {
  logger.info({ method, path, userId, durationMs }, `${method} ${path}`);
}

export function logError(err: unknown, context?: Record<string, unknown>) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: error, ...context }, error.message);

  // Sentry: bootstrapEnv is safe here — SENTRY_DSN is in the allowlist.
  if (bootstrapEnv("SENTRY_DSN") && bootstrapEnv("NODE_ENV") === "production") {
    import("@sentry/nextjs").then(Sentry => {
      Sentry.captureException(err, { extra: context });
    }).catch(() => {});
  }
}

export function logJobEvent(
  jobId:  string,
  event:  "started" | "completed" | "failed" | "skipped_duplicate" | "skipped_cancelled" | string,
  data?:  Record<string, unknown>
) {
  logger.info({ jobId, event, ...data }, `[job] ${event} — ${jobId}`);
}

export function logGenerationEvent(
  format:      string,
  stylePreset: string,
  durationMs:  number,
  success:     boolean
) {
  logger.info({ format, stylePreset, durationMs, success },
    `[generate] ${format} ${success ? "ok" : "failed"} in ${durationMs}ms`);
}

export default logger;
