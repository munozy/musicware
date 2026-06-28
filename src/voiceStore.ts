/**
 * IndexedDB store for raw voice-take audio Blobs (ADR-0009). localStorage holds the small
 * Recording metadata; the audio bytes are too big for it, so they live here keyed by a
 * blobKey. All ops degrade gracefully when IndexedDB is unavailable (e.g. jsdom) — they
 * resolve to null/undefined rather than throw, so the app never crashes on storage.
 */

const DB_NAME = "musicware-voice";
const STORE = "blobs";
const VERSION = 1;

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

/** A fresh, collision-resistant key for a new voice blob. */
export function newBlobKey(): string {
  return "voice-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getBlob(key: string): Promise<Blob | null> {
  if (!hasIDB()) return null;
  const db = await openDB();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(key: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
