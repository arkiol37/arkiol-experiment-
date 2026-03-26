// src/middleware.ts
// Route protection, CSRF validation, security headers, and RBAC.
//
// ── EDGE RUNTIME CONSTRAINT ─────────────────────────────────────────────────
// This file runs in the Next.js Edge Runtime which cannot import Node.js
// built-ins. Importing @arkiol/shared here would pull the entire shared barrel
// (including crypto, Stripe, Prisma adapter, etc.) and break the build.
//
// The auth-configured check below intentionally mirrors the same logic used in
// detectCapabilities().auth in capabilities.ts. If that logic ever changes,
// update both places. A comment in capabilities.ts cross-references this file.
//
// All other files (routes, libs, server components) use detectCapabilities().
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse, NextRequest } from 'next/server';

// ── Constants ────────────────────────────────────────────────────────────────

const CSRF_EXEMPT_PREFIXES = [
  '/api/billing/webhook', '/api/webhooks', '/api/health',
  '/api/auth', '/api/mobile', '/api/capabilities',
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PUBLIC_PATHS = [
  '/api/health', '/api/billing/webhook', '/api/auth',
  '/api/mobile/', '/api/explore/templates', '/api/webhooks',
  '/api/capabilities', '/home', '/privacy', '/terms',
  '/login', '/register', '/reset-password', '/set-password',
  '/error', '/_next',
];

// ── Edge-safe auth check ─────────────────────────────────────────────────────
// Mirrors detectCapabilities().auth — see packages/shared/src/capabilities.ts.
// process.env is available in Edge Runtime; @arkiol/shared is not importable here.
const AUTH_CONFIGURED = !!(
  process.env.NEXTAUTH_SECRET &&
  process.env.NEXTAUTH_SECRET.length >= 32
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some(p => pathname.startsWith(p));
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname === '/' ||
    pathname === '/favicon.ico'
  );
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  const h = res.headers;
  h.set('X-Content-Type-Options',  'nosniff');
  h.set('X-Frame-Options',         'DENY');
  h.set('X-XSS-Protection',        '1; mode=block');
  h.set('Referrer-Policy',         'strict-origin-when-cross-origin');
  h.set('Permissions-Policy',      'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return res;
}

// ── Middleware ────────────────────────────────────────────────────────────────

async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ── CSRF guard ──────────────────────────────────────────────────────────────
  if (
    MUTATING_METHODS.has(req.method) &&
    pathname.startsWith('/api/') &&
    !isCsrfExempt(pathname)
  ) {
    const origin = req.headers.get('origin');
    const appUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
    if (appUrl && origin && !origin.startsWith(appUrl)) {
      return withSecurityHeaders(
        NextResponse.json({ error: 'CSRF: Cross-origin request blocked' }, { status: 403 })
      );
    }
  }

  // ── Auth not configured → pass everything through ────────────────────────
  // Individual API routes return 503 for their own capability checks.
  if (!AUTH_CONFIGURED) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── Public paths always allowed ──────────────────────────────────────────
  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── Mobile Bearer token — route handler verifies the JWT itself ──────────
  if (req.headers.get('authorization')?.startsWith('Bearer ')) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── Session token check ──────────────────────────────────────────────────
  const { getToken } = require('next-auth/jwt');
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  }).catch(() => null);

  if (!token) {
    return withSecurityHeaders(
      pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Authentication required' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', req.url))
    );
  }

  // ── Suspended accounts ───────────────────────────────────────────────────
  if ((token as any).suspended) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // ── Admin-only routes ────────────────────────────────────────────────────
  const isAdminPath = ['/admin', '/api/admin'].some(p => pathname.startsWith(p));
  if (isAdminPath && !['ADMIN', 'SUPER_ADMIN'].includes((token as any).role ?? '')) {
    return withSecurityHeaders(
      pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.redirect(new URL('/dashboard', req.url))
    );
  }

  // ── Inject user context headers for downstream route handlers ────────────
  const response = NextResponse.next();
  if ((token as any).id) {
    response.headers.set('x-user-id',    String((token as any).id));
    response.headers.set('x-user-role',  String((token as any).role ?? 'VIEWER'));
    response.headers.set('x-user-email', String((token as any).email ?? ''));
    response.headers.set('x-org-id',     String((token as any).orgId ?? ''));
  }
  return withSecurityHeaders(response);
}

export default middleware;

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/gallery/:path*',
    '/gif-studio/:path*',
    '/campaign-director/:path*',
    '/campaigns/:path*',
    '/editor/:path*',
    '/brand/:path*',
    '/brand-assets/:path*',
    '/content-ai/:path*',
    '/team/:path*',
    '/billing/:path*',
    '/settings/:path*',
    '/onboarding/:path*',
    '/studio/:path*',
    '/admin/:path*',
    '/api/generate/:path*',
    '/api/campaigns/:path*',
    '/api/assets/:path*',
    '/api/export/:path*',
    '/api/brand/:path*',
    '/api/usage/:path*',
    '/api/webhooks/:path*',
    '/api/jobs/:path*',
    '/api/team/:path*',
    '/api/billing/:path*',
    '/api/org/:path*',
    '/api/api-keys/:path*',
    '/api/audit/:path*',
    '/api/mobile/:path*',
    '/api/admin/:path*',
    '/api/monitoring/:path*',
  ],
};
