/*
 * Gameplay rule tests: catches, outcomes, timers, pause, restart, stars.
 * Runs the authoritative game module head-less with fixed steps.
 */
"use strict";
const CC = globalThis.CC;

const questionsRaw = require("../data/questions.json");
const levelsRaw = require("../data/levels.json");
const levelById = CC.Levels.byId(levelsRaw);

// Mirrors Renderer.computeLayout for a synthetic 1000 x 800 world.
function makeLayout(n) {
  const worldW = 1000, worldH = 800;
  const laneW = worldW / n;
  const toyHeight = Math.min(worldH * 0.60, laneW * 1.45);
  const clawHeadWorldH = 124;
  const toyRowBottomY = worldH * 0.985;
  const railY = worldH * 0.115;
  const captureGripY = toyRowBottomY - toyHeight + toyHeight * 0.06;
  return {
    worldW, worldH, railY, toyRowBottomY, toyHeight, clawHeadWorldH,
    captureY: captureGripY - clawHeadWorldH, collectX: 500
  };
}

function makeGame(levelId, seed) {
  const g = new CC.Game({
    level: levelById[levelId],
    questionsRaw: questionsRaw,
    layout: makeLayout(levelById[levelId].choiceCount),
    seedText: seed || "test"
  });
  g.begin();
  return g;
}

function makeInput() {
  let pending = false;
  return {
    dir: 0,
    drop() { pending = true; },
    consumeDrop() { if (pending) { pending = false; return true; } return false; },
    clearDrop() { pending = false; }
  };
}

const DT = 1 / 120;

function step(g, inp, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) g.update(DT, inp);
}

function runUntil(g, inp, states, maxSeconds) {
  const want = new Set(states);
  const n = Math.round((maxSeconds || 12) / DT);
  for (let i = 0; i < n; i++) {
    g.update(DT, inp);           // advance first so a queued drop is consumed
    if (want.has(g.state)) return g.state;
  }
  return g.state;
}

function correctToy(g) {
  return g.toys.find(t => t.choiceId === g.question.correctAnswerId);
}
function wrongToy(g) {
  return g.toys.find(t => t.choiceId !== g.question.correctAnswerId);
}

function snapshot(g) {
  return JSON.stringify({
    state: g.state, claw: { x: g.claw.x, y: g.claw.y, pose: g.claw.pose },
    timeLeft: g.timeLeft, graceLeft: g.graceLeft, score: g.score,
    hearts: g.hearts, streak: g.streak, q: g.qIndex,
    toys: g.toys.map(t => [t.x, t.y, t.carried, t.collected])
  });
}

// ---------------------------------------------------------------- catches ---

test("valid catch: aligned drop on the correct toy scores 100 + 20 first drop", () => {
  const g = makeGame(1), inp = makeInput();
  const t = correctToy(g);
  g.claw.x = t.x;                       // perfectly aligned
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "correct");
  assert.eq(g.feedback.gained, 120, "100 + 20 first-drop bonus, no streak yet");
  assert.eq(g.score, 120);
  assert.eq(g.hearts, 3);
  assert.eq(g.correctCount, 1);
  // the correct toy is collected and gone
  assert.eq(t.collected, true);
});

test("wrong catch: lose one heart, restore toy, retry same question, no +20 next time", () => {
  const g = makeGame(1), inp = makeInput();
  const before = wrongToy(g);
  const beforeX = before.x, beforeY = before.y;
  const q = g.question;
  g.claw.x = before.x;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "wrong");
  assert.eq(g.hearts, 2, "one heart lost");
  assert.eq(g.score, 0);
  assert.eq(g.streak, 0);
  assert.eq(before.x, beforeX, "toy restored to lane x");
  assert.eq(before.y, beforeY, "toy restored to row y");
  assert.eq(before.carried, false);
  runUntil(g, inp, ["AIMING"]);
  assert.eq(g.qIndex, 0, "same question retried");
  assert.eq(g.question.id, q.id);
  // remaining aiming time was preserved (minus feedback duration freeze)
  assert.ok(g.timeLeft <= 50 && g.timeLeft > 47, "remaining time kept, got " + g.timeLeft);
  assert.eq(g.graceLeft, 0, "no reading grace after a wrong attempt");
  // now catch correctly: no first-drop bonus anymore
  const t = correctToy(g);
  g.claw.x = t.x;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "correct");
  assert.eq(g.feedback.gained, 100, "first-attempt bonus consumed by the wrong drop");
});

