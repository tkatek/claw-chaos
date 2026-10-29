/*
 * CLAW CHAOS - claw movement, grab cycle kinematics and carrying.
 * Pure logic in world units. The game module drives phase transitions;
 * this class owns position, easing and pose.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 2);

  // Pose: "open" or "closed" - maps to the two available claw artworks.
  function Claw(level, layout) {
    this.level = level;
    this.layout = layout;
    this.x = layout.worldW / 2;
    this.y = layout.railY;         // travel line height
    this.vx = 0;                   // horizontal velocity while aiming
    this.pose = "open";
    this.tween = null;             // {axis, from, to, dur, t, ease}
    this.swayT = 0;                // carry sway clock
    this.sway = 0;
  }

  Claw.prototype.minX = function () {
    return this.layout.worldW * 0.02;
  };
  Claw.prototype.maxX = function () {
    return this.layout.worldW * 0.98;
  };

  // Manual aiming: dir is -1, 0 or +1 (opposite keys cancel). Accelerating
  // ramp for a weighty feel, quick decel stop.
  Claw.prototype.aim = function (dt, dir) {
    if (this.tween) return;
    const vmax = this.level.clawHorizontalSpeed;
    const accel = vmax * 6;
    const target = clamp(dir, -1, 1) * vmax;
    if (target > this.vx) this.vx = Math.min(target, this.vx + accel * dt);
    else if (target < this.vx) this.vx = Math.max(target, this.vx - accel * dt);
    this.x = clamp(this.x + this.vx * dt, this.minX(), this.maxX());
    if ((this.x === this.minX() && this.vx < 0) || (this.x === this.maxX() && this.vx > 0)) {
      this.vx = 0;
    }
  };

  Claw.prototype.startTween = function (axis, to, speed, ease) {
    const from = axis === "x" ? this.x : this.y;
    const dist = Math.abs(to - from);
    this.tween = {
      axis: axis, from: from, to: to,
      dur: Math.max(0.001, dist / speed),
      t: 0, ease: ease || easeInOut
    };
  };

  // Remap tween endpoints into a new layout. y endpoints are expressed as a
  // fraction along railY..captureY; x endpoints scale with worldW.
  Claw.prototype.remapTween = function (oldLayout, newLayout, oldCaptureY, newCaptureY) {
    const tw = this.tween;
    if (!tw) return;
    if (tw.axis === "y") {
      const span = Math.max(1e-6, oldCaptureY - oldLayout.railY);
      const map = v => newLayout.railY +
        clamp((v - oldLayout.railY) / span, 0, 1) * (newCaptureY - newLayout.railY);
      tw.from = map(tw.from);
      tw.to = map(tw.to);
    } else {
      const k = newLayout.worldW / oldLayout.worldW;
      tw.from *= k; tw.to *= k;
    }
  };

  // Returns true when the active tween finished.
  Claw.prototype.stepTween = function (dt) {
    if (!this.tween) return true;
    const tw = this.tween;
    tw.t = Math.min(tw.dur, tw.t + dt);
    const k = tw.ease(tw.t / tw.dur);
    const v = tw.from + (tw.to - tw.from) * k;
    if (tw.axis === "x") this.x = v; else this.y = v;
    if (tw.t >= tw.dur) {
      if (tw.axis === "x") this.x = tw.to; else this.y = tw.to;
      this.tween = null;
      return true;
    }
    return false;
  };

  Claw.prototype.cancelTween = function () { this.tween = null; };

  // Subtle sway while carrying a toy.
  Claw.prototype.updateSway = function (dt, carrying) {
    if (carrying) {
      this.swayT += dt;
      this.sway = Math.sin(this.swayT * 2.6) * 0.05;
    } else {
      this.swayT = 0;
      this.sway = 0;
    }
  };

  // Grip anchor: where finger tips are, in world units (with sway offset).
  Claw.prototype.gripPoint = function () {
    return {
      x: this.x + this.sway * this.layout.worldW * 0.01,
      y: this.y + this.layout.clawHeadWorldH
    };
  };

  // Re-anchor after a relayout (resize/rotation) so no jump occurs:
  // x scales with world width, y remaps between rail and capture line.
  Claw.prototype.relayout = function (layout, captureY) {
    const oldW = this.layout.worldW;
    const oldSpan = Math.max(1e-6, this.layout.captureY - this.layout.railY);
    const frac = clamp((this.y - this.layout.railY) / oldSpan, 0, 1);
    const xFrac = oldW > 0 ? this.x / oldW : 0.5;
    this.layout = layout;
    this.x = clamp(xFrac * layout.worldW, this.minX(), this.maxX());
    this.y = layout.railY + frac * (captureY - layout.railY);
  };

  CC.Claw = Claw;
  return Claw;
});
