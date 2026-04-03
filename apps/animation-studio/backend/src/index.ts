import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';

import { config } from './config/env';
import { logger } from './config/logger';
import { db } from './config/database';
import { redis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { rateLimiter } from './middleware/rateLimiter';

// Routes
import authRoutes from './routes/auth';
import assetRoutes from './routes/assets';
import renderRoutes from './routes/renders';
import billingRoutes from './routes/billing';
import adminRoutes from './routes/admin';
import webhookRoutes from './routes/webhooks';
import healthRoutes from './routes/health';
import animationApiRoutes from './api/publicAnimationApi';
import brandAssetRoutes from './routes/brandAssets';
import { usersRouter, brandsRouter, projectsRouter, analyticsRouter, providersRouter } from './routes/_combined_routes';

const app = express();
const httpServer = createServer(app);

// ── Security ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', config.CDN_URL, 'blob:'],
      mediaSrc: ["'self'", config.CDN_URL],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      config.FRONTEND_URL,
      ...(config.NODE_ENV !== 'production'
        ? ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
        : []),
    ];
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Workspace-ID', 'X-API-Key'],
}));

// ── Stripe webhooks: must receive raw body before JSON parser ──
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request middleware ────────────────────────────────────────
app.use(requestId);
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(rateLimiter);

// ── Trust proxy (for correct IP behind load balancer/nginx) ──
if (config.NODE_ENV === 'production') app.set('trust proxy', 1);

// ── Routes ────────────────────────────────────────────────────
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/assets', assetRoutes);
app.use('/api/brand-assets', brandAssetRoutes);
app.use('/api/projects', projectsRouter);
app.use('/api/renders', renderRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/providers', providersRouter);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/v1/animation', animationApiRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ── Error handler (must be last) ─────────────────────────────
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────
async function bootstrap() {
  try {
    await db.raw('SELECT 1');
    logger.info('✅ Database connected');

    await redis.ping();
    logger.info('✅ Redis connected');

    // Initialize Sentry if DSN is set
    if (config.SENTRY_DSN) {
      const Sentry = await import('@sentry/node');
      Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
      logger.info('✅ Sentry initialized');
    }

    httpServer.listen(config.PORT, () => {
      logger.info(`🚀 Animation Studio API running on port ${config.PORT} [${config.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('❌ Startup failed:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down`);
  httpServer.close(async () => {
    try {
      await db.destroy();
      await redis.quit();
      logger.info('✅ Shutdown complete');
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection:', reason?.message || reason);
});

bootstrap();

export { app };
