/* db.js — tiny IndexedDB wrapper. All personal data lives here, on-device only. */
(function (global) {
  "use strict";

  const DB_NAME = "workoutApp";
  const DB_VERSION = 1;
  const STORES = {
    profile: { keyPath: "id" },      // single record id:"me"
    bodyweight: { keyPath: "date" }, // date: "YYYY-MM-DD", kg: number
    logs: { keyPath: "key" },        // key: "YYYY-MM-DD|idx|Exercise", sets:[...]
  };

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const DB = {
    get: (store, key) => tx(store, "readonly").then((s) => wrap(s.get(key))),
    getAll: (store) => tx(store, "readonly").then((s) => wrap(s.getAll())),
    put: (store, value) => tx(store, "readwrite").then((s) => wrap(s.put(value))),
    del: (store, key) => tx(store, "readwrite").then((s) => wrap(s.delete(key))),

    // Full backup / restore (Settings → export/import JSON).
    async exportAll() {
      const out = { version: DB_VERSION, exported: new Date().toISOString() };
      for (const name of Object.keys(STORES)) out[name] = await DB.getAll(name);
      return out;
    },
    // One transaction per store. Records missing their keyPath, or whose key is an
    // invalid IndexedDB type (put throws synchronously), are skipped and counted —
    // one bad record can't abort the store or the remaining stores.
    async importAll(data) {
      const db = await open();
      let imported = 0, skipped = 0;
      for (const [name, opts] of Object.entries(STORES)) {
        const arr = data[name];
        if (!Array.isArray(arr)) continue;
        const candidates = arr.filter((r) => r && typeof r === "object" && r[opts.keyPath] != null);
        skipped += arr.length - candidates.length;
        await new Promise((resolve, reject) => {
          const t = db.transaction(name, "readwrite");
          t.oncomplete = resolve;
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error("import aborted: " + name));
          const store = t.objectStore(name);
          candidates.forEach((r) => { try { store.put(r); imported++; } catch { skipped++; } });
        });
      }
      return { imported, skipped };
    },
    async clearAll() {
      const db = await open();
      await Promise.all(
        Object.keys(STORES).map(
          (name) =>
            new Promise((res, rej) => {
              const r = db.transaction(name, "readwrite").objectStore(name).clear();
              r.onsuccess = () => res();
              r.onerror = () => rej(r.error);
            })
        )
      );
    },
  };

  global.DB = DB;
})(window);
