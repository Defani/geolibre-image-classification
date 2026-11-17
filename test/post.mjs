// Post-processing on a real Sentinel-2 stack: node test/post.mjs <stack.json> <stack.u16> <samples dir> <out dir> [png]
import { readFileSync, writeFileSync } from "node:fs";
import * as C from "../src/core.js";
const [meta, raw, dir, out, png] = process.argv.slice(2);
const m = JSON.parse(readFileSync(meta, "utf8")), buf = readFileSync(raw), u = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2), n = m.w * m.h;
const data = m.names.map((_, b) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) { const v = u[b * n + i]; a[i] = v === 0 ? NaN : v; } return a; });
const grid = { width: m.w, height: m.h, bounds: m.bounds, geographic: true };
const valid = new Uint8Array(n); for (let i = 0; i < n; i++) valid[i] = data.every((L) => Number.isFinite(L[i])) ? 1 : 0;
const refl = Object.fromEntries(m.names.map((nm, i) => [nm, data[i].map((v) => v * 1e-4)]));
const mvi = C.computeIndex(C.INDICES.MVI, refl, n), ndvi = C.computeIndex(C.INDICES.NDVI, refl, n);
const geo = { width: m.w, height: m.h, bounds: m.bounds, epsg: 4326, geographic: true };

// composite: RGB + float stack
writeFileSync(out + "/rgb.tif", C.writeGeoTiff(C.compositeRgb(data[2], data[1], data[0], n, valid), { ...geo, samples: 3, rgb: true, nodata: 0, names: ["B4", "B3", "B2"] }));
writeFileSync(out + "/stack.tif", C.writeGeoTiff(C.compositeStack([...data, ndvi, mvi], n, valid), { ...geo, samples: 12, nodata: -9999, names: [...m.names, "NDVI", "MVI"] }));

// classification -> sieve -> dissolved polygons
const samples = [];
for (const f of ["training_polygons.geojson", "training_points.geojson"]) for (const ft of JSON.parse(readFileSync(dir + "/" + f, "utf8")).features) samples.push({ code: ft.properties.class, cells: C.sampleCells(ft.geometry, grid) });
const sp = C.splitSamples(samples, { ratio: 0.7, maxPix: 500, seed: 42, valid: (c) => valid[c] });
const model = await C.trainRF(C.gather(data, sp.train.cells), Uint8Array.from(sp.train.y), sp.train.cells.length, 10, 4, { trees: 50 });
const cls = new Uint8Array(n), cells = [];
for (let c = 0; c < n; c++) if (valid[c]) cells.push(c);
const X = C.gather(data, cells), pred = C.predict(model, X, cells.length);
cells.forEach((c, i) => (cls[c] = sp.codes[pred[i]]));
writeFileSync(out + "/cls.u8", cls);
const dx = (m.bounds[2] - m.bounds[0]) / m.w, dy = (m.bounds[3] - m.bounds[1]) / m.h;
const toXY = (x, y) => [m.bounds[0] + x * dx, m.bounds[3] - y * dy];
for (const minPx of [0, 50]) {
  let t0 = Date.now();
  const sv = C.sieve(cls, m.w, m.h, minPx);
  const t1 = Date.now(), polys = C.polygonize(sv, m.w, m.h, toXY), t2 = Date.now();
  const ar = C.classAreas(sv, grid, 4);
  const fc = { type: "FeatureCollection", features: [...polys].map(([code, e]) => ({ type: "Feature", properties: { class_code: code, patches: e.patches, area_ha: ar.area[code] / 1e4, cells: ar.cells[code] }, geometry: { type: "MultiPolygon", coordinates: e.polygons } })) };
  const json = JSON.stringify(fc);
  writeFileSync(`${out}/poly_${minPx}.geojson`, json);
  const changed = sv.reduce((s, v, i) => s + (v !== cls[i]), 0);
  console.log(`sieve ${minPx}px: changed ${changed} px in ${t1 - t0} ms; polygonize ${t2 - t1} ms; patches`, fc.features.map((f) => `${f.properties.class_code}:${f.properties.patches}`).join(" "), `${(json.length / 1048576).toFixed(1)} MB`);
}

// threshold MVI > 4.5 as a vector, the mask as raster
const mask = new Uint8Array(n); let pass = 0;
for (let i = 0; i < n; i++) if (valid[i] && Number.isFinite(mvi[i]) && mvi[i] > 4.5) { mask[i] = 1; pass++; }
const mp = C.polygonize(mask, m.w, m.h, toXY).get(1);
writeFileSync(out + "/mvi.geojson", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { cells: pass }, geometry: { type: "MultiPolygon", coordinates: mp.polygons } }] }));
console.log("MVI > 4.5:", pass, "px,", mp.patches, "patches");

// pHYs
if (png) { const b = C.pngWithDpi(new Uint8Array(readFileSync(png)), 300); writeFileSync(out + "/dpi.png", b); console.log("png", b.length); }
