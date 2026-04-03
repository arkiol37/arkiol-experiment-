// src/app/api/auth/[...nextauth]/route.ts
import { NextResponse } from 'next/server';

function isAuthConfigured(): boolean {
  return !!(
    process.env.NEXTAUTH_SECRET &&
    process.env.NEXTAUTH_SECRET.length >= 32 &&
    process.env.DATABASE_URL &&
    (process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://'))
  );
}

function notConfigured() {
  return NextResponse.json(
    { error: 'Authentication not configured', hint: 'Set NEXTAUTH_SECRET (32+ chars), NEXTAUTH_URL and DATABASE_URL' },
    { status: 503 }
  );
}

// Cached handler — built once per cold start after config is confirmed present
let _handler: any = null;

async function getHandler() {
  if (_handler) return _handler;
  // Dynamic requires keep this out of the module-level bundle evaluation
  // and prevent webpack from statically analyzing the import chain
  const nextAuth    = require('next-auth');
  const NextAuth    = nextAuth.default ?? nextAuth;
  const { authOptions } = require('../../../../lib/auth');
  _handler = NextAuth(authOptions);
  return _handler;
}

export async function GET(req: Request, ctx: any) {
  if (!isAuthConfigured()) return notConfigured();
  try {
    const handler = await getHandler();
    return handler(req, ctx);
  } catch (err: any) {
    console.error('[nextauth] GET error:', err?.message ?? err);
    return notConfigured();
  }
}

export async function POST(req: Request, ctx: any) {
  if (!isAuthConfigured()) return notConfigured();
  try {
    const handler = await getHandler();
    return handler(req, ctx);
  } catch (err: any) {
    console.error('[nextauth] POST error:', err?.message ?? err);
    return notConfigured();
  }
}
