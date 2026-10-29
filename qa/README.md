# QA artifacts (not shipped game code)

## screenshots/
Actual app screenshots of the running game (not mockups), captured via the
in-app browser from the local nested-path server:

- desktop-1919x1003.png, desktop-1920x1080.png, desktop-1366x768.png,
  desktop-1440x900.png (wide composed cabinet, 92-94% width)
- ipad-1024x768.png, ipad-768x1024.png
- phone-409x866.png, phone-393x852.png, phone-375x667.png, phone-320x568.png
- phone-landscape-844x390.png
- state-carrying-desktop.png  (claw ASCENDING with a caught toy)
- state-feedback-desktop.png  (feedback pill after a correct grab)
- state-aftercorrect-desktop.png (extended cabinet after a correct catch)

All captured in AIMING/gameplay state (no pause or loading overlay), after the
final layout pass. Compare against the approved targets
(TARGET_DESKTOP.png / TARGET_PHONE.png supplied by the owner).

## server.js
Zero-dependency static server used for the nested-hosting check:

    node qa/server.js
    game  -> http://127.0.0.1:8787/games/claw-chaos/
    refs  -> /refs/   (expects the reference images folder, local machine only)

It serves the project under /games/claw-chaos/ to prove subdirectory hosting
works; PNG responses may cache for the session, code/data are no-store.

## alpha_probe.js, phone_probe.js
Node scripts that decode the cabinet PNGs and measure the real transparent
window holes / row alpha profiles / console button colors. The normalized
rectangles in js/assets.js come from these measurements.

## *_zoom.html, *_sheet.html
Manual QA pages (grid overlays on the cabinet art) used to place the control
hit zones precisely over the artwork's drawn buttons. The game also supports
`index.html?debug=zones` to draw the live hit zones over the rendered console.

## Note
qa/ is development/QA tooling only; the game itself needs only index.html,
css/, js/, data/ and assets/ and can be uploaded as static files anywhere,
including a nested directory.
