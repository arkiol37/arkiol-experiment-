// apps/arkiol-core/src/hooks/useAutosaveReliability.ts
// V16 TC-026 FIX: Autosave reliability for rapid edit + refresh scenarios.
//
// Three-layer approach:
//   1. Flush autosave on beforeunload, pagehide, and visibilitychange
//      (handles browser close, tab switch, mobile backgrounding)
//   2. Lightweight IndexedDB local backup layer — write-through on every edit
//      (handles crash recovery, network failure, F5 before flush)
//   3. Restore from IndexedDB on mount if server draft is older or absent
//
// Ownership and concurrency safeguards are NOT changed — all server writes
// still go through the existing /api/editor/autosave endpoint with full
// userId+orgId scoping. IndexedDB is a LOCAL backup only, not a sync layer.

'use client';

import { useEffect, useRef, useCallback } from 'react';

const IDB_DB_NAME      = 'arkiol_autosave_v1';
const IDB_STORE_NAME   = 'drafts';
const IDB_DB_VERSION   = 1;
const FLUSH_TIMEOUT_MS = 300; // debounce window before flushing

export interface AutosaveState {
  projectId:  string;
  elements:   unknown[];
  savedAt:    string; // ISO timestamp
  version:    number;
}

// ── IndexedDB helper (no external deps) ──────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function idbWriteDraft(draft: AutosaveState): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE_NAME, 'readwrite');
      const req = tx.objectStore(IDB_STORE_NAME).put(draft);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.warn('[autosave-idb] Write failed (non-fatal):', err);
  }
}

export async function idbReadDraft(projectId: string): Promise<AutosaveState | null> {
  try {
    const db = await openIDB();
    const result = await new Promise<AutosaveState | null>((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(projectId);
      req.onsuccess = () => resolve((req.result as AutosaveState) ?? null);
      req.onerror   = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function idbClearDraft(projectId: string): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE_NAME, 'readwrite');
      const req = tx.objectStore(IDB_STORE_NAME).delete(projectId);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
    db.close();
  } catch {}
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseAutosaveReliabilityOptions {
  projectId:  string;
  elements:   unknown[];
  version:    number;
  /** Called when a crash recovery draft is found (from IndexedDB) */
  onCrashRecovery?: (draft: AutosaveState) => void;
  /** Async function that sends the draft to the server */
  serverFlush: (elements: unknown[], checkpoint?: boolean) => Promise<void>;
}

/**
 * useAutosaveReliability
 *
 * Attach to your editor component. Handles:
 * - Flushing to server on beforeunload / pagehide / visibilitychange
 * - Writing to IndexedDB on every elements change (local backup)
 * - Restoring from IndexedDB on mount if server draft is stale/absent
 */
export function useAutosaveReliability({
  projectId,
  elements,
  version,
  onCrashRecovery,
  serverFlush,
}: UseAutosaveReliabilityOptions) {
  // Keep a ref to the latest elements so event handlers always see fresh data
  const elementsRef    = useRef(elements);
  const projectIdRef   = useRef(projectId);
  const serverFlushRef = useRef(serverFlush);
  const flushingRef    = useRef(false);
  const idbVersionRef  = useRef(version);

  useEffect(() => { elementsRef.current    = elements;    }, [elements]);
  useEffect(() => { projectIdRef.current   = projectId;   }, [projectId]);
  useEffect(() => { serverFlushRef.current = serverFlush; }, [serverFlush]);
  useEffect(() => { idbVersionRef.current  = version;     }, [version]);

  // ── Write-through to IndexedDB on every elements change ──────────────────
  useEffect(() => {
    if (!projectId || !elements.length) return;
    const draft: AutosaveState = {
      projectId,
      elements,
      savedAt: new Date().toISOString(),
      version,
    };
    idbWriteDraft(draft);
  }, [projectId, elements, version]);

  // ── Flush to server helper (beacon-safe, synchronous-ish) ─────────────────
  const flushToServer = useCallback(async (reason: string) => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    const el = elementsRef.current;
    if (!el || !el.length) {
      flushingRef.current = false;
      return;
    }
    try {
      // Use sendBeacon for beforeunload — doesn't block page close
      // Fall back to fetch for visibilitychange (page not unloading)
      await serverFlushRef.current(el, false);
      console.debug(`[autosave] Flushed (${reason})`);
    } catch (err) {
      console.warn(`[autosave] Server flush failed (${reason}), IndexedDB backup retained:`, err);
    } finally {
      flushingRef.current = false;
    }
  }, []);

  // ── Beacon flush for unload (no async/await — fire-and-forget) ───────────
  const beaconFlush = useCallback(() => {
    const el  = elementsRef.current;
    const pid = projectIdRef.current;
    if (!el?.length || !pid) return;

    // sendBeacon is the only guaranteed delivery during unload
    const payload = JSON.stringify({ projectId: pid, elements: el, checkpoint: false });
    const beaconOk = navigator.sendBeacon?.(
      '/api/editor/autosave',
      new Blob([payload], { type: 'application/json' })
    );

    if (!beaconOk) {
      // sendBeacon failed (quota exceeded / disabled) — attempt sync XHR
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/editor/autosave', false); // synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      } catch {
        console.warn('[autosave] Both beacon and sync XHR failed — IndexedDB backup is the safety net');
      }
    }
  }, []);

  // ── Register lifecycle event listeners ────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // beforeunload: user closing tab/window
    const handleBeforeUnload = () => {
      beaconFlush();
    };

    // pagehide: more reliable than beforeunload in modern browsers / mobile
    const handlePageHide = (e: PageTransitionEvent) => {
      beaconFlush();
    };

    // visibilitychange: tab backgrounded (mobile, Alt+Tab, etc.)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        beaconFlush();
        // Also try async flush for cases where the page stays alive (tab switch)
        setTimeout(() => flushToServer('visibilitychange'), FLUSH_TIMEOUT_MS);
      }
    };

    window.addEventListener('beforeunload',     handleBeforeUnload);
    window.addEventListener('pagehide',          handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload',      handleBeforeUnload);
      window.removeEventListener('pagehide',           handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [beaconFlush, flushToServer]);

  // ── Mount: check IndexedDB for crash recovery ─────────────────────────────
  useEffect(() => {
    if (!projectId || !onCrashRecovery) return;

    (async () => {
      const localDraft = await idbReadDraft(projectId);
      if (!localDraft) return;

      // Only offer recovery if local draft is newer than current version
      if (localDraft.version > version && localDraft.elements.length > 0) {
        const localTime = new Date(localDraft.savedAt).getTime();
        const isRecent  = Date.now() - localTime < 7 * 24 * 60 * 60 * 1000; // 7 days
        if (isRecent) {
          onCrashRecovery(localDraft);
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]); // Run once on mount per projectId

  return {
    /** Manually trigger a server flush (e.g., before navigation) */
    flush: (reason = 'manual') => flushToServer(reason),
    /** Clear the local IndexedDB backup after a successful manual save */
    clearLocalBackup: () => idbClearDraft(projectId),
    /** Directly write current state to IndexedDB */
    writeLocalBackup: () => idbWriteDraft({
      projectId,
      elements,
      savedAt: new Date().toISOString(),
      version,
    }),
  };
}
