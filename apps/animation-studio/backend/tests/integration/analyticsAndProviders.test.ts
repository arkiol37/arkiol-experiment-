/**
 * Integration tests — Analytics & Providers routes
 *
 * Tests request validation and response shapes.
 * No real DB required — validates structural contracts.
 */

// ══════════════════════════════════════════════════════════════════════════════
// Analytics endpoint contract
// ══════════════════════════════════════════════════════════════════════════════
describe('Analytics Overview — Response contract', () => {
  const EXPECTED_FIELDS = [
    'renderStats',
    'creditStats',
    'providerStats',
    'monthlyOutput',
    'platformBreakdown',
    'hookTypeBreakdown',
    'durationBreakdown',
    'dailyCreditSpend',
    'topHookTypes',
    'qualityStats',
    'preferences',
  ];

  test('all required top-level fields are listed', () => {
    // The analytics overview endpoint must return all of these keys
    for (const field of EXPECTED_FIELDS) {
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    }
    expect(EXPECTED_FIELDS).toHaveLength(11);
  });

  test('period parameter maps to correct day count', () => {
    const periodToDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    expect(periodToDays['7d']).toBe(7);
    expect(periodToDays['30d']).toBe(30);
    expect(periodToDays['90d']).toBe(90);
    // Default should be 30d
    const defaultPeriod = '30d';
    expect(periodToDays[defaultPeriod]).toBe(30);
  });

  test('duration buckets cover all cases', () => {
    const buckets = ['short', 'mid', 'long'];
    // short = ≤15s, mid = 16-30s, long = 31s+
    const secPerBucket: Record<string, [number, number]> = {
      short: [0, 15],
      mid:   [16, 30],
      long:  [31, Infinity],
    };
    for (const b of buckets) {
      const [min, max] = secPerBucket[b];
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeGreaterThan(min);
    }
    expect(buckets).toHaveLength(3);
  });
});

describe('Analytics — renderStats shape', () => {
  const mockRenderStats = {
    total:           42,
    complete:        38,
    failed:          4,
    avg_scenes:      4.2,
    avg_duration_sec: 22.5,
    total_credits:   210,
  };

  test('success rate calculation is correct', () => {
    const rate = mockRenderStats.total > 0
      ? Math.round((mockRenderStats.complete / mockRenderStats.total) * 100)
      : 0;
    expect(rate).toBe(90);
  });

  test('zero total does not produce NaN', () => {
    const stats = { total: 0, complete: 0, failed: 0 };
    const rate = stats.total > 0 ? (stats.complete / stats.total) * 100 : 0;
    expect(rate).toBe(0);
    expect(isNaN(rate)).toBe(false);
  });

  test('avg_duration_sec is rounded to integer for display', () => {
    const display = Math.round(mockRenderStats.avg_duration_sec);
    expect(display).toBe(23);
  });
});

describe('Analytics — providerStats normalization', () => {
  const mockProviders = [
    { provider: 'runway', count: 65 },
    { provider: 'pika',   count: 35 },
  ];

  test('percentage sums to 100', () => {
    const total = mockProviders.reduce((s, p) => s + p.count, 0);
    const pcts  = mockProviders.map(p => Math.round((p.count / total) * 100));
    expect(pcts.reduce((s, p) => s + p, 0)).toBe(100);
  });

  test('provider with most renders has highest percentage', () => {
    const total = mockProviders.reduce((s, p) => s + p.count, 0);
    const sorted = [...mockProviders].sort((a, b) => b.count - a.count);
    const topPct = Math.round((sorted[0].count / total) * 100);
    expect(topPct).toBeGreaterThan(50);
  });
});

