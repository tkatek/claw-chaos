/*
 * CLAW CHAOS - authoritative game state, rules, timer, score, lives.
 * Pure logic, no DOM. Driven by fixed-step updates from main.js.
 *
 * States: LEVEL_READY -> AIMING -> DESCENDING -> GRABBING -> ASCENDING ->
 * DELIVERING -> FEEDBACK -> (AIMING | RESULTS), plus ERROR for load faults.
 * Pause is a frozen overlay on any in-play state.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const CLOSE_TIME = 0.22;        // claw closing phase (s)
  const FEEDBACK_TIME = { correct: 2.2, wrong: 1.8, empty: 1.2, timeout: 1.6 };
  const READING_GRACE = 2.0;      // seconds per NEW question only
  const EMPTY_GRAB_PENALTY = 2.0; // seconds deducted on empty grab
  const STREAK_BONUS_CAP = 4;

  function Game(opts) {
    this.level = opts.level;
    this.questionsRaw = opts.questionsRaw;
    this.questionsById = CC.Questions.byId(opts.questionsRaw);
    this.layout = opts.layout;
    this.seedText = opts.seedText || String(this.level.id);

    this.events = { list: [], on(fn) { this.list.push(fn); }, emit() { this.list.forEach(f => f()); } };

    this.state = "LEVEL_READY";
    this.paused = false;
    this.pausedFrom = null;
    this.autoPaused = false;

    this.hearts = 3;
    this.score = 0;
    this.streak = 0;
    this.correctCount = 0;

    this.qIndex = -1;
    this.question = null;
    this.assignment = null;
    this.toys = [];
    this.claw = new CC.Claw(this.level, this.layout);

    this.graceLeft = 0;
    this.timeLeft = 0;
    this.firstDropAvailable = true;
    this.grabTimer = 0;
    this.feedbackTimer = 0;
    this.feedback = null;         // {kind, gained?, correctChoiceId?}
    this.caught = null;
    this.result = null;           // set on RESULTS
    this.attempts = 0;            // drops performed (stats)
  }

  // ---- lifecycle ----------------------------------------------------------

  Game.prototype.begin = function () {
    if (this.state !== "LEVEL_READY") return;
    this.startQuestion(0);
    this.events.emit();
  };

  Game.prototype.startQuestion = function (index) {
    this.qIndex = index;
    this.question = this.questionsById[this.level.questionIds[index]];
    this.assignment = CC.Questions.assignmentFor(this.question, this.seedText);
    const toyIndexes = CC.Questions.toysFor(
      this.question, CC.Assets.toys.length, this.seedText);
    this.toys = CC.Toys.createRow(
      this.assignment, toyIndexes, this.level, this.layout, this.seedText);
    this.timeLeft = this.level.questionTimeSeconds;
    this.graceLeft = READING_GRACE;   // granted only on a NEW question
    this.firstDropAvailable = true;
    this.caught = null;
    this.feedback = null;
    this.claw.pose = "open";
    this.state = "AIMING";
    this.events.emit();
  };

  Game.prototype.pause = function (auto) {
    if (this.paused || this.state === "RESULTS" || this.state === "LEVEL_READY") return;
    this.paused = true;
    this.pausedFrom = this.state;
    this.autoPaused = !!auto;
    this.events.emit();
  };

  Game.prototype.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    this.autoPaused = false;
    this.events.emit();
  };

  // ---- geometry remap on resize/rotation -----------------------------------

  Game.prototype.relayout = function (newLayout) {
    const oldLayout = this.layout;
    this.layout = newLayout;
    this.claw.remapTween(oldLayout, newLayout, oldLayout.captureY, newLayout.captureY);
    this.claw.relayout(newLayout, newLayout.captureY);
    this.claw.level = this.level;
    this.toys.forEach(t => {
      t.layout = newLayout;
      if (!t.carried) {
        t.y = newLayout.toyRowBottomY - newLayout.toyHeight / 2;
        t.update(0); // recompute x within lane without advancing motion
      }
    });
    this.events.emit();
  };

  // ---- main update ---------------------------------------------------------

  // input: {dir: -1|0|1, consumeDrop: () => boolean, clearDrop: () => void}
  Game.prototype.update = function (dt, input) {
    if (this.paused) return;
    if (this.state !== "AIMING" && input && input.clearDrop) {
      input.clearDrop(); // drop requests only ever count inside AIMING
    }
    switch (this.state) {
      case "AIMING": this.updateAiming(dt, input || { dir: 0 }); break;
      case "DESCENDING": this.updateDescending(dt); break;
      case "GRABBING": this.updateGrabbing(dt); break;
      case "ASCENDING": this.updateAscending(dt); break;
      case "DELIVERING": this.updateDelivering(dt); break;
      case "FEEDBACK": this.updateFeedback(dt); break;
    }
  };

  Game.prototype.updateAiming = function (dt, input) {
    // reading grace first; the countdown only runs in AIMING, never during
    // claw motion, feedback or pause (update is not even called then).
    if (this.graceLeft > 0) {
      this.graceLeft = Math.max(0, this.graceLeft - dt);
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.enterFeedback("timeout");
        return;
      }
    }
    this.claw.aim(dt, input.dir);
    this.toys.forEach(t => t.update(dt));

    // exactly one DROP accepted per grab cycle; everything else is ignored
    if (input.consumeDrop && input.consumeDrop()) {
      this.attempts++;
      this.graceLeft = 0; // dropping means the question has been read
      this.claw.cancelTween();
      this.claw.startTween("y", this.layout.captureY, this.level.clawDescendSpeed);
      this.state = "DESCENDING";
      this.events.emit();
    }
  };

  Game.prototype.updateDescending = function (dt) {
    this.toys.forEach(t => t.update(dt));   // targets keep moving until caught
    if (this.claw.stepTween(dt)) {
      const grip = this.claw.gripPoint();
      this.caught = CC.Toys.findCatch(this.toys, grip.x, this.level.grabTolerance);
      this.state = "GRABBING";
      this.grabTimer = CLOSE_TIME;
      this.events.emit();
    }
  };

  Game.prototype.updateGrabbing = function (dt) {
    this.claw.pose = "closed";
    this.grabTimer -= dt;
    if (this.grabTimer <= 0) {
      if (this.caught) this.caught.carried = true;
      this.claw.startTween("y", this.layout.railY, this.level.clawAscendSpeed);
      this.state = "ASCENDING";
      this.events.emit();
    }
  };

  Game.prototype.updateAscending = function (dt) {
    this.toys.forEach(t => t.update(dt));
    const grip = this.claw.gripPoint();
    if (this.caught) this.caught.followClaw(grip.x, grip.y);
    this.claw.updateSway(dt, !!this.caught);
    if (this.claw.stepTween(dt)) {
      if (this.caught) {
        this.claw.startTween("x", this.layout.collectX, this.level.clawHorizontalSpeed);
        this.state = "DELIVERING";
      } else {
        this.enterFeedback("empty");
      }
      this.events.emit();
    }
  };

  Game.prototype.updateDelivering = function (dt) {
    const grip = this.claw.gripPoint();
    if (this.caught) this.caught.followClaw(grip.x, grip.y);
    this.claw.updateSway(dt, !!this.caught);
    if (this.claw.stepTween(dt)) {
      const kind = this.caught.choiceId === this.question.correctAnswerId
        ? "correct" : "wrong";
      this.enterFeedback(kind);
    }
  };

  // Apply an outcome exactly once, at feedback entry.
  Game.prototype.enterFeedback = function (kind) {
    const toy = this.caught;
    this.caught = null;

    if (kind === "correct") {
      this.streak += 1;  // increment before computing the streak bonus
      const bonus = 10 * Math.min(this.streak - 1, STREAK_BONUS_CAP);
      const firstDrop = this.firstDropAvailable ? 20 : 0;
      this.gained = 100 + firstDrop + bonus;
      this.score += this.gained;
      this.correctCount += 1;
      this.feedback = {
        kind: kind, gained: this.gained, streak: this.streak,
        explanation: this.question.explanation,
        correctChoiceId: this.question.correctAnswerId
      };
      if (toy) { toy.carried = false; toy.collected = true; }
      this.claw.pose = "open";
    } else if (kind === "wrong") {
      this.hearts -= 1;
      this.streak = 0;
      this.firstDropAvailable = false;
      if (toy) toy.restore();
      this.claw.pose = "open";
      this.feedback = {
        kind: kind, hearts: this.hearts,
        explanation: this.question.explanation,
        correctText: this.correctText()
      };
    } else if (kind === "empty") {
      this.streak = 0;
      this.firstDropAvailable = false;
      this.timeLeft = Math.max(0, this.timeLeft - EMPTY_GRAB_PENALTY);
      this.claw.pose = "open";
      this.feedback = { kind: kind };
    } else if (kind === "timeout") {
      this.hearts -= 1;
      this.streak = 0;
      this.firstDropAvailable = false;
      this.claw.cancelTween();
      this.claw.pose = "open";
      this.feedback = { kind: kind, hearts: this.hearts };
    }

    this.state = "FEEDBACK";
    this.feedbackTimer = FEEDBACK_TIME[kind] || 1.5;
    this.events.emit();
  };

  Game.prototype.correctText = function () {
    const c = this.question.choices.find(c => c.id === this.question.correctAnswerId);
    return c ? c.text : "";
  };

  Game.prototype.updateFeedback = function (dt) {
    const fb = this.feedback;
    this.feedbackTimer -= dt;
    if (this.feedbackTimer > 0) return;

    if (fb.kind === "correct") {
      this.toys = this.toys.filter(t => !t.collected);
      if (this.correctCount >= this.level.questionIds.length) {
        this.finish(true);
      } else {
        this.startQuestion(this.qIndex + 1);
      }
      return;
    }
    if (fb.kind === "timeout") {
      // retry the same question with a fresh timer
      if (this.hearts <= 0) { this.finish(false); return; }
      this.timeLeft = this.level.questionTimeSeconds;
      this.state = "AIMING";
      this.events.emit();
      return;
    }
    // wrong / empty: retry same question with the remaining aiming time
    if (fb.kind === "wrong" && this.hearts <= 0) { this.finish(false); return; }
    this.state = "AIMING";
    this.events.emit();
  };

  Game.prototype.finish = function (success) {
    this.state = "RESULTS";
    this.result = {
      success: success,
      stars: success ? this.hearts : 0,
      score: this.score,
      hearts: this.hearts,
      levelId: this.level.id
    };
    this.events.emit();
  };

  CC.Game = Game;
  return Game;
});
