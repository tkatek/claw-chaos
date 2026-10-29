/*
 * CLAW CHAOS - versioned progress storage with safe fallback.
 * Saves highest unlocked level, best score and best stars per level.
 * Falls back to an in-memory copy when localStorage is unavailable or corrupt.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const KEY = "claw-chaos/progress";
  const VERSION = 1;

  function defaults() {
    return { v: VERSION, unlockedLevel: 1, best: {} }; // best[levelId] = {score, stars}
  }

  function sanitize(data) {
    const out = defaults();
    if (!data || typeof data !== "object") return out;
    if (Number.isInteger(data.unlockedLevel) && data.unlockedLevel >= 1 && data.unlockedLevel <= 15) {
      out.unlockedLevel = data.unlockedLevel;
    }
    if (data.best && typeof data.best === "object") {
      for (const k in data.best) {
        const lv = parseInt(k, 10);
        const b = data.best[k];
        if (Number.isInteger(lv) && lv >= 1 && lv <= 15 && b && typeof b === "object") {
          out.best[lv] = {
            score: Number.isFinite(b.score) ? Math.max(0, Math.floor(b.score)) : 0,
            stars: Number.isInteger(b.stars) ? Math.min(3, Math.max(0, b.stars)) : 0
          };
        }
      }
    }
    return out;
  }

  const env = (typeof globalThis !== "undefined") ? globalThis : (function () { return this; })();

  const Storage = {
    available: (function () {
      try {
        const t = "__cc_probe__";
        env.localStorage.setItem(t, "1");
        env.localStorage.removeItem(t);
        return true;
      } catch (e) { return false; }
    })(),
    _memory: null,

    load: function () {
      if (this.available) {
        try {
          const raw = env.localStorage.getItem(KEY);
          if (raw) return sanitize(JSON.parse(raw));
        } catch (e) { /* corrupt or blocked: fall through to defaults */ }
      }
      if (this._memory) return sanitize(this._memory);
      return defaults();
    },

    save: function (progress) {
      const clean = sanitize(progress);
      clean.v = VERSION;
      this._memory = JSON.parse(JSON.stringify(clean));
      if (this.available) {
        try { env.localStorage.setItem(KEY, JSON.stringify(clean)); return true; }
        catch (e) { return false; }
      }
      return false;
    },

    // Record a finished attempt; returns the updated progress.
    recordResult: function (progress, result) {
      const next = sanitize(progress);
      if (result.success) {
        next.unlockedLevel = Math.max(next.unlockedLevel, Math.min(15, result.levelId + 1));
        const prev = next.best[result.levelId] || { score: 0, stars: 0 };
        next.best[result.levelId] = {
          score: Math.max(prev.score, result.score),
          stars: Math.max(prev.stars, result.stars)
        };
      }
      this.save(next);
      return next;
    },

    reset: function () {
      this._memory = null;
      if (this.available) {
        try { env.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      }
    }
  };

  CC.Storage = Storage;
  return Storage;
});
