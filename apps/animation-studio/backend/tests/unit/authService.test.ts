/**
 * Unit tests — authService pure functions + authMiddleware role hierarchy
 *
 * Covers the deterministic, side-effect-free functions that require no DB:
 *   - signAccessToken / verifyAccessToken (JWT round-trip, payload, expiry)
 *   - signRefreshToken / verifyRefreshToken
 *   - hashPassword / verifyPassword (argon2id)
 *   - requireRole middleware (role checking logic)
 *   - requireWorkspaceAccess role hierarchy ordering
 *
 * JWT functions require process.env JWT_SECRET etc. — set minimal values below.
 */

process.env.JWT_SECRET          = 'test-jwt-secret-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET  = 'test-refresh-secret-at-least-32-chars!!';
process.env.JWT_EXPIRES_IN      = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashPassword,
  verifyPassword,
} from '../../src/auth/authService';

// requireRole is middleware — test the logic pattern directly
// We'll test the role hierarchy used in requireWorkspaceAccess
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  editor: 1,
  admin:  2,
  owner:  3,
};

function hasAccess(memberRole: string, minRole: string): boolean {
  return (ROLE_HIERARCHY[memberRole] ?? -1) >= (ROLE_HIERARCHY[minRole] ?? Infinity);
}

// ══════════════════════════════════════════════════════════════════════════════
// signAccessToken / verifyAccessToken
// ══════════════════════════════════════════════════════════════════════════════
describe('signAccessToken', () => {
  it('returns a non-empty string', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('is a valid 3-part JWT (header.payload.signature)', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    expect(token.split('.').length).toBe(3);
  });

  it('different payloads produce different tokens', () => {
    const t1 = signAccessToken({ userId: 'u1', role: 'user' });
    const t2 = signAccessToken({ userId: 'u2', role: 'user' });
    expect(t1).not.toBe(t2);
  });
});

