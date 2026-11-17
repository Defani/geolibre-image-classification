// Runs the core on a real Sentinel-2 stack: node test/weda.mjs <stack.json> <stack.u16> <samples dir> <out.tif>
import { readFileSync, writeFileSync } from "node:fs";
import * as C from "../src/core.js";
const [meta, raw, dir, outTif] = process.argv.slice(2);
const m = JSON.parse(readFileSync(meta, "utf8")), buf = readFileSync(raw), u = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2), n = m.w * m.h;
const data = m.names.map((_, b) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) { const v = u[b * n + i]; a[i] = v === 0 ? NaN : v; } return a; });
const grid = { width: m.w, height: m.h, bounds: m.bounds, geographic: true };
const valid = (c) => data.every((L) => Number.isFinite(L[c]));
const refl = Object.fromEntries(m.names.map((nm, i) => [nm, data[i].map((v) => v * 1e-4)]));
const idx = ["NDVI", "NDWI", "NDBI"].map((k) => C.computeIndex(C.INDICES[k], refl, n));
const samples = [];
for (const f of ["training_polygons.geojson", "training_points.geojson"]) for (const ft of JSON.parse(readFileSync(dir + "/" + f, "utf8")).features) samples.push({ code: ft.properties.class, cells: C.sampleCells(ft.geometry, grid) });
console.log("samples", samples.length, "cells", samples.reduce((a, s) => a + s.cells.length, 0));
for (const [label, layers] of [["10 bands", data], ["10 bands + 3 indices", [...data, ...idx]]]) {
  const sp = C.splitSamples(samples, { ratio: 0.7, maxPix: 500, seed: 42, valid });
  const d = layers.length, K = sp.codes.length, Xtr = C.gather(layers, sp.train.cells), ytr = Uint8Array.from(sp.train.y), Xte = C.gather(layers, sp.test.cells), yte = Uint8Array.from(sp.test.y);
  for (const [algo, o] of [["RF", { trees: 100 }], ["GTB", { trees: 100, maxNodes: 5 }], ["SVM", { kernel: "RBF", cost: 10, gamma: 0.5 }], ["SVM", { kernel: "LINEAR", cost: 10 }]]) {
    const t0 = Date.now(), model = await C.train(algo, Xtr, ytr, sp.train.cells.length, d, K, o), t1 = Date.now();
    const acc = C.accuracy(yte, C.predict(model, Xte, sp.test.cells.length), K);
    console.log(label.padEnd(22), (algo + " " + (o.kernel ?? "")).padEnd(11), `train ${sp.train.cells.length} test ${sp.test.cells.length}`, `OA ${(acc.oa * 100).toFixed(2)}% kappa ${acc.kappa.toFixed(3)}`, model.oob != null ? `OOB ${(model.oob * 100).toFixed(2)}%` : "", `PA ${acc.pa.map((v) => (v * 100).toFixed(1)).join("/")}`, `${t1 - t0} ms`);
  }
}
// full-image RF prediction + GeoTIFF
const sp = C.splitSamples(samples, { ratio: 0.7, maxPix: 500, seed: 42, valid });
const model = await C.trainRF(C.gather(data, sp.train.cells), Uint8Array.from(sp.train.y), sp.train.cells.length, 10, 4, { trees: 100 });
console.log("importance", m.names.map((nm, i) => nm + " " + (model.importance[i] * 100).toFixed(1)).join(", "));
const cls = new Uint8Array(n), X = new Float32Array(n * 10), cells = [];
let k = 0; for (let c = 0; c < n; c++) if (valid(c)) { for (let j = 0; j < 10; j++) X[k * 10 + j] = data[j][c]; cells.push(c); k++; }
let t0 = Date.now(); const out = C.predict(model, X, k); cells.forEach((c, i) => (cls[c] = sp.codes[out[i]]));
console.log("predicted", k, "px in", Date.now() - t0, "ms");
const ar = C.classAreas(cls, grid, 4); console.log("areas ha", [1, 2, 3, 4].map((c) => (ar.area[c] / 1e4).toFixed(0)).join(" / "));
const sm = C.majority(cls, m.w, m.h, 3, 4); let diff = 0; for (let i = 0; i < n; i++) if (sm[i] !== cls[i]) diff++; console.log("majority 3x3 changed", diff);
const pal = Array.from({ length: 256 }, () => [0, 0, 0]); [[1, "#1f78b4"], [2, "#33a02c"], [3, "#e31a1c"], [4, "#ff7f00"]].forEach(([c, h]) => (pal[c] = C.hexToRgb(h)));
writeFileSync(outTif, C.writeGeoTiff(cls, { width: m.w, height: m.h, bounds: m.bounds, epsg: 4326, geographic: true, palette: pal, nodata: 0 }));
console.log("expr", C.compileExpression("(B8 - B4) / (B8 + B4)", ["B8", "B4"]).fn({ B8: 0.4, B4: 0.1 }), "roles", ["S2A_B8A.tif", "S2A_B8", "B04", "LC09_SR_B5", "band_11"].map((s) => C.guessRole(s)), C.guessRole("LC09_SR_B5", "l8"));
