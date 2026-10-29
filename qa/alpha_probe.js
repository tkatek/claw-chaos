// Alpha-analysis of frame PNGs: find the true transparent window hole,
// marquee/console extents and row-by-row alpha profile. Pure Node, no deps.
const fs = require("fs"), zlib = require("zlib");

function decode(file) {
  const b = fs.readFileSync(file); let pos = 8;
  let w, h, ct, bd, idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos), type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const stride = w * ch, out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { w, h, ch, data: out };
}

const alphaAt = (im, x, y) => im.ch >= 4 ? im.data[(y * im.w + x) * im.ch + 3] : 255;

function analyze(file) {
  const im = decode(file);
  console.log("\n=== " + file + " " + im.w + "x" + im.h + " ===");
  // row profile: fraction of pixels with alpha<8 (hole) per 2% band
  const bands = 50;
  const rows = [];
  for (let by = 0; by < bands; by++) {
    let transparent = 0, total = 0;
    const y0 = Math.floor(by * im.h / bands), y1 = Math.floor((by + 1) * im.h / bands);
    for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 8))) {
      for (let x = 0; x < im.w; x += Math.max(1, Math.floor(im.w / 120))) {
        total++; if (alphaAt(im, x, y) < 8) transparent++;
      }
    }
    rows.push(transparent / total);
  }
  rows.forEach((r, i) => {
    const bar = "#".repeat(Math.round(r * 40));
    console.log(String((i * 2)).padStart(3) + "%-" + String((i + 1) * 2).padStart(3) + "% " + (r * 100).toFixed(0).padStart(3) + "% " + bar);
  });
  // find the largest transparent run of rows (the window hole) using full-res scan
  const rowTransparent = [];
  for (let y = 0; y < im.h; y++) {
    let t = 0;
    for (let x = 0; x < im.w; x += 3) { if (alphaAt(im, x, y) < 8) t++; }
    rowTransparent.push(t / Math.ceil(im.w / 3));
  }
  // hole rows = rows whose transparent fraction > 0.5 (allow decor at edges)
  let best = { len: 0 };
  let start = -1;
  for (let y = 0; y < im.h; y++) {
    if (rowTransparent[y] > 0.5) { if (start < 0) start = y; }
    else { if (start >= 0 && y - start > best.len) best = { start, end: y, len: y - start }; start = -1; }
  }
  if (start >= 0 && im.h - start > best.len) best = { start, end: im.h, len: im.h - start };
  console.log("hole rows: y " + best.start + ".." + best.end + "  = " + (best.start / im.h).toFixed(4) + ".." + (best.end / im.h).toFixed(4) + " (h " + (best.len / im.h).toFixed(4) + ")");
  // inside hole rows, find transparent column range
  if (best.len) {
    const ym = Math.floor((best.start + best.end) / 2);
    let x0 = -1, x1 = -1;
    for (let x = 0; x < im.w; x++) if (alphaAt(im, x, ym) < 8) { if (x0 < 0) x0 = x; x1 = x; }
    console.log("hole cols at mid: x " + x0 + ".." + x1 + " = " + (x0 / im.w).toFixed(4) + ".." + ((x1 + 1) / im.w).toFixed(4) + " (w " + ((x1 + 1 - x0) / im.w).toFixed(4) + ")");
    // verify rect is fully transparent across rows at hole x range
    let allClear = true, worst = 0;
    for (let y = best.start + 5; y < best.end - 5; y += 3) {
      let t = 0, n = 0;
      for (let x = x0 + 5; x < x1 - 5; x += 3) { n++; if (alphaAt(im, x, y) < 8) t++; }
      worst = Math.max(worst, 1 - t / n);
    }
    console.log("worst opaque fraction inside hole: " + (worst * 100).toFixed(1) + "%");
  }
}

["assets/windows/window_desktop.png", "assets/windows/window_ipad.png", "assets/windows/window_phone.png"].forEach(analyze);
