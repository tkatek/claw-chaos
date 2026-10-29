/*
 * CLAW CHAOS - asset registry and per-image calibration.
 * All rectangles are normalized (0..1) within the natural image size.
 * Calibration values come from alpha/pixel analysis of the real PNGs
 * (see tests/calibration.html); do not scatter magic numbers elsewhere.
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

  // -------------------------------------------------------------- windows ---
  // Transparent interiors measured from the artwork.
  const frame = (file, w, h, interior, controls) => ({
    src: "assets/windows/" + file,
    width: w,
    height: h,
    interior: interior,          // transparent playfield rect (normalized)
    controls: controls || null   // pictured control hit regions, if any
  });

  const phoneControls = {
    left:  { x: 0.08, y: 0.695, w: 0.26, h: 0.165 },
    right: { x: 0.34, y: 0.695, w: 0.22, h: 0.165 },
    drop:  { x: 0.58, y: 0.695, w: 0.32, h: 0.165 }
  };

  Assets.frames = {
    desktop: frame("window_desktop.png", 3840, 2160,
      { x: 0.0292, y: 0.1375, w: 0.9416, h: 0.6989 }, null),
    ipad: frame("window_ipad.png", 3840, 2880,
      { x: 0.0376, y: 0.1448, w: 0.9248, h: 0.6936 }, null),
    phone: frame("window_phone.png", 941, 1672,
      { x: 0.211, y: 0.274, w: 0.578, h: 0.362 }, phoneControls)
  };

  // Frame choice by viewport aspect, never by user agent. Phone-landscape and
  // any wide viewport reuse the desktop frame; square-ish and portrait
  // tablets use the roomier ipad frame; narrow portrait gets the phone frame.
  Assets.selectFrame = function (viewportAspect) {
    if (viewportAspect < 0.74) return Assets.frames.phone;
    if (viewportAspect < 0.9) return Assets.frames.ipad;
    const dDesktop = Math.abs(viewportAspect - 16 / 9);
    const dIpad = Math.abs(viewportAspect - 4 / 3);
    return dIpad < dDesktop ? Assets.frames.ipad : Assets.frames.desktop;
  };

  // ------------------------------------------------------- question card ---
  // top_question_card_blank.png 2172 x 724, gold plate; safe text zone inside.
  Assets.questionCard = {
    src: "assets/ui/top_question_card_blank.png",
    width: 2172,
    height: 724,
    textRect: { x: 0.10, y: 0.24, w: 0.80, h: 0.52 }
  };

  CC.Assets = Assets;
  return Assets;
});
