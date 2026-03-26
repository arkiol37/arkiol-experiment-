// src/app/api/capabilities/route.ts
// Public endpoint — returns which services are available.
// Safe for client components to call. Never exposes secrets, only boolean flags.
// All detection logic lives in @arkiol/shared detectCapabilities() — not duplicated here.
import { NextResponse }          from 'next/server';
import { serializeCapabilities } from '@arkiol/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(serializeCapabilities());
}
