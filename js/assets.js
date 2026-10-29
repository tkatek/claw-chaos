/*
 * CLAW CHAOS - asset registry and per-image calibration.
 * All rectangles are normalized (0..1) within the natural image size.
 * Calibration values come from alpha/pixel analysis of the real PNGs
 * (see qa/alpha_probe.js, qa/phone_probe.js); do not scatter magic numbers.
 */
(function (root, factory) {
  const CC = root.CC || (root.CC = {});
  const api = factory(CC, root);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CC) {

  const Assets = {};

  // ---------------------------------------------------------------- claw ---
  // claw_open_long_cable.png 1254 x 1254
  // content bbox x .1712-.8309, y 0-.9645; cable x .4447-.5595; head y .4342-.9374
  Assets.clawOpen = {
    src: "assets/claw/claw_open_long_cable.png",
    width: 1254,
    height: 1254,
    // housing (head) source rectangle, excluding the long cable above it
    headRect: { x: 0.1712, y: 0.4342, w: 0.6597, h: 0.5303 },
    // normalized pivot inside the image: horizontal center of housing,
    // bottom = finger tips
    gripX: 0.501,
    gripY: 0.9645
  };

  // claw_closed_long_cable.png 1945 x 3840
  // content bbox x .2192-.785, y 0-.9736; cable x .4384-.5678; head y .5533-.9673
  Assets.clawClosed = {
    src: "assets/claw/claw_closed_long_cable.png",
    width: 1945,
    height: 3840,
    headRect: { x: 0.2192, y: 0.5533, w: 0.5658, h: 0.4203 },
    gripX: 0.5021,
    gripY: 0.9736,
    // vertical strip of pure cable used to extend/retract the visible cable
    cableStrip: { x: 0.4384, y: 0.02, w: 0.1294, h: 0.30 }
  };

  // The two housings are drawn at the same world width. In source pixels the
  // closed housing is wider (1101 px vs 827 px), so its draw scale differs.
  Assets.clawHeadWorldWidth = 0.16; // fraction of playfield width
  Assets.clawPoseBlend = {
    open: Assets.clawOpen,
    closed: Assets.clawClosed
  };

  // ---------------------------------------------------------------- toys ---
  // All toys are 3840 x 3840. Each toy holds a blank bright plate in front of
  // its body; labelRect is the interior of that plate (measured per image).
  // gripY: normalized y of the toy top that the claw grabs (content bbox top).
  const toy = (file, plate, contentTop, contentX0, contentX1) => ({
    src: "assets/toys/" + file,
    width: 3840,
    height: 3840,
    labelRect: plate,
    gripY: contentTop,
    contentX0: contentX0,
    contentX1: contentX1
  });

  Assets.toys = [
    toy("toy_01_green_monster.png",
      { x: 0.258, y: 0.542, w: 0.488, h: 0.193 }, 0.0271, 0.0919, 0.9102),
    toy("toy_02_pink_bear.png",
      { x: 0.331, y: 0.546, w: 0.361, h: 0.200 }, 0.0146, 0.1211, 0.8810),
    toy("toy_03_blue_monster.png",
      { x: 0.223, y: 0.537, w: 0.556, h: 0.236 }, 0.0271, 0.0376, 0.9624),
    toy("toy_04_yellow_chick.png",
      { x: 0.294, y: 0.579, w: 0.435, h: 0.194 }, 0.0104, 0.1148, 0.8873),
    toy("toy_05_orange_bear.png",
      { x: 0.331, y: 0.546, w: 0.361, h: 0.200 }, 0.0146, 0.1211, 0.8810),
    toy("toy_06_lavender_bear.png",
      { x: 0.331, y: 0.546, w: 0.361, h: 0.200 }, 0.0146, 0.1211, 0.8810),
    toy("toy_07_purple_monster.png",
      { x: 0.223, y: 0.537, w: 0.556, h: 0.236 }, 0.0271, 0.0376, 0.9624),
    toy("toy_08_teal_monster.png",
      { x: 0.258, y: 0.542, w: 0.488, h: 0.193 }, 0.0271, 0.0919, 0.9102)
  ];

  // -------------------------------------------------------------- frames ---
  // Cabinet artworks with a transparent play window. Rectangles are measured
  // from the real PNGs (qa probes), not guessed:
  //   - interior: the transparent play window inside the art
  //   - mid: the vertically stretchable band (window + its glass rails);
  //     the renderer nine-slices the art there so one portrait cabinet can
  //     fill 393x852, 375x667 and 320x568 without cropping or distortion
  //   - controls: hit zones over the artwork's OWN drawn buttons
  //     (drawn: true => the renderer must never paint a second button set)
  const frame = (src, w, h, interior, mid, controls) => ({
    src: src,
    width: w,
    height: h,
    interior: interior,
    mid: mid,
    controls: controls || null
  });

  // photo_b.png (1448x1086): approved desktop/tablet-landscape cabinet.
  // Window hole y .2551-.6713, x .1775-.8225 (qa/alpha_probe.js).
  // Console buttons (grid-measured, qa/wide_console_zoom.html): red joystick
  // ball x .17-.23, yellow left arrow x .235-.345, purple right arrow
  // x .615-.665, green DROP x .765-.885. Zones pad the circles for touch.
  const wideControls = {
    drawn: true,
    left:  { x: 0.225, y: 0.745, w: 0.130, h: 0.120 },
    right: { x: 0.595, y: 0.745, w: 0.090, h: 0.120 },
    drop:  { x: 0.765, y: 0.750, w: 0.120, h: 0.130 },
    joy:   { x: 0.155, y: 0.750, w: 0.090, h: 0.140 }
  };

  // Horizontal extension columns for the wide cabinet (art-space x ranges
  // that are plain in that vertical section, measured from the PNG):
  //  - marquee: gaps between the bulb rows (bulbs sit at ~5.3% pitch;
  //    these columns avoid every bulb on the y .035/.05/.16/.19 rows)
  //  - mid: the transparent window hole between the glass rails
  //  - console: the plain dark nameplate between the arrow buttons
  // Every section receives the SAME total extra width, distributed over its
  // own columns, so the rails above/below each section stay aligned.
  const wideXb = {
    top: [[0.352, 0.381], [0.455, 0.486], [0.514, 0.543], [0.568, 0.597]],
    mid: [[0.30, 0.70]],
    bottom: [[0.42, 0.50], [0.52, 0.585]]
  };

  // photo_a.png (941x1672): approved portrait phone/tablet cabinet.
  // Window hole y .238-.689, x .2635-.7333. Console buttons (grid-measured,
  // qa/phone_arrows_zoom.html): red joystick x .17-.22, yellow left arrow
  // x .25-.31, purple right arrow x .42-.48, green DROP x .67-.85.
  const portraitControls = {
    drawn: true,
    left:  { x: 0.225, y: 0.795, w: 0.150, h: 0.090 },
    right: { x: 0.385, y: 0.795, w: 0.140, h: 0.090 },
    drop:  { x: 0.665, y: 0.775, w: 0.200, h: 0.130 },
    joy:   { x: 0.120, y: 0.780, w: 0.160, h: 0.120 }
  };

  Assets.frames = {
    // primary cabinets (approved reference art, controls drawn into the art)
    wide: Object.assign(
      frame("assets/backdrop/photo_b.png", 1448, 1086,
        { x: 0.1775, y: 0.2551, w: 0.6450, h: 0.4162 },
        { y0: 0.2551, y1: 0.6713 }, wideControls),
      { xb: wideXb, maxInteriorAspect: 3.1 }),
    portrait: frame("assets/backdrop/photo_a.png", 941, 1672,
      { x: 0.2635, y: 0.2380, w: 0.4698, h: 0.4510 },
      { y0: 0.2380, y1: 0.6890 }, portraitControls),

    // legacy cabinets kept for reference; not selected at runtime
    desktop: Object.assign(
      frame("assets/windows/window_desktop.png", 3840, 2160,
        { x: 0.0292, y: 0.1375, w: 0.9416, h: 0.6989 },
        { y0: 0.1375, y1: 0.8364 },
        {
          drawn: false,
          left:  { x: 0.019, y: 0.842, w: 0.207, h: 0.152 },
          right: { x: 0.226, y: 0.842, w: 0.207, h: 0.152 },
          drop:  { x: 0.622, y: 0.842, w: 0.358, h: 0.152 },
          pad:   { x: 0.019, y: 0.842, w: 0.415, h: 0.152 },
          plate: { x: 0.456, y: 0.842, w: 0.145, h: 0.152 }
        }), { legacy: true }),
    ipad: Object.assign(
      frame("assets/windows/window_ipad.png", 3840, 2880,
        { x: 0.0376, y: 0.1448, w: 0.9248, h: 0.6936 },
        { y0: 0.1448, y1: 0.8384 },
        {
          drawn: false,
          left:  { x: 0.019, y: 0.842, w: 0.207, h: 0.152 },
          right: { x: 0.226, y: 0.842, w: 0.207, h: 0.152 },
          drop:  { x: 0.622, y: 0.842, w: 0.358, h: 0.152 },
          pad:   { x: 0.019, y: 0.842, w: 0.415, h: 0.152 },
          plate: { x: 0.456, y: 0.842, w: 0.145, h: 0.152 }
        }), { legacy: true }),
    phone: Object.assign(
      frame("assets/windows/window_phone.png", 941, 1672,
        { x: 0.211, y: 0.274, w: 0.578, h: 0.362 },
        { y0: 0.274, y1: 0.636 },
        {
          drawn: false,
          left:  { x: 0.08, y: 0.695, w: 0.26, h: 0.165 },
          right: { x: 0.34, y: 0.695, w: 0.22, h: 0.165 },
          drop:  { x: 0.58, y: 0.695, w: 0.32, h: 0.165 }
        }), { legacy: true })
  };

  // Frames the runtime actually loads and renders (the approved cabinets).
  Assets.activeFrames = ["wide", "portrait"];

  // Frame choice by viewport aspect, never by user agent. Wide/landscape
  // (>= 1) uses the wide cabinet; portrait uses the tall cabinet. The
  // renderer nine-slices the mid band so both fill the viewport class well.
  Assets.selectFrame = function (viewportAspect) {
    return viewportAspect >= 1.0
      ? Assets.frames.wide
      : Assets.frames.portrait;
  };

  // ------------------------------------------------------- question card ---
  // top_question_card_blank.png 2172 x 724, gold plate; safe text zone inside.
  Assets.questionCard = {
    src: "assets/ui/top_question_card_blank.png",
    width: 2172,
    height: 724,
    textRect: { x: 0.08, y: 0.20, w: 0.84, h: 0.58 }
  };

  // ------------------------------------------------------------- palette ---
  // Single source of color truth for the renderer and CSS-matched chrome.
  Assets.palette = {
    deepPurple: "#442075",
    violet: "#8A2AC5",
    gold: "#FBBF42",
    orange: "#FF8B36",
    green: "#29C783",
    blue: "#4CAEEA",
    ivory: "#FFF1D7",
    nearBlack: "#242037",
    heart: "#ff4d6b",
    danger: "#ff5470"
  };

  // --------------------------------------------------- scene dressing spec ---
  // Decorative interior: a bright starry arcade hall above a dense plush
  // pile. Purely decorative - never interactive, never carries answer text;
  // the playable claw/toys are always drawn separately on top. Back rows
  // get a soft blur from the renderer so they read as depth, not targets.
  Assets.backdrop = {
    // plush pile rows: back (small, soft) to front (large, vivid).
    // baseY is the row's baseline as a fraction of interior height; the
    // toys sink into the pile so rows overlap naturally.
    rows: [
      { scale: 0.34, baseY: 0.50, alpha: 0.50, count: 8, jitter: 0.55, blur: 1.6 },
      { scale: 0.46, baseY: 0.63, alpha: 0.68, count: 7, jitter: 0.60, blur: 1.1 },
      { scale: 0.60, baseY: 0.77, alpha: 0.85, count: 6, jitter: 0.50, blur: 0.6 },
      { scale: 0.74, baseY: 0.92, alpha: 1.00, count: 5, jitter: 0.45, blur: 0 }
    ],
    bokeh: [
      { x: 0.14, y: 0.16, r: 0.100, color: "255,138,214" },
      { x: 0.84, y: 0.12, r: 0.085, color: "120,200,255" },
      { x: 0.66, y: 0.28, r: 0.090, color: "255,190,110" },
      { x: 0.30, y: 0.30, r: 0.080, color: "190,150,255" },
      { x: 0.93, y: 0.38, r: 0.060, color: "255,140,190" },
      { x: 0.06, y: 0.40, r: 0.065, color: "150,215,255" }
    ],
    stars: [
      [0.10, 0.10], [0.31, 0.07], [0.52, 0.12], [0.72, 0.06], [0.90, 0.14],
      [0.20, 0.22], [0.84, 0.24], [0.44, 0.20], [0.63, 0.18], [0.05, 0.30]
    ]
  };

  CC.Assets = Assets;
  return Assets;
});
