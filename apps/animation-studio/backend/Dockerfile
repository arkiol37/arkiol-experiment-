# ─── Builder stage ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build deps for native modules (argon2, sharp)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# ─── Production stage ──────────────────────────────────────────
FROM node:20-alpine AS production

# Install FFmpeg with full codec support + system fonts
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    ttf-freefont \
    libass \
    && fc-cache -f

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Create logs directory with correct permissions
RUN mkdir -p logs && chown -R node:node /app

# Non-root user for security
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:4000/api/health || exit 1

EXPOSE 4000

CMD ["node", "dist/index.js"]
