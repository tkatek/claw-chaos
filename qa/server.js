// Minimal zero-dependency static server for local QA.
// Serves the claw-chaos project at a NESTED path (/games/claw-chaos/) to prove
// subdirectory hosting works, plus the reference images at /refs/.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname + "/.."; // project root (claw-chaos)
const REFS = "C:/Users/HP/Downloads/claw_chaos_refs";
const PORT = 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  let base, rel;
  if (urlPath.startsWith("/refs/")) {
    base = REFS;
    rel = urlPath.slice("/refs/".length);
  } else if (urlPath.startsWith("/games/claw-chaos/")) {
    base = ROOT;
    rel = urlPath.slice("/games/claw-chaos/".length);
  } else if (urlPath === "/games/claw-chaos") {
    res.writeHead(301, { Location: "/games/claw-chaos/" });
    return res.end();
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("404 - serve path is /games/claw-chaos/");
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(path.normalize(base))) {
    res.writeHead(403);
    return res.end("403");
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      console.log("404", req.url);
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("404 " + req.url);
    }
    console.log("200", req.url);
    const isPng = path.extname(file).toLowerCase() === ".png";
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      // QA only: big art may cache for the session; code/data stay fresh
      "Cache-Control": isPng ? "max-age=3600" : "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`QA server: game at http://127.0.0.1:${PORT}/games/claw-chaos/ · refs at /refs/`)
);
