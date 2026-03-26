// src/lib/auth/password.ts
// Password hashing and comparison utilities.
// Used by both NextAuth credentials provider and the mobile JWT signin endpoint.
import { compare, hash } from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, SALT_ROUNDS);
}

export async function comparePassword(plaintext: string, hashed: string | null | undefined): Promise<boolean> {
  if (!hashed) return false;
  return compare(plaintext, hashed);
}
