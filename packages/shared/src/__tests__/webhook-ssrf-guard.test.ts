/**
 * packages/shared/src/__tests__/webhook-ssrf-guard.test.ts
 *
 * Unit tests for webhookSsrfGuard.ts
 *
 * Pure functions — no DB, no HTTP requests made, no network.
 *
 * Covers:
 *  - validateWebhookUrl — safe URLs, blocked by category:
 *      malformed, non-HTTPS, IP literals, private IPv4 ranges,
 *      blocked hostname patterns, blocked ports
 *  - assertWebhookUrlSafe — throws for unsafe URLs with SSRF_BLOCKED code
 */

import {
  validateWebhookUrl,
  assertWebhookUrlSafe,
} from '../webhookSsrfGuard';

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — SAFE URLs
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — safe URLs', () => {
  const SAFE_URLS = [
    'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX',
    'https://api.example.com/webhooks/arkiol',
    'https://webhook.site/unique-path',
    'https://notify.myapp.io/events',
    'https://stripe.com/webhooks',
    'https://example.com/hook',
    'https://my-saas.com:443/webhook',
    'https://company.github.io/notifications',
  ];

  for (const url of SAFE_URLS) {
    it(`allows: ${url}`, () => {
      const result = validateWebhookUrl(url);
      expect(result.safe).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — MALFORMED / INVALID
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — malformed URLs', () => {
  const BAD_URLS = [
    '',
    'not-a-url',
    'javascript:alert(1)',
    'ftp://example.com/file',
    '//example.com/path',
  ];

  for (const url of BAD_URLS) {
    it(`rejects malformed: "${url}"`, () => {
      const result = validateWebhookUrl(url);
      expect(result.safe).toBe(false);
      expect(typeof result.reason).toBe('string');
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — NON-HTTPS
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — non-HTTPS scheme', () => {
  it('rejects plain HTTP', () => {
    const result = validateWebhookUrl('http://example.com/hook');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });

  it('rejects ws://', () => {
    const result = validateWebhookUrl('ws://example.com/hook');
    expect(result.safe).toBe(false);
  });

  it('rejects ftp://', () => {
    const result = validateWebhookUrl('ftp://example.com/file');
    expect(result.safe).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — IP LITERALS
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — IP literal addresses', () => {
  it('rejects raw IPv4 address', () => {
    const result = validateWebhookUrl('https://93.184.216.34/hook');
    expect(result.safe).toBe(false);
    expect(result.reason?.toLowerCase()).toMatch(/ip|domain/);
  });

  it('rejects IPv6 literal [::1]', () => {
    const result = validateWebhookUrl('https://[::1]/hook');
    expect(result.safe).toBe(false);
  });

  it('rejects IPv6 public address literal', () => {
    const result = validateWebhookUrl('https://[2001:db8::1]/hook');
    expect(result.safe).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — PRIVATE / RESERVED IPv4 RANGES
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — private/reserved IPv4 ranges', () => {
  const PRIVATE_IPS = [
    '127.0.0.1',        // loopback
    '127.255.255.255',  // loopback edge
    '10.0.0.1',         // RFC-1918 class A
    '10.255.255.255',   // RFC-1918 class A edge
    '172.16.0.1',       // RFC-1918 class B start
    '172.31.255.255',   // RFC-1918 class B end
    '192.168.0.1',      // RFC-1918 class C
    '192.168.255.255',  // RFC-1918 class C edge
    '169.254.169.254',  // AWS/GCP/Azure IMDS metadata
    '169.254.0.1',      // link-local
    '100.64.0.1',       // carrier-grade NAT
  ];

  for (const ip of PRIVATE_IPS) {
    it(`blocks private IP: ${ip}`, () => {
      const result = validateWebhookUrl(`https://${ip}/hook`);
      expect(result.safe).toBe(false);
      expect(typeof result.reason).toBe('string');
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — BLOCKED HOSTNAME PATTERNS
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — blocked hostname patterns', () => {
  const BLOCKED_HOSTS = [
    'localhost',
    'service.local',
    'internal-api.internal',
    'my-service.corp',
    'app.intranet',
    'device.lan',
    'router.home',
    'test.example',
    'metadata.google.internal',
  ];

  for (const host of BLOCKED_HOSTS) {
    it(`blocks hostname: ${host}`, () => {
      const result = validateWebhookUrl(`https://${host}/hook`);
      expect(result.safe).toBe(false);
      expect(typeof result.reason).toBe('string');
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — BLOCKED PORTS
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — blocked internal ports', () => {
  const INTERNAL_PORTS = [
    80, 8080, 8000, 8001, 8008,   // HTTP
    25, 465, 587,                  // SMTP
    3306,                          // MySQL
    5432,                          // PostgreSQL
    27017,                         // MongoDB
    6379,                          // Redis
    2375, 2376,                    // Docker API
    10250,                         // Kubernetes
    9200,                          // Elasticsearch
  ];

  for (const port of INTERNAL_PORTS) {
    it(`blocks port: ${port}`, () => {
      const result = validateWebhookUrl(`https://api.example.com:${port}/hook`);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain(String(port));
    });
  }

  it('allows standard HTTPS port 443', () => {
    const result = validateWebhookUrl('https://api.example.com:443/hook');
    expect(result.safe).toBe(true);
  });

  it('allows non-standard non-internal port (e.g. 8443)', () => {
    // 8443 is not in the block list
    const result = validateWebhookUrl('https://api.example.com:8443/hook');
    expect(result.safe).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateWebhookUrl — REASON FIELD
// ══════════════════════════════════════════════════════════════════════════════
describe('validateWebhookUrl — reason field quality', () => {
  it('reason is a non-empty string for all blocked URLs', () => {
    const blocked = [
      'http://example.com/hook',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.1/hook',
      'https://169.254.169.254/hook',
      'https://service.internal/hook',
      'https://example.com:3306/hook',
    ];
    for (const url of blocked) {
      const result = validateWebhookUrl(url);
      expect(result.safe).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.reason!.length).toBeGreaterThan(10);
    }
  });

  it('safe URL returns no reason', () => {
    const result = validateWebhookUrl('https://api.example.com/hook');
    expect(result.reason).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// assertWebhookUrlSafe
// ══════════════════════════════════════════════════════════════════════════════
describe('assertWebhookUrlSafe', () => {
  it('does not throw for a safe URL', () => {
    expect(() => assertWebhookUrlSafe('https://api.example.com/hook')).not.toThrow();
  });

  it('throws for an unsafe URL', () => {
    expect(() => assertWebhookUrlSafe('https://localhost/hook')).toThrow();
  });

  it('thrown error has code SSRF_BLOCKED', () => {
    try {
      assertWebhookUrlSafe('https://localhost/hook');
    } catch (e: any) {
      expect(e.code).toBe('SSRF_BLOCKED');
    }
  });

  it('thrown error has statusCode 400', () => {
    try {
      assertWebhookUrlSafe('http://example.com/hook');
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
    }
  });

  it('thrown error message describes the block reason', () => {
    try {
      assertWebhookUrlSafe('https://10.0.0.1/hook');
    } catch (e: any) {
      expect(e.message.length).toBeGreaterThan(10);
    }
  });

  it('throws for all blocked URL categories', () => {
    const blocked = [
      'http://api.example.com/hook',          // non-https
      'https://127.0.0.1/hook',               // loopback
      'https://192.168.1.1/hook',             // private
      'https://service.local/hook',           // internal hostname
      'https://api.example.com:3306/hook',    // blocked port
    ];
    for (const url of blocked) {
      expect(() => assertWebhookUrlSafe(url)).toThrow();
    }
  });
});
