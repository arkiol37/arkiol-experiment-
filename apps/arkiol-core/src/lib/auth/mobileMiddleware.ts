// backend-additions/src/lib/auth/mobileMiddleware.ts
// Extracts and verifies mobile JWT from Authorization header.
// Copy this into your main Next.js app at src/lib/auth/mobileMiddleware.ts

import { NextRequest } from 'next/server';
import { verifyMobileToken } from './mobileToken';

export async function getMobileUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return verifyMobileToken(token);
}
