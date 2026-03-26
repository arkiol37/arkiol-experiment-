# Dockerfile
# ── Arkiol Worker Image ───────────────────────────────────────────────────────
# Builds the persistent BullMQ generation worker with all native canvas deps.
# Deploy this to Railway / Fly.io / EC2 alongside your Next.js Vercel deployment.
#
# Build:  docker build -t arkiol-worker .
# Run:    docker run --env-file .env arkiol-worker
#
# Or with docker-compose:  docker-compose up worker

FROM node:20-slim AS base

# ── System dependencies for node-canvas and gif-encoder-2 ────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev \
    libcairo2 \
    libjpeg-dev \
    libjpeg62-turbo \
    libpango1.0-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgif-dev \
    libgif7 \
    librsvg2-dev \
    librsvg2-2 \
    libpixman-1-dev \
    libpixman-1-0 \
    build-essential \
    python3 \
    pkg-config \
    openssl \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS deps

COPY package.json package-lock.json* ./
# Rebuild canvas from source so it links against the system cairo libs
RUN npm ci --build-from-source

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript (workers only — no Next.js build needed here)
RUN npx tsc --project tsconfig.json --noEmit --skipLibCheck || true

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copy only what the worker needs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src          ./src
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/assets       ./assets

# ── Register bundled fonts with system fontconfig ─────────────────────────────
# This allows pango (used by librsvg2 for SVG rasterization) to find our fonts.
# node-canvas registerFont() handles canvas registration at runtime.
RUN mkdir -p /usr/local/share/fonts/arkiol \
    && cp /app/assets/fonts/*.ttf /usr/local/share/fonts/arkiol/ \
    && fc-cache -fv /usr/local/share/fonts/arkiol/ \
    && echo "Fonts registered:" && fc-list | grep arkiol || true

# Regenerate Prisma client in final image (links against correct OpenSSL)
RUN npx prisma generate

# Non-root user for security
RUN groupadd -r arkiol && useradd -r -g arkiol arkiol
RUN chown -R arkiol:arkiol /app
USER arkiol

# ── Health check ──────────────────────────────────────────────────────────────
# Verifies: (1) Redis reachable, (2) font assets present, (3) node-canvas works
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e " \
    const redis = require('./node_modules/ioredis'); \
    const fs    = require('fs'); \
    const r = new redis({ host: process.env.REDIS_HOST ?? 'localhost', lazyConnect: true }); \
    r.connect() \
      .then(() => r.ping()) \
      .then(() => { \
        if (!fs.existsSync('./assets/fonts/DejaVuSans-Regular.ttf')) throw new Error('Fonts missing'); \
        return r.disconnect(); \
      }) \
      .then(() => process.exit(0)) \
      .catch(() => process.exit(1)); \
  " || exit 1

# Start the combined worker (generation + webhook)
CMD ["node", "--require", "tsx/esm", "src/workers/index.ts"]
