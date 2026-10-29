/*
 * CLAW CHAOS - question validation, lookup and seeded answer shuffling.
 * Pure logic: no DOM, no fetch.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const Questions = {};

  // Deterministic PRNG (mulberry32) seeded from a string, so answer-slot
  // shuffling is reproducible in tests and stable across retries.
  Questions.seededRandom = function (seedText) {
    let h = 1779033703 ^ seedText.length;
    for (let i = 0; i < seedText.length; i++) {
      h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = (h ^= h >>> 16) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Stable display order for a question's choices. The mapping is derived
  // only from the question id + seed, so retries keep the same slots while
  // toy artwork stays independent of answer positions.
  Questions.assignmentFor = function (question, seedText) {
    const rand = Questions.seededRandom(question.id + "|" + (seedText || ""));
    const order = question.choices.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    return {
      // ordered [{id, text}], plus which display slot is correct
      choices: order,
      correctSlot: order.findIndex(c => c.id === question.correctAnswerId)
    };
  };

  // Deterministic toy pick per (question, seed): distinct toys, stable.
  Questions.toysFor = function (question, toyCount, seedText) {
    const rand = Questions.seededRandom("toys|" + question.id + "|" + (seedText || ""));
    const pool = [];
    for (let i = 0; i < toyCount; i++) pool.push(i);
    const picked = [];
    for (let n = question.choices.length; n > 0 && pool.length; n--) {
      const j = Math.floor(rand() * pool.length);
      picked.push(pool.splice(j, 1)[0]);
    }
    return picked;
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  // Schema validation of the parsed questions.json. Returns {ok, errors}.
  // NOTE: this proves structure only - whether an item is semantically
  // unambiguous is a human-review concern (see AMBIGUITY_WATCHLIST).
  Questions.validate = function (raw) {
    const errors = [];
    const list = Array.isArray(raw && raw.questions) ? raw.questions : null;
    if (!list) return { ok: false, errors: ["questions.json: missing questions array"] };

    const ids = new Set();
    const perLevel = new Map();
    list.forEach((q, i) => {
      const where = "questions[" + i + "]";

      if (!str(q.id)) errors.push(where + ": missing id");
      else if (ids.has(q.id)) errors.push(where + ": duplicate id " + q.id);
      else ids.add(q.id);

      if (typeof q.levelId !== "number" || q.levelId < 1 || q.levelId > 15)
        errors.push(where + ": levelId must be 1..15");

      if (!str(q.type)) errors.push(where + ": missing type");
      if (!str(q.prompt)) errors.push(where + ": missing prompt");

      if (!Array.isArray(q.choices) || q.choices.length < 2)
        errors.push(where + ": needs at least 2 choices");

      const labels = new Set();
      const texts = new Set();
      (q.choices || []).forEach((c, j) => {
        const cw = where + ".choices[" + j + "]";
        if (!str(c.id)) errors.push(cw + ": missing id");
        else if (labels.has(c.id)) errors.push(cw + ": duplicate choice id " + c.id);
        else labels.add(c.id);
        const t = str(c.text);
        if (!t) errors.push(cw + ": missing text");
        else {
          if (t.length > 12) errors.push(cw + ": text '" + t + "' longer than 12 chars");
          if (texts.has(t.toLowerCase())) errors.push(cw + ": duplicate choice text '" + t + "'");
          texts.add(t.toLowerCase());
        }
      });

      if (!labels.has(str(q.correctAnswerId)))
        errors.push(where + ": correctAnswerId '" + q.correctAnswerId + "' not among choices");
      if (!str(q.explanation)) errors.push(where + ": missing explanation");

      if (q.levelId >= 1) {
        if (!perLevel.has(q.levelId)) perLevel.set(q.levelId, []);
        perLevel.get(q.levelId).push(q);
      }
    });

    if (list.length !== 75)
      errors.push("expected 75 questions total, found " + list.length);
    for (let lv = 1; lv <= 15; lv++) {
      const qs = perLevel.get(lv) || [];
      if (qs.length !== 5)
        errors.push("level " + lv + ": expected exactly 5 questions, found " + qs.length);
      const counts = new Set(qs.map(q => q.choices.length));
      if (counts.size > 1)
        errors.push("level " + lv + ": inconsistent choice counts " + [...counts].join(","));
    }

    return { ok: errors.length === 0, errors: errors };
  };

  Questions.byId = function (raw) {
    const map = Object.create(null);
    ((raw && raw.questions) || []).forEach(q => { map[q.id] = q; });
    return map;
  };

  // Items whose single-defensible-answer guarantee relies on context that a
  // schema check cannot verify. Flagged for human review, not silently trusted.
  Questions.AMBIGUITY_WATCHLIST = [
    { id: "q005", note: "day/night assumes the common time-of-day reading" },
    { id: "q013", note: "fish can swim - flying fish excluded by beginner context" },
    { id: "q019", note: "calendar facts assumed (Gregorian, 12 months)" }
  ];

  CC.Questions = Questions;
  return Questions;
});
