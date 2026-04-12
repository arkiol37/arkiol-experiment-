// packages/shared/src/webhookSsrfGuard.ts
// ─────────────────────────────────────────────────────────────────────────────
// SSRF GUARD FOR OUTBOUND WEBHOOK URLS — Task #4
//
// Blocks registration of webhook URLs that point to:
//   • localhost / loopback (127.x.x.x, ::1)
//   • RFC-1918 private IP ranges (10.x, 172.16-31.x, 192.168.x)
//   • Link-local (169.254.x.x, fe80::/10)
//   • Metadata endpoints (169.254.169.254 — AWS/GCP/Azure IMDS)
//   • Internal DNS patterns (*.internal, *.local, *.corp, etc.)
//   • Non-HTTPS schemes
//   • IP literals (direct IP webhook URLs bypass DNS-based controls)
//
// Call validateWebhookUrl(url) before persisting any webhook endpoint.
// ─────────────────────────────────────────────────────────────────────────────

// Private/reserved IPv4 CIDR ranges as [network, maskBits] tuples
const BLOCKED_IPV4_CIDRS: Array<[number, number, number]> = [
  // Loopback
  [0x7f000000, 0xff000000, 8],     // 127.0.0.0/8
  // RFC-1918 private
  [0x0a000000, 0xff000000, 8],     // 10.0.0.0/8
  [0xac100000, 0xfff00000, 12],    // 172.16.0.0/12
  [0xc0a80000, 0xffff0000, 16],    // 192.168.0.0/16
  // Link-local (APIPA + IMDS)
  [0xa9fe0000, 0xffff0000, 16],    // 169.254.0.0/16 (includes 169.254.169.254)
  // Carrier-grade NAT
  [0x64400000, 0xffc00000, 10],    // 100.64.0.0/10
  // Unique local (Docker default bridge etc.)
  [0xfc000000, 0xfe000000, 7],     // fc00::/7 (IPv6 ULA — handled separately)
];

// Blocked hostname patterns — exact match or suffix
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.corp$/i,
  /\.intranet$/i,
  /\.lan$/i,
  /\.home$/i,
  /\.example$/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,           // AWS/GCP/Azure IMDS
  /^fd[0-9a-f]{2}:/i,              // IPv6 ULA prefix
];

export interface SsrfCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Parse an IPv4 address string into a 32-bit integer.
 * Returns null if not a valid IPv4 address.
 */
function parseIPv4(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== part) return null;
    result = (result << 8) | n;
  }
  return result >>> 0; // unsigned
}

/**
 * Check if an IPv4 integer falls in any blocked CIDR range.
 */
function isBlockedIPv4(ip: number): boolean {
  for (const [network, mask] of BLOCKED_IPV4_CIDRS) {
    if ((ip & mask) === network) return true;
  }
  return false;
}

/**
 * Check if a hostname looks like a raw IP address (IPv4 or IPv6 literal).
 * We block direct IP webhook URLs entirely — legitimate services use domain names.
 */
function isIpLiteral(host: string): boolean {
  // IPv6 literals in URLs are wrapped in brackets: [::1]
  if (host.startsWith('[')) return true;
  // IPv4: 4 dot-separated decimal octets
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * Validate a webhook URL for SSRF safety.
 *
 * @param url - The webhook URL string to validate
 * @returns SsrfCheckResult with `safe: true` or `safe: false` + `reason`
 *
 * @example
 * const result = validateWebhookUrl('https://hooks.example.com/notify');
 * if (!result.safe) throw new Error(result.reason);
 */
export function validateWebhookUrl(url: string): SsrfCheckResult {
  // ── 1. Basic URL parse ──────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'Invalid URL format.' };
  }

  // ── 2. HTTPS only ───────────────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    return {
      safe: false,
      reason: `Webhook URL must use HTTPS. Got: "${parsed.protocol}". ` +
              'HTTP endpoints are not supported for security reasons.',
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, ''); // strip trailing dot

  // ── 3. Block IP literals entirely ──────────────────────────────────────
  if (isIpLiteral(hostname)) {
    return {
      safe: false,
      reason: 'Webhook URLs must use domain names, not raw IP addresses. ' +
              'IP literals are blocked to prevent SSRF attacks.',
    };
  }

  // ── 4. Block reserved/private IPv4 ranges ──────────────────────────────
  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null && isBlockedIPv4(ipv4)) {
    return {
      safe: false,
      reason: `Webhook URL resolves to a private or reserved IP address (${hostname}). ` +
              'Localhost, loopback, and private IP ranges are not allowed.',
    };
  }

  // ── 5. Block internal hostname patterns ────────────────────────────────
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        safe: false,
        reason: `Webhook URL hostname "${hostname}" matches a blocked internal pattern. ` +
                'Internal DNS targets (*.local, *.internal, *.corp, metadata endpoints) are not allowed.',
      };
    }
  }

  // ── 6. Port restrictions ────────────────────────────────────────────────
  if (parsed.port) {
    const port = parseInt(parsed.port, 10);
    // Allow standard HTTPS (443) and common dev-facing ports.
    // Block anything that looks like an internal service port.
    const INTERNAL_PORTS = new Set([
      80, 8080, 8000, 8001, 8008, // HTTP (not HTTPS)
      25, 465, 587,                // SMTP
      3306, 5432, 27017, 6379,     // Databases / Redis
      2375, 2376,                  // Docker API
      10250, 10255,                // Kubernetes
      9200, 9300,                  // Elasticsearch
    ]);
    if (INTERNAL_PORTS.has(port)) {
      return {
        safe: false,
        reason: `Port ${port} is not allowed for webhook URLs. ` +
                'It is commonly used by internal services and databases.',
      };
    }
  }

  return { safe: true };
}

/**
 * Assert that a webhook URL is SSRF-safe.
 * Throws a descriptive error if not.
 */
export function assertWebhookUrlSafe(url: string): void {
  const result = validateWebhookUrl(url);
  if (!result.safe) {
    const err = Object.assign(new Error(result.reason), { code: 'SSRF_BLOCKED' as const, statusCode: 400 });
    throw err;
  }
}
