// prisma/seed.ts
//
// LOCAL DEVELOPMENT SEED — creates minimal test fixtures for local dev and CI.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  PRODUCTION GUARD                                                       │
// │  This script MUST NEVER run against a production database.              │
// │  It exits immediately if NODE_ENV=production OR if                      │
// │  ALLOW_SEED is not set to "development".                                │
// │                                                                         │
// │  To seed locally: NODE_ENV=development ALLOW_SEED=development npx tsx   │
// │                   prisma/seed.ts                                        │
// │  Or via npm:       npm run db:seed  (sets the vars automatically)       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// What this creates:
//   • One org ("dev-org") on CREATOR plan — matches real new-user flow
//   • One ADMIN user  — email/password login for local testing
//   • One DESIGNER user — for multi-role testing
//
// What this deliberately does NOT create:
//   • No hardcoded brand/campaign IDs (use the API to create those)
//   • No payment/Stripe fixtures (handled by Stripe test mode + webhooks)
//
// Passwords are set from SEED_ADMIN_PASSWORD / SEED_DESIGNER_PASSWORD env vars.
// If not set, the script prints instructions and exits — no default passwords.

import { PrismaClient } from "@prisma/client";
import { hash }         from "bcryptjs";

// ── Production guard — must be the very first executable statement ─────────────
const nodeEnv   = process.env.NODE_ENV   ?? "";
const allowSeed = process.env.ALLOW_SEED ?? "";

if (nodeEnv === "production") {
  console.error(
    "\n❌ SEED ABORTED: NODE_ENV=production\n" +
    "   This seed script must never run against a production database.\n" +
    "   Production data is managed through the application and migrations.\n"
  );
  process.exit(1);
}

if (allowSeed !== "development") {
  console.error(
    "\n❌ SEED ABORTED: ALLOW_SEED is not set to \"development\"\n" +
    "   To run the seed locally, set ALLOW_SEED=development in your .env.local\n" +
    "   or run: ALLOW_SEED=development npm run db:seed\n" +
    "   This guard prevents accidental seeding of non-local databases.\n"
  );
  process.exit(1);
}

// ── Require explicit passwords — no hardcoded defaults ───────────────────────
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const designerPassword = process.env.SEED_DESIGNER_PASSWORD;

if (!adminPassword || !designerPassword) {
  console.error(
    "\n❌ SEED ABORTED: Missing required seed password environment variables.\n" +
    "   Add these to your .env.local:\n\n" +
    "     SEED_ADMIN_PASSWORD=<your-local-admin-password>\n" +
    "     SEED_DESIGNER_PASSWORD=<your-local-designer-password>\n\n" +
    "   Use passwords that are easy to remember locally — they are never used\n" +
    "   in production and are not subject to production password policy.\n"
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding development database...\n");

  // ── Dev org ────────────────────────────────────────────────────────────────
  // CREATOR plan mirrors what a real new paid signup produces.
  const org = await prisma.org.upsert({
    where:  { slug: "dev-org" },
    update: {},
    create: {
      name:        "Dev Org",
      slug:        "dev-org",
      plan:        "FREE",
      creditLimit: 500,   // Creator: 500 credits/mo @ $25/month
      creditsUsed: 0,
    },
  });
  console.log(`✓ Org: ${org.name}  (id: ${org.id})`);

  // ── Admin user ─────────────────────────────────────────────────────────────
  const adminHash = await hash(adminPassword as string, 12);
  const admin = await prisma.user.upsert({
    where:  { email: "admin@dev.local" },
    update: {},
    create: {
      email:        "admin@dev.local",
      name:         "Dev Admin",
      role:         "ADMIN",
      orgId:        org.id,
      passwordHash: adminHash,
    },
  });
  console.log(`✓ Admin:    ${admin.email}  (role: ${admin.role})`);

  // ── Designer user ──────────────────────────────────────────────────────────
  const designerHash = await hash(designerPassword as string, 12);
  const designer = await prisma.user.upsert({
    where:  { email: "designer@dev.local" },
    update: {},
    create: {
      email:        "designer@dev.local",
      name:         "Dev Designer",
      role:         "DESIGNER",
      orgId:        org.id,
      passwordHash: designerHash,
    },
  });
  console.log(`✓ Designer: ${designer.email}  (role: ${designer.role})`);

  console.log("\n✅ Development seed complete.\n");
  console.log("   Sign in at http://localhost:3000/auth/login\n");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
