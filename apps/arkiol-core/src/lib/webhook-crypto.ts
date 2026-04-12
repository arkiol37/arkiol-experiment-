// src/lib/webhook-crypto.ts
// AES-256-GCM encryption for webhook signing secrets stored in the database.
//
// WHY encrypt at the application layer?
//   Defense-in-depth: if the DB is compromised (SQL injection, backup leak,
//   misconfigured snapshot), webhook secrets are not exposed in plaintext.
//   The encryption key lives only in the application environment, never in the DB.
//
// KEY REQUIREMENT:
//   WEBHOOK_SECRET_KEY must be exactly 64 hex characters (32 bytes / 256 bits).
//   Generate with: openssl rand -hex 32
//   The server will refuse to start if this variable is missing or malformed.
//   There is NO fallback key — a missing key is a configuration error, not a default.
//
// ALGORITHM: AES-256-GCM
//   - 256-bit key (32 bytes from WEBHOOK_SECRET_KEY)
//   - 96-bit random IV (12 bytes, generated fresh per encryption)
//   - 128-bit authentication tag (16 bytes, prevents tampering)
//   - Stored format: <iv_hex>:<ciphertext_hex>:<tag_hex>
//
// WIRE FORMAT returned to clients:
//   whsec_<random_bytes_hex>  (64-char hex = 256 bits of entropy)
//   This is the PLAINTEXT secret the client uses to verify HMAC-SHA256 signatures.
//   It is shown ONCE at webhook creation and never retrievable afterwards.

import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

const KEY_ENV        = "WEBHOOK_SECRET_KEY";
const ALGORITHM      = "aes-256-gcm" as const;
const IV_BYTES       = 12;   // 96 bits — NIST recommended for GCM
const TAG_BYTES      = 16;   // 128 bits — GCM authentication tag
const KEY_HEX_LENGTH = 64;   // 32 bytes expressed as hex

// ── Key loading — fails hard if missing or malformed ─────────────────────────
function loadKey(): Buffer {
  const hex = process.env.WEBHOOK_SECRET_KEY;

  if (!hex || hex.length !== KEY_HEX_LENGTH || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      `[webhook-crypto] WEBHOOK_SECRET_KEY is not set or invalid. ` +
      `Generate one with: openssl rand -hex 32`
    );
  }

  return Buffer.from(hex, "hex");
}

// ── Encrypt a webhook signing secret for storage ──────────────────────────────
// Returns: "<iv_hex>:<ciphertext_hex>:<tag_hex>"
// Safe to store in any text column. Not human-readable.
export function encryptWebhookSecret(plaintext: string): string {
  const key        = loadKey();
  const iv         = randomBytes(IV_BYTES);
  const cipher     = createCipheriv(ALGORITHM, key, iv);
  const encrypted  = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag        = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    encrypted.toString("hex"),
    tag.toString("hex"),
  ].join(":");
}

// ── Decrypt a webhook signing secret for HMAC signing ────────────────────────
// Throws if the ciphertext is tampered or the key is wrong (GCM authentication).
export function decryptWebhookSecret(stored: string): string {
  const key  = loadKey();
  const parts = stored.split(":");

  // Handle legacy XOR-encrypted secrets (they never contained a valid ":" triple).
  // XOR-encrypted format: "<32-byte iv hex>:<variable hex>" — 2 parts only.
  // AES-GCM format: "<24-char iv hex>:<ciphertext hex>:<32-char tag hex>" — 3 parts.
  if (parts.length !== 3) {
    throw new Error(
      "[webhook-crypto] Cannot decrypt legacy-format webhook secret. " +
      "This webhook was created with the old insecure XOR scheme. " +
      "Delete and re-create this webhook to generate a properly secured secret."
    );
  }

  const [ivHex, ciphertextHex, tagHex] = parts;

  if (!ivHex || !ciphertextHex || !tagHex) {
    throw new Error("[webhook-crypto] Malformed stored secret: missing IV, ciphertext, or tag.");
  }

  const iv         = Buffer.from(ivHex,         "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag        = Buffer.from(tagHex,        "hex");

  if (iv.length !== IV_BYTES) {
    throw new Error(`[webhook-crypto] Invalid IV length: expected ${IV_BYTES} bytes, got ${iv.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`[webhook-crypto] Invalid tag length: expected ${TAG_BYTES} bytes, got ${tag.length}.`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws ERR_CRYPTO_INVALID_AUTH_TAG if tampered
  ]);

  return decrypted.toString("utf8");
}

// ── Constant-time safe-equal for HMAC comparison ─────────────────────────────
// Exported for use in any route that needs to compare secrets/tokens.
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
