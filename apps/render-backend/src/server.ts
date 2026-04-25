// apps/render-backend/src/server.ts
//
// Entry point for the ARKIOL generation backend on Render.
//
// This service runs the heavy generation pipeline (OpenAI calls,
// template composition, asset injection, layout, render) that
// previously executed inline inside Vercel's serverless container.
// Vercel now handles only the UI + a lightweight /api/generate
// proxy that forwards here.
//
// Routes:
//   GET  /                 -> health check
//   GET  /health           -> health check (alias)
//   POST /generate         -> start a generation job (auth-guarded)
//   GET  /status/:jobId    -> status / progress
//   GET  /result/:jobId    -> final assets or error
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { healthRouter }   from './routes/health';
import { generateRouter } from './routes/generate';
import { statusRouter }   from './routes/status';
import { resultRouter }   from './routes/result';
import { requireSharedSecret } from './lib/auth';

const app = express();

// Render sits behind a proxy — trust it so req.ip / rate limiters
// see the real client.
app.set('trust proxy', 1);

app.use(helmet({
  // We don't serve HTML — disabling CSP avoids false positives on
  // JSON responses without any real benefit.
  contentSecurityPolicy: false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true); // dev default
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

app.use('/', healthRouter);
app.use('/health', healthRouter);

// /generate is the only shared-secret-gated endpoint. /status and
// /result read the DB using only the jobId — the frontend still
// enforces per-user ownership on its own /api/jobs route, which is
// where end users actually see status.
app.use('/generate', requireSharedSecret, generateRouter);
app.use('/status',   statusRouter);
app.use('/result',   resultRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Express 4 requires the (err, req, res, next) signature — keeping
// `next` in the param list is what tells Express this is an error
// handler, even though we don't call it.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err?.message ?? 'Unknown error';
  // Map well-known classes of failure to clearer status codes so
  // the Vercel forwarder (and the UI) sees an actionable signal
  // instead of a blanket 500.
  const isPrismaInit = err?.name === 'PrismaClientInitializationError';
  const isUnreachable = /Can't reach database server|ECONNREFUSED|ENOTFOUND/i.test(message);
  const status = (isPrismaInit || isUnreachable) ? 503 : 500;
  const code = isPrismaInit
    ? 'database_unreachable'
    : isUnreachable
      ? 'upstream_unreachable'
      : 'internal_error';
  // eslint-disable-next-line no-console
  console.error(
    `[render-backend] ${req.method} ${req.url} -> ${status} ${code}: ${message}`,
    err?.stack?.split('\n').slice(0, 4).join('\n'),
  );
  res.status(status).json({
    error:   status === 503 ? 'Generation backend dependency unavailable' : 'Internal server error',
    code,
    message,
  });
});

const port = Number(process.env.PORT ?? 4100);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[render-backend] listening on :${port}`);
});
