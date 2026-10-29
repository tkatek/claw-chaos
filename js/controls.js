/*
 * CLAW CHAOS - keyboard, pointer and touch input with careful cleanup.
 * The game reads {dir, consumeDrop()} every update; drop requests are
 * one-shot latches cleared on consumption or on any cancel condition.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC, root) {

  function Controls(opts) {
    this.canvas = opts.canvas;
    this.hitTest = opts.hitTest || null; // (event) -> 'left'|'right'|'drop'|'interior'|null
    this.onPauseToggle = opts.onPauseToggle || function () {};

    this.keys = { left: false, right: false };
    this.pointerDir = 0;          // -1/0/+1 while a control button is held
    this.dropLatch = false;       // one DROP request pending
    this.paused = false;          // input parked while overlay is up
    this.enabled = true;

    this._pointers = new Map();   // pointerId -> control name
    this._bind();
  }

  Controls.prototype.dir = function () {
    if (!this.enabled || this.paused) return 0;
    // keyboard and pointer votes add up; opposite directions cancel out
    let d = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    d += this.pointerDir;
    return Math.max(-1, Math.min(1, d));
  };

  Controls.prototype.requestDrop = function () {
    if (!this.enabled || this.paused) return;
    this.dropLatch = true;
  };

  Controls.prototype.consumeDrop = function () {
    if (this.dropLatch) { this.dropLatch = false; return true; }
    return false;
  };

  // Drain a stale drop request (called by the game while not in AIMING).
  Controls.prototype.clearDrop = function () { this.dropLatch = false; };

  // Clear every held/latched input (pause, blur, restart, lost capture).
  Controls.prototype.clear = function () {
    this.keys.left = false;
    this.keys.right = false;
    this.pointerDir = 0;
    this.dropLatch = false;
    this._pointers.clear();
  };

  Controls.prototype.setPaused = function (p) {
    this.paused = p;
    if (p) this.clear();
  };

  Controls.prototype._bind = function () {
    const self = this;

    this._onKeyDown = function (e) {
      if (!self.enabled) return;
      const k = e.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") {
        if (!e.repeat) self.keys.left = true;
        if (self._inPlay()) e.preventDefault();
      } else if (k === "ArrowRight" || k === "d" || k === "D") {
        if (!e.repeat) self.keys.right = true;
        if (self._inPlay()) e.preventDefault();
      } else if (k === " " || k === "Spacebar") {
        if (!e.repeat) self.requestDrop();
        if (self._inPlay()) e.preventDefault();
      } else if (k === "Escape") {
        if (self._inPlay() || self.paused) { self.onPauseToggle(); e.preventDefault(); }
      }
    };
    this._onKeyUp = function (e) {
      const k = e.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") self.keys.left = false;
      else if (k === "ArrowRight" || k === "d" || k === "D") self.keys.right = false;
    };

    // Canvas pointer input: pictured frame buttons + tap-interior-to-drop.
    this._onPointerDown = function (e) {
      if (!self.enabled || self.paused) return;
      if (!self.canvas.contains(e.target) && e.target !== self.canvas) return;
      const target = self.hitTest ? self.hitTest(e) : "interior";
      if (target === "left" || target === "right") {
        self.pointerDir = target === "left" ? -1 : 1;
        self._pointers.set(e.pointerId, target);
        try { self.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        e.preventDefault();
      } else if (target === "drop" || target === "interior") {
        self.requestDrop();
        self._pointers.set(e.pointerId, target);
        try { self.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        e.preventDefault();
      }
    };
    this._releasePointer = function (e) {
      const held = self._pointers.get(e.pointerId);
      self._pointers.delete(e.pointerId);
      if (held === "left" && self.pointerDir === -1) self.pointerDir = 0;
      if (held === "right" && self.pointerDir === 1) self.pointerDir = 0;
    };
    this._onPointerUp = function (e) { self._releasePointer(e); };
    this._onPointerCancel = function (e) { self._releasePointer(e); };
    this._onLostCapture = function (e) { self._releasePointer(e); };

    this._onBlur = function () { self.clear(); };

    root.addEventListener("keydown", this._onKeyDown, { passive: false });
    root.addEventListener("keyup", this._onKeyUp);
    this.canvas.addEventListener("pointerdown", this._onPointerDown, { passive: false });
    this.canvas.addEventListener("pointerup", this._onPointerUp);
    this.canvas.addEventListener("pointercancel", this._onPointerCancel);
    this.canvas.addEventListener("lostpointercapture", this._onLostCapture);
    root.addEventListener("blur", this._onBlur);
  };

  Controls.prototype._inPlay = function () {
    // preventDefault only for active gameplay keys, not whole-page typing
    return this.enabled && !this.paused;
  };

  // Full teardown so restarts never accumulate listeners.
  Controls.prototype.destroy = function () {
    this.clear();
    root.removeEventListener("keydown", this._onKeyDown);
    root.removeEventListener("keyup", this._onKeyUp);
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointercancel", this._onPointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this._onLostCapture);
    root.removeEventListener("blur", this._onBlur);
  };

  CC.Controls = Controls;
  return Controls;
});
