/*
 * Asset integrity: files exist, dimensions match calibration, paths are
 * deployment-safe (relative, no host, no leading slash).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const CC = globalThis.CC;

const ROOT = path.join(__dirname, "..");

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.eq(b.readUInt32BE(12), 0x49484452, file + " missing IHDR");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function checkPath(src, what) {
  assert.ok(typeof src === "string" && src.length > 0, what + ": empty path");
  assert.ok(!/^[a-z]+:\/\//i.test(src), what + ": must not be absolute URL: " + src);
  assert.ok(!src.startsWith("/"), what + ": must not be root-relative: " + src);
  assert.ok(!src.includes("localhost") && !src.includes("127.0.0.1"),
    what + ": must not hardcode a host");
  const abs = path.join(ROOT, src);
  assert.ok(fs.existsSync(abs), what + ": file missing: " + src);
  return abs;
}

test("every referenced asset exists with the calibrated dimensions", () => {
  const A = CC.Assets;
  [A.clawOpen, A.clawClosed].forEach((c, i) => {
    const abs = checkPath(c.src, "claw " + i);
    const s = pngSize(abs);
    assert.eq(s.w, c.width, c.src + " width");
    assert.eq(s.h, c.height, c.src + " height");
  });
  A.toys.forEach((t, i) => {
    const abs = checkPath(t.src, "toy " + i);
    const s = pngSize(abs);
    assert.eq(s.w, 3840, t.src + " width");
    assert.eq(s.h, 3840, t.src + " height");
  });
  ["wide", "portrait", "desktop", "ipad", "phone"].forEach(k => {
    const f = A.frames[k];
    const abs = checkPath(f.src, "frame " + k);
    const s = pngSize(abs);
    assert.eq(s.w, f.width, f.src + " width");
    assert.eq(s.h, f.height, f.src + " height");
  });
  const abs = checkPath(A.questionCard.src, "question card");
  const s = pngSize(abs);
  assert.eq(s.w, 2172, "card width");
  assert.eq(s.h, 724, "card height");
});

test("the two claw poses keep their distinct sizes (1254 vs 1945x3840)", () => {
  const A = CC.Assets;
  assert.eq(A.clawOpen.width, 1254);
  assert.eq(A.clawOpen.height, 1254);
  assert.eq(A.clawClosed.width, 1945);
  assert.eq(A.clawClosed.height, 3840);
  // separate head rectangles exist for both poses (no same-size swap)
  assert.ok(A.clawOpen.headRect && A.clawClosed.headRect);
  assert.notEq(A.clawOpen.headRect.y, A.clawClosed.headRect.y,
    "head regions differ because padding differs");
  assert.ok(A.clawClosed.cableStrip, "closed pose supplies the cable strip");
});

test("calibration rectangles are sane (inside unit square, non-empty)", () => {
  const A = CC.Assets;
  const rects = [A.clawOpen.headRect, A.clawClosed.headRect, A.clawClosed.cableStrip,
    A.questionCard.textRect];
  A.toys.forEach(t => rects.push(t.labelRect));
  ["wide", "portrait", "desktop", "ipad", "phone"].forEach(k => {
    const f = A.frames[k];
    rects.push(f.interior);
    // mid band: ordered vertical span inside the art
    assert.ok(f.mid.y0 > 0 && f.mid.y1 < 1 && f.mid.y0 < f.mid.y1,
      k + ": bad mid band " + JSON.stringify(f.mid));
    const c = f.controls;
    if (c) ["left", "right", "drop"].forEach(n => rects.push(c[n]));
  });
  rects.forEach((r, i) => {
    assert.ok(r && r.x >= 0 && r.y >= 0, "rect " + i + " origin in range");
    assert.ok(r.w > 0 && r.h > 0, "rect " + i + " non-empty");
    assert.ok(r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "rect " + i + " inside image");
  });
});

test("toy label plates sit in the measured band (y .54-.78 of the image)", () => {
  CC.Assets.toys.forEach(t => {
    const r = t.labelRect;
    assert.ok(r.y >= 0.50 && r.y + r.h <= 0.80,
      t.src + " label plate outside measured band");
    assert.ok(r.w >= 0.30 && r.w <= 0.60, t.src + " label plate width unexpected");
  });
});

test("frame selection is aspect-based (no user-agent logic)", () => {
  const A = CC.Assets;
  // portrait phones and portrait tablets get the tall cabinet
  assert.eq(A.selectFrame(390 / 844), A.frames.portrait);
  assert.eq(A.selectFrame(320 / 568), A.frames.portrait);
  assert.eq(A.selectFrame(768 / 1024), A.frames.portrait, "portrait tablet uses tall cabinet");
  // desktop / landscape phone / landscape tablet get the wide cabinet
  assert.eq(A.selectFrame(1920 / 1080), A.frames.wide);
  assert.eq(A.selectFrame(844 / 390), A.frames.wide, "phone landscape reuses the wide frame");
  assert.eq(A.selectFrame(1024 / 768), A.frames.wide);
  // wide 21:9 still the wide cabinet
  assert.eq(A.selectFrame(2.4), A.frames.wide);
});

test("active cabinets are the approved art with drawn-in controls", () => {
  const A = CC.Assets;
  A.activeFrames.forEach(k => {
    const f = A.frames[k];
    assert.ok(!f.legacy, k + " must be a primary frame");
    assert.ok(f.controls && f.controls.drawn === true,
      k + ": approved art already draws its controls");
    // the stretchable mid band must contain the whole interior window
    assert.ok(f.mid.y0 <= f.interior.y + 1e-6 &&
      f.interior.y + f.interior.h <= f.mid.y1 + 1e-6,
      k + ": interior escapes the stretchable mid band");
  });
});

test("every frame pictures shelf controls with valid, playable hit regions", () => {
  const A = CC.Assets;
  ["wide", "portrait", "phone", "desktop", "ipad"].forEach(k => {
    const f = A.frames[k];
    const c = f.controls;
    assert.ok(c, k + " frame has pictured control hit regions");
    ["left", "right", "drop"].forEach(b => {
      const r = c[b];
      assert.ok(r && r.w > 0 && r.h > 0, k + "." + b + ": missing/empty region");
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1,
        k + "." + b + ": region escapes the frame");
      // controls live in the shelf band, never over the playfield window
      assert.ok(r.y >= f.interior.y + f.interior.h - 0.02,
        k + "." + b + ": region overlaps the interior window");
    });
    // steering regions must not overlap the drop target
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w &&
      a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!hit(c.left, c.drop), k + ": left region overlaps drop");
    assert.ok(!hit(c.right, c.drop), k + ": right region overlaps drop");
  });
});

test("data JSON files parse", () => {
  JSON.parse(fs.readFileSync(path.join(ROOT, "data/questions.json"), "utf8"));
  JSON.parse(fs.readFileSync(path.join(ROOT, "data/levels.json"), "utf8"));
});