test("empty grab: no heart loss, streak reset, -2s, retry; distant toy not auto-snapped", () => {
  const g = makeGame(1), inp = makeInput();
  // build some streak first via two correct catches
  for (let i = 0; i < 2; i++) {
    const t = correctToy(g);
    g.claw.x = t.x;
    inp.drop();
    runUntil(g, inp, ["AIMING", "RESULTS"]);
  }
  assert.eq(g.streak, 2);
  const timeBefore = g.timeLeft;
  // level 1, 3 lanes: dead center of a gap misses every capture zone
  g.claw.x = 1000 / 3;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "empty");
  assert.eq(g.hearts, 3, "no heart lost on empty");
  assert.eq(g.streak, 0);
  assert.almost(g.timeLeft, Math.max(0, timeBefore - 2), 1e-6, "2 second penalty");
  runUntil(g, inp, ["AIMING"]);
  assert.eq(g.qIndex, 2, "same question retried (third of five)");
  // nearest toys stay in place: nobody teleported toward the claw
  g.toys.forEach(t => assert.eq(t.carried, false));
});

test("empty grab between OUTER lanes does not catch outermost toy (no snap)", () => {
  const g = makeGame(2, "gap"), inp = makeInput(); // 3 choices, tolerance .45
  const zone = (1000 / 3) * 0.45;                  // half-width of a capture zone
  const lane0 = 1000 / 6, lane1 = 1000 / 2;
  const gapX = (lane0 + zone + lane1 - zone) / 2;  // middle of the gap
  g.claw.x = gapX;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "empty");
});

test("capture detection is deterministic: overlap, ties by distance then lane", () => {
  const layout = makeLayout(3);
  const mk = (slot, x) => ({
    slot, laneCount: 3, x, y: 0, carried: false, collected: false,
    layout,
    laneWidth() { return layout.worldW / 3; },
    captureHalfWidth(tol) { return this.laneWidth() * tol; }
  });
  const toys = [mk(0, 200), mk(1, 520), mk(2, 830)];
  const tol = 0.40;
  assert.ok(CC.Toys.findCatch(toys, 200, tol), "direct hit catches");
  assert.ok(CC.Toys.findCatch(toys, 200 + 133.3 * 0.4 - 0.01, tol), "edge of zone catches");
  assert.eq(CC.Toys.findCatch(toys, 360, tol), null, "mid-gap misses");
  // tie: two toys equidistant -> lowest slot wins
  const tied = [mk(1, 500), mk(0, 400)];
  const caught = CC.Toys.findCatch(tied, 450, 0.2); // both within 100u
  assert.ok(caught, "tie should still catch someone");
  assert.eq(caught.slot, 0, "deterministic tie-break: lowest lane");
  // carried toys are not eligible
  const carried = mk(0, 200); carried.carried = true;
  assert.eq(CC.Toys.findCatch([carried], 200, tol), null);
});

test("moving targets: capture uses the position at capture time (level 7)", () => {
  const g = makeGame(7, "moving"), inp = makeInput();
  const t = correctToy(g);
  // track the toy while aiming, then stop tracking during descent: the claw
  // must resolve against where the toy actually is when it arrives
  let expected = null;
  let dropped = false;
  for (let i = 0; i < 12000; i++) {
    if (g.state === "AIMING") {
      g.claw.x = t.x;
      if (!dropped && i > 60) { inp.drop(); dropped = true; }
    }
    if (g.state === "GRABBING" && expected === null) {
      const grip = g.claw.gripPoint();
      const caught = CC.Toys.findCatch(g.toys, grip.x, g.level.grabTolerance);
      expected = caught ? caught.choiceId : null;
    }
    if (g.state === "FEEDBACK" && expected !== null) {
      const got = g.feedback.kind;
      if (expected === null) assert.eq(got, "empty", "no overlap at arrival = empty");
      else if (expected === g.question.correctAnswerId) assert.eq(got, "correct");
      else assert.eq(got, "wrong");
      return;
    }
    g.update(DT, inp);
  }
  throw new Error("never reached feedback in moving-target test");
});

test("moving toys stay inside their own lanes and keep moving during descent", () => {
  const g = makeGame(7, "lanes"), inp = makeInput();
  const laneW = 1000 / 4;
  const within = t => {
    const c = laneW * (t.slot + 0.5);
    return t.x > c - laneW / 2 && t.x < c + laneW / 2;
  };
  let movedDuringDescent = false;
  let lastX = null;
  for (let i = 0; i < 7200; i++) {
    g.update(DT, inp);
    assert.ok(g.toys.every(within), "toy left its lane");
    if (g.state === "DESCENDING") {
      const x0 = g.toys[0].x;
      if (lastX !== null && Math.abs(x0 - lastX) > 1e-9) movedDuringDescent = true;
      lastX = x0;
    }
    if (i === 3000) { g.claw.x = 500; inp.drop(); }
    if (g.state === "FEEDBACK") break;
  }
  assert.ok(movedDuringDescent, "targets should keep moving during descent");
});

