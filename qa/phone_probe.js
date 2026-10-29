// Detailed geometry probe for the phone frame: opaque column extents per row,
// opaque content INSIDE the window hole (shelf art?), and color sampling.
const fs = require("fs"), zlib = require("zlib");

function decode(file) {
  const b = fs.readFileSync(file); let pos = 8;
  let w, h, ct, idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos), type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
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

const im = decode("assets/windows/window_phone.png");
const A = (x, y) => im.data[(y * im.w + x) * 4 + 3];
const RGB = (x, y) => [im.data[(y * im.w + x) * 4], im.data[(y * im.w + x) * 4 + 1], im.data[(y * im.w + x) * 4 + 2]];

console.log("phone " + im.w + "x" + im.h);
console.log("row | opaqueX0..X1 (norm) | opaqueFrac | transparent runs inside body");
for (let by = 0; by < 50; by++) {
  const y = Math.floor((by + 0.5) * im.h / 50);
  let x0 = -1, x1 = -1, opaque = 0;
  const runs = [];
  let runStart = -1;
  for (let x = 0; x < im.w; x++) {
    const a = A(x, y) >= 8;
    if (a) { if (x0 < 0) x0 = x; x1 = x; opaque++; runStart = -1; }
    else if (x0 >= 0 && runStart < 0) runStart = x;
    if (!a && runStart >= 0 && x === im.w - 1) runs.push([runStart, x]);
  }
  // transparent gaps strictly inside the opaque body
  const gaps = [];
  let gap = null;
  for (let x = x0; x <= x1; x++) {
    if (A(x, y) < 8) { if (!gap) gap = [x, x]; else gap[1] = x; }
    else if (gap) { if (gap[1] - gap[0] > 30) gaps.push(gap); gap = null; }
  }
  if (gap && gap[1] - gap[0] > 30) gaps.push(gap);
  const frac = (x1 - x0 + 1) ? (opaque / (x1 - x0 + 1)).toFixed(2) : "0";
  const gapStr = gaps.map(g => g[0] + "-" + g[1] + " (" + (g[0] / im.w).toFixed(3) + "-" + (g[1] / im.w).toFixed(3) + ")").join(" ");
  console.log(String(by * 2).padStart(3) + "% y" + String(y).padStart(4) + " | " + (x0 / im.w).toFixed(3) + ".." + (x1 / im.w).toFixed(3) +
    " | opq " + frac + " | gaps: " + (gapStr || "-"));
}
// sample colors: marquee center, side column mid, console panel areas
const samples = [
  ["marquee center", 0.5, 0.15], ["marquee upper", 0.5, 0.06],
  ["left column mid-window", 0.10, 0.45], ["right column mid-window", 0.90, 0.45],
  ["console left", 0.25, 0.75], ["console center", 0.5, 0.75], ["console right", 0.75, 0.75],
  ["console lower center", 0.5, 0.9], ["bottom center", 0.5, 0.985]
];
samples.forEach(([name, nx, ny]) => {
  const x = Math.floor(nx * im.w), y = Math.floor(ny * im.h);
  const px = im.data[(y * im.w + x) * 4];
  console.log(name + " @(" + nx + "," + ny + ") alpha=" + A(x, y) + " rgb=" + RGB(x, y));
});
