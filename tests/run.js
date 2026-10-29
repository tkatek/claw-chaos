/*
 * CLAW CHAOS - dependency-free test harness.
 * Usage: node tests/run.js
 */
"use strict";
const path = require("path");
const fs = require("fs");

globalThis.CC = globalThis.CC || {};

const tests = [];
let currentFile = "";

globalThis.test = function (name, fn) {
  tests.push({ file: currentFile, name, fn });
};

const assert = function (cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
};
assert.eq = function (a, b, msg) {
  if (a !== b) throw new Error((msg || "eq") + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
};
assert.notEq = function (a, b, msg) {
  if (a === b) throw new Error((msg || "notEq") + ": both are " + JSON.stringify(a));
};
assert.almost = function (a, b, eps, msg) {
  if (Math.abs(a - b) > (eps || 1e-6)) {
    throw new Error((msg || "almost") + ": |" + a + " - " + b + "| > " + (eps || 1e-6));
  }
};
assert.ok = assert;
globalThis.assert = assert;

// load shared modules once
require("../js/assets.js");
require("../js/questions.js");
require("../js/levels.js");
require("../js/toys.js");
require("../js/claw.js");
require("../js/game.js");
require("../js/storage.js");

// discover test files
const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith(".test.js"))
  .sort();

files.forEach(f => {
  currentFile = f;
  require(path.join(dir, f));
});

let pass = 0, fail = 0;
const failures = [];
tests.forEach(t => {
  try {
    t.fn();
    pass++;
    console.log("  ok  " + t.file + " :: " + t.name);
  } catch (e) {
    fail++;
    failures.push({ t, e });
    console.log("FAIL  " + t.file + " :: " + t.name);
    console.log("      " + (e && e.message ? e.message : e));
  }
});

console.log("\n" + pass + " passed, " + fail + " failed, " + tests.length + " total");
if (fail > 0) process.exit(1);
