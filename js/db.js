/* db.js — tiny IndexedDB wrapper. All personal data lives here, on-device only. */
(function (global) {
  "use strict";

  const DB_NAME = "workoutApp";
  const DB_VERSION = 1;
  const STORES = {
    profile: { keyPath: "id" },      // single record id:"me"
    bodyweight: { keyPath: "date" }, // date: "YYYY-MM-DD", kg: number
    logs: { keyPath: "key" },        // key: "YYYY-MM-DD|Exercise", sets:[...]
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
    async importAll(data) {
      for (const name of Object.keys(STORES)) {
        if (!Array.isArray(data[name])) continue;
        for (const rec of data[name]) await DB.put(name, rec);
      }
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
