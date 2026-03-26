// apps/arkiol-core/src/components/billing/PaddleCheckout.tsx
// V16: Paddle checkout component using Paddle.js (client-side token only).
// This component NEVER has access to PADDLE_API_KEY — only PADDLE_CLIENT_TOKEN
// (which is a public-safe token for Paddle.js inline checkout).
//
// Flow:
//   1. Click "Upgrade" → POST /api/billing/paddle/transaction (server-side)
//   2. Server creates Paddle transaction, returns transactionId + clientToken
//   3. Client initializes Paddle.js with clientToken (public, safe)
//   4. Paddle.js opens inline checkout using transactionId
//   5. On success, webhook fires → server provisions plan via shared logic

'use client';
import React from 'react';

import { useState, useEffect, useRef } from 'react';

type PlanKey = 'CREATOR' | 'PRO' | 'STUDIO';

interface PaddleCheckoutProps {
  planKey:      PlanKey;
  label?:       string;
  disabled?:    boolean;
  onSuccess?:   () => void;
  onCancel?:    () => void;
  className?:   string;
  style?:       React.CSSProperties;
}

// Paddle.js type shim (not importing paddle-js package to avoid bundle bloat)
declare global {
  interface Window {
    Paddle?: {
      Initialize: (opts: { token: string }) => void;
      Checkout: {
        open: (opts: {
          transactionId: string;
          settings?: {
            successUrl?: string;
            theme?: 'light' | 'dark';
            displayMode?: 'overlay' | 'inline';
          };
        }) => void;
      };
      Environment: {
        set: (env: 'sandbox' | 'production') => void;
      };
    };
  }
}

function loadPaddleJs(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Paddle) { resolve(); return; }
    const script = document.createElement('script');
    script.src   = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paddle.js'));
    document.head.appendChild(script);
  });
}

export function PaddleCheckout({
  planKey,
  label,
  disabled,
  onSuccess,
  onCancel,
  className,
  style,
}: PaddleCheckoutProps) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const initializedRef          = useRef(false);

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);

    try {
      // ── Step 1: Get transaction ID from server (server-side Paddle API call) ──
      const res = await fetch('/api/billing/paddle/transaction', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ planKey }),
      });

      if (res.status === 503) {
        setError('Billing not configured. Add PADDLE_API_KEY to your environment variables.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const { transactionId, clientToken, environment } = await res.json();

      if (!transactionId || !clientToken) {
        throw new Error('Invalid response from billing server');
      }

      // ── Step 2: Load Paddle.js (lazy, only when needed) ──────────────────────
      await loadPaddleJs();

      if (!window.Paddle) {
        throw new Error('Paddle.js failed to initialize');
      }

      // ── Step 3: Initialize Paddle.js with client token (safe, public) ────────
      // Client token is NOT the API key — it's a read-only public token for checkout
      if (!initializedRef.current) {
        if (environment === 'sandbox') {
          window.Paddle.Environment.set('sandbox');
        }
        window.Paddle.Initialize({ token: clientToken });
        initializedRef.current = true;
      }

      // ── Step 4: Open Paddle inline checkout ──────────────────────────────────
      window.Paddle.Checkout.open({
        transactionId,
        settings: {
          successUrl:  `${window.location.origin}/dashboard?billing=success`,
          theme:       'light',
          displayMode: 'overlay',
        },
      });

      // Paddle.js fires events on its overlay — success is handled via webhook
      // The page will redirect to successUrl after payment
      onSuccess?.();

    } catch (err: any) {
      console.error('[paddle-checkout] Error:', err.message);
      setError(err.message ?? 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleCheckout}
        disabled={disabled || loading}
        className={className}
        style={style}
        type="button"
      >
        {loading ? 'Loading...' : (label ?? `Upgrade to ${planKey}`)}
      </button>
      {error && (
        <p style={{ color: 'var(--error, #DC2626)', fontSize: '12px', marginTop: '8px', fontFamily: 'var(--font-body, system-ui)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
