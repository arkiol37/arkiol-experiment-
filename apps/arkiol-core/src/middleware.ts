// src/middleware.ts
// Route protection, CSRF validation, security headers, and RBAC.
//
// ── EDGE RUNTIME CONSTRAINT ─────────────────────────────────────────────────
// This file runs in the Next.js Edge Runtime which cannot import Node.js
// built-ins. Importing @arkiol/shared here would pull the entire shared barrel
// (including crypto, Stripe, Prisma adapter, etc.) and break the build.
//
// IMPORTANT: next-auth/jwt is Edge-compatible (uses Web Crypto API internally),
// so it can be imported at the top level. require() is NOT supported in Edge
// Runtime and was causing silent failures.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

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

const AUTH_CONFIGURED = !!(
  process.env.NEXTAUTH_SECRET &&
  process.env.NEXTAUTH_SECRET.length >= 32
);

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

async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // CSRF guard
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

  // Auth not configured → pass through (individual routes do capability checks)
  if (!AUTH_CONFIGURED) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Public paths always allowed
  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Mobile Bearer token — route handler verifies the JWT itself
  if (req.headers.get('authorization')?.startsWith('Bearer ')) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Session token check
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

  // Suspended accounts
  if ((token as any).suspended) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Admin-only routes
  const isAdminPath = ['/admin', '/api/admin'].some(p => pathname.startsWith(p));
  if (isAdminPath && !['ADMIN', 'SUPER_ADMIN'].includes((token as any).role ?? '')) {
    return withSecurityHeaders(
      pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.redirect(new URL('/dashboard', req.url))
    );
  }

  // Inject user context headers for downstream route handlers
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
    // Dashboard pages
    '/dashboard/:path*',
    '/gallery/:path*',
    '/gif-studio/:path*',
    '/animation-studio/:path*',
    '/campaign-director/:path*',
    '/campaigns/:path*',
    '/editor/:path*',
    '/canvas/:path*',
    '/brand/:path*',
    '/brand-assets/:path*',
    '/content-ai/:path*',
    '/team/:path*',
    '/billing/:path*',
    '/settings/:path*',
    '/onboarding/:path*',
    '/studio/:path*',
    '/admin/:path*',
    // API routes — all protected routes must be listed here so
    // x-user-id / x-user-role / x-org-id headers are injected
    '/api/generate/:path*',
    '/api/generate',
    '/api/campaigns/:path*',
    '/api/campaigns',
    '/api/assets/:path*',
    '/api/assets',
    '/api/export/:path*',
    '/api/export',
    '/api/brand/:path*',
    '/api/brand',
    '/api/brand-assets/:path*',
    '/api/brand-assets',
    '/api/usage/:path*',
    '/api/usage',
    '/api/webhooks/:path*',
    '/api/jobs/:path*',
    '/api/jobs',
    '/api/team/:path*',
    '/api/team',
    '/api/billing/:path*',
    '/api/billing',
    '/api/org/:path*',
    '/api/org',
    '/api/api-keys/:path*',
    '/api/api-keys',
    '/api/audit/:path*',
    '/api/audit',
    '/api/audit-logs/:path*',
    '/api/audit-logs',
    '/api/mobile/:path*',
    '/api/admin/:path*',
    '/api/admin',
    '/api/monitoring/:path*',
    '/api/monitoring',
    // Previously missing — caused 401 on valid sessions and blank UI
    '/api/content-ai',
    '/api/content-ai/:path*',
    '/api/editor/:path*',
    '/api/editor',
    '/api/automation/:path*',
    '/api/automation',
    '/api/cost-protection/:path*',
    '/api/cost-protection',
    '/api/explore',
    '/api/explore/feedback',
    '/api/platform',
  ],
};