// ------------------------------------------------------------- exactly once ---

test("outcome applied exactly once per grab (event + score accounting)", () => {
  const g = makeGame(1, "once"), inp = makeInput();
  let events = 0;
  g.events.on(() => events++);
  const base = events;
  const t = correctToy(g);
  g.claw.x = t.x;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  const scoreAtFeedback = g.score;
  const heartsAtFeedback = g.hearts;
  assert.eq(scoreAtFeedback, 120);
  step(g, inp, 1); // extra steps within feedback must not re-apply
  assert.eq(g.score, scoreAtFeedback);
  assert.eq(g.hearts, heartsAtFeedback);
  runUntil(g, inp, ["AIMING"]);
  assert.eq(g.qIndex, 1);
});

test("spammed DROP during a grab cycle starts exactly one cycle", () => {
  const g = makeGame(1, "spam"), inp = makeInput();
  const t = correctToy(g);
  g.claw.x = t.x;
  // hold the drop key down the whole time
  let spam = true;
  const origConsume = inp.consumeDrop;
  inp.consumeDrop = function () { if (spam) this.drop(); return origConsume.call(this); };
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.attempts, 1, "one DROP accepted, others ignored during the cycle");
  assert.eq(g.feedback.kind, "correct");
  inp.consumeDrop = origConsume;
});

// ------------------------------------------------------------------ timers ---

test("reading grace: 2s countdown-free window on a NEW question only in AIMING", () => {
  const g = makeGame(1, "grace"), inp = makeInput();
  assert.almost(g.graceLeft, 2.0, 1e-9);
  const t0 = g.timeLeft;
  step(g, inp, 1.0); // inside grace
  assert.almost(g.timeLeft, t0, 1e-6, "timer frozen during grace");
  assert.almost(g.graceLeft, 1.0, 0.01);
  step(g, inp, 1.05); // grace expired
  assert.ok(g.timeLeft < t0, "timer runs after grace");
});

test("timer frozen during claw motion and feedback", () => {
  const g = makeGame(1, "frozen"), inp = makeInput();
  const t = correctToy(g);
  g.claw.x = t.x;
  step(g, inp, 2.05); // consume grace first
  inp.drop();
  const atDescend = runUntil(g, inp, ["DESCENDING"], 1);
  assert.eq(atDescend, "DESCENDING");
  const t1 = g.timeLeft;
  step(g, inp, 0.5);
  assert.almost(g.timeLeft, t1, 1e-9, "no countdown while descending");
  runUntil(g, inp, ["FEEDBACK"]);
  const t2 = g.timeLeft;
  step(g, inp, 0.5);
  assert.almost(g.timeLeft, t2, 1e-9, "no countdown during feedback");
});

test("timeout: one heart lost, fresh timer, same question, grace NOT renewed", () => {
  const g = makeGame(1, "timeout"), inp = makeInput();
  const q = g.question;
  g.graceLeft = 0;
  g.timeLeft = 0.05;
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.kind, "timeout");
  assert.eq(g.hearts, 2);
  assert.eq(g.streak, 0);
  runUntil(g, inp, ["AIMING"]);
  assert.eq(g.question.id, q.id, "same question after timeout");
  assert.eq(g.qIndex, 0);
  assert.almost(g.timeLeft, 50, 1e-6, "fresh question timer");
  assert.eq(g.graceLeft, 0, "no reading grace after timeout");
});

test("repeated time-outs end the level in failure (one event per expiry)", () => {
  const g = makeGame(1, "timeout3"), inp = makeInput();
  let timeouts = 0;
  for (let round = 0; round < 3; round++) {
    g.graceLeft = 0;
    g.timeLeft = 0.05;
    const st = runUntil(g, inp, ["FEEDBACK", "RESULTS"], 5);
    if (st === "FEEDBACK" && g.feedback.kind === "timeout") timeouts++;
    if (g.state === "RESULTS") break;
    runUntil(g, inp, ["AIMING"], 5);
  }
  assert.eq(timeouts, 3, "three hearts fall to three timeouts");
  assert.eq(g.state, "RESULTS");
  assert.eq(g.result.success, false);
  assert.eq(g.result.stars, 0, "no completion stars on failure");
  assert.eq(g.hearts, 0);
});

