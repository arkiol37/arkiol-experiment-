// src/hooks/useCapabilities.ts
// Client-side hook — fetches capability flags from /api/capabilities.
// Use this in "use client" components instead of reading process.env.
// The interface is imported from @arkiol/shared so naming is always consistent.
"use client";
import { useState, useEffect }              from 'react';
import type { SerializedCapabilities }      from '@arkiol/shared';

export type { SerializedCapabilities as AppCapabilities };

const DEFAULT: SerializedCapabilities = {
  hasDatabase: false, hasAI: false, hasStorage: false, hasQueue: false,
  hasRateLimit: false, hasAuth: false, hasPaddleBilling: false,
  hasStripeBilling: false, hasBilling: false, hasEmail: false,
  hasWebhooks: false, hasMobileAuth: false, hasSentry: false,
};

// Module-level cache so repeated hook calls don't re-fetch
let _cached: SerializedCapabilities | null = null;

export function useCapabilities(): { caps: SerializedCapabilities; loading: boolean } {
  const [caps, setCaps]       = useState<SerializedCapabilities>(_cached ?? DEFAULT);
  const [loading, setLoading] = useState(!_cached);

  useEffect(() => {
    if (_cached) { setCaps(_cached); setLoading(false); return; }
    fetch('/api/capabilities')
      .then(r => r.json())
      .then((data: SerializedCapabilities) => { _cached = data; setCaps(data); })
      .catch(() => { /* leave defaults — all features show as unconfigured */ })
      .finally(() => setLoading(false));
  }, []);

  return { caps, loading };
}
