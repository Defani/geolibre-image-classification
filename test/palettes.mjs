// Heatmap palettes: every stop parses, ramps give rgb(), text colour flips on dark cells: node test/palettes.mjs
import { readFileSync } from "node:fs";
import * as C from "../src/core.js";
const src = readFileSync(new URL("../src/win.js", import.meta.url), "utf8");
const grab = (name) => src.slice(src.indexOf(name), src.indexOf("\n}", src.indexOf(name)) + 2);
const block = src.slice(src.indexOf("const PALETTES"), src.indexOf("const blues"));
const S = {}, hexToRgb = C.hexToRgb;
const api = new Function("S", "hexToRgb", block.replace(/^S\.pal = .*$/m, "S.pal = {};") + "\nreturn { PALETTES, ramp, inkOn };")(S, hexToRgb);
let fail = 0;
for (const [kind, set] of Object.entries(api.PALETTES)) for (const [name, stops] of Object.entries(set)) {
  const bad = stops.filter((h) => !/^#[0-9a-f]{6}$/i.test(h));
  const lo = api.ramp(stops, 0), hi = api.ramp(stops, 1), mid = api.ramp(stops, 0.5);
  const ok = !bad.length && [lo, mid, hi].every((c) => /^rgb\(\d+,\d+,\d+\)$/.test(c)) && ["#111827", "#ffffff"].includes(api.inkOn(mid));
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", kind, name, lo, hi, "ink", api.inkOn(lo), api.inkOn(hi));
}
if (api.inkOn("rgb(8,48,107)") !== "#ffffff" || api.inkOn("rgb(247,251,255)") !== "#111827") { fail++; console.log("FAIL ink contrast"); }
if (fail) process.exit(1);
console.log("all passed");
