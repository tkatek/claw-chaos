/*
 * CLAW CHAOS - level configuration loading, validation and progression.
 * Pure logic: no DOM, no fetch. All tunable difficulty values live in
 * data/levels.json; this module only validates and indexes them.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const Levels = {};

  const NUM_FIELDS = [
    "questionTimeSeconds", "targetMotionSpeed", "targetMotionAmplitude",
    "grabTolerance", "clawHorizontalSpeed", "clawDescendSpeed", "clawAscendSpeed"
  ];

  // Validate levels.json against the question data (references + counts).
  Levels.validate = function (rawLevels, questionsRaw) {
    const errors = [];
    const list = Array.isArray(rawLevels && rawLevels.levels) ? rawLevels.levels : null;
    if (!list) return { ok: false, errors: ["levels.json: missing levels array"] };
    if (list.length !== 15)
      errors.push("expected 15 levels, found " + list.length);

    const questions = CC.Questions
      ? CC.Questions.byId(questionsRaw)
      : (() => { const m = Object.create(null); ((questionsRaw && questionsRaw.questions) || []).forEach(q => { m[q.id] = q; }); return m; })();

    const seen = new Set();
    const questionUse = new Map();

    list.forEach((lv, i) => {
      const where = "levels[" + i + "]";
      if (typeof lv.id !== "number" || lv.id < 1 || lv.id > 15)
        errors.push(where + ": id must be 1..15");
      else if (seen.has(lv.id)) errors.push(where + ": duplicate level id " + lv.id);
      else seen.add(lv.id);

      if (!String(lv.title || "").trim()) errors.push(where + ": missing title");

      if (!Array.isArray(lv.questionIds) || lv.questionIds.length !== 5)
        errors.push(where + ": needs exactly 5 questionIds");
      (lv.questionIds || []).forEach(qid => {
        const q = questions[qid];
        if (!q) { errors.push(where + ": unknown question id " + qid); return; }
        if (q.levelId !== lv.id)
          errors.push(where + ": question " + qid + " belongs to level " + q.levelId);
        if (questionUse.has(qid))
          errors.push(where + ": question " + qid + " reused in level " + questionUse.get(qid));
        else questionUse.set(qid, lv.id);
        if (Array.isArray(q.choices) && q.choices.length !== lv.choiceCount)
          errors.push(where + ": choiceCount " + lv.choiceCount + " != question " + qid + " choices " + q.choices.length);
      });

      NUM_FIELDS.forEach(f => {
        if (typeof lv[f] !== "number" || !isFinite(lv[f]) || lv[f] < 0)
          errors.push(where + ": bad numeric field " + f);
      });
      if (lv.grabTolerance > 0.5) errors.push(where + ": grabTolerance above 0.5");
      if (lv.questionTimeSeconds < 5) errors.push(where + ": questionTimeSeconds below 5");
    });

    // every level must be distinguishable: the full difficulty tuple is
    // unique, and within each field the non-zero values are distinct
    // (stationary levels legitimately share motion = 0).
    const tuples = new Set(list.map(lv => NUM_FIELDS.map(f => lv[f]).join(",")));
    if (tuples.size !== list.length)
      errors.push("some levels share identical difficulty configurations");
    NUM_FIELDS.forEach(field => {
      const nz = list.map(lv => lv[field]).filter(v => v > 0);
      if (new Set(nz).size !== nz.length)
        errors.push("field " + field + " repeats non-zero values");
    });

    return { ok: errors.length === 0, errors: errors };
  };

  Levels.byId = function (rawLevels) {
    const map = Object.create(null);
    ((rawLevels && rawLevels.levels) || []).forEach(lv => { map[lv.id] = lv; });
    return map;
  };

  Levels.order = function (rawLevels) {
    return ((rawLevels && rawLevels.levels) || []).slice().sort((a, b) => a.id - b.id);
  };

  // A level is playable when it is the first one or the previous one has
  // been completed (recorded in the saved progress).
  Levels.isUnlocked = function (levelId, highestUnlocked) {
    return levelId <= Math.max(1, highestUnlocked || 1);
  };

  CC.Levels = Levels;
  return Levels;
});
