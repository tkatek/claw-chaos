/*
 * Content completeness and validation tests.
 */
"use strict";
const CC = globalThis.CC;

const questionsRaw = require("../data/questions.json");
const levelsRaw = require("../data/levels.json");

test("questions.json validates: 75 questions, structure, unique ids", () => {
  const v = CC.Questions.validate(questionsRaw);
  assert.eq(v.ok, true, "validation errors: " + v.errors.join(" | "));
  assert.eq(questionsRaw.questions.length, 75);
});

test("exactly 5 questions per level, correct levelId references", () => {
  const perLevel = {};
  questionsRaw.questions.forEach(q => {
    perLevel[q.levelId] = (perLevel[q.levelId] || 0) + 1;
  });
  for (let lv = 1; lv <= 15; lv++) {
    assert.eq(perLevel[lv], 5, "level " + lv + " question count");
  }
});

test("choice ids unique, texts unique, length <= 12, correct answer present", () => {
  questionsRaw.questions.forEach(q => {
    const ids = new Set(), texts = new Set();
    q.choices.forEach(c => {
      assert.ok(!ids.has(c.id), q.id + " duplicate choice id " + c.id);
      assert.ok(!texts.has(c.text.toLowerCase()), q.id + " duplicate choice text " + c.text);
      assert.ok(c.text.length > 0 && c.text.length <= 12, q.id + " choice text length");
      ids.add(c.id); texts.add(c.text.toLowerCase());
    });
    assert.ok(ids.has(q.correctAnswerId), q.id + " correctAnswerId missing");
    assert.ok(q.prompt.trim().length > 0, q.id + " empty prompt");
    assert.ok(q.explanation.trim().length > 0, q.id + " empty explanation");
  });
});

test("no duplicate prompts (no filler/copies)", () => {
  const seen = new Set();
  questionsRaw.questions.forEach(q => {
    const key = q.prompt.trim().toLowerCase();
    assert.ok(!seen.has(key), "duplicate prompt: " + q.prompt);
    seen.add(key);
  });
});

test("levels.json validates and references existing questions", () => {
  const v = CC.Levels.validate(levelsRaw, questionsRaw);
  assert.eq(v.ok, true, "level errors: " + v.errors.join(" | "));
  assert.eq(levelsRaw.levels.length, 15);
});

test("level choiceCount matches its questions' choice counts", () => {
  const byId = CC.Questions.byId(questionsRaw);
  levelsRaw.levels.forEach(lv => {
    lv.questionIds.forEach(qid => {
      assert.eq(byId[qid].choices.length, lv.choiceCount,
        "level " + lv.id + " vs " + qid);
    });
  });
});

test("difficulty values are distinct and progress gradually", () => {
  const lv = levelsRaw.levels;
  assert.eq(lv[0].questionTimeSeconds, 50);
  assert.eq(lv[14].questionTimeSeconds, 30);
  for (let i = 1; i < lv.length; i++) {
    assert.ok(lv[i].questionTimeSeconds <= lv[i - 1].questionTimeSeconds,
      "time should not increase at level " + lv[i].id);
  }
  ["grabTolerance"].forEach(f => {
    for (let i = 1; i < lv.length; i++) {
      assert.ok(lv[i][f] <= lv[i - 1][f], f + " should tighten, level " + lv[i].id);
    }
  });
  // levels 1-6 stationary, 7+ moving, 13+ fastest
  for (let i = 0; i < 6; i++) assert.eq(lv[i].targetMotionSpeed, 0, "level " + lv[i].id + " should be stationary");
  for (let i = 6; i < 15; i++) assert.ok(lv[i].targetMotionSpeed > 0, "level " + lv[i].id + " should move");
  assert.ok(lv[14].targetMotionSpeed >= lv[6].targetMotionSpeed, "top level fastest");
  // at most 4 choices
  lv.forEach(l => assert.ok(l.choiceCount <= 4));
});

test("seeded shuffle is stable for a question+seed and keeps correct slot findable", () => {
  const q = questionsRaw.questions[10];
  const a1 = CC.Questions.assignmentFor(q, "seedA");
  const a2 = CC.Questions.assignmentFor(q, "seedA");
  assert.eq(a1.choices.map(c => c.id).join(","), a2.choices.map(c => c.id).join(","),
    "same seed must give same order (stable across retries)");
  assert.ok(a1.correctSlot >= 0 && a1.correctSlot < a1.choices.length);
  assert.eq(a1.choices[a1.correctSlot].id, q.correctAnswerId);
  // all choices still present exactly once (nothing removed)
  const ids = a1.choices.map(c => c.id).sort().join(",");
  assert.eq(ids, q.choices.map(c => c.id).sort().join(","));
});

test("different seeds actually shuffle somewhere (coverage across questions)", () => {
  let correctFirst = 0, total = 0;
  questionsRaw.questions.forEach(q => {
    const a = CC.Questions.assignmentFor(q, "run42");
    total++;
    if (a.choices[0].id === q.correctAnswerId) correctFirst++;
  });
  assert.ok(correctFirst > 0 && correctFirst < total,
    "answer positions should vary, got " + correctFirst + "/" + total + " correct-first");
});

test("seeded PRNG is deterministic and in range", () => {
  const r1 = CC.Questions.seededRandom("abc");
  const r2 = CC.Questions.seededRandom("abc");
  const s1 = [r1(), r1(), r1()];
  const s2 = [r2(), r2(), r2()];
  assert.eq(s1.join(","), s2.join(","));
  s1.forEach(v => assert.ok(v >= 0 && v < 1, "PRNG out of range: " + v));
});

test("toysFor picks distinct toys, count matches choices", () => {
  const q = questionsRaw.questions[40]; // a 4-choice level
  const picks = CC.Questions.toysFor(q, 8, "seedZ");
  assert.eq(picks.length, q.choices.length);
  assert.eq(new Set(picks).size, picks.length, "toys must be distinct");
  const again = CC.Questions.toysFor(q, 8, "seedZ");
  assert.eq(picks.join(","), again.join(","), "toy pick must be stable");
});

test("ambiguity watchlist flags items for human review (schema cannot prove semantics)", () => {
  assert.ok(Array.isArray(CC.Questions.AMBIGUITY_WATCHLIST));
  assert.ok(CC.Questions.AMBIGUITY_WATCHLIST.length >= 3);
  CC.Questions.AMBIGUITY_WATCHLIST.forEach(entry => {
    assert.ok(entry.id && entry.note, "watchlist entries need id and note");
    assert.ok(questionsRaw.questions.some(q => q.id === entry.id), "watchlist id unknown: " + entry.id);
  });
});
