/*
 * CLAW CHAOS - canvas renderer.
 * Draws the arcade frame, question card, toys with word labels, the claw
 * (tiled cable + pose head), HUD and feedback. All gameplay math lives in
 * world units; this module maps world -> screen through the frame interior.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC, root) {

  const WORLD_W = 1000;

  function Renderer(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.images = opts.images;         // {key: HTMLImageElement} keyed by src
    this.frame = null;
    this.frameRect = null;             // CSS px rect of the frame PNG
    this.interiorRect = null;          // CSS px rect of the transparent window
    this.worldH = WORLD_W;
    this.cache = {};                   // prescaled render-size images
    this.cacheScale = 0;
    this.cssW = 0; this.cssH = 0; this.dpr = 1;
  }

  Renderer.prototype.resize = function (cssW, cssH) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    // frame choice follows the VIEWPORT aspect (per spec), the artwork then
    // letterboxes inside whatever canvas area the control bar leaves
    const vw = (root.innerWidth || cssW), vh = (root.innerHeight || cssH);
    this.frame = CC.Assets.selectFrame(vw / Math.max(1, vh));
    this.frameKey = this.frame === CC.Assets.frames.phone ? "phone"
      : this.frame === CC.Assets.frames.ipad ? "ipad" : "desktop";
    this.measure();
    this.primeCache();
  };

  Renderer.prototype.measure = function () {
    const fr = this.frame;
    const availAspect = this.cssW / Math.max(1, this.cssH);
    const frameAspect = fr.width / fr.height;
    let w, h;
    if (availAspect > frameAspect) { h = this.cssH; w = h * frameAspect; }
    else { w = this.cssW; h = w / frameAspect; }
    this.frameRect = {
      x: (this.cssW - w) / 2, y: (this.cssH - h) / 2, w: w, h: h
    };
    const ir = fr.interior;
    this.interiorRect = {
      x: this.frameRect.x + ir.x * this.frameRect.w,
      y: this.frameRect.y + ir.y * this.frameRect.h,
      w: ir.w * this.frameRect.w,
      h: ir.h * this.frameRect.h
    };
    this.worldH = WORLD_W * (this.interiorRect.h / Math.max(1, this.interiorRect.w));
  };

  // ---- cached, render-size versions of the big PNGs -------------------------
  // Never resize 4K sources at draw time; prescale once per size bucket.
  Renderer.prototype.primeCache = function () {
    const scale = this.frameRect.w / this.frame.width; // px per source px
    if (Math.abs(scale - this.cacheScale) / Math.max(1e-6, this.cacheScale) < 0.2 &&
        Object.keys(this.cache).length) return;
    this.cacheScale = scale;
    this.cache = {};
    const dpr = this.dpr;
    const prescale = (key, srcRectNorm, outW) => {
      const img = this.images[key];
      if (!img) return null;
      const sx = srcRectNorm.x * img.naturalWidth;
      const sy = srcRectNorm.y * img.naturalHeight;
      const sw = srcRectNorm.w * img.naturalWidth;
      const sh = srcRectNorm.h * img.naturalHeight;
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(outW * dpr));
      cv.height = Math.max(1, Math.round(cv.width * (sh / sw)));
      const cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      return cv;
    };

    // full frames
    ["desktop", "ipad", "phone"].forEach(k => {
      const f = CC.Assets.frames[k];
      const img = this.images[f.src];
      if (!img) return;
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(this.frameRect.w * dpr));
      cv.height = Math.max(1, Math.round(cv.width * (f.height / f.width)));
      const cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      this.cache["frame:" + k] = cv;
    });

    // toys cached at the largest size any lane count needs (3 lanes widest)
    const toyWorldH = Math.min(this.worldH * 0.50, (WORLD_W / 3) * 1.30);
    const toyPx = this.wsx(toyWorldH);
    CC.Assets.toys.forEach((t, i) => {
      this.cache["toy:" + i] = prescale(t.src, { x: 0, y: 0, w: 1, h: 1 }, toyPx);
    });

    // claw heads at their world width (sized from the toy scale)
    const headW = this.wsx(toyWorldH * 0.60);
    this.cache["claw:open"] = prescale(CC.Assets.clawOpen.src,
      CC.Assets.clawOpen.headRect, headW);
    this.cache["claw:closed"] = prescale(CC.Assets.clawClosed.src,
      CC.Assets.clawClosed.headRect, headW);

    // cable strip (from the closed-claw art, the long cable)
    const cableW = (0.1294 / 0.5658) * headW;
    this.cache["cable"] = prescale(CC.Assets.clawClosed.src,
      CC.Assets.clawClosed.cableStrip, cableW);

    // question card at card width
    const cardW = this.cardRect().w;
    this.cache["card"] = prescale(CC.Assets.questionCard.src,
      { x: 0, y: 0, w: 1, h: 1 }, cardW);
  };

  // ---- world -> screen ------------------------------------------------------
  Renderer.prototype.wx = function (x) { return this.interiorRect.x + x / WORLD_W * this.interiorRect.w; };
  Renderer.prototype.wy = function (y) { return this.interiorRect.y + y / this.worldH * this.interiorRect.h; };
  Renderer.prototype.wsx = function (w) { return w / WORLD_W * this.interiorRect.w; };
  Renderer.prototype.wsy = function (h) { return h / this.worldH * this.interiorRect.h; };

  // Question card geometry in world units, shared by layout and drawing.
  Renderer.prototype.cardWorld = function () {
    const worldH = this.worldH;
    const w = Math.min(0.66 * WORLD_W, 3 * 0.21 * worldH);
    return { x: (WORLD_W - w) / 2, y: worldH * 0.012, w: w, h: w / 3 };
  };

  // Gameplay layout for the current frame, used by the game module.
  // Everything scales with the frame's interior aspect so wide, tall and
  // narrow windows all get a readable card, a traveling claw and a toy row
  // that the claw can actually reach with visible descent.
  Renderer.prototype.computeLayout = function (choiceCount) {
    const worldH = this.worldH;
    const laneW = WORLD_W / choiceCount;
    const toyHeight = Math.min(worldH * 0.50, laneW * 1.30);
    const headAspect = ((CC.Assets.clawOpen.headRect.h / CC.Assets.clawOpen.headRect.w) +
      (CC.Assets.clawClosed.headRect.h / CC.Assets.clawClosed.headRect.w)) / 2;
    const clawHeadW = toyHeight * 0.60;               // claw sized like the toys
    const clawHeadWorldH = clawHeadW * headAspect;
    const card = this.cardWorld();
    const toyRowBottomY = worldH * 0.985;
    const toyTop = toyRowBottomY - toyHeight;
    // rail: claw hangs just above the toy tops at rest
    const railY = Math.min(card.y + card.h + worldH * 0.015,
      Math.max(worldH * 0.06, toyTop - clawHeadWorldH - worldH * 0.012));
    // capture: tips close around the toy's upper body
    const captureTipsY = toyTop + toyHeight * 0.32;
    return {
      worldW: WORLD_W,
      worldH: worldH,
      railY: railY,
      toyRowBottomY: toyRowBottomY,
      toyHeight: toyHeight,
      clawHeadW: clawHeadW,
      clawHeadWorldH: clawHeadWorldH,
      captureY: captureTipsY - clawHeadWorldH, // claw housing y at capture
      collectX: WORLD_W * 0.5,
      cardBottom: card.y + card.h
    };
  };

  Renderer.prototype.cardRect = function () {
    const c = this.cardWorld();
    return {
      x: this.wx(c.x), y: this.wy(c.y),
      w: this.wsx(c.w), h: this.wsy(c.h)
    };
  };

  // Pointer hit test against pictured frame buttons (phone) or the interior.
  Renderer.prototype.hitTest = function (clientX, clientY) {
    if (!this.frameRect) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * this.cssW;
    const y = (clientY - rect.top) / rect.height * this.cssH;
    const fx = (x - this.frameRect.x) / this.frameRect.w;
    const fy = (y - this.frameRect.y) / this.frameRect.h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    const c = this.frame.controls;
    if (c) {
      if (inRect(fx, fy, c.left)) return "left";
      if (inRect(fx, fy, c.right)) return "right";
      if (inRect(fx, fy, c.drop)) return "drop";
    }
    const ir = this.frame.interior;
    if (fx >= ir.x && fx <= ir.x + ir.w && fy >= ir.y && fy <= ir.y + ir.h) return "interior";
    return null;
  };

  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ---- drawing ---------------------------------------------------------------

  Renderer.prototype.draw = function (game) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    const frameImg = this.cache["frame:" + this.frameKey];
    if (frameImg) {
      ctx.drawImage(frameImg, this.frameRect.x, this.frameRect.y, this.frameRect.w, this.frameRect.h);
    }

    if (!game || !game.layout) return;

    this.drawCollectionSlot(game);
    this.drawToys(game);
    this.drawClaw(game);
    this.drawCard(game);
    this.drawHUD(game);
    if (game.state === "FEEDBACK" && game.feedback) this.drawFeedback(game);
  };

  Renderer.prototype.drawToys = function (game) {
    const ctx = this.ctx;
    const size = this.wsx(game.layout.toyHeight);
    game.toys.forEach(t => {
      if (t.collected) return;
      const img = this.cache["toy:" + t.assetIndex];
      const cx = this.wx(t.x);
      const cy = this.wy(t.y);
      if (!img) return;
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      // word label on the toy's blank plate, following the toy
      const a = CC.Assets.toys[t.assetIndex];
      const lr = a.labelRect;
      const px = cx - size / 2 + lr.x * size;
      const py = cy - size / 2 + lr.y * size;
      const pw = lr.w * size, ph = lr.h * size;
      this.drawFittedText(t.text, px + pw * 0.06, py + ph * 0.08, pw * 0.88, ph * 0.84,
        { color: "#251a4d", bold: true, maxLines: 2 });
    });
  };

  Renderer.prototype.drawClaw = function (game) {
    const ctx = this.ctx;
    const claw = game.claw;
    const grip = claw.gripPoint();
    const headX = this.wx(grip.x);
    const headTopY = this.wy(claw.y);
    const headW = this.wsx(game.layout.clawHeadW);

    // cable: tiled strip from the interior top down to the housing
    const cable = this.cache["cable"];
    if (cable) {
      const cw = cable.width / this.dpr;
      const ch = cable.height / this.dpr;
      let y = this.interiorRect.y;
      const bottom = headTopY;
      while (y < bottom) {
        const h = Math.min(ch, bottom - y);
        ctx.drawImage(cable, 0, 0, cable.width, cable.height * (h / ch),
          headX - cw / 2, y, cw, h);
        y += ch;
      }
    }

    const head = this.cache["claw:" + claw.pose];
    if (head) {
      const hh = headW * (head.height / head.width);
      ctx.drawImage(head, headX - headW / 2, headTopY, headW, hh);
    }
  };

  Renderer.prototype.drawCollectionSlot = function (game) {
    // subtle marker under the fixed collection point, between card and rail
    const ctx = this.ctx;
    const x = this.wx(game.layout.collectX);
    const y = this.wy(game.layout.cardBottom + game.layout.worldH * 0.035);
    ctx.strokeStyle = "rgba(255, 214, 106, 0.75)";
    ctx.lineWidth = Math.max(2, this.wsx(9));
    ctx.lineCap = "round";
    const w = this.wsx(52);
    ctx.beginPath();
    ctx.moveTo(x - w, y); ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 214, 106, 0.9)";
    const s = this.wsx(16);
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.7);
    ctx.lineTo(x - s * 0.6, y - s * 0.4);
    ctx.lineTo(x + s * 0.6, y - s * 0.4);
    ctx.closePath();
    ctx.fill();
  };

  Renderer.prototype.drawCard = function (game) {
    if (!game.question) return;
    const ctx = this.ctx;
    const r = this.cardRect();
    const img = this.cache["card"];
    if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    const tr = CC.Assets.questionCard.textRect;
    this.drawFittedText(game.question.prompt,
      r.x + tr.x * r.w, r.y + tr.y * r.h, tr.w * r.w, tr.h * r.h,
      { color: "#3a2408", bold: true, maxLines: 3 });
  };

  Renderer.prototype.drawHUD = function (game) {
    const ctx = this.ctx;
    const fs = Math.max(12, this.interiorRect.h * 0.048);
    const outline = (txt, x, y, color, align) => {
      ctx.font = "bold " + fs + "px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = align || "left";
      ctx.lineWidth = fs * 0.22;
      ctx.strokeStyle = "rgba(20,10,40,.85)";
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = color;
      ctx.fillText(txt, x, y);
    };
    const topY = this.interiorRect.y + fs * 0.35;
    const leftX = this.interiorRect.x + fs * 0.5;
    const rightX = this.interiorRect.x + this.interiorRect.w - fs * 0.5;

    // hearts + timer share the top-left line (green during reading grace)
    let hearts = "";
    for (let i = 0; i < 3; i++) hearts += i < game.hearts ? "♥" : "♡";
    const grace = game.graceLeft > 0 && game.state === "AIMING";
    const t = Math.max(0, Math.ceil(game.timeLeft));
    outline(hearts + "  " + (grace ? "READY" : t + "s"), leftX, topY,
      grace ? "#9fe870" : "#ff8ba0", "left");

    // score + progress top-right
    outline(String(game.score), rightX, topY, "#ffd66a", "right");
    ctx.font = "bold " + fs * 0.72 + "px system-ui, sans-serif";
    ctx.lineWidth = fs * 0.16;
    const prog = (game.qIndex + 1) + "/" + game.level.questionIds.length;
    ctx.textAlign = "right";
    ctx.strokeText(prog, rightX, topY + fs * 1.25);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(prog, rightX, topY + fs * 1.25);
  };

  Renderer.prototype.drawFeedback = function (game) {
    const ctx = this.ctx;
    const fb = game.feedback;
    let title = "", sub = "";
    if (fb.kind === "correct") {
      title = "CORRECT!  +" + fb.gained;
      sub = fb.explanation;
    } else if (fb.kind === "wrong") {
      title = "WRONG!";
      sub = "The answer was '" + fb.correctText + "'. " + fb.explanation;
    } else if (fb.kind === "empty") {
      title = "EMPTY GRAB";
      sub = "-2 seconds. Try again!";
    } else if (fb.kind === "timeout") {
      title = "TIME IS UP!";
      sub = "One heart lost. Try again!";
    }

    const fs = Math.max(14, this.interiorRect.h * 0.06);
    const r = {
      x: this.interiorRect.x + this.interiorRect.w * 0.08,
      y: this.wy(game.layout.worldH * 0.70),
      w: this.interiorRect.w * 0.84,
      h: this.interiorRect.h * 0.22
    };
    ctx.fillStyle = "rgba(16, 8, 38, 0.82)";
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.22);
    ctx.fill();
    ctx.strokeStyle = fb.kind === "correct" ? "#9fe870" :
      fb.kind === "wrong" ? "#ff5470" : "#ffd66a";
    ctx.lineWidth = Math.max(2, fs * 0.12);
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.22);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold " + fs + "px system-ui, sans-serif";
    ctx.fillStyle = fb.kind === "correct" ? "#9fe870" :
      fb.kind === "wrong" ? "#ff5470" : "#ffd66a";
    ctx.fillText(title, r.x + r.w / 2, r.y + r.h * 0.30);
    ctx.font = "bold " + fs * 0.6 + "px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    this.drawFittedText(sub, r.x + r.w * 0.05, r.y + r.h * 0.48, r.w * 0.9, r.h * 0.46,
      { color: "#ffffff", maxLines: 2, noStroke: true });
  };

  // Text that must fit a box: shrink then wrap, never clip.
  Renderer.prototype.drawFittedText = function (text, x, y, w, h, opts) {
    const ctx = this.ctx;
    opts = opts || {};
    const maxLines = opts.maxLines || 2;
    const bold = opts.bold !== false;
    let fs = h / (maxLines * 1.15);
    let lines;
    for (let guard = 0; guard < 24; guard++) {
      ctx.font = (bold ? "bold " : "") + fs + "px system-ui, sans-serif";
      lines = wrapText(ctx, text, w);
      if (lines.length <= maxLines &&
          lines.every(l => ctx.measureText(l).width <= w) &&
          fs * lines.length * 1.12 <= h) break;
      fs *= 0.92;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lineH = fs * 1.12;
    const y0 = y + h / 2 - (lines.length - 1) * lineH / 2;
    lines.forEach((line, i) => {
      const ly = y0 + i * lineH;
      if (!opts.noStroke) {
        ctx.lineWidth = fs * 0.16;
        ctx.strokeStyle = "rgba(20,10,40,.75)";
        ctx.strokeText(line, x + w / 2, ly);
      }
      ctx.fillStyle = opts.color || "#ffffff";
      ctx.fillText(line, x + w / 2, ly);
    });
  };

  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + " " + words[i];
      if (ctx.measureText(test).width <= maxW) line = test;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  CC.Renderer = Renderer;
  return Renderer;
});
