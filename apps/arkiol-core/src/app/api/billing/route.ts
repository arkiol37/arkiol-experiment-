// src/app/api/billing/route.ts
// V15 — ALL Stripe webhook handling removed from this file.
// Webhooks are handled exclusively at POST /api/billing/webhook via @arkiol/shared.
// NO direct process.env usage — all config from validated env module.
import "server-only";
import {
  detectCapabilities,
  getTopupPack,
} from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import Stripe                        from "stripe";
import { prisma }                    from "../../../lib/prisma";
import { rateLimit }                 from "../../../lib/rate-limit";
import { ApiError }                  from "../../../lib/types";
import { requirePermission }         from "../../../lib/auth";
import { isFounderEmail }            from "../../../lib/ownerAccess";
import { z }                         from "zod";
import { billingUnavailable } from "../../../lib/error-handling";
import { PLANS, getPlanConfig, TOPUP_PACKS, getTopupStripePriceId,
         getSubscriptionStripePriceId, resolvePlan,
         getEnv, getActiveBillingProvider, type PlanKey } from "@arkiol/shared";

// ── Stripe client ──────────────────────────────────────────────────────────────
function getStripe(): Stripe {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: "2024-04-10", typescript: true });
}

// ── GET /api/billing — fetch current billing status ───────────────────────────
// Uses canonical Org fields: creditBalance, currentCycleStart, currentCycleEnd
// (no legacy creditsUsed / creditLimit columns).
// NOTE: GET does NOT require billing (Stripe/Paddle) to be configured — it reads
// plan/credit state directly from the DB. Only POST (checkout/portal) needs Stripe.
export async function GET(req: NextRequest) {
  if (!detectCapabilities().database) return billingUnavailable();

  try {
    // Use getRequestUser — reads x-user-id injected by middleware (works in App Router).
    // Also resolves founder email from x-user-email for owner bypass on billing display.
    const { getRequestUser, hasOwnerAccess: _hasOwner } = await import('../../../lib/auth').then(m => ({
      getRequestUser: m.getRequestUser,
      hasOwnerAccess: null,
    })).catch(() => ({ getRequestUser: null, hasOwnerAccess: null }));

    let sessionUserId: string;
    let sessionEmail: string = '';
    let sessionRole: string = 'DESIGNER';
    let sessionOrgId: string = '';

    // Primary: read from middleware-injected headers (fastest, no session round-trip)
    const headerUserId = req.headers.get('x-user-id');
    if (headerUserId) {
      sessionUserId  = headerUserId;
      sessionEmail   = req.headers.get('x-user-email') ?? '';
      sessionRole    = req.headers.get('x-user-role')  ?? 'DESIGNER';
      sessionOrgId   = req.headers.get('x-org-id')     ?? '';
    } else {
      // Fallback: full session lookup
      // auth via getRequestUser (middleware-injected headers, then session fallback)
      const _br = await (require('../../../lib/auth').getRequestUser)(req).catch(() => null);
      const session = _br ? { user: { id: _br.id, email: _br.email, orgId: _br.orgId, role: _br.role } } : null;
      if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const su = session.user as any;
      sessionUserId = su.id;
      sessionEmail  = su.email ?? '';
      sessionRole   = su.role  ?? 'DESIGNER';
      sessionOrgId  = su.orgId ?? '';
    }
    if (!sessionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Founder bypass: if email matches FOUNDER_EMAIL, return max entitlements directly
    // without reading the DB org — covers the window before DB promotion.
    // Guarantee email is resolved: header → DB lookup fallback.
    const { isFounderEmail, ownerSnapshot } = await import('../../../lib/ownerAccess');
    const resolvedEmail = sessionEmail
      || (await prisma.user.findUnique({ where: { id: sessionUserId }, select: { email: true } }).catch(() => null))?.email?.toLowerCase().trim()
      || '';
    if (isFounderEmail(resolvedEmail) || sessionRole === 'SUPER_ADMIN') {
      const { PLANS } = await import('@arkiol/shared');
      return NextResponse.json({
        plan:               'STUDIO',
        subscriptionStatus: 'ACTIVE',
        trialEndsAt:        null,
        billingCycleAnchor: null,
        currentCycleStart:  null,
        currentCycleEnd:    null,
        monthlyPriceUsd:    149,
        gracePeriodEndsAt:  null,
        costProtectionBlocked: false,
        credits: {
          balance:      999_999,
          dailyBalance: 9_999,
          monthlyLimit: 6000,
          usagePct:     0,
          remaining:    999_999,
          used:         0,
          limit:        6000,
        },
        creditBalance:     999_999,
        canUseStudioVideo: true,
        autoRefillEnabled: false,
        features: {
          canUseStudioVideo: true,
          canUseGifMotion:   true,
          canUseZipExport:   true,
          canBatchGenerate:  true,
          canUseAutomation:  true,
          maxConcurrency:    10,
          maxDailyVideoJobs: 100,
        },
        planLimits: {
          credits:        6000,
          members:        999,
          brands:         999,
          priceUsd:       149,
          rolloverPct:    100,
          maxConcurrency: 10,
        },
        autoRefill: { enabled: false, threshold: null },
        allPlans: [],
        topupPacks: [],
        _founderBypass: true,
      });
    }

    const user = await prisma.user.findUnique({
      where:   { id: sessionUserId },
      include: {
        org: {
          select: {
            id: true,
            plan: true,
            subscriptionStatus: true,
            stripeSubscriptionId: true,
            trialEndsAt: true,
            billingCycleAnchor: true,
            currentCycleStart: true,
            currentCycleEnd: true,
            monthlyPriceUsd: true,
            // Canonical credit fields
            creditBalance: true,
            dailyCreditBalance: true,
            // Feature flags
            canUseStudioVideo: true,
            canUseGifMotion: true,
            canUseZipExport: true,
            canBatchGenerate: true,
            canUseAutomation: true,
            maxConcurrency: true,
            maxDailyVideoJobs: true,
            // Cost protection
            costProtectionBlocked: true,
            gracePeriodEndsAt: true,
            // Auto-refill
            autoRefillEnabled: true,
            refillThreshold: true,
          },
        },
      },
    });
    if (!user?.org) return NextResponse.json({ error: "No org" }, { status: 404 });

    const { org } = user;
    const planKey  = resolvePlan(org.plan);
    const planCfg  = PLANS[planKey];

    // Monthly credit limit for this plan (0 = FREE daily bucket plan)
    const creditLimit = planCfg.credits;
    const usagePct    = creditLimit > 0
      ? Math.round(((creditLimit - org.creditBalance) / creditLimit) * 100)
      : 0;

    return NextResponse.json({
      plan:               planKey,
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt:        org.trialEndsAt,
      billingCycleAnchor: org.billingCycleAnchor,
      currentCycleStart:  org.currentCycleStart,
      currentCycleEnd:    org.currentCycleEnd,
      monthlyPriceUsd:    org.monthlyPriceUsd ?? planCfg.priceUsd,
      gracePeriodEndsAt:  org.gracePeriodEndsAt,
      costProtectionBlocked: org.costProtectionBlocked,

      credits: {
        // Canonical fields
        balance:         org.creditBalance,
        dailyBalance:    org.dailyCreditBalance,
        monthlyLimit:    creditLimit,
        usagePct,
        // Aliased for UI consumers (DashboardHome, SettingsView)
        remaining:       Math.max(0, org.creditBalance),
        used:            Math.max(0, creditLimit - org.creditBalance),
        limit:           creditLimit,
      },
      // Top-level alias for billing/page.tsx OrgBilling interface
      creditBalance:     org.creditBalance,
      canUseStudioVideo: org.canUseStudioVideo,
      autoRefillEnabled: org.autoRefillEnabled,

      features: {
        canUseStudioVideo: org.canUseStudioVideo,
        canUseGifMotion:   org.canUseGifMotion,
        canUseZipExport:   org.canUseZipExport,
        canBatchGenerate:  org.canBatchGenerate,
        canUseAutomation:  org.canUseAutomation,
        maxConcurrency:    org.maxConcurrency,
        maxDailyVideoJobs: org.maxDailyVideoJobs,
      },

      planLimits: {
        credits:        planCfg.credits,
        members:        planCfg.members,
        brands:         planCfg.brands,
        priceUsd:       planCfg.priceUsd,
        rolloverPct:    planCfg.rolloverPct,
        maxConcurrency: planCfg.maxConcurrency,
      },

      autoRefill: {
        enabled:   org.autoRefillEnabled,
        threshold: org.refillThreshold,
      },

      // All plans for upgrade/downgrade UI
      allPlans: (Object.entries(PLANS) as [string, typeof planCfg][]).map(([key, cfg]) => ({
        plan:        key,
        credits:     cfg.credits,
        priceUsd:    cfg.priceUsd,
        members:     cfg.members,
        brands:      cfg.brands,
        currentPlan: key === planKey,
      })),

      // Available top-up packs
      topupPacks: TOPUP_PACKS.map(p => ({
        id:       p.id,
        name:     p.name,
        credits:  p.credits,
        priceUsd: p.priceUsd,
      })),
    });
  } catch (err: any) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── POST /api/billing — create checkout session, portal link, cancel, or topup ─
const PostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), plan: z.enum(["CREATOR", "PRO", "STUDIO"]) }),
  z.object({ action: z.literal("topup"),    packId: z.string() }),
  z.object({ action: z.literal("portal") }),
  z.object({ action: z.literal("cancel") }),
]);

