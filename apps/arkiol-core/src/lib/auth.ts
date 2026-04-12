// src/lib/auth.ts
// Safe auth — works without NEXTAUTH_SECRET/DATABASE_URL configured.
// Uses an INLINE Prisma adapter (no @auth/prisma-adapter package needed).
import 'server-only';
import { type NextRequest } from 'next/server';
import { ApiError }         from './types';

// ── Types ──────────────────────────────────────────────────────────────────────
export type NextAuthOptions = any;

// ── Inline Prisma Adapter for next-auth v4 ────────────────────────────────────
// Replaces @auth/prisma-adapter entirely — zero external package dependency.
// Compatible with next-auth@^4.x and Prisma@^5.x
function buildPrismaAdapter(prisma: any) {
  return {
    async createUser(data: any) {
      return prisma.user.create({ data });
    },
    async getUser(id: string) {
      return prisma.user.findUnique({ where: { id } }).catch(() => null);
    },
    async getUserByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } }).catch(() => null);
    },
    async getUserByAccount({ providerAccountId, provider }: any) {
      const account = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { user: true },
      }).catch(() => null);
      return account?.user ?? null;
    },
    async updateUser({ id, ...data }: any) {
      return prisma.user.update({ where: { id }, data });
    },
    async deleteUser(userId: string) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    },
    async linkAccount(data: any) {
      return prisma.account.create({ data }).catch(() => null);
    },
    async unlinkAccount({ providerAccountId, provider }: any) {
      await prisma.account.delete({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      }).catch(() => {});
    },
    async createSession(data: any) {
      return prisma.session.create({ data });
    },
    async getSessionAndUser(sessionToken: string) {
      const session = await prisma.session.findUnique({
        where: { sessionToken },
        include: { user: true },
      }).catch(() => null);
      if (!session) return null;
      const { user, ...sessionData } = session;
      return { session: sessionData, user };
    },
    async updateSession({ sessionToken, ...data }: any) {
      return prisma.session.update({ where: { sessionToken }, data }).catch(() => null);
    },
    async deleteSession(sessionToken: string) {
      await prisma.session.delete({ where: { sessionToken } }).catch(() => {});
    },
    async createVerificationToken(data: any) {
      return prisma.verificationToken.create({ data }).catch(() => null);
    },
    async useVerificationToken({ identifier, token }: any) {
      return prisma.verificationToken.delete({
        where: { identifier_token: { identifier, token } },
      }).catch(() => null);
    },
  };
}

// ── Auth configured check ─────────────────────────────────────────────────────
function isAuthConfigured(): boolean {
  const env = process.env;
  return !!(
    env.NEXTAUTH_SECRET &&
    env.NEXTAUTH_SECRET.length >= 32 &&
    env.DATABASE_URL &&
    (env.DATABASE_URL.startsWith('postgresql://') || env.DATABASE_URL.startsWith('postgres://'))
  );
}

// ── NextAuth options (lazy — only built when auth is configured) ───────────────
let _authOptions: any = null;

