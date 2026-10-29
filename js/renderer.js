/*
 * CLAW CHAOS - canvas renderer.
 * Draws the arcade room, the composed cabinet (nine-sliced around its
 * stretchable window band), question card, plush-pile interior, toys with
 * word labels, the claw (tiled cable + pose head), HUD and feedback.
 * All gameplay math lives in world units; this module maps world -> screen
 * through the frame interior. One geometry (frameRect + yMap) drives both
 * drawing and pointer hit-testing, so visuals and input can never diverge.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC, root) {

  const WORLD_W = 1000;
  const now = () => (root.performance && root.performance.now)
    ? root.performance.now() : Date.now();

  function Renderer(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.images = opts.images;         // {key: HTMLImageElement} keyed by src
    this.frame = null;
    this.frameKey = "";
    this.frameRect = null;             // CSS px rect of the composed cabinet
    this.frameScale = 1;               // css px per art px (top/bottom bands)
    this.midStretch = 1;               // vertical stretch of the window band
    this.interiorRect = null;          // CSS px rect of the transparent window
    this.worldH = WORLD_W;
    this.cache = {};                   // prescaled render-size images
    this.cacheScale = 0;
    this.cssW = 0; this.cssH = 0; this.dpr = 1;
    // presentation-only animation clocks (paused with the game, reduced-motion
    // aware); never part of gameplay math
    this.animT = 0;
    this.poseK = 0;                    // 0 = open, 1 = closed (visual crossfade)
    this.lastDrawTs = 0;
    this.reduced = !!(root.matchMedia &&
      root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.debugZones = false;           // QA overlay for control hit zones
  }

  Renderer.prototype.resize = function (cssW, cssH) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    // frame choice follows the VIEWPORT aspect (per spec); the artwork is
    // then composed (not squashed) inside the canvas area
    const vw = (root.innerWidth || cssW), vh = (root.innerHeight || cssH);
    this.frame = CC.Assets.selectFrame(vw / Math.max(1, vh));
    this.frameKey = this.frame === CC.Assets.frames.portrait ? "portrait" : "wide";
    this.measure();
    this.primeCache();
  };

  // Compose the cabinet: top marquee + stretchable window band + bottom
  // console (nine-slice on the measured mid band). Prefer filling BOTH
  // viewport axes by stretching only the window band within safe limits;
  // otherwise keep natural proportions and let the painted arcade room fill
  // the remaining strips. Never squash the marquee/console, never crop.
  Renderer.prototype.measure = function () {
    const fr = this.frame;
    const art = { w: fr.width, h: fr.height };
    const m = fr.mid;
    const kMin = this.frameKey === "portrait" ? 0.62 : 0.66;
    const kMax = 2.9;

    let k = 1, s = Math.min(this.cssH / art.h, this.cssW / art.w);
    const sW = this.cssW / art.w;
    const fixedNatH = (m.y0 + (1 - m.y1)) * art.h;    // top + bottom bands
    const midNatH = (m.y1 - m.y0) * art.h;
    const kFill = (this.cssH - sW * fixedNatH) / (sW * midNatH);
    if (kFill >= kMin && kFill <= kMax) { k = kFill; s = sW; }

    this.frameScale = s;
    this.midStretch = k;
    const topH = m.y0 * art.h * s;
    const midH = midNatH * s * k;
    const botH = (1 - m.y1) * art.h * s;
    const w = art.w * s, h = topH + midH + botH;
    this.frameRect = {
      x: (this.cssW - w) / 2, y: (this.cssH - h) / 2, w: w, h: h,
      topH: topH, midH: midH, botH: botH
    };
    const ir = fr.interior;
    const midSpan = m.y1 - m.y0;
    this.interiorRect = {
      x: this.frameRect.x + ir.x * w,
      y: this.frameRect.y + topH + (ir.y - m.y0) / midSpan * midH,
      w: ir.w * w,
      h: ir.h / midSpan * midH
    };
    this.worldH = WORLD_W * (this.interiorRect.h / Math.max(1, this.interiorRect.w));
  };

  // Normalized art-space y -> css px y inside the composed cabinet, mapping
  // through the stretched mid band. Used by drawing AND hit-testing.
  Renderer.prototype.yMap = function (ny) {
    const fr = this.frame, m = fr.mid, F = this.frameRect;
    if (ny <= m.y0) return F.y + ny / m.y0 * F.topH;
    if (ny >= m.y1) return F.y + F.topH + F.midH + (ny - m.y1) / (1 - m.y1) * F.botH;
    return F.y + F.topH + (ny - m.y0) / (m.y1 - m.y0) * F.midH;
  };

  // CSS px rect of a named control hit zone (left/right/drop/joy).
  Renderer.prototype.ctlRect = function (name) {
    const c = this.frame && this.frame.controls;
    if (!c || !c[name]) return null;
    const r = c[name];
    const F = this.frameRect;
    const y0 = this.yMap(r.y);
    const y1 = this.yMap(r.y + r.h);
    return { x: F.x + r.x * F.w, y: y0, w: r.w * F.w, h: y1 - y0 };
  };

  // Marquee (top band) rectangle in CSS px - HUD and logo anchor.
  Renderer.prototype.marqueeRect = function () {
    const F = this.frameRect;
    return { x: F.x, y: F.y, w: F.w, h: F.topH };
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
    const prescale = (key, srcRectNorm, outW, outH) => {
      const img = this.images[key];
      if (!img) return null;
      const sx = srcRectNorm.x * img.naturalWidth;
      const sy = srcRectNorm.y * img.naturalHeight;
      const sw = srcRectNorm.w * img.naturalWidth;
      const sh = srcRectNorm.h * img.naturalHeight;
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(outW * dpr));
      cv.height = Math.max(1, Math.round((outH || cv.width * (sh / sw)) * dpr));
      const cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      return cv;
    };

    // composed cabinet: three vertical slices around the stretched mid band
    const fr = this.frame, m = fr.mid, F = this.frameRect;
    const img = this.images[fr.src];
    if (img) {
      const cv = document.createElement("canvas");
      cv.width = Math.max(2, Math.round(F.w * dpr));
      cv.height = Math.max(2, Math.round(F.h * dpr));
      const cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      const slice = (sy0, sy1, dy, dh) => cx.drawImage(img,
        0, sy0 * img.naturalHeight, img.naturalWidth, (sy1 - sy0) * img.naturalHeight,
        0, dy * dpr, cv.width, dh * dpr);
      slice(0, m.y0, 0, F.topH);
      slice(m.y0, m.y1, F.topH, F.midH);
      slice(m.y1, 1, F.topH + F.midH, F.botH);
      this.cache["frame:" + this.frameKey] = cv;
    }

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

    // static scene dressing, rebuilt only per size bucket
    this.cache["room"] = this.buildRoom();
    this.cache["backdrop"] = this.buildBackdrop();
    this.cache["glass"] = this.buildGlassFX();
  };

  // The arcade hall OUTSIDE the cabinet: warm bokeh room matching the
  // approved reference (deep magenta-violet with glowing pinks/oranges/cyans
  // and neon strip lights). Painted full-canvas so letterbox strips and the
  // sides of wide viewports never show a flat page color.
  Renderer.prototype.buildRoom = function () {
    const dpr = this.dpr;
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(this.cssW * dpr));
    cv.height = Math.max(2, Math.round(this.cssH * dpr));
    const cx = cv.getContext("2d");
    cx.scale(dpr, dpr);
    const W = this.cssW, H = this.cssH;
    const glow = (x, y, r, color, a) => {
      const g = cx.createRadialGradient(x, y, r * 0.05, x, y, r);
      g.addColorStop(0, "rgba(" + color + "," + a + ")");
      g.addColorStop(0.6, "rgba(" + color + "," + (a * 0.4).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + color + ",0)");
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
    };

    let g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a1145");
    g.addColorStop(0.5, "#3d1a5e");
    g.addColorStop(1, "#1d0c33");
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);

    // soft warm halo behind the machine
    glow(W * 0.5, H * 0.42, Math.max(W, H) * 0.55, "255,150,90", 0.16);
    glow(W * 0.5, H * 0.30, Math.max(W, H) * 0.34, "255,190,120", 0.10);

    // big blurred arcade bokeh (pink/cyan/gold/violet)
    const R = Math.max(W, H);
    [[0.10, 0.16, 0.130, "255,120,200", 0.30], [0.24, 0.34, 0.100, "140,190,255", 0.24],
     [0.80, 0.14, 0.150, "255,170,90", 0.28], [0.90, 0.40, 0.110, "120,230,255", 0.24],
     [0.06, 0.72, 0.120, "200,130,255", 0.24], [0.92, 0.78, 0.100, "255,140,120", 0.22],
     [0.36, 0.10, 0.070, "255,220,130", 0.20], [0.66, 0.30, 0.080, "255,160,220", 0.20]]
     .forEach(b => glow(b[0] * W, b[1] * H, b[2] * R, b[3], b[4]));

    // neon strip lights along the top and floor edges
    [["255,110,190", 0.045], ["110,220,255", 0.955]].forEach(s => {
      const y = s[1] * H;
      const lg = cx.createLinearGradient(0, y - H * 0.02, 0, y + H * 0.02);
      lg.addColorStop(0, "rgba(" + s[0] + ",0)");
      lg.addColorStop(0.5, "rgba(" + s[0] + ",0.30)");
      lg.addColorStop(1, "rgba(" + s[0] + ",0)");
      cx.fillStyle = lg;
      cx.fillRect(0, y - H * 0.02, W, H * 0.04);
    });

    // gentle floor shading so the machine sits in the room
    g = cx.createLinearGradient(0, H * 0.72, 0, H);
    g.addColorStop(0, "rgba(20,8,40,0)");
    g.addColorStop(1, "rgba(16,6,34,0.55)");
    cx.fillStyle = g;
    cx.fillRect(0, H * 0.7, W, H * 0.3);
    return cv;
  };

  // Bright starry arcade interior behind the glass with a dense plush pile,
  // matching the approved reference. Cached once per size bucket; purely
  // decorative - never interactive, never labelled, always behind the
  // playable toys.
  Renderer.prototype.buildBackdrop = function () {
    const ir = this.interiorRect, dpr = this.dpr;
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(ir.w * dpr));
    cv.height = Math.max(2, Math.round(ir.h * dpr));
    const cx = cv.getContext("2d");
    cx.scale(dpr, dpr);
    const W = ir.w, H = ir.h;
    const glow = (x, y, r, color, a) => {
      const g = cx.createRadialGradient(x, y, r * 0.08, x, y, r);
      g.addColorStop(0, "rgba(" + color + "," + a + ")");
      g.addColorStop(0.65, "rgba(" + color + "," + (a * 0.45).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + color + ",0)");
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
    };

    // violet hall with a warm ceiling light (bright, never dark in PLAYING)
    let g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#6d31c4");
    g.addColorStop(0.34, "#8b46d4");
    g.addColorStop(0.62, "#7b36c2");
    g.addColorStop(1, "#5d27a6");
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    glow(W * 0.5, H * 0.02, H * 0.62, "255,205,130", 0.20);
    glow(W * 0.08, H * 0.22, H * 0.34, "120,220,255", 0.10);
    glow(W * 0.92, H * 0.24, H * 0.36, "255,130,215", 0.11);

    // crescent moon + sparkle stars (phone reference motif, subtle)
    const mr = Math.max(7, H * 0.045);
    const mx = W * 0.82, my = H * 0.10;
    glow(mx, my, mr * 2.6, "255,240,200", 0.30);
    cx.fillStyle = "#fff3c8";
    cx.beginPath(); cx.arc(mx, my, mr, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = "#8b46d4";
    cx.beginPath(); cx.arc(mx + mr * 0.42, my - mr * 0.18, mr * 0.86, 0, Math.PI * 2); cx.fill();
    const sparkle = (x, y, r, color) => {
      glow(x, y, r * 2.0, color, 0.22);
      cx.fillStyle = "rgba(255,255,240,0.92)";
      cx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 === 0 ? r : r * 0.36;
        const a = i * Math.PI / 4;
        const sx = Math.cos(a) * rr, sy = Math.sin(a) * rr;
        i === 0 ? cx.moveTo(sx, sy) : cx.lineTo(sx, sy);
      }
      cx.closePath(); cx.fill();
    };
    CC.Assets.backdrop.stars.forEach((s, i) =>
      sparkle(s[0] * W, s[1] * H, Math.max(2.2, (2.6 + (i % 3)) * H / 460),
        i % 3 === 0 ? "255,210,120" : i % 3 === 1 ? "160,220,255" : "255,160,210"));

    // soft plush-pile mound the rows sink into
    g = cx.createLinearGradient(0, H * 0.42, 0, H);
    g.addColorStop(0, "rgba(64,26,128,0)");
    g.addColorStop(0.5, "rgba(84,40,150,0.45)");
    g.addColorStop(1, "rgba(110,58,180,0.65)");
    cx.fillStyle = g;
    cx.fillRect(0, H * 0.40, W, H * 0.60);

    // dense decorative plush pile: back rows small/soft, front rows large
    const frontPx = Math.min(H * 0.5, (W / 3) * 1.3); // approx front-toy px size
    CC.Assets.backdrop.rows.forEach((row, ri) => {
      const th = row.scale * frontPx;
      const baseY = row.baseY * H;
      for (let i = 0; i < row.count; i++) {
        const img = this.cache["toy:" + ((i * 3 + ri * 2) % CC.Assets.toys.length)];
        if (!img) continue;
        const hash = Math.sin(i * 137.13 + ri * 61.7) * 43758.5;
        const frac = hash - Math.floor(hash);
        const jx = (frac - 0.5) * row.jitter * (W / row.count);
        const jy = Math.sin(i * 91.7 + ri * 43.3) * th * 0.10;
        const x = ((i + 0.5) / row.count) * W + jx;
        const y = baseY + jy - th / 2;
        cx.globalAlpha = row.alpha * 0.92;
        cx.drawImage(img, x - th / 2, y, th, th);
        cx.globalAlpha = 1;
      }
      // soft contact shadow line under each row to build pile depth
      cx.fillStyle = "rgba(30,10,64," + (0.10 + ri * 0.05).toFixed(2) + ")";
      cx.fillRect(0, baseY - th * 0.04, W, Math.max(2, th * 0.07));
    });

    // warm glossy shelf band under the pile (reflective lower shelf)
    g = cx.createLinearGradient(0, H * 0.955, 0, H);
    g.addColorStop(0, "rgba(255,214,150,0.30)");
    g.addColorStop(0.4, "rgba(255,196,120,0.16)");
    g.addColorStop(1, "rgba(170,110,225,0.18)");
    cx.fillStyle = g;
    cx.fillRect(0, H * 0.95, W, H * 0.05);
    glow(W * 0.5, H * 0.985, W * 0.44, "255,210,140", 0.16);
    return cv;
  };

  // Glass highlights over the toys, under the cabinet frame: brighter light
  // streaks, a warm top glow and a light inner rim that reads as the window
  // catching the neon. No dark vignette - the scene stays bright.
  Renderer.prototype.buildGlassFX = function () {
    const ir = this.interiorRect, dpr = this.dpr;
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(ir.w * dpr));
    cv.height = Math.max(2, Math.round(ir.h * dpr));
    const cx = cv.getContext("2d");
    cx.scale(dpr, dpr);
    const W = ir.w, H = ir.h;

    [[0.24, 0.085, 0.06], [0.56, 0.06, 0.038]].forEach(s => {
      cx.save();
      cx.translate(s[0] * W, 0);
      cx.rotate(-0.42);
      const g = cx.createLinearGradient(0, 0, 0, H * 1.2);
      g.addColorStop(0, "rgba(255,255,255," + s[2] + ")");
      g.addColorStop(0.5, "rgba(255,255,255," + (s[2] * 0.45).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = g;
      cx.fillRect(-s[1] * W / 2, -H * 0.25, s[1] * W, H * 1.55);
      cx.restore();
    });

    let g = cx.createLinearGradient(0, 0, 0, H * 0.15);
    g.addColorStop(0, "rgba(255,238,222,0.13)");
    g.addColorStop(1, "rgba(255,238,222,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H * 0.15);

    // light inner rim (glass edge catching the arcade lights)
    const e = Math.max(2, H * 0.0045);
    cx.strokeStyle = "rgba(255,222,255,0.20)";
    cx.lineWidth = e;
    cx.strokeRect(e / 2, e / 2, W - e, H - e);
    return cv;
  };

  // ---- world -> screen ------------------------------------------------------
  Renderer.prototype.wx = function (x) { return this.interiorRect.x + x / WORLD_W * this.interiorRect.w; };
  Renderer.prototype.wy = function (y) { return this.interiorRect.y + y / this.worldH * this.interiorRect.h; };
  Renderer.prototype.wsx = function (w) { return w / WORLD_W * this.interiorRect.w; };
  Renderer.prototype.wsy = function (h) { return h / this.worldH * this.interiorRect.h; };

  // Question card geometry in world units, shared by layout and drawing.
  Renderer.prototype.cardWorld = function () {
    const worldH = this.worldH;
    const w = Math.min(0.90 * WORLD_W, worldH * 0.40);
    return { x: (WORLD_W - w) / 2, y: worldH * 0.012, w: w, h: w / 3 };
  };

  // Gameplay layout for the current frame, used by the game module.
  // Everything scales with the frame's interior aspect so wide, tall and
  // narrow windows all get a readable card, a traveling claw and a toy row
  // that the claw can actually reach with visible descent.
  Renderer.prototype.computeLayout = function (choiceCount) {
    const worldH = this.worldH;
    const laneW = WORLD_W / choiceCount;
    // wide plates (0.56 of the toy square) still stay inside one lane at
    // 1.55x, so neighbouring answer plates never cover each other; the
    // worldH cap keeps a visible claw descent between card and toys
    const toyHeight = Math.min(worldH * 0.47, laneW * 1.55);
    const headAspect = ((CC.Assets.clawOpen.headRect.h / CC.Assets.clawOpen.headRect.w) +
      (CC.Assets.clawClosed.headRect.h / CC.Assets.clawClosed.headRect.w)) / 2;
    const clawHeadW = toyHeight * 0.55;               // claw sized like the toys
    const clawHeadWorldH = clawHeadW * headAspect;
    const card = this.cardWorld();
    const toyRowBottomY = worldH * 0.985;
    const toyTop = toyRowBottomY - toyHeight;
    // rail: the claw hangs above the toy tops, but never up inside the card
    const railY = Math.max(
      Math.min(card.y + card.h + worldH * 0.015,
        Math.max(worldH * 0.06, toyTop - clawHeadWorldH - worldH * 0.012)),
      card.y + card.h + worldH * 0.012
    );
    // capture: fingers close around the toy's upper body (below the head)
    const captureTipsY = toyTop + toyHeight * 0.40;
    const captureY = Math.max(captureTipsY - clawHeadWorldH, railY + 1);
    return {
      worldW: WORLD_W,
      worldH: worldH,
      railY: railY,
      toyRowBottomY: toyRowBottomY,
      toyHeight: toyHeight,
      clawHeadW: clawHeadW,
      clawHeadWorldH: clawHeadWorldH,
      captureY: captureY, // claw housing y at capture
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

  // Pointer hit test against the artwork's pictured buttons (mapped through
  // the same composed geometry that draws them) or the interior.
  Renderer.prototype.hitTest = function (clientX, clientY) {
    if (!this.frameRect) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * this.cssW;
    const y = (clientY - rect.top) / rect.height * this.cssH;
    const c = this.frame.controls;
    if (c) {
      const names = ["drop", "left", "right"];
      for (let i = 0; i < names.length; i++) {
        const r = this.ctlRect(names[i]);
        if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          return names[i];
        }
      }
    }
    const ir = this.interiorRect;
    if (x >= ir.x && x <= ir.x + ir.w && y >= ir.y && y <= ir.y + ir.h) return "interior";
    return null;
  };

  // ---- drawing ---------------------------------------------------------------
  // Z-order: (A) arcade room, (B) interior + plush pile, (C) toys,
  // (D) claw, (E) glass FX, (F) composed cabinet frame, (G) card/HUD/
  // control glows, (H) feedback.
  Renderer.prototype.draw = function (game, hint) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // presentation clocks advance only while the game actually runs, so
    // pause freezes every visual mid-pose and reduced motion can zero them
    const nowTs = now();
    if (game && !game.paused && this.lastDrawTs) {
      let dt = (nowTs - this.lastDrawTs) / 1000;
      if (dt > 0.1) dt = 0.016;
      this.animT += this.reduced ? 0 : dt;
      const target = game.claw.pose === "closed" ? 1 : 0;
      const step = dt / 0.2; // anchored open<->closed crossfade over ~0.2s
      this.poseK += Math.max(-step, Math.min(step, target - this.poseK));
    }
    this.lastDrawTs = nowTs;

    this.drawImageCached("room", { x: 0, y: 0, w: this.cssW, h: this.cssH });
    this.drawImageCached("backdrop", this.interiorRect);

    if (!game || !game.layout) {
      this.drawImageCached("frame:" + this.frameKey, this.frameRect);
      return;
    }

    this.drawCollectionSlot(game);
    this.drawToys(game);
    this.drawClaw(game);
    this.drawImageCached("glass", this.interiorRect);
    this.drawImageCached("frame:" + this.frameKey, this.frameRect);
    this.drawCard(game);
    this.drawHUD(game);
    this.drawShelf(game, hint || {});
    if (game.state === "FEEDBACK" && game.feedback) this.drawFeedback(game);
  };

  Renderer.prototype.drawImageCached = function (key, r) {
    const img = this.cache[key];
    if (img) this.ctx.drawImage(img, r.x, r.y, r.w, r.h);
  };

  Renderer.prototype.drawToys = function (game) {
    const ctx = this.ctx;
    const size = this.wsx(game.layout.toyHeight);
    game.toys.forEach(t => {
      if (t.collected) return;
      const img = this.cache["toy:" + t.assetIndex];
      if (!img) return;
      // gentle visual bob only - the x position the claw can catch stays
      // exactly the engine's, so hit regions and visuals never diverge
      const bob = (this.reduced || t.carried) ? 0 :
        Math.sin(this.animT * 2.1 + t.phase * 2.7) * size * 0.012;
      const cx = this.wx(t.x);
      const cy = this.wy(t.y) + bob;
      if (!t.carried) {
        ctx.fillStyle = "rgba(12,4,30,0.28)";
        ctx.beginPath();
        ctx.ellipse(cx, this.wy(t.y) + size * 0.46, size * 0.30, size * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      // word label on the toy's blank plate, following the toy as one object
      const a = CC.Assets.toys[t.assetIndex];
      const lr = a.labelRect;
      const px = cx - size / 2 + lr.x * size;
      const py = cy - size / 2 + lr.y * size;
      const pw = lr.w * size, ph = lr.h * size;
      this.drawFittedText(t.text, px + pw * 0.04, py + ph * 0.05, pw * 0.92, ph * 0.90,
        { color: "#251a4d", bold: true, maxLines: 2 });
    });
  };

  Renderer.prototype.drawClaw = function (game) {
    const ctx = this.ctx;
    const claw = game.claw;
    const grip = claw.gripPoint();
    // subtle idle sway while aiming (presentation only, never affects aiming)
    const idle = (!this.reduced && game.state === "AIMING") ?
      Math.sin(this.animT * 1.3) * this.wsx(WORLD_W * 0.0015) : 0;
    const headX = this.wx(grip.x) + idle;
    const headTopY = this.wy(claw.y);
    const headW = this.wsx(game.layout.clawHeadW);

    // warm spotlight shaft from the rail down onto the claw (decorative)
    const shaftW = headW * 2.2;
    const lg = ctx.createLinearGradient(0, this.interiorRect.y, 0, headTopY + headW * 0.9);
    lg.addColorStop(0, "rgba(255,228,175,0.11)");
    lg.addColorStop(1, "rgba(255,228,175,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(headX - shaftW / 2, this.interiorRect.y, shaftW,
      headTopY + headW * 0.9 - this.interiorRect.y);

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

    // anchored open<->closed crossfade: both poses share the housing top
    // anchor and width, so the metal body stays put while fingers close
    const drawHead = (img, alpha) => {
      ctx.globalAlpha = alpha;
      const hh = headW * (img.height / img.width);
      ctx.drawImage(img, headX - headW / 2, headTopY, headW, hh);
    };
    const k = this.poseK;
    if (k < 0.999 && this.cache["claw:open"]) drawHead(this.cache["claw:open"], 1 - k);
    if (k > 0.001 && this.cache["claw:closed"]) drawHead(this.cache["claw:closed"], k);
    ctx.globalAlpha = 1;
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

  // ---- marquee HUD + logo -----------------------------------------------------

  Renderer.prototype.font = function (weight, px) {
    return weight + " " + px + "px system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
  };

  Renderer.prototype.plaque = function (x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(58,26,20,0.82)";
    roundRect(ctx, x, y, w, h, h * 0.34);
    ctx.fill();
    // glowing gold rim - the plaque reads as a lit arcade panel
    ctx.save();
    ctx.shadowColor = "rgba(255,190,80,0.9)";
    ctx.shadowBlur = Math.max(4, h * 0.28);
    ctx.strokeStyle = CC.Assets.palette.gold;
    ctx.lineWidth = Math.max(1.5, h * 0.075);
    roundRect(ctx, x, y, w, h, h * 0.34);
    ctx.stroke();
    ctx.restore();
  };

  // HUD lives inside the cabinet's marquee band (measured top band), never
  // over the playfield: pause+level+progress left, hearts center, score and
  // clock right, CLAW CHAOS logo centered below them.
  Renderer.prototype.drawHUD = function (game) {
    const ctx = this.ctx;
    const mq = this.marqueeRect();
    if (mq.h < 30) return; // ultra-short marquee: HUD would be unreadable
    const u = Math.max(14, Math.min(mq.h * 0.28, mq.w * 0.07)); // plaque height
    const rowY = mq.y + mq.h * 0.12;

    // --- left cluster: level plaque + question progress, right of pause ---
    let leftX = mq.x + Math.max(mq.w * 0.035, this.pauseRightPx() + 6);
    ctx.font = this.font(800, u * 0.56);
    const lvlTxt = "LV " + game.level.id;
    const lvlW = ctx.measureText(lvlTxt).width + u * 0.7;
    this.plaque(leftX, rowY, lvlW, u);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = CC.Assets.palette.ivory;
    ctx.fillText(lvlTxt, leftX + lvlW / 2, rowY + u * 0.54);

    const prog = "Q " + (game.qIndex + 1) + "/" + game.level.questionIds.length;
    ctx.font = this.font(800, u * 0.52);
    const progW = ctx.measureText(prog).width + u * 0.6;
    this.plaque(leftX + lvlW + u * 0.35, rowY, progW, u);
    ctx.fillStyle = "rgba(255,241,215,0.95)";
    ctx.fillText(prog, leftX + lvlW + u * 0.35 + progW / 2, rowY + u * 0.54);

    // --- right cluster: score over clock, right-aligned ---
    const rightX = mq.x + mq.w * 0.96;
    const t = Math.max(0, game.timeLeft);
    const grace = game.graceLeft > 0 && game.state === "AIMING";
    const timeTxt = grace ? "READY" :
      String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0");
    const danger = !grace && t <= 10 && game.state === "AIMING" && game.hearts > 0;
    const pulse = danger && !this.reduced ? 1 + 0.045 * Math.sin(this.animT * 7) : 1;
    ctx.font = this.font(800, u * 0.52);
    const clkW = (ctx.measureText(timeTxt).width + u * 0.8) * pulse;
    const clkH = u * pulse;
    const cy0 = rowY + (u - clkH) / 2;
    this.plaque(rightX - clkW, cy0, clkW, clkH);
    ctx.textAlign = "right";
    ctx.fillStyle = danger ? CC.Assets.palette.danger : CC.Assets.palette.ivory;
    ctx.fillText(timeTxt, rightX - u * 0.28, cy0 + clkH * 0.54);

    ctx.font = this.font(800, u * 0.56);
    const scoreTxt = String(game.score);
    const scoreW = ctx.measureText(scoreTxt).width + u * 1.35;
    this.plaque(rightX - clkW - u * 0.3 - scoreW, rowY, scoreW, u);
    const starC = rightX - clkW - u * 0.3 - scoreW + u * 0.52;
    starPath(ctx, starC, rowY + u * 0.5, u * 0.34);
    const sg = ctx.createLinearGradient(starC, rowY + u * 0.16, starC, rowY + u * 0.84);
    sg.addColorStop(0, "#ffe9a8");
    sg.addColorStop(1, "#f0a93c");
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = "rgba(90,50,0,0.8)";
    ctx.lineWidth = Math.max(1, u * 0.04);
    starPath(ctx, starC, rowY + u * 0.5, u * 0.34);
    ctx.stroke();
    ctx.fillStyle = CC.Assets.palette.ivory;
    ctx.fillText(scoreTxt, rightX - clkW - u * 0.3 - u * 0.26, rowY + u * 0.54);

    // --- hearts centered between the clusters ---
    const hs = u * 0.66;
    const heartsCx = mq.x + mq.w / 2;
    for (let i = 0; i < 3; i++) {
      const hx = heartsCx + (i - 1) * hs * 1.5;
      const hy = rowY + u * 0.5;
      const on = i < game.hearts;
      heartPath(ctx, hx, hy, hs);
      if (on) {
        const hg = ctx.createLinearGradient(hx, hy - hs / 2, hx, hy + hs / 2);
        hg.addColorStop(0, "#ff8ba0");
        hg.addColorStop(1, "#e5173f");
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(hx - hs * 0.16, hy - hs * 0.22, hs * 0.14, hs * 0.09, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(60,6,24,0.8)";
      } else {
        ctx.strokeStyle = "rgba(20,10,40,0.5)";
      }
      ctx.lineWidth = Math.max(1, u * 0.045);
      heartPath(ctx, hx, hy, hs);
      ctx.stroke();
    }

    // --- CLAW CHAOS logo centered in the remaining marquee space ---
    const logoY = rowY + u + mq.h * 0.045;
    const logoH = Math.min((mq.y + mq.h * 0.96) - logoY, mq.h * 0.44);
    if (logoH >= 12) this.drawLogo(mq.x + mq.w / 2, logoY, mq.w * 0.74, logoH);
  };

  // Right edge of the DOM pause button in canvas coordinates, so the level
  // plaque never slides under it. Falls back to a safe inset.
  Renderer.prototype.pauseRightPx = function () {
    const btn = this.canvas.ownerDocument.getElementById("btn-pause");
    if (!btn || btn.classList.contains("hidden")) return 0;
    const r = btn.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    return r.right - c.left;
  };

  Renderer.prototype.drawLogo = function (cx, y, maxW, maxH) {
    const ctx = this.ctx;
    let fs = maxH;
    let w;
    ctx.font = this.font(900, fs);
    w = ctx.measureText("CLAW CHAOS").width;
    if (w > maxW) { fs *= maxW / w; ctx.font = this.font(900, fs); }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.save();
    ctx.shadowColor = "rgba(80,30,0,0.55)";
    ctx.shadowBlur = fs * 0.18;
    ctx.shadowOffsetY = fs * 0.06;
    ctx.lineWidth = Math.max(2, fs * 0.14);
    ctx.strokeStyle = "#5a2a00";
    ctx.lineJoin = "round";
    ctx.strokeText("CLAW CHAOS", cx, y);
    const g = ctx.createLinearGradient(0, y, 0, y + fs);
    g.addColorStop(0, "#fff3c0");
    g.addColorStop(0.55, "#ffc23e");
    g.addColorStop(1, "#ff8b36");
    ctx.fillStyle = g;
    ctx.fillText("CLAW CHAOS", cx, y);
    ctx.restore();
  };

  // ---- control faces ----------------------------------------------------------
  // The approved cabinet artwork already draws the joystick, arrows and DROP
  // button; these overlays only add subtle live-state glows (never a second
  // set of buttons) plus the optional QA zone overlay.

  Renderer.prototype.drawShelf = function (game, hint) {
    const c = this.frame && this.frame.controls;
    if (!c) return;
    const ctx = this.ctx;
    const dir = hint.dir || 0;
    const dropFlash = hint.dropAt && (now() - hint.dropAt) < 260;

    const glowOn = (name, hot) => {
      if (!hot) return;
      const b = this.ctlRect(name);
      if (!b) return;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, b.x, b.y, b.w, b.h, b.h * 0.35);
      ctx.fill();
      ctx.restore();
    };
    glowOn("left", dir < 0);
    glowOn("right", dir > 0);
    glowOn("drop", dropFlash);

    if (this.debugZones) {
      const names = ["left", "right", "drop", "joy"];
      names.forEach(n => {
        const r = this.ctlRect(n);
        if (!r) return;
        ctx.save();
        ctx.strokeStyle = n === "drop" ? "#00e5ff" : "#ff4dd2";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = this.font(800, 12);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(n, r.x + 2, r.y + 2);
        ctx.restore();
      });
    }
  };

  // Compact colorful notification pill under the question card. It never
  // reaches the toy row, so the targets stay visible while it is up.
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
    if (sub.length > 72) sub = sub.slice(0, 69).trimEnd() + "\u2026";

    const styles = {
      correct: { top: "#46e08c", bot: "#1d9e63", glow: "rgba(70,224,140,0.9)" },
      wrong: { top: "#ff7d9d", bot: "#d63463", glow: "rgba(255,125,157,0.9)" },
      empty: { top: "#ffc95e", bot: "#f09022", glow: "rgba(255,201,94,0.9)" },
      timeout: { top: "#c78bff", bot: "#8a2ac5", glow: "rgba(199,139,255,0.9)" }
    };
    const st = styles[fb.kind] || styles.empty;
    const ir = this.interiorRect;
    const w = Math.min(ir.w * 0.92, ir.w);
    const h = Math.max(34, ir.h * 0.115);
    const x = this.wx(game.layout.collectX) - w / 2;
    const y = this.wy(game.layout.cardBottom + game.layout.worldH * 0.02);

    ctx.save();
    ctx.shadowColor = st.glow;
    ctx.shadowBlur = Math.max(8, h * 0.35);
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, st.top);
    grad.addColorStop(1, st.bot);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, h * 0.5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(2, h * 0.06);
    roundRect(ctx, x, y, w, h, h * 0.5);
    ctx.stroke();

    this.drawFittedText(title, x + w * 0.05, y + h * 0.08, w * 0.9, h * 0.42,
      { color: "#ffffff", bold: true, maxLines: 1, noStroke: true });
    this.drawFittedText(sub, x + w * 0.06, y + h * 0.50, w * 0.88, h * 0.42,
      { color: "#ffffff", maxLines: 1, noStroke: true });
    ctx.restore();
  };

  // Text that must fit a box: start at the largest single-line size, then
  // shrink until it wraps within maxLines and never clips.
  Renderer.prototype.drawFittedText = function (text, x, y, w, h, opts) {
    const ctx = this.ctx;
    opts = opts || {};
    const maxLines = opts.maxLines || 2;
    const bold = opts.bold !== false;
    let fs = h / 1.15;
    let lines;
    for (let guard = 0; guard < 28; guard++) {
      ctx.font = (bold ? "bold " : "") + fs + "px system-ui, sans-serif";
      lines = wrapText(ctx, text, w);
      if (lines.length <= maxLines &&
          lines.every(l => ctx.measureText(l).width <= w) &&
          fs * lines.length * 1.12 <= h) break;
      fs *= 0.94;
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

  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.32);
    ctx.bezierCurveTo(x - s * 0.62, y - s * 0.14, x - s * 0.36, y - s * 0.62, x, y - s * 0.30);
    ctx.bezierCurveTo(x + s * 0.36, y - s * 0.62, x + s * 0.62, y - s * 0.14, x, y + s * 0.32);
    ctx.closePath();
  }

  function starPath(ctx, cx, cy, R) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? R : R * 0.46;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  CC.Renderer = Renderer;
  return Renderer;
});
