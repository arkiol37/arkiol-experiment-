-- Migration: 20260306_mobile_companion
-- Adds MobilePushToken table for Expo push notifications

CREATE TABLE IF NOT EXISTS "MobilePushToken" (
    "id"         TEXT NOT NULL DEFAULT gen_random_uuid(),
    "token"      TEXT NOT NULL,
    "platform"   TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePushToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MobilePushToken_token_key" UNIQUE ("token"),
    CONSTRAINT "MobilePushToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MobilePushToken_userId_idx" ON "MobilePushToken"("userId");
