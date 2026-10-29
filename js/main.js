/*
 * CLAW CHAOS - initialization, asset/data loading, lifecycle and the single
 * animation loop (fixed-step updates with bounded catch-up).
 */
(function (root) {
  const CC = root.CC || (root.CC = {});

  const FIXED_DT = 1 / 120;
  const MAX_CATCHUP_STEPS = 8; // bounded catch-up after tab stalls

  function $(id) { return document.getElementById(id); }

  function fetchJSON(url) {
    return fetch(url, { cache: "no-cache" })
      .then(r => { if (!r.ok) throw new Error(url + " -> HTTP " + r.status); return r.json(); });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + src));
      img.src = src; // relative, deployment-safe
    });
  }

  function App() {
    this.canvas = $("game-canvas");
    this.renderer = new CC.Renderer({ canvas: this.canvas, images: {} });
    this.game = null;
    this.controls = null;
    this.questionsRaw = null;
    this.levelsRaw = null;
    this.progress = CC.Storage.load();
    this.running = false;
    this.lastTs = 0;
    this.accumulator = 0;
    this.rafId = 0;
    this.levelSeed = 0;
    this._onEvent = this.onGameEvent.bind(this);
    this._onResize = this.onResize.bind(this);
    this._onVisibility = this.onVisibility.bind(this);
    this._onWindowBlur = this.onWindowBlur.bind(this);
  }

  // ---- boot ----------------------------------------------------------------

  App.prototype.boot = function () {
    this.showScreen("screen-loading");
    const urls = ["data/questions.json", "data/levels.json"];
    const imageList = []
      .concat(CC.Assets.toys.map(t => t.src))
      .concat([CC.Assets.frames.desktop.src, CC.Assets.frames.ipad.src,
               CC.Assets.frames.phone.src, CC.Assets.clawOpen.src,
               CC.Assets.clawClosed.src, CC.Assets.questionCard.src]);

    Promise.all(urls.map(fetchJSON))
      .then(data => {
        this.questionsRaw = data[0];
        this.levelsRaw = data[1];
        const qv = CC.Questions.validate(this.questionsRaw);
        const lvv = CC.Levels.validate(this.levelsRaw, this.questionsRaw);
        if (!qv.ok || !lvv.ok) {
          throw new Error("invalid data: " + qv.errors.concat(lvv.errors).slice(0, 4).join("; "));
        }
        return Promise.all(imageList.map(loadImage));
      })
      .then(imgs => {
        imageList.forEach((src, i) => { this.renderer.images[src] = imgs[i]; });
        this.startHome();
      })
      .catch(err => {
        this.fatal(err && err.message ? err.message : String(err));
      });
  };

  App.prototype.fatal = function (message) {
    this.stopLoop();
    const el = $("error-message");
    if (el) el.textContent = message;
    this.showScreen("screen-error");
  };

  // ---- screens -------------------------------------------------------------

  App.prototype.showScreen = function (id) {
    ["screen-loading", "screen-error", "screen-start", "screen-levels",
     "screen-pause", "screen-results", "screen-ready"]
      .forEach(s => { const n = $(s); if (n) n.classList.toggle("hidden", s !== id); });
    if (id) this.setOverlaySizing(!!id);
  };

  App.prototype.hideScreens = function () {
    this.showScreen(null);
  };

  App.prototype.setOverlaySizing = function (overlaysShown) {
    // keep canvas letterboxed area when an overlay is up
    this.canvas.classList.toggle("dim", overlaysShown && this.game !== null);
  };

  App.prototype.startHome = function () {
    this.stopGame();
    this.showScreen("screen-start");
    this.renderOnce();
  };

  App.prototype.openLevelSelect = function () {
    const grid = $("levels-grid");
    grid.innerHTML = "";
    CC.Levels.order(this.levelsRaw).forEach(lv => {
      const unlocked = CC.Levels.isUnlocked(lv.id, this.progress.unlockedLevel);
      const best = this.progress.best[lv.id] || { score: 0, stars: 0 };
      const btn = document.createElement("button");
      btn.className = "level-btn" + (unlocked ? "" : " locked");
      btn.disabled = !unlocked;
      btn.innerHTML =
        "<span class='lv-num'>" + lv.id + "</span>" +
        "<span class='lv-title'>" + lv.title + "</span>" +
        "<span class='lv-meta'>" + (unlocked ? (best.stars ? "★".repeat(best.stars) + " " : "") + best.score + " pts" : "🔒") + "</span>";
      btn.addEventListener("click", () => { if (unlocked) this.startLevel(lv.id); });
      grid.appendChild(btn);
    });
    this.showScreen("screen-levels");
  };

  App.prototype.startLevel = function (levelId) {
    const level = CC.Levels.byId(this.levelsRaw)[levelId];
    if (!level) return;
    this.stopGame();

    this.renderer.resize(this.canvasBox().w, this.canvasBox().h);
    const layout = this.renderer.computeLayout(level.choiceCount);
    this.levelSeed = Date.now() & 0xffff;
    this.game = new CC.Game({
      level: level,
      questionsRaw: this.questionsRaw,
      layout: layout,
      seedText: "run" + this.levelSeed
    });
    this.game.events.on(this._onEvent);
    this.game.begin();

    this.controls = new CC.Controls({
      canvas: this.canvas,
      hitTest: (e) => this.renderer.hitTest(e.clientX, e.clientY),
      onPauseToggle: () => this.togglePause()
    });

    this.hideScreens();
    this.updateChrome();
    this.startLoop();
  };

  App.prototype.stopGame = function () {
    this.stopLoop();
    if (this.controls) { this.controls.destroy(); this.controls = null; }
    this.game = null;
    this.accumulator = 0;
  };

  // ---- loop ------------------------------------------------------------------

  App.prototype.canvasBox = function () {
    const wrap = $("game-wrap");
    const bar = $("touch-bar");
    let barH = 0;
    if (bar) {
      const wasHidden = bar.classList.contains("hidden");
      if (wasHidden) bar.classList.remove("hidden"); // measure real footprint
      barH = bar.offsetHeight;
      if (wasHidden) bar.classList.add("hidden");
    }
    return { w: Math.max(200, wrap.clientWidth), h: Math.max(200, wrap.clientHeight - barH) };
  };

  App.prototype.startLoop = function () {
    if (this.running) return; // one loop only, never accumulate
    this.running = true;
    this.lastTs = 0;
    this.accumulator = 0;
    const step = (ts) => {
      if (!this.running) return;
      if (!this.lastTs) this.lastTs = ts;
      let frameTime = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      if (frameTime > 0.25) frameTime = FIXED_DT; // huge stall: drop the past
      this.accumulator += frameTime;
      let n = 0;
      while (this.accumulator >= FIXED_DT && n < MAX_CATCHUP_STEPS) {
        this.stepGame(FIXED_DT);
        this.accumulator -= FIXED_DT;
        n++;
      }
      if (n === MAX_CATCHUP_STEPS) this.accumulator = 0; // bounded catch-up
      this.renderer.draw(this.game);
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  };

  App.prototype.stopLoop = function () {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  };

  App.prototype.stepGame = function (dt) {
    if (!this.game) return;
    this.game.update(dt, {
      dir: this.controls ? this.controls.dir() : 0,
      consumeDrop: this.controls ? () => this.controls.consumeDrop() : () => false,
      clearDrop: this.controls ? () => this.controls.clearDrop() : () => {}
    });
  };

  // ---- events / UI ---------------------------------------------------------

  App.prototype.onGameEvent = function () {
    const g = this.game;
    if (!g) return;
    if (g.state === "RESULTS" && g.result) {
      this.progress = CC.Storage.recordResult(this.progress, g.result);
      this.showResults();
    }
    this.updateChrome();
  };

  App.prototype.updateChrome = function () {
    const bar = $("touch-bar");
    if (bar) {
      // the phone frame already pictures its buttons: no duplicate controls
      const framePicsControls = this.renderer.frame &&
        this.renderer.frame.controls !== null;
      const showBar = !framePicsControls && !!this.game;
      const wasShown = !bar.classList.contains("hidden");
      bar.classList.toggle("hidden", !showBar);
      if (wasShown !== showBar) this.onResize(); // reclaim / reserve bar space
    }
    const pauseBtn = $("btn-pause");
    if (pauseBtn) pauseBtn.classList.toggle("hidden", !this.game);
  };

  App.prototype.togglePause = function () {
    if (!this.game) return;
    if (this.game.paused) {
      this.game.resume();
      if (this.controls) this.controls.setPaused(false);
      this.hideScreens();
      this.lastTs = 0; // reset timestamps on resume
      this.startLoop();
    } else if (this.game.state !== "RESULTS") {
      this.game.pause(false);
      if (this.controls) this.controls.setPaused(true);
      this.stopLoop();
      this.renderer.draw(this.game); // frozen scene stays visible under overlay
      this.showScreen("screen-pause");
    }
  };

  App.prototype.onVisibility = function () {
    if (document.hidden) this.autoPause();
  };

  App.prototype.onWindowBlur = function () { this.autoPause(); };

  App.prototype.autoPause = function () {
    if (this.game && !this.game.paused &&
        this.game.state !== "RESULTS" && this.game.state !== "LEVEL_READY") {
      this.game.pause(true);
      if (this.controls) this.controls.setPaused(true);
      this.stopLoop();
      this.renderer.draw(this.game);
      this.showScreen("screen-pause");
      const note = $("pause-note");
      if (note) note.textContent = "Paused automatically. Press Resume to continue.";
    }
  };

  App.prototype.onResize = function () {
    if (!this.renderer) return;
    const box = this.canvasBox();
    this.renderer.resize(box.w, box.h);
    if (this.game) {
      const layout = this.renderer.computeLayout(this.game.level.choiceCount);
      this.game.relayout(layout); // preserve state, remap rendering only
    }
    this.renderer.draw(this.game);
  };

  App.prototype.showResults = function () {
    const r = this.game.result;
    const prev = (this.progress.best[r.levelId] || { score: 0, stars: 0 });
    $("results-title").textContent = r.success ? "LEVEL COMPLETE!" : "OUT OF HEARTS";
    $("results-stars").textContent = r.success ? "★".repeat(r.stars) + "☆".repeat(3 - r.stars) : "☆☆☆";
    $("results-score").textContent = r.score + " points   (best " + Math.max(prev.score, r.score) + ")";
    const next = $("btn-next-level");
    next.classList.toggle("hidden", !r.success || r.levelId >= 15);
    this.showScreen("screen-results");
  };

  App.prototype.renderOnce = function () {
    this.renderer.resize(this.canvasBox().w, this.canvasBox().h);
    this.renderer.draw(null);
  };

  // ---- wiring ----------------------------------------------------------------

  App.prototype.wire = function () {
    $("btn-start").addEventListener("click", () => this.openLevelSelect());
    $("btn-home").addEventListener("click", () => this.startHome());
    $("btn-pause").addEventListener("click", () => this.togglePause());
    $("btn-resume").addEventListener("click", () => this.togglePause());
    $("btn-retry").addEventListener("click", () => {
      const id = this.game ? this.game.level.id : 1;
      this.startLevel(id);
    });
    $("btn-results-retry").addEventListener("click", () => {
      const id = this.game ? this.game.level.id : 1;
      this.startLevel(id);
    });
    $("btn-results-home").addEventListener("click", () => this.startHome());
    $("btn-next-level").addEventListener("click", () => {
      const id = this.game ? Math.min(15, this.game.level.id + 1) : 1;
      this.startLevel(id);
    });
    $("btn-error-retry").addEventListener("click", () => { this.showScreen("screen-loading"); this.boot(); });
    $("btn-levels-back").addEventListener("click", () => this.showScreen("screen-start"));

    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);
    window.addEventListener("blur", this._onWindowBlur);

    // touch-bar hold buttons forward into the current Controls instance
    // (used on frames without pictured buttons; pointer capture included)
    const bar = $("touch-bar");
    bar.addEventListener("pointerdown", e => {
      const t = e.target;
      if (!this.controls) return;
      if (t.id === "btn-left") { this.controls.pointerDir = -1; try { t.setPointerCapture(e.pointerId); } catch (err) {} }
      if (t.id === "btn-right") { this.controls.pointerDir = 1; try { t.setPointerCapture(e.pointerId); } catch (err) {} }
      if (t.id === "btn-drop") { this.controls.requestDrop(); try { t.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
    });
    const endHold = e => {
      if (!this.controls) return;
      if (e.target.id === "btn-left" && this.controls.pointerDir === -1) this.controls.pointerDir = 0;
      if (e.target.id === "btn-right" && this.controls.pointerDir === 1) this.controls.pointerDir = 0;
    };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev =>
      bar.addEventListener(ev, endHold));
  };

  CC.App = App;

  document.addEventListener("DOMContentLoaded", () => {
    const app = new App();
    root.__ccApp = app; // debugging/verification hook
    app.wire();
    app.boot();
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
