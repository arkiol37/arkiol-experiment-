// apps/arkiol-core/scripts/vercel-prisma-generate.cjs
// Reliable Prisma client generation for builds (Vercel, CI, local).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const schemaPath = path.resolve(repoRoot, 'packages/shared/prisma/schema.prisma');
const prismaBin = path.resolve(repoRoot, 'node_modules/.bin/prisma');
console.log('[prisma-generate] Schema:', schemaPath);

try {
  const command = fs.existsSync(prismaBin) ? prismaBin : 'npx';
  const args = fs.existsSync(prismaBin)
    ? ['generate', `--schema=${schemaPath}`]
    : ['--yes', 'prisma', 'generate', `--schema=${schemaPath}`];

  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  });
  console.log('[prisma-generate] Success');
} catch (err) {
  console.error('[prisma-generate] Failed:', err.message);
  process.exit(1);
}
