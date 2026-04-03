// apps/arkiol-core/scripts/vercel-prisma-generate.cjs
// Reliable Prisma client generation for builds (Vercel, CI, local).
// Uses npx which resolves Prisma from the workspace regardless of hoisting.
const { execSync } = require('node:child_process');
const path = require('node:path');

const schemaPath = path.resolve(__dirname, '../../../packages/shared/prisma/schema.prisma');
console.log('[prisma-generate] Schema:', schemaPath);

try {
  execSync(`npx prisma generate --schema="${schemaPath}"`, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../../..'),
    env: process.env,
  });
  console.log('[prisma-generate] Success');
} catch (err) {
  console.error('[prisma-generate] Failed:', err.message);
  process.exit(1);
}