function buildAuthOptions(): any {
  const env = process.env;
  const { NextAuthOptions: _unused, ...nextAuth } = require('next-auth') as any;
  const GoogleProvider      = require('next-auth/providers/google').default;
  const AppleProvider       = require('next-auth/providers/apple').default;
  const CredentialsProvider = require('next-auth/providers/credentials').default;
  const { compare }         = require('bcryptjs');
  const { z }               = require('zod');
  const { prisma }          = require('./prisma');

  function getApplePrivateKey(): string {
    const raw = env.APPLE_PRIVATE_KEY ?? '';
    if (!raw) return '';
    if (raw.includes('-----BEGIN')) return raw;
    try { return Buffer.from(raw, 'base64').toString('utf8'); } catch { return raw; }
  }

  const providers: any[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(GoogleProvider({
      clientId:     env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: 'consent', access_type: 'offline', response_type: 'code' } },
    }));
  }

  if (env.APPLE_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID) {
    providers.push(AppleProvider({
      clientId:     env.APPLE_ID,
      clientSecret: { appleId: env.APPLE_ID, teamId: env.APPLE_TEAM_ID, privateKey: getApplePrivateKey(), keyId: env.APPLE_KEY_ID },
    }));
  }

  const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

  providers.push(CredentialsProvider({
    name: 'credentials',
    credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
    async authorize(credentials: any) {
      const parsed = LoginSchema.safeParse(credentials);
      if (!parsed.success) return null;
      try {
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user?.passwordHash) return null;
        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId };
      } catch { return null; }
    },
  }));

  return {
    adapter:  buildPrismaAdapter(prisma),
    session:  { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
    providers,
    secret:   env.NEXTAUTH_SECRET,
    callbacks: {
      async jwt({ token, user }: any) {
        if (user) {
          token.role  = (user as any).role;
          token.id    = user.id;
          token.orgId = (user as any).orgId;
          token.email = user.email;

          // ── Founder auto-promotion ────────────────────────────────────────
          // Runs on every sign-in (not just first). Self-heals accounts that
          // pre-existed before FOUNDER_EMAIL was set, or whose DB role was reset.
          try {
            const founderEmail = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
            if (founderEmail && user.email?.toLowerCase().trim() === founderEmail) {
              const updated = await prisma.user.update({
                where: { id: user.id },
                data:  { role: 'SUPER_ADMIN' },
                select: { role: true, orgId: true },
              });
              token.role = updated.role;
              if (updated.orgId) {
                await prisma.org.update({
                  where: { id: updated.orgId },
                  data: {
                    plan:                'STUDIO',
                    subscriptionStatus:  'ACTIVE',
                    creditBalance:       999_999,
                    dailyCreditBalance:  9_999,
                    canUseStudioVideo:   true,
                    canUseGifMotion:     true,
                    canBatchGenerate:    true,
                    canUseZipExport:     true,
                    canUseAutomation:    true,
                    maxConcurrency:      10,
                    maxDailyVideoJobs:   100,
                    maxFormatsPerRun:    9,
                    maxVariationsPerRun: 5,
                  },
                }).catch(() => {});
              }
            }
          } catch { /* non-fatal */ }
        } else if (token.id) {
          // Token refresh — re-read role, orgId AND email from DB every time.
          // email must always be present so the middleware x-user-email header
          // is populated, which the founder bypass in /api/generate depends on.
          try {
            const dbUser = await prisma.user.findUnique({
              where:  { id: token.id as string },
              select: { role: true, orgId: true, email: true },
            }).catch(() => null);
            if (dbUser) {
              token.orgId = dbUser.orgId;
              token.email = dbUser.email ?? token.email;

              // ── Founder: never downgrade on refresh ─────────────────────
              // If this is the founder email, always force SUPER_ADMIN in the
              // token, even if the DB row hasn't been promoted yet. This is the
              // critical fix: without it the refresh branch overwrites
              // token.role = DESIGNER (DB value) and nullifies the sign-in
              // promotion that correctly set SUPER_ADMIN.
              const founderEmail = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
              const thisEmail    = (dbUser.email ?? token.email as string ?? '').toLowerCase().trim();
              if (founderEmail && thisEmail && thisEmail === founderEmail) {
                token.role = 'SUPER_ADMIN';
                // Also ensure the DB is corrected on every refresh so it stays consistent
                if (dbUser.role !== 'SUPER_ADMIN') {
                  await prisma.user.update({
                    where: { id: token.id as string },
                    data:  { role: 'SUPER_ADMIN' },
                  }).catch(() => {});
                }
              } else {
                token.role = dbUser.role;
              }
            }
          } catch {}
        }
        return token;
      },
      async session({ session, token }: any) {
        if (session.user) {
          (session.user as any).role  = token.role;
          (session.user as any).id    = token.id;
          (session.user as any).orgId = token.orgId;
          (session.user as any).email = token.email ?? session.user.email;
        }
        return session;
      },
      async signIn({ user, account, profile }: any) {
        // Apple: persist name from first sign-in
        if (account?.provider === 'apple' && profile?.name && user.id) {
          try {
            const ap = profile as any;
            const fullName = [ap.name?.firstName, ap.name?.lastName].filter(Boolean).join(' ');
            if (fullName && !user.name) {
              await prisma.user.update({ where: { id: user.id }, data: { name: fullName } }).catch(() => {});
            }
          } catch {}
        }

        // OAuth users: ensure they have an org
        if (account?.provider !== 'credentials' && user.id) {
          try {
            const dbUser = await prisma.user.findUnique({
              where:  { id: user.id },
              select: { orgId: true, email: true, name: true },
            });
            if (dbUser && !dbUser.orgId) {
              const founderEmail  = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
              const isFounder     = dbUser.email?.toLowerCase().trim() === founderEmail;
              const displayName   = dbUser.name ?? dbUser.email?.split('@')[0] ?? 'user';
              const baseSlug      = displayName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 40) + '-' + Date.now();

              const newOrg = await prisma.org.create({
                data: {
                  name:               isFounder ? 'Arkiol Founder Workspace' : `${displayName}'s Workspace`,
                  slug:               baseSlug,
                  plan:               isFounder ? 'STUDIO' : 'FREE',
                  subscriptionStatus: 'ACTIVE',
                  creditBalance:      0,
                  dailyCreditBalance: 0,
                  creditLimit:        isFounder ? 999_999 : 500,
                },
              });

              await prisma.user.update({
                where: { id: user.id },
                data: {
                  orgId: newOrg.id,
                  role:  isFounder ? 'SUPER_ADMIN' : 'DESIGNER',
                },
              });
            }
          } catch (err: any) {
            console.error('[auth] OAuth org creation failed:', err?.message);
          }
        }

        return true;
      },
    },
    pages:  { signIn: '/login', error: '/login' },
    events: {
      async signIn({ user, account }: any) {
        console.info(`[auth] sign_in user=${user.id} provider=${account?.provider ?? 'credentials'}`);
      },
    },
  };
}

