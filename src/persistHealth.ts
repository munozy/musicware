/**
 * Persist-health signal (DEBT-034 high finding). The localStorage stores used to swallow a
 * failed write with only a console.error, so a user whose storage was full believed their work
 * was saved and lost it on next launch — the worst failure for a create-bricks app.
 *
 * Every store now reports the outcome of its last write here; the app subscribes and shows a
 * non-blocking banner while the latest save is failing. It's a tiny external store so the signal
 * can cross the independent hooks (recordings / songs / video) without prop-drilling.
 */

type Listener = () => void;

let failed = false;
const listeners = new Set<Listener>();

/** Called by each store after a persist attempt. false = the write threw (e.g. quota exceeded). */
export function reportPersist(ok: boolean): void {
  const next = !ok;
  if (next === failed) return; // no change → don't churn subscribers
  failed = next;
  for (const l of listeners) l();
}

/** True while the most recent persist attempt (any store) failed. */
export function persistFailed(): boolean {
  return failed;
}

/** Subscribe for useSyncExternalStore. Returns an unsubscribe. */
export function subscribePersist(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Test-only: reset the module singleton between cases. */
export function __resetPersistHealth(): void {
  failed = false;
  listeners.clear();
}
