/*
 * CLAW CHAOS - toy entities: lanes, motion, capture regions, attachment.
 * Pure logic in world units; the renderer maps world -> pixels.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // One selectable answer toy.
  // layout supplies { worldW, toyRowBottomY, toyHeight } in world units.
  function Toy(opts) {
    this.assetIndex = opts.assetIndex;       // index into CC.Assets.toys
    this.choiceId = opts.choiceId;           // question choice id ("a".."d")
    this.text = opts.text;
    this.slot = opts.slot;                   // display slot (lane) 0..n-1
    this.laneCount = opts.laneCount;
    this.speed = opts.speed;                 // rad/s, 0 = stationary
    this.amplitude = opts.amplitude;         // fraction of lane width
    this.phase = opts.phase;
    this.layout = opts.layout;
    this.carried = false;
    this.restorePending = false;
    this.t = 0;
    this.x = this.laneCenter();
    this.y = this.layout.toyRowBottomY - this.layout.toyHeight / 2;
  }

  Toy.prototype.laneCenter = function () {
    return this.layout.worldW * (this.slot + 0.5) / this.laneCount;
  };

  Toy.prototype.laneWidth = function () {
    return this.layout.worldW / this.laneCount;
  };

  Toy.prototype.halfWidth = function () {
    // logical horizontal extent of the toy artwork
    return this.layout.toyHeight / 2;
  };

  // Horizontal capture region half-width: the level tolerance applies to the
  // claw aligning with the toy; alignment is always judged against the toy's
  // position at capture time.
  Toy.prototype.captureHalfWidth = function (grabTolerance) {
    return this.laneWidth() * grabTolerance;
  };

  Toy.prototype.update = function (dt) {
    if (this.carried) return;               // attached toys ride with the claw
    this.t += dt;
    if (this.speed > 0 && this.amplitude > 0) {
      const span = this.amplitude * this.laneWidth();
      // clamp so the toy can never leave its own lane
      const maxSpan = (this.laneWidth() / 2) - (this.layout.toyHeight * 0.34);
      const s = Math.min(span, Math.max(0, maxSpan));
      this.x = this.laneCenter() + Math.sin(this.phase + this.t * this.speed) * s;
    } else {
      this.x = this.laneCenter();
    }
  };

  Toy.prototype.topY = function () {
    return this.y - this.layout.toyHeight / 2;
  };
  Toy.prototype.bottomY = function () {
    return this.y + this.layout.toyHeight / 2;
  };

  // Attach/detach at the stable grip anchor: toy top center under claw tips.
  Toy.prototype.followClaw = function (clawX, clawGripY) {
    this.x = clawX;
    this.y = clawGripY + this.layout.toyHeight / 2;
  };

  Toy.prototype.restore = function () {
    this.carried = false;
    this.x = this.laneCenter();
    this.y = this.layout.toyRowBottomY - this.layout.toyHeight / 2;
  };

  // Build the toy row for a question from its stable assignment.
  // assignment: {choices:[{id,text}...]} (already shuffled by questions.js)
  // toyIndexes: stable toy artwork pick (same length as choices)
  const Toys = {
    createRow: function (assignment, toyIndexes, level, layout, seedText) {
      const rand = CC.Questions.seededRandom("phase|" + seedText);
      return assignment.choices.map((choice, slot) => new Toy({
        assetIndex: toyIndexes[slot],
        choiceId: choice.id,
        text: choice.text,
        slot: slot,
        laneCount: assignment.choices.length,
        speed: level.targetMotionSpeed,
        amplitude: level.targetMotionAmplitude,
        phase: rand() * Math.PI * 2,
        layout: layout
      }));
    },

    // Deterministic catch detection: overlap of the claw grip x with a toy's
    // logical capture region. Ties: nearest center wins, then lowest lane.
    // Returns the caught Toy or null. grabTolerance from the level config.
    findCatch: function (toys, gripX, grabTolerance) {
      let best = null;
      let bestDx = Infinity;
      for (let i = 0; i < toys.length; i++) {
        const t = toys[i];
        if (t.carried) continue;
        const dx = Math.abs(gripX - t.x);
        if (dx <= t.captureHalfWidth(grabTolerance)) {
          if (dx < bestDx - 1e-9 || (Math.abs(dx - bestDx) <= 1e-9 && best && t.slot < best.slot)) {
            best = t; bestDx = dx;
          }
        }
      }
      return best;
    }
  };

  CC.Toys = Toys;
  CC.Toy = Toy;
  return Toys;
});
