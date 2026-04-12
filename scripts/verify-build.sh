#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ARKIOL v12 — Build Verification                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"

echo ""
echo "1. Installing dependencies..."
npm install

echo ""
echo "2. Generating Prisma client..."
npx prisma generate --schema=packages/shared/prisma/schema.prisma

echo ""
echo "3. Type-checking packages/shared..."
cd packages/shared && npx tsc --noEmit && echo "✓ packages/shared: PASS" && cd ../..

echo ""
echo "4. Building packages/shared..."
npm run build --workspace=packages/shared && echo "✓ packages/shared build: PASS"

echo ""
echo "5. Type-checking apps/arkiol-core..."
npm run type-check --workspace=apps/arkiol-core && echo "✓ apps/arkiol-core: PASS"

echo ""
echo "6. Building apps/arkiol-core..."
npm run build --workspace=apps/arkiol-core && echo "✓ apps/arkiol-core build: PASS"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ALL CHECKS PASSED — BUILD IS CLEAN                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
