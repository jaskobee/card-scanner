// Local persistence. See CLAUDE.md §4 — no login, nothing leaves the browser,
// and a closed tab is never a lost batch (§2.5).

const DB_NAME = 'card-scanner';
const DB_VERSION = 1;
const STORES = { projects: 'id', cards: 'id', jobs: 'id', blobs: 'id', settings: 'key' };

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath });
          if (name === 'cards' || name === 'jobs') store.createIndex('projectId', 'projectId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

export async function put(store, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readwrite').put(value);
    r.onsuccess = () => resolve(value);
    r.onerror = () => reject(r.error);
  });
}

export async function putMany(store, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve(values.length);
    t.onerror = () => reject(t.error);
  });
}

export async function get(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readonly').get(key);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}

export async function all(store, indexName, indexValue) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const s = tx(db, store, 'readonly');
    const src = indexName ? s.index(indexName) : s;
    const r = indexValue === undefined ? src.getAll() : src.getAll(indexValue);
    r.onsuccess = () => resolve(r.result ?? []);
    r.onerror = () => reject(r.error);
  });
}

export async function remove(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readwrite').delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function removeWhere(store, indexName, indexValue) {
  const rows = await all(store, indexName, indexValue);
  await Promise.all(rows.map((r) => remove(store, r.id)));
  return rows.length;
}

// --- blobs ----------------------------------------------------------------
// Images live in their own store so card records stay small and quick to scan.

export async function putBlob(id, blob) { await put('blobs', { id, blob }); return id; }
export async function getBlob(id) { return (await get('blobs', id))?.blob ?? null; }

/**
 * Object URLs leak until revoked, and 500 of them is real memory. Hand them out
 * from here so they can all be released when a view is torn down.
 */
export class UrlCache {
  constructor() { this.urls = new Map(); }
  async urlFor(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const blob = await getBlob(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }
  release(id) {
    const url = this.urls.get(id);
    if (url) { URL.revokeObjectURL(url); this.urls.delete(id); }
  }
  releaseAll() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

// --- settings -------------------------------------------------------------

export async function setting(key, value) {
  if (value === undefined) return (await get('settings', key))?.value ?? null;
  await put('settings', { key, value });
  return value;
}

/** Rough usage figure for the storage panel. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used, quota } = await navigator.storage.estimate();
  return { used, quota };
}