// ------------------------------------------------------------------- pause ---

test("pause freezes every motion phase exactly; resume continues without teleport/skip", () => {
  const phases = ["AIMING", "DESCENDING", "GRABBING", "ASCENDING", "DELIVERING", "FEEDBACK"];
  phases.forEach(phase => {
    const g = makeGame(1, "p" + phase), inp = makeInput();
    // grace off so the timer is meaningful
    g.graceLeft = 0;
    const t = phase === "FEEDBACK" || phase === "DELIVERING" || phase === "ASCENDING" ||
              phase === "GRABBING" || phase === "DESCENDING" ? correctToy(g) : correctToy(g);
    g.claw.x = t.x;
    if (phase !== "AIMING") inp.drop();
    const reached = runUntil(g, inp, [phase], 8);
    assert.eq(reached, phase, "should reach " + phase);
    if (phase === "AIMING") { /* stayed */ }
    if (phase === "FEEDBACK") { /* feedback of correct */ }
    const before = snapshot(g);
    g.pause(false);
    step(g, inp, 5.0); // paused updates are ignored
    assert.eq(snapshot(g), before, phase + ": paused state must not change");
    g.resume();
    const afterResume = snapshot(g);
    assert.eq(afterResume, before, phase + ": resume must not teleport or skip");
    // and the game continues normally afterwards
    const st = runUntil(g, inp, ["AIMING", "RESULTS"], 10);
    assert.ok(st === "AIMING" || st === "RESULTS", phase + ": game continues after resume");
  });
});

test("pause preserves carried toy and score; no duplicate score after resume", () => {
  const g = makeGame(1, "carry"), inp = makeInput();
  const t = correctToy(g);
  g.claw.x = t.x;
  inp.drop();
  runUntil(g, inp, ["ASCENDING"]);
  assert.eq(t.carried, true);
  g.pause(false);
  const s0 = snapshot(g);
  step(g, inp, 2);
  assert.eq(snapshot(g), s0);
  g.resume();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.score, 120);
  assert.eq(g.hearts, 3);
});

// ---------------------------------------------------------------- restarts ---

test("restart: fresh game instance has clean state (hearts, score, question 1)", () => {
  const g1 = makeGame(3, "a"), inp = makeInput();
  g1.claw.x = wrongToy(g1).x;
  inp.drop();
  runUntil(g1, inp, ["AIMING"], 8);
  assert.eq(g1.hearts, 2);
  const g2 = makeGame(3, "a"); // same config = same layout, fresh attempt
  assert.eq(g2.hearts, 3);
  assert.eq(g2.score, 0);
  assert.eq(g2.streak, 0);
  assert.eq(g2.qIndex, 0);
  assert.eq(g2.state, "AIMING");
});

// ------------------------------------------------------- scoring and streak ---

test("streak bonus: +10 x min(streak-1,4) increments across consecutive corrects", () => {
  const g = makeGame(1, "streak"), inp = makeInput();
  const gains = [];
  for (let q = 0; q < 5; q++) {
    const t = correctToy(g);
    g.claw.x = t.x;
    inp.drop();
    runUntil(g, inp, ["FEEDBACK"]);
    gains.push(g.feedback.gained);
    runUntil(g, inp, ["AIMING", "RESULTS"], 10);
  }
  assert.eq(g.state, "RESULTS");
  assert.eq(g.result.success, true);
  assert.eq(g.result.stars, 3, "3 hearts left = 3 stars");
  assert.eq(gains[0], 120, "first: 100 + 20 + 0");
  assert.eq(gains[1], 130, "second: 100 + 20 + 10");
  assert.eq(gains[2], 140, "third: 100 + 20 + 20");
  assert.eq(gains[3], 150, "fourth: 100 + 20 + 30");
  assert.eq(gains[4], 160, "fifth: 100 + 20 + 40");
  assert.eq(g.score, 700);
});