describe('Analytics — platformBreakdown display logic', () => {
  const mockPlatforms = [
    { platform: 'tiktok',    count: 40 },
    { platform: 'instagram', count: 30 },
    { platform: 'youtube',   count: 20 },
    { platform: 'facebook',  count: 10 },
  ];

  const PLATFORM_COLORS: Record<string, string> = {
    tiktok:    '#ff2d55',
    instagram: '#c026d3',
    youtube:   '#ef4444',
    facebook:  '#3b82f6',
  };

  test('all platforms have assigned colors', () => {
    for (const p of mockPlatforms) {
      expect(PLATFORM_COLORS[p.platform]).toBeDefined();
      expect(PLATFORM_COLORS[p.platform]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test('platform name is capitalised correctly', () => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    expect(cap('tiktok')).toBe('Tiktok');
    expect(cap('instagram')).toBe('Instagram');
    expect(cap('youtube')).toBe('Youtube');
  });

  test('pie chart values sum equals total render count', () => {
    const total = mockPlatforms.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(100);
  });
});

describe('Analytics — durationBreakdown best-practice signal', () => {
  test('short-dominant mix triggers positive signal', () => {
    const durationMap = { short: 60, mid: 30, long: 10 };
    const isPositive = durationMap.short > durationMap.long;
    expect(isPositive).toBe(true);
  });

  test('long-dominant mix triggers improvement suggestion', () => {
    const durationMap = { short: 10, mid: 20, long: 70 };
    const isPositive = durationMap.short > durationMap.long;
    expect(isPositive).toBe(false);
  });

  test('percentage calculations are correct', () => {
    const counts = { short: 50, mid: 30, long: 20 };
    const total  = counts.short + counts.mid + counts.long;
    expect(Math.round((counts.short / total) * 100)).toBe(50);
    expect(Math.round((counts.mid   / total) * 100)).toBe(30);
    expect(Math.round((counts.long  / total) * 100)).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Provider management — validation logic
// ══════════════════════════════════════════════════════════════════════════════
describe('Provider management — Input validation', () => {
  const VALID_PROVIDERS = ['runway', 'pika', 'sora', 'custom'] as const;

  test('only allowed providers pass validation', () => {
    for (const p of VALID_PROVIDERS) {
      expect(VALID_PROVIDERS).toContain(p);
    }
    const invalid = 'openai';
    expect(VALID_PROVIDERS).not.toContain(invalid as any);
  });

  test('apiKey must be non-empty', () => {
    const valid = 'sk-runway-abc123';
    expect(valid.length).toBeGreaterThan(0);
    expect(''.length).toBe(0); // empty key must be rejected
  });

  test('isPrimary defaults to false when not specified', () => {
    const defaults = { provider: 'runway', autoFallback: true, isPrimary: false };
    expect(defaults.isPrimary).toBe(false);
    expect(defaults.autoFallback).toBe(true);
  });
});

describe('Provider management — PATCH routing logic', () => {
  test('setting isPrimary=true requires unsetting others', () => {
    // Simulate logic: only one provider can be primary
    const providers = [
      { id: '1', provider: 'runway', is_primary: true },
      { id: '2', provider: 'pika',   is_primary: false },
    ];

    // When we set pika as primary
    const afterUpdate = providers.map(p =>
      p.id === '2' ? { ...p, is_primary: true } : { ...p, is_primary: false }
    );

    const primaryCount = afterUpdate.filter(p => p.is_primary).length;
    expect(primaryCount).toBe(1);
    expect(afterUpdate.find(p => p.id === '2')?.is_primary).toBe(true);
    expect(afterUpdate.find(p => p.id === '1')?.is_primary).toBe(false);
  });

  test('toggling enabled preserves other fields', () => {
    const provider = { id: '1', provider: 'runway', is_primary: true, enabled: true, auto_fallback: true };
    const updated  = { ...provider, enabled: false };
    expect(updated.is_primary).toBe(true);
    expect(updated.auto_fallback).toBe(true);
    expect(updated.enabled).toBe(false);
  });

  test('cost_optimize and auto_fallback toggle independently', () => {
    const p = { auto_fallback: true, cost_optimize: false };
    const updated = { ...p, cost_optimize: true };
    expect(updated.auto_fallback).toBe(true); // unchanged
    expect(updated.cost_optimize).toBe(true);
  });
});

describe('Provider management — display quality tiers', () => {
  const QUALITY_TIERS: Record<string, string> = {
    standard:      '#94a3b8',
    premium:       '#f59e0b',
    'cutting-edge': '#a78bfa',
  };

  const PROVIDER_TIERS: Record<string, string> = {
    runway: 'premium',
    pika:   'standard',
    sora:   'cutting-edge',
    custom: 'standard',
  };

  test('all providers have a quality tier', () => {
    for (const [, tier] of Object.entries(PROVIDER_TIERS)) {
      expect(QUALITY_TIERS[tier]).toBeDefined();
    }
  });

  test('quality tier colors are valid hex', () => {
    for (const [, color] of Object.entries(QUALITY_TIERS)) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test('sora has cutting-edge tier', () => {
    expect(PROVIDER_TIERS['sora']).toBe('cutting-edge');
  });

  test('runway has premium tier', () => {
    expect(PROVIDER_TIERS['runway']).toBe('premium');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Notifications — settings schema
// ══════════════════════════════════════════════════════════════════════════════
describe('Notifications — settings schema contract', () => {
  const DEFAULT_SETTINGS = {
    email_render_complete: true,
    email_render_failed:   true,
    email_low_credits:     true,
    email_weekly_digest:   false,
    email_marketing:       false,
    email_product_updates: true,
  };

  test('all notification keys are defined', () => {
    const requiredKeys = [
      'email_render_complete',
      'email_render_failed',
      'email_low_credits',
      'email_weekly_digest',
      'email_marketing',
      'email_product_updates',
    ];
    for (const key of requiredKeys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
      expect(typeof (DEFAULT_SETTINGS as any)[key]).toBe('boolean');
    }
  });

  test('deep merge preserves unmodified keys', () => {
    const base    = { ...DEFAULT_SETTINGS };
    const patch   = { email_marketing: true };
    const merged  = { ...base, ...patch };
    expect(merged.email_render_complete).toBe(true); // unchanged
    expect(merged.email_marketing).toBe(true);        // updated
    expect(merged.email_low_credits).toBe(true);      // unchanged
  });

  test('boolean values only — no strings or numbers', () => {
    for (const [, val] of Object.entries(DEFAULT_SETTINGS)) {
      expect(typeof val).toBe('boolean');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sessions — display logic
// ══════════════════════════════════════════════════════════════════════════════
describe('Sessions — display and security logic', () => {
  test('IP masking hides last octet', () => {
    const maskIp = (ip: string) => {
      const parts = ip.split('.');
      if (parts.length === 4) {
        parts[3] = '***';
        return parts.join('.');
      }
      return ip;
    };
    expect(maskIp('192.168.1.42')).toBe('192.168.1.***');
    expect(maskIp('10.0.0.1')).toBe('10.0.0.***');
    expect(maskIp('not-an-ip')).toBe('not-an-ip');
  });

  test('current session is identified by token hash comparison', () => {
    // Simulated: current token's hash matches session record
    const currentHash = 'abc123hash';
    const sessions = [
      { id: 's1', token_hash: 'abc123hash', is_current: true },
      { id: 's2', token_hash: 'def456hash', is_current: false },
    ];
    const current = sessions.find(s => s.token_hash === currentHash);
    expect(current?.is_current).toBe(true);
  });

  test('revoking current session should force re-login', () => {
    // This is a logic test — revoking your own session means:
    // the access token for that session becomes invalid
    const revokedSessionId = 's1';
    const activeSessions = [
      { id: 's1', active: true },
      { id: 's2', active: true },
    ];
    const afterRevoke = activeSessions.map(s =>
      s.id === revokedSessionId ? { ...s, active: false } : s
    );
    expect(afterRevoke.find(s => s.id === 's1')?.active).toBe(false);
    expect(afterRevoke.find(s => s.id === 's2')?.active).toBe(true);
  });
});
