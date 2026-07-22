// Tiny IndexedDB wrapper for the patch/pattern libraries. One db, one object
// store per library, keyPath 'id', 'slug' index for per-device queries.

const DB_NAME = 'synthhub';
const DB_VERSION = 1;
const STORES = ['patches', 'patterns'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath: 'id' });
          os.createIndex('slug', 'slug', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (os: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbPut<T extends { id: string }>(
  store: StoreName,
  value: T,
): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (os) => os.put(value));
}

export function idbDelete(store: StoreName, id: string): Promise<undefined> {
  return tx(store, 'readwrite', (os) => os.delete(id));
}

export function idbAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (os) => os.getAll() as IDBRequest<T[]>);
}

export function idbBySlug<T>(store: StoreName, slug: string): Promise<T[]> {
  return tx(
    store,
    'readonly',
    (os) => os.index('slug').getAll(slug) as IDBRequest<T[]>,
  );
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