export async function POST(req: NextRequest) {
  if (!detectCapabilities().billing) return billingUnavailable();

  try {
    // Use middleware-injected headers first, fall back to full session lookup
    const headerUserId = req.headers.get('x-user-id');
    let postUserId: string;
    if (headerUserId) {
      postUserId = headerUserId;
    } else {
      // auth via getRequestUser (middleware-injected headers, then session fallback)
      const _br = await (require('../../../lib/auth').getRequestUser)(req).catch(() => null);
      const session = _br ? { user: { id: _br.id, email: _br.email, orgId: _br.orgId, role: _br.role } } : null;
      if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      postUserId = (session.user as any).id;
    }
    if (!postUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await rateLimit(postUserId, "billing");

    const user = await prisma.user.findUnique({
      where:   { id: postUserId },
      include: { org: true },
    });
    if (!user?.org) return NextResponse.json({ error: "No org" }, { status: 404 });

    // Founder bypass: derive effectiveRole from email so the founder can manage
    // billing even if the DB row hasn't been promoted to SUPER_ADMIN yet.
    const postEmail       = req.headers.get('x-user-email')
                            ?? (user as any).email
                            ?? '';
    const effectiveRole   = isFounderEmail(postEmail) ? 'SUPER_ADMIN' : user.role;
    requirePermission(effectiveRole, "MANAGE_BILLING");

    const body   = await req.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const stripe  = getStripe();
    const { org } = user;
    const baseUrl = getEnv().NEXT_PUBLIC_APP_URL ?? "https://app.arkiol.com";

    // Ensure Stripe customer exists
    let stripeCustomerId = org.stripeCustomerId ?? undefined;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email:    user.email ?? undefined,
        name:     org.name,
        metadata: { orgId: org.id, orgSlug: org.slug },
      });
      stripeCustomerId = customer.id;
      await prisma.org.update({ where: { id: org.id }, data: { stripeCustomerId } });
    }

    // ── Checkout for subscription plan upgrade ─────────────────────────────────
    if (parsed.data.action === "checkout") {
      const planKey = parsed.data.plan;
      const priceId = getSubscriptionStripePriceId(planKey);
      if (!priceId) return NextResponse.json({ error: `No Stripe price configured for plan ${planKey}` }, { status: 503 });

      const planCfg = PLANS[planKey as PlanKey];

      const checkoutSession = await stripe.checkout.sessions.create({
        customer:             stripeCustomerId,
        mode:                 "subscription",
        payment_method_types: ["card"],
        line_items:           [{ price: priceId, quantity: 1 }],
        success_url:          `${baseUrl}/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:           `${baseUrl}/dashboard?billing=cancelled`,
        subscription_data: {
          metadata: {
            orgId:    org.id,
            plan:     planKey,
            priceUsd: String(planCfg.priceUsd),
          },
        },
        metadata: { orgId: org.id, plan: planKey },
        allow_promotion_codes: true,
      });

      return NextResponse.json({ url: checkoutSession.url });
    }

    // ── One-time top-up credit pack purchase ───────────────────────────────────
    if (parsed.data.action === "topup") {
      const pack = getTopupPack(parsed.data.packId);
      if (!pack) return NextResponse.json({ error: "Unknown topup pack" }, { status: 400 });

      const priceId = getTopupStripePriceId(pack.id);
      if (!priceId) return NextResponse.json({ error: `No Stripe price configured for pack ${pack.id}` }, { status: 503 });

      const checkoutSession = await stripe.checkout.sessions.create({
        customer:             stripeCustomerId,
        mode:                 "payment",
        payment_method_types: ["card"],
        line_items:           [{ price: priceId, quantity: 1 }],
        success_url:          `${baseUrl}/dashboard?billing=topup_success`,
        cancel_url:           `${baseUrl}/dashboard?billing=cancelled`,
        metadata: {
          orgId:  org.id,
          type:   "topup",
          packId: pack.id,
        },
      });

      return NextResponse.json({ url: checkoutSession.url });
    }

    // ── Billing portal ─────────────────────────────────────────────────────────
    if (parsed.data.action === "portal") {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer:   stripeCustomerId,
        return_url: `${baseUrl}/dashboard`,
      });
      return NextResponse.json({ url: portalSession.url });
    }

    // ── Cancel at period end ───────────────────────────────────────────────────
    if (parsed.data.action === "cancel") {
      if (!org.stripeSubscriptionId) {
        return NextResponse.json({ error: "No active subscription" }, { status: 400 });
      }
      await stripe.subscriptions.update(org.stripeSubscriptionId, { cancel_at_period_end: true });
      await prisma.org.update({
        where: { id: org.id },
        data:  { subscriptionStatus: "CANCELED" },
      });
      return NextResponse.json({ success: true, message: "Subscription will cancel at period end" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (err: any) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("[billing] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── PUT is intentionally NOT exported ─────────────────────────────────────────
// All Stripe webhooks are handled at POST /api/billing/webhook (via @arkiol/shared).
// Having a duplicate inline handler here (which was the V14 bug) is removed.
