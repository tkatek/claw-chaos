/*
 * Storage resilience: corrupt data, throwing storage, unavailable storage.
 * Loads fresh copies of storage.js against fake globalThis.localStorage.
 */
"use strict";
const path = require("path");
const STORAGE_PATH = require.resolve("../js/storage.js");

function freshStorage(localStorageValue) {
  delete require.cache[STORAGE_PATH];
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const prevLS = globalThis.localStorage;
  const prevCC = globalThis.CC;
  globalThis.CC = {};
  if (localStorageValue === undefined) {
    try { delete globalThis.localStorage; } catch (e) { /* ignore */ }
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageValue, configurable: true, writable: true
    });
  }
  try {
    return require(STORAGE_PATH);
  } finally {
    if (localStorageValue === undefined) {
      // restore whatever was there before (tests run under plain node: none)
      if (hadOwn) {
        Object.defineProperty(globalThis, "localStorage", {
          value: prevLS, configurable: true, writable: true
        });
      } else {
        try { delete globalThis.localStorage; } catch (e) { /* ignore */ }
      }
    }
    globalThis.CC = prevCC;
  }
}

function makeLS(initial, failMode) {
  const store = Object.assign(Object.create(null), initial || {});
  return {
    getItem(k) {
      if (failMode === "get") throw new Error("quota");
      return (k in store) ? store[k] : null;
    },
    setItem(k, v) {
      if (failMode === "set") throw new Error("quota");
      store[k] = String(v);
    },
    removeItem(k) { if (failMode === "del") throw new Error("nope"); delete store[k]; },
    clear() { for (const k in store) delete store[k]; }
  };
}

test("defaults when nothing saved", () => {
  const S = freshStorage(makeLS());
  const p = S.load();
  assert.eq(p.v, 1);
  assert.eq(p.unlockedLevel, 1);
  assert.ok(!Object.keys(p.best).length);
});

test("corrupt JSON in storage falls back to defaults", () => {
  const S = freshStorage(makeLS({ "claw-chaos/progress": "{not json" }));
  const p = S.load();
  assert.eq(p.unlockedLevel, 1);
});

test("wrong-shape saved data is sanitized, valid parts kept", () => {
  const S = freshStorage(makeLS({
    "claw-chaos/progress": JSON.stringify({
      v: 99, unlockedLevel: "seven", best: { 2: { score: "x", stars: 9 }, junk: 1 }
    })
  }));
  const p = S.load();
  assert.eq(p.unlockedLevel, 1, "invalid unlock discarded");
  assert.eq(p.best[2].stars, 3, "stars clamped to 0..3");
  assert.eq(p.best[2].score, 0);
  assert.ok(!p.best.junk, "non-numeric level keys dropped");
});

test("save and reload round-trips", () => {
  const S = freshStorage(makeLS());
  S.recordResult({ unlockedLevel: 1, best: {} },
    { success: true, stars: 3, score: 640, hearts: 3, levelId: 1 });
  const p = S.load();
  assert.eq(p.unlockedLevel, 2);
  assert.eq(p.best[1].score, 640);
  assert.eq(p.best[1].stars, 3);
  assert.eq(p.v, 1);
});

test("throwing localStorage: probe reports unavailable, memory fallback works", () => {
  const S = freshStorage(makeLS({}, "set"));
  assert.eq(S.available, false, "setItem throws during probe -> unavailable");
  const okSave = S.save({ unlockedLevel: 3, best: { 2: { score: 10, stars: 1 } } });
  assert.eq(okSave, false, "setItem throws -> report not persisted");
  // in-memory fallback keeps the data alive for this session
  const p = S.load();
  assert.eq(p.unlockedLevel, 3, "memory fallback returns saved data");
  assert.eq(p.best[2].score, 10);
});

test("getItem throwing: defaults returned, nothing crashes", () => {
  const S = freshStorage(makeLS({}, "get"));
  const p = S.load();
  assert.eq(p.unlockedLevel, 1);
});

test("recordResult never reduces progress", () => {
  const S = freshStorage(makeLS());
  let p = S.recordResult({ unlockedLevel: 5, best: {} },
    { success: true, stars: 1, score: 100, hearts: 1, levelId: 3 });
  assert.eq(p.unlockedLevel, 5, "unlock level never goes down");
});