test("streak resets on wrong and empty, caps at +40", () => {
  const g = makeGame(2, "cap"), inp = makeInput();
  for (let q = 0; q < 4; q++) {
    const t = correctToy(g);
    g.claw.x = t.x;
    inp.drop();
    runUntil(g, inp, ["AIMING", "RESULTS"], 10);
  }
  assert.eq(g.streak, 4);
  // empty grab resets the streak
  g.claw.x = 1000 / 3;
  inp.drop();
  runUntil(g, inp, ["AIMING"], 8);
  assert.eq(g.streak, 0);
  // next correct catch: streak back to 1 (no bonus) and the first-attempt
  // bonus was already consumed by the empty grab -> plain 100
  const t = correctToy(g);
  g.claw.x = t.x;
  inp.drop();
  runUntil(g, inp, ["FEEDBACK"]);
  assert.eq(g.feedback.gained, 100, "streak bonus reset and first-attempt bonus consumed");
  // that catch also completes the level (5 correct)
  runUntil(g, inp, ["AIMING", "RESULTS"], 10);
  assert.eq(g.state, "RESULTS");
});

test("stars equal remaining hearts: 2 hearts -> 2 stars", () => {
  const g = makeGame(1, "stars2"), inp = makeInput();
  // one wrong catch (heart to 2), then five correct
  g.claw.x = wrongToy(g).x;
  inp.drop();
  runUntil(g, inp, ["AIMING"], 8);
  for (let q = 0; q < 5; q++) {
    const t = correctToy(g);
    g.claw.x = t.x;
    inp.drop();
    runUntil(g, inp, ["AIMING", "RESULTS"], 10);
  }
  assert.eq(g.state, "RESULTS");
  assert.eq(g.result.success, true);
  assert.eq(g.result.hearts, 2);
  assert.eq(g.result.stars, 2);
});

test("unlocking: only a successful finish unlocks the next level", () => {
  const S = CC.Storage;
  let p = { unlockedLevel: 1, best: {} };
  p = S.recordResult(p, { success: false, stars: 0, score: 300, hearts: 0, levelId: 1 });
  assert.eq(p.unlockedLevel, 1, "failure must not unlock");
  p = S.recordResult(p, { success: true, stars: 2, score: 500, hearts: 2, levelId: 1 });
  assert.eq(p.unlockedLevel, 2);
  assert.eq(p.best[1].score, 500);
  assert.eq(p.best[1].stars, 2);
  p = S.recordResult(p, { success: true, stars: 1, score: 300, hearts: 1, levelId: 1 });
  assert.eq(p.best[1].score, 500, "best score kept");
  assert.eq(p.best[1].stars, 2, "best stars kept");
  assert.ok(CC.Levels.isUnlocked(2, p.unlockedLevel));
  assert.ok(!CC.Levels.isUnlocked(3, p.unlockedLevel));
});

// ---------------------------------------------------------------- relayout ---

test("resize mid-grab: relayout preserves question, timer, toy state and carried toy", () => {
  const g = makeGame(1, "resize"), inp = makeInput();
  const t = correctToy(g);
  g.claw.x = t.x;
  inp.drop();
  runUntil(g, inp, ["ASCENDING"]);
  g.graceLeft = 0;
  step(g, inp, 0.2);
  const qId = g.question.id;
  const time = g.timeLeft;
  const carriedToy = g.toys.find(x => x.carried);
  assert.ok(carriedToy, "toy carried mid-grab");
  const newX = carriedToy.x;

  const newLayout = makeLayout(3);
  newLayout.worldH = 950;
  newLayout.toyRowBottomY = 950 * 0.985;
  g.relayout(newLayout);

  assert.eq(g.question.id, qId, "question preserved");
  assert.almost(g.timeLeft, time, 1e-9, "timer preserved");
  const still = g.toys.find(x => x.carried);
  assert.ok(still === carriedToy, "carried toy identity preserved");
  assert.almost(still.x, newX, 0.5, "carried toy keeps following the claw");
  assert.eq(g.state, "ASCENDING", "grab not interrupted");
  // round continues to completion after resize
  const st = runUntil(g, inp, ["AIMING", "RESULTS"], 10);
  assert.ok(st === "AIMING" || st === "RESULTS");
  if (st === "AIMING") assert.eq(g.qIndex, 1, "advanced to next question");
});

test("claw reaches both outermost lanes", () => {
  const g = makeGame(4, "edges"), inp = makeInput(); // 4 choices
  const left = g.toys[0], right = g.toys[g.toys.length - 1];
  [left, right].forEach(t => {
    g.claw.x = t.x;
    inp.drop();
    const st = runUntil(g, inp, ["FEEDBACK"], 8);
    assert.eq(st, "FEEDBACK");
    assert.ok(g.feedback.kind === "correct" || g.feedback.kind === "wrong",
      "outermost lane toy must be catchable, got " + g.feedback.kind);
    if (g.feedback.kind === "wrong") runUntil(g, inp, ["AIMING"], 8);
  });
});