export const authOptions: any = new Proxy({} as any, {
  get(_target, prop) {
    if (!isAuthConfigured()) return undefined;
    if (!_authOptions) _authOptions = buildAuthOptions();
    return (_authOptions as any)[prop];
  },
});

// ── RBAC ───────────────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  GENERATE_ASSETS:  ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DESIGNER'],
  CREATE_CAMPAIGN:  ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  PUBLISH_CAMPAIGN: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  DELETE_CAMPAIGN:  ['SUPER_ADMIN', 'ADMIN'],
  DELETE_ASSETS:    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DESIGNER'],
  EDIT_BRAND:       ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  MANAGE_TEAM:      ['SUPER_ADMIN', 'ADMIN'],
  MANAGE_BILLING:   ['SUPER_ADMIN', 'ADMIN'],
  VIEW_DIAGNOSTICS: ['SUPER_ADMIN', 'ADMIN'],
  MANAGE_API_KEYS:  ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  VIEW_AUDIT_LOGS:  ['SUPER_ADMIN', 'ADMIN'],
  EXPORT_ASSETS:    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DESIGNER'],
  USE_AUTOMATION:   ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  MANAGE_WEBHOOKS:  ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function requirePermission(role: string, permission: Permission): void {
  if (!hasPermission(role, permission)) throw new ApiError(403, `Forbidden: requires ${permission} permission`);
}

export async function getServerSession() {
  if (!isAuthConfigured()) return null;
  try {
    const { getServerSession: nextAuthGetServerSession } = require('next-auth');
    const session = await nextAuthGetServerSession(authOptions);
    if (!session?.user) throw new ApiError(401, 'Authentication required');
    return session;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return null;
  }
}

export async function getAuthUser() {
  if (!isAuthConfigured()) throw new ApiError(503, 'Authentication not configured');
  try {
    const { getServerSession: nextAuthGetServerSession } = require('next-auth');
    const session = await nextAuthGetServerSession(authOptions);
    if (!session?.user) throw new ApiError(401, 'Authentication required');
    const user = session.user as any;
    return { id: user.id as string, email: user.email as string, role: user.role as string, orgId: user.orgId as string };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'Authentication required');
  }
}

export async function hashPassword(password: string): Promise<string> {
  const { hash } = require('bcryptjs');
  return hash(password, 12);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

export async function createAuditLog(opts: {
  userId: string; orgId: string; action: string;
  resourceType: string; resourceId?: string; metadata?: any; req?: NextRequest
}) {
  try {
    const { prisma } = require('./prisma');
    await prisma.auditLog.create({
      data: {
        actorId:    opts.userId,
        orgId:      opts.orgId,
        action:     opts.action,
        targetType: opts.resourceType,
        targetId:   opts.resourceId,
        metadata:   opts.metadata
          ? { ...opts.metadata,
              ipAddress: opts.req?.headers.get('x-forwarded-for') ?? opts.req?.headers.get('x-real-ip') ?? undefined,
              userAgent: opts.req?.headers.get('user-agent') ?? undefined,
            }
          : {
              ipAddress: opts.req?.headers.get('x-forwarded-for') ?? opts.req?.headers.get('x-real-ip') ?? undefined,
              userAgent: opts.req?.headers.get('user-agent') ?? undefined,
            },
      },
    });
  } catch { /* non-fatal */ }
}

export async function getRequestUser(req: NextRequest) {
  if (!isAuthConfigured()) throw new ApiError(503, 'Authentication not configured');
  const userId = req.headers.get('x-user-id');
  const role   = req.headers.get('x-user-role') ?? 'VIEWER';
  const orgId  = req.headers.get('x-org-id') ?? '';
  const email  = req.headers.get('x-user-email') ?? '';
  // Always return email when reading from middleware-injected headers.
  // The founder bypass in /api/generate depends on email being present.
  if (userId) return { id: userId, role, orgId, email };

  try {
    const { getServerSession: nextAuthGetServerSession } = require('next-auth');
    const session = await nextAuthGetServerSession(authOptions);
    if (!session?.user) throw new ApiError(401, 'Authentication required');
    const user = session.user as any;
    return { id: user.id as string, email: user.email as string, role: user.role as string, orgId: user.orgId as string };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'Authentication required');
  }
}