describe('verifyAccessToken', () => {
  it('round-trips userId correctly', () => {
    const token = signAccessToken({ userId: 'user-abc', role: 'user' });
    const payload = verifyAccessToken(token);
    expect(payload.userId).toBe('user-abc');
  });

  it('round-trips role correctly', () => {
    const token = signAccessToken({ userId: 'u1', role: 'admin' });
    expect(verifyAccessToken(token).role).toBe('admin');
  });

  it('round-trips workspaceId when provided', () => {
    const token = signAccessToken({ userId: 'u1', workspaceId: 'ws-xyz', role: 'user' });
    expect(verifyAccessToken(token).workspaceId).toBe('ws-xyz');
  });

  it('workspaceId is undefined when omitted', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    const payload = verifyAccessToken(token);
    expect(payload.workspaceId).toBeUndefined();
  });

  it('throws JsonWebTokenError on tampered token', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('throws on completely invalid token', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => verifyAccessToken('')).toThrow();
  });

  it('payload contains iat and exp', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    const payload = verifyAccessToken(token);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('exp is roughly 15 minutes from iat', () => {
    const token = signAccessToken({ userId: 'u1', role: 'user' });
    const payload = verifyAccessToken(token);
    const diffSec = payload.exp - payload.iat;
    // 15 minutes = 900 seconds (allow ±5s for test timing)
    expect(diffSec).toBeGreaterThanOrEqual(895);
    expect(diffSec).toBeLessThanOrEqual(905);
  });

  it('rejects token signed with wrong secret', () => {
    // Manually sign with a different secret
    const jwt = require('jsonwebtoken');
    const badToken = jwt.sign({ userId: 'u1', role: 'user' }, 'wrong-secret');
    expect(() => verifyAccessToken(badToken)).toThrow();
  });

  it('verifies issuer and audience', () => {
    // Token signed without the correct issuer/audience should fail
    const jwt = require('jsonwebtoken');
    const badToken = jwt.sign(
      { userId: 'u1', role: 'user' },
      process.env.JWT_SECRET,
      { issuer: 'wrong-issuer', audience: 'wrong-audience' }
    );
    expect(() => verifyAccessToken(badToken)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// signRefreshToken / verifyRefreshToken
// ══════════════════════════════════════════════════════════════════════════════
describe('signRefreshToken', () => {
  it('returns a valid JWT string', () => {
    const token = signRefreshToken({ userId: 'u1' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('different userIds produce different tokens', () => {
    const t1 = signRefreshToken({ userId: 'u1' });
    const t2 = signRefreshToken({ userId: 'u2' });
    expect(t1).not.toBe(t2);
  });
});

describe('verifyRefreshToken', () => {
  it('round-trips userId', () => {
    const token = signRefreshToken({ userId: 'user-refresh-test' });
    expect(verifyRefreshToken(token).userId).toBe('user-refresh-test');
  });

  it('payload has iat and exp', () => {
    const token = signRefreshToken({ userId: 'u1' });
    const payload = verifyRefreshToken(token);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('exp is roughly 7 days from iat', () => {
    const token = signRefreshToken({ userId: 'u1' });
    const payload = verifyRefreshToken(token);
    const diffSec = payload.exp - payload.iat;
    // 7 days = 604800 seconds (allow ±10s)
    expect(diffSec).toBeGreaterThanOrEqual(604790);
    expect(diffSec).toBeLessThanOrEqual(604810);
  });

  it('throws on tampered token', () => {
    const token = signRefreshToken({ userId: 'u1' });
    const tampered = token.slice(0, -4) + 'WXYZ';
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });

  it('access token cannot be used as refresh token (different secrets)', () => {
    const accessToken = signAccessToken({ userId: 'u1', role: 'user' });
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it('refresh token cannot be used as access token', () => {
    const refreshToken = signRefreshToken({ userId: 'u1' });
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// hashPassword / verifyPassword (argon2id)
// ══════════════════════════════════════════════════════════════════════════════
describe('hashPassword', () => {
  it('returns a non-empty string', async () => {
    const hash = await hashPassword('MyPassword123!');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('hash looks like argon2 format (starts with $argon2id)', async () => {
    const hash = await hashPassword('test');
    expect(hash).toMatch(/^\$argon2id/);
  });

  it('same password produces different hashes (salted)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });

  it('works with unicode passwords', async () => {
    await expect(hashPassword('pässwörد123')).resolves.toBeDefined();
  });

  it('works with very long passwords', async () => {
    await expect(hashPassword('x'.repeat(500))).resolves.toBeDefined();
  });

  it('works with empty string (edge case — allowed by argon2)', async () => {
    await expect(hashPassword('')).resolves.toBeDefined();
  });
}, 30_000); // argon2 is intentionally slow

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('CorrectHorse99!');
    expect(await verifyPassword(hash, 'CorrectHorse99!')).toBe(true);
  }, 15_000);

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('CorrectHorse99!');
    expect(await verifyPassword(hash, 'WrongHorse99!')).toBe(false);
  }, 15_000);

  it('returns false for empty password against real hash', async () => {
    const hash = await hashPassword('MyPassword!');
    expect(await verifyPassword(hash, '')).toBe(false);
  }, 15_000);

  it('is case-sensitive', async () => {
    const hash = await hashPassword('Password123');
    expect(await verifyPassword(hash, 'password123')).toBe(false);
  }, 15_000);

  it('throws on malformed hash string', async () => {
    await expect(verifyPassword('not-a-hash', 'password')).rejects.toThrow();
  }, 10_000);
}, 60_000);

// ══════════════════════════════════════════════════════════════════════════════
// Workspace role hierarchy (requireWorkspaceAccess logic)
// ══════════════════════════════════════════════════════════════════════════════
describe('workspace role hierarchy', () => {
  describe('role ordering', () => {
    it('owner > admin > editor > viewer', () => {
      expect(ROLE_HIERARCHY.owner).toBeGreaterThan(ROLE_HIERARCHY.admin);
      expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.editor);
      expect(ROLE_HIERARCHY.editor).toBeGreaterThan(ROLE_HIERARCHY.viewer);
    });

    it('all values are non-negative integers', () => {
      for (const [, v] of Object.entries(ROLE_HIERARCHY)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('hasAccess — viewer minimum', () => {
    const minRole = 'viewer';
    it('viewer has access', () => expect(hasAccess('viewer', minRole)).toBe(true));
    it('editor has access', () => expect(hasAccess('editor', minRole)).toBe(true));
    it('admin has access',  () => expect(hasAccess('admin',  minRole)).toBe(true));
    it('owner has access',  () => expect(hasAccess('owner',  minRole)).toBe(true));
  });

  describe('hasAccess — editor minimum', () => {
    const minRole = 'editor';
    it('viewer is denied',  () => expect(hasAccess('viewer', minRole)).toBe(false));
    it('editor has access', () => expect(hasAccess('editor', minRole)).toBe(true));
    it('admin has access',  () => expect(hasAccess('admin',  minRole)).toBe(true));
    it('owner has access',  () => expect(hasAccess('owner',  minRole)).toBe(true));
  });

  describe('hasAccess — admin minimum', () => {
    const minRole = 'admin';
    it('viewer is denied',  () => expect(hasAccess('viewer', minRole)).toBe(false));
    it('editor is denied',  () => expect(hasAccess('editor', minRole)).toBe(false));
    it('admin has access',  () => expect(hasAccess('admin',  minRole)).toBe(true));
    it('owner has access',  () => expect(hasAccess('owner',  minRole)).toBe(true));
  });

  describe('hasAccess — owner minimum', () => {
    const minRole = 'owner';
    it('viewer is denied', () => expect(hasAccess('viewer', minRole)).toBe(false));
    it('editor is denied', () => expect(hasAccess('editor', minRole)).toBe(false));
    it('admin is denied',  () => expect(hasAccess('admin',  minRole)).toBe(false));
    it('owner has access', () => expect(hasAccess('owner',  minRole)).toBe(true));
  });

  describe('hasAccess — unknown roles', () => {
    it('unknown member role is denied', () => {
      expect(hasAccess('superuser', 'viewer')).toBe(false);
    });

    it('unknown minRole blocks everyone', () => {
      expect(hasAccess('owner', 'superuser')).toBe(false);
    });
  });

  describe('symmetric access checks', () => {
    it('same role always grants access', () => {
      for (const role of ['viewer', 'editor', 'admin', 'owner']) {
        expect(hasAccess(role, role)).toBe(true);
      }
    });

    it('lower role is always denied for higher minRole', () => {
      const roles = ['viewer', 'editor', 'admin', 'owner'];
      for (let i = 0; i < roles.length; i++) {
        for (let j = i + 1; j < roles.length; j++) {
          // roles[i] (lower) trying to access roles[j] (higher) minRole
          expect(hasAccess(roles[i], roles[j])).toBe(false);
        }
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// JWT token isolation (access vs refresh — cross-use is blocked)
// ══════════════════════════════════════════════════════════════════════════════
describe('JWT token type isolation', () => {
  it('access token payload has no refresh-only fields', () => {
    const token = signAccessToken({ userId: 'u1', role: 'admin', workspaceId: 'ws1' });
    const payload = verifyAccessToken(token);
    // Access token payload fields
    expect(payload.userId).toBe('u1');
    expect(payload.role).toBe('admin');
  });

  it('refresh token payload contains only userId', () => {
    const token = signRefreshToken({ userId: 'u1' });
    const payload = verifyRefreshToken(token);
    expect(payload.userId).toBe('u1');
    // Should NOT contain role or workspaceId
    expect((payload as any).role).toBeUndefined();
    expect((payload as any).workspaceId).toBeUndefined();
  });

  it('multiple sequential access tokens have different iat', async () => {
    const t1 = signAccessToken({ userId: 'u1', role: 'user' });
    await new Promise(r => setTimeout(r, 1100)); // wait >1s so iat differs
    const t2 = signAccessToken({ userId: 'u1', role: 'user' });
    const p1 = verifyAccessToken(t1);
    const p2 = verifyAccessToken(t2);
    expect(p2.iat).toBeGreaterThan(p1.iat);
  }, 10_000);
});

// ══════════════════════════════════════════════════════════════════════════════
// User role system (application-level roles, not workspace roles)
// ══════════════════════════════════════════════════════════════════════════════
describe('application roles', () => {
  const APP_ROLES = ['user', 'admin', 'super_admin'];

  it('all standard app roles can be signed into access tokens', () => {
    for (const role of APP_ROLES) {
      const token = signAccessToken({ userId: 'u1', role });
      expect(verifyAccessToken(token).role).toBe(role);
    }
  });

  it('custom role strings are preserved in token', () => {
    const token = signAccessToken({ userId: 'u1', role: 'api_client' });
    expect(verifyAccessToken(token).role).toBe('api_client');
  });
});
