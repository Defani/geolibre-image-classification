// Image Classification core: indices, sampling, classifiers, accuracy and a GeoTIFF writer. No DOM, no host API.

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- indices

const nd = (a, b) => (a + b === 0 ? 0 : (a - b) / (a + b));
/** Spectral indices on reflectance (0-1). Keys are Sentinel-2 band roles. */
export const INDICES = {
  NDVI: { needs: ["B8", "B4"], fn: (b) => nd(b.B8, b.B4) },
  EVI2: { needs: ["B8", "B4"], fn: (b) => (2.5 * (b.B8 - b.B4)) / (b.B8 + 2.4 * b.B4 + 1) },
  CAI: { needs: ["B12", "B11"], fn: (b) => b.B12 / Math.max(b.B11, 1e-6) },
  NDWI: { needs: ["B8", "B11"], fn: (b) => nd(b.B8, b.B11) },
  GCVI: { needs: ["B8", "B3"], fn: (b) => b.B8 / Math.max(b.B3, 1e-6) - 1 },
  SAVI: { needs: ["B8", "B4"], fn: (b) => (1.5 * (b.B8 - b.B4)) / (b.B8 + b.B4 + 0.5) },
  PRI: { needs: ["B2", "B3"], fn: (b) => nd(b.B2, b.B3) },
  HALL_COVER: { needs: ["B4", "B8", "B12"], fn: (b) => -0.017 * b.B4 - 0.007 * b.B8 - 0.079 * b.B12 + 5.22 },
  IRECI: { needs: ["B7", "B4", "B5", "B6"], fn: (b) => { const d = b.B5 / Math.max(b.B6, 1e-6); return d === 0 ? 0 : (b.B7 - b.B4) / d; } },
  NDRE: { needs: ["B8A", "B5"], fn: (b) => nd(b.B8A, b.B5) },
  MNDWI: { needs: ["B3", "B11"], fn: (b) => nd(b.B3, b.B11) },
  NDMI: { needs: ["B8", "B11"], fn: (b) => nd(b.B8, b.B11) },
  NDBI: { needs: ["B11", "B8"], fn: (b) => nd(b.B11, b.B8) },
  NBR: { needs: ["B8", "B12"], fn: (b) => nd(b.B8, b.B12) },
  // Mangrove Vegetation Index, Baloloy et al. 2020 (ISPRS J. Photogramm. Remote Sens. 166): (NIR - Green) / (SWIR1 - Green)
  MVI: { needs: ["B8", "B3", "B11"], fn: (b) => { const d = b.B11 - b.B3; return d === 0 ? 0 : (b.B8 - b.B3) / d; } },
  GVS: { needs: ["B8", "B4", "B12"], fn: (b) => gvs(b) },
  NDFI: { needs: ["B8", "B4", "B12"], fn: (b) => { const g = gvs(b), npv = 1 - nd(b.B8, b.B4); return (g - npv) / Math.max(g + npv, 1e-6); } },
};
function gvs(b) {
  const ndvi = nd(b.B8, b.B4), nbr = nd(b.B8, b.B12);
  return (ndvi * 100) / (Math.abs(ndvi) * 100 + Math.abs(nbr) * 100 + 1);
}

export const ROLES = ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B11", "B12"];
/** Landsat 8/9 band number -> Sentinel-2 role. */
export const LANDSAT_ROLES = { B2: "B2", B3: "B3", B4: "B4", B5: "B8", B6: "B11", B7: "B12" };
/** Band number -> Sentinel-2 role, per sensor. Roles drive indices and composites, so any sensor works. */
export const SENSOR_ROLES = {
  l8: LANDSAT_ROLES,
  l57: { B1: "B2", B2: "B3", B3: "B4", B4: "B8", B5: "B11", B7: "B12" },
  ps: { B2: "B2", B4: "B3", B6: "B4", B7: "B5", B8: "B8" },
  wv: { B2: "B2", B3: "B3", B5: "B4", B6: "B5", B7: "B8", B8: "B8A" },
  spot: { B0: "B2", B1: "B3", B2: "B4", B3: "B8" },
  modis: { B1: "B4", B2: "B8", B3: "B2", B4: "B3", B6: "B11", B7: "B12" },
};
export const SENSORS = [["s2", "Sentinel-2 MSI"], ["l8", "Landsat 8 / 9 OLI"], ["l57", "Landsat 5 / 7 TM, ETM+"], ["ps", "PlanetScope SuperDove"], ["wv", "WorldView-2 / 3"], ["spot", "SPOT 6 / 7, Pléiades"], ["modis", "MODIS surface reflectance"], ["custom", "Other (set roles by hand)"]];
/** Centre wavelength (nm) of each role, for spectral profiles. */
export const ROLE_NM = { B2: 490, B3: 560, B4: 665, B5: 705, B6: 740, B7: 783, B8: 842, B8A: 865, B11: 1610, B12: 2190 };
export const ROLE_NAMES = { B2: "Blue", B3: "Green", B4: "Red", B5: "Red edge 1", B6: "Red edge 2", B7: "Red edge 3", B8: "NIR", B8A: "NIR narrow", B11: "SWIR1", B12: "SWIR2" };

/** Guess the band role from a layer or file name ("S2A_B8A.tif" -> "B8A", "LC09_SR_B5" with sensor l8 -> "B8"). */
export function guessRole(name, sensor = "s2") {
  const m = /(?:^|[^A-Za-z0-9])B(?:and)?[_ ]?(?:0?(8A|1[0-2]|[1-9])|(0))(?![0-9A-Za-z])/i.exec(String(name).replace(/\.[A-Za-z0-9]+$/, ""));
  if (!m || sensor === "custom") return "";
  const b = "B" + (m[1] ?? m[2]).toUpperCase();
  if (SENSOR_ROLES[sensor]) return SENSOR_ROLES[sensor][b] ?? "";
  return ROLES.includes(b) ? b : "";
}

/** Compile "(B8 - B4) / (B8 + B4)" into a function of a role->value object. Throws on anything but arithmetic. */
export function compileExpression(expr, names) {
  const src = String(expr).trim();
  if (!src) throw new Error("Empty expression");
  if (!/^[\w\s.+\-*/(),]+$/.test(src)) throw new Error("Only numbers, band names and + - * / ( ) are allowed");
  const fns = ["min", "max", "abs", "sqrt", "log", "exp", "pow"];
  const used = [];
  const body = src.replace(/[A-Za-z_]\w*/g, (id) => {
    if (fns.includes(id)) return "Math." + id;
    if (!names.includes(id)) throw new Error(`Unknown band "${id}"`);
    if (!used.includes(id)) used.push(id);
    return `b[${JSON.stringify(id)}]`;
  });
  let f;
  try { f = new Function("b", `"use strict"; return (${body});`); } catch { throw new Error("Invalid expression"); }
  return { needs: used, fn: (b) => { const v = f(b); return Number.isFinite(v) ? v : 0; } };
}

/** Evaluate an index over whole bands. `bands` maps role -> Float32Array of reflectance. */
export function computeIndex(def, bands, n) {
  const out = new Float32Array(n), b = {};
  const arrs = def.needs.map((k) => bands[k]);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < arrs.length; k++) b[def.needs[k]] = arrs[k][i];
    const v = def.fn(b);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// ---------------------------------------------------------------- samples -> pixels

function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * Grid cells covered by a sample. `grid` = { bounds:[w,s,e,n], width, height } in the sample's own coordinates.
 * Points give one cell, polygons every cell whose centre is inside (holes respected).
 */
export function sampleCells(geometry, grid) {
  const [w, s, e, n] = grid.bounds, dx = (e - w) / grid.width, dy = (n - s) / grid.height, cells = [];
  const cellOf = (p) => {
    const cx = Math.floor((p[0] - w) / dx), cy = Math.floor((n - p[1]) / dy);
    return cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height ? cy * grid.width + cx : -1;
  };
  const poly = (rings) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of rings[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const c0 = Math.max(0, Math.floor((x0 - w) / dx)), c1 = Math.min(grid.width - 1, Math.floor((x1 - w) / dx));
    const r0 = Math.max(0, Math.floor((n - y1) / dy)), r1 = Math.min(grid.height - 1, Math.floor((n - y0) / dy));
    const before = cells.length;
    for (let r = r0; r <= r1; r++) {
      const y = n - (r + 0.5) * dy;
      for (let c = c0; c <= c1; c++) {
        const x = w + (c + 0.5) * dx;
        if (inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h))) cells.push(r * grid.width + c);
      }
    }
    if (cells.length === before) { const k = cellOf([(x0 + x1) / 2, (y0 + y1) / 2]); if (k >= 0) cells.push(k); }
  };
  const g = geometry;
  if (!g) return cells;
  if (g.type === "Point") { const k = cellOf(g.coordinates); if (k >= 0) cells.push(k); }
  else if (g.type === "MultiPoint") for (const p of g.coordinates) { const k = cellOf(p); if (k >= 0) cells.push(k); }
  else if (g.type === "Polygon") poly(g.coordinates);
  else if (g.type === "MultiPolygon") for (const p of g.coordinates) poly(p);
  return cells;
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/**
 * Turn samples into training and test pixels.
 * samples: [{ code, cells:number[] }]; valid(cell) says whether a cell holds data.
 * Returns { train:{cells,y}, test:{cells,y}, codes, perClass:[{code,samples,train,test}], capped }.
 */
export function splitSamples(samples, opts) {
  const { ratio = 0.7, by = "pixel", maxPix = 500, seed = 42, valid = () => true } = opts;
  const rand = rng(seed), codes = [...new Set(samples.map((s) => s.code))].sort((a, b) => a - b);
  const kOf = new Map(codes.map((c, i) => [c, i]));
  const seen = new Set(), tr = { cells: [], y: [] }, te = { cells: [], y: [] };
  const per = codes.map((c) => ({ code: c, samples: 0, train: 0, test: 0 }));
  let capped = 0;
  const push = (set, cell, k) => { set.cells.push(cell); set.y.push(k); };
  const groups = codes.map(() => []);
  for (const s of samples) {
    const k = kOf.get(s.code);
    let cells = s.cells.filter((c) => valid(c) && !seen.has(c));
    cells.forEach((c) => seen.add(c));
    if (!cells.length) continue;
    per[k].samples++;
    if (cells.length > maxPix) { cells = shuffle(cells, rand).slice(0, maxPix); capped++; }
    groups[k].push(cells);
  }
  groups.forEach((list, k) => {
    if (by === "sample" && list.length > 1) {
      // whole samples go to one side, so test pixels never sit next to training pixels of the same polygon
      const order = shuffle(list.map((_, i) => i), rand), nTrain = Math.min(list.length - 1, Math.max(1, Math.round(list.length * ratio)));
      order.forEach((i, pos) => list[i].forEach((c) => push(pos < nTrain ? tr : te, c, k)));
    } else {
      const all = shuffle(list.flat(), rand), nTrain = all.length > 1 ? Math.min(all.length - 1, Math.max(1, Math.round(all.length * ratio))) : all.length;
      all.forEach((c, pos) => push(pos < nTrain ? tr : te, c, k));
    }
  });
  tr.y.forEach((k) => per[k].train++);
  te.y.forEach((k) => per[k].test++);
  return { train: tr, test: te, codes, perClass: per, capped };
}

/** Row-major feature matrix for a list of cells. layers: Float32Array[] all on the same grid. */
export function gather(layers, cells) {
  const d = layers.length, X = new Float32Array(cells.length * d);
  for (let j = 0; j < d; j++) { const L = layers[j]; for (let i = 0; i < cells.length; i++) X[i * d + j] = L[cells[i]]; }
  return X;
}

// ---------------------------------------------------------------- binning (shared by RF and GTB)

const MAX_BINS = 64;
function makeBins(X, n, d, rand) {
  const edges = [], take = Math.min(n, 4000), pick = new Int32Array(take);
  for (let i = 0; i < take; i++) pick[i] = take === n ? i : Math.floor(rand() * n);
  const v = new Float32Array(take);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < take; i++) v[i] = X[pick[i] * d + j];
    const s = Float32Array.from(v).sort(), e = [];
    for (let q = 1; q < MAX_BINS; q++) { const x = s[Math.floor((q * (take - 1)) / MAX_BINS)]; if (!e.length || x > e[e.length - 1]) e.push(x); }
    if (e.length && e[e.length - 1] >= s[take - 1]) e.pop(); // the last edge must leave something on the right
    edges.push(Float32Array.from(e));
  }
  const B = new Uint8Array(n * d);
  for (let j = 0; j < d; j++) {
    const e = edges[j], m = e.length;
    for (let i = 0; i < n; i++) {
      const x = X[i * d + j];
      let lo = 0, hi = m; // count of edges < x
      while (lo < hi) { const mid = (lo + hi) >> 1; if (e[mid] < x) lo = mid + 1; else hi = mid; }
      B[i * d + j] = lo;
    }
  }
  return { edges, B };
}

function pack(t) {
  return { feat: Int16Array.from(t.feat), thr: Float32Array.from(t.thr), left: Int32Array.from(t.left), right: Int32Array.from(t.right), val: Float32Array.from(t.val) };
}

// ---------------------------------------------------------------- random forest

function growClassTree(B, y, d, K, idx, n, edges, o, rand, imp) {
  const t = { feat: [], thr: [], left: [], right: [], val: [] };
  const node = () => { t.feat.push(-1); t.thr.push(0); t.left.push(-1); t.right.push(-1); t.val.push(0); return t.feat.length - 1; };
  const hist = new Int32Array((MAX_BINS + 1) * K), cnt = new Int32Array(K), lc = new Int32Array(K), feats = Int32Array.from({ length: d }, (_, i) => i);
  const stack = [[node(), 0, n, 0]];
  while (stack.length) {
    const [id, a, b, depth] = stack.pop(), m = b - a;
    cnt.fill(0);
    for (let i = a; i < b; i++) cnt[y[idx[i]]]++;
    let best = 0, sq = 0;
    for (let k = 0; k < K; k++) { if (cnt[k] > cnt[best]) best = k; sq += cnt[k] * cnt[k]; }
    t.val[id] = best;
    if (cnt[best] === m || m < 2 * o.minLeaf || (o.maxDepth > 0 && depth >= o.maxDepth)) continue;
    const parent = m - sq / m; // n * gini
    let bestGain = 1e-9, bf = -1, bb = 0;
    for (let i = 0; i < o.mtry; i++) { const j = i + Math.floor(rand() * (d - i)); const tmp = feats[i]; feats[i] = feats[j]; feats[j] = tmp; }
    for (let fi = 0; fi < o.mtry; fi++) {
      const f = feats[fi], nb = edges[f].length;
      if (!nb) continue;
      hist.fill(0, 0, (nb + 1) * K);
      for (let i = a; i < b; i++) { const s = idx[i]; hist[B[s * d + f] * K + y[s]]++; }
      lc.fill(0);
      let nl = 0;
      for (let bin = 0; bin < nb; bin++) {
        for (let k = 0; k < K; k++) { const h = hist[bin * K + k]; lc[k] += h; nl += h; }
        const nr = m - nl;
        if (nl < o.minLeaf || nr < o.minLeaf) continue;
        let sl = 0, sr = 0;
        for (let k = 0; k < K; k++) { sl += lc[k] * lc[k]; const r = cnt[k] - lc[k]; sr += r * r; }
        const gain = parent - (nl - sl / nl) - (nr - sr / nr);
        if (gain > bestGain) { bestGain = gain; bf = f; bb = bin; }
      }
    }
    if (bf < 0) continue;
    let i = a, j = b - 1;
    while (i <= j) { if (B[idx[i] * d + bf] <= bb) i++; else { const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; } }
    imp[bf] += bestGain;
    t.feat[id] = bf; t.thr[id] = edges[bf][bb];
    const L = node(), R = node();
    t.left[id] = L; t.right[id] = R;
    stack.push([L, a, i, depth + 1], [R, i, b, depth + 1]);
  }
  return pack(t);
}

function classRows(y, n, K) {
  const rows = Array.from({ length: K }, () => []);
  for (let i = 0; i < n; i++) rows[y[i]].push(i);
  return rows;
}
/** Weights inversely proportional to class frequency, n / (K * n_k), as scikit-learn's class_weight="balanced". */
export function balancedWeights(y, n, K) {
  const cnt = new Float64Array(K);
  for (let i = 0; i < n; i++) cnt[y[i]]++;
  const present = cnt.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
  return Array.from(cnt, (c) => (c > 0 ? n / (present * c) : 0));
}

function walk(t, X, off) {
  let k = 0;
  while (t.feat[k] >= 0) k = X[off + t.feat[k]] <= t.thr[k] ? t.left[k] : t.right[k];
  return t.val[k];
}

/** Random forest. X is n×d row-major, y class index 0..K-1. */
export async function trainRF(X, y, n, d, K, opts = {}, onProgress = () => {}) {
  const o = { trees: 100, minLeaf: 1, bag: 0.5, vars: "sqrt", maxDepth: 0, seed: 42, ...opts };
  o.mtry = Math.max(1, Math.min(d, o.vars === "all" ? d : o.vars === "log2" ? Math.round(Math.log2(d)) + 1 : Math.round(Math.sqrt(d))));
  const rand = rng(o.seed), { edges, B } = makeBins(X, n, d, rand), imp = new Float64Array(d);
  const m = Math.max(1, Math.round(n * o.bag)), trees = [], oobVotes = new Uint16Array(n * K), inBag = new Uint8Array(n), idx = new Int32Array(m);
  // balanced: every class is drawn equally often, which is what weighting by inverse class frequency does to a bootstrap
  const byClass = o.balanced ? classRows(y, n, K).filter((l) => l.length) : null;
  let last = Date.now(), depthSum = 0;
  for (let t = 0; t < o.trees; t++) {
    inBag.fill(0);
    for (let i = 0; i < m; i++) {
      let s;
      if (byClass) { const l = byClass[Math.floor(rand() * byClass.length)]; s = l[Math.floor(rand() * l.length)]; } else s = Math.floor(rand() * n);
      idx[i] = s; inBag[s] = 1;
    }
    const tree = growClassTree(B, y, d, K, idx, m, edges, o, rand, imp);
    trees.push(tree);
    depthSum += Math.log2(tree.feat.length + 1);
    for (let i = 0; i < n; i++) if (!inBag[i]) oobVotes[i * K + walk(tree, X, i * d)]++;
    if (Date.now() - last > 60) { onProgress((t + 1) / o.trees); await tick(); last = Date.now(); }
  }
  let ok = 0, seen = 0;
  for (let i = 0; i < n; i++) {
    let best = -1, bv = 0;
    for (let k = 0; k < K; k++) if (oobVotes[i * K + k] > bv) { bv = oobVotes[i * K + k]; best = k; }
    if (best >= 0) { seen++; if (best === y[i]) ok++; }
  }
  const tot = imp.reduce((a, b) => a + b, 0) || 1;
  return { type: "RF", d, K, trees, importance: Array.from(imp, (v) => v / tot), oob: seen ? ok / seen : null, mtry: o.mtry };
}

function predictRF(model, X, n, out) {
  const { d, K, trees } = model, votes = new Uint16Array(K);
  for (let i = 0; i < n; i++) {
    votes.fill(0);
    const off = i * d;
    for (let t = 0; t < trees.length; t++) votes[walk(trees[t], X, off)]++;
    let best = 0;
    for (let k = 1; k < K; k++) if (votes[k] > votes[best]) best = k;
    out[i] = best;
  }
}

// ---------------------------------------------------------------- gradient tree boost (multinomial deviance)

function growRegTree(B, g, h, d, idx, n, edges, maxLeaves, minLeaf, scale, imp) {
  const t = { feat: [], thr: [], left: [], right: [], val: [] };
  const node = () => { t.feat.push(-1); t.thr.push(0); t.left.push(-1); t.right.push(-1); t.val.push(0); return t.feat.length - 1; };
  const hg = new Float64Array(MAX_BINS + 1), hh = new Float64Array(MAX_BINS + 1), hc = new Int32Array(MAX_BINS + 1), LAMBDA = 1e-3;
  const plan = (id, a, b) => {
    let G = 0, H = 0;
    for (let i = a; i < b; i++) { G += g[idx[i]]; H += h[idx[i]]; }
    t.val[id] = (scale * G) / (H + LAMBDA);
    const leaf = { id, a, b, gain: 0, f: -1, bin: 0 }, m = b - a;
    if (m < 2 * minLeaf) return leaf;
    const base = (G * G) / (H + LAMBDA);
    for (let f = 0; f < d; f++) {
      const nb = edges[f].length;
      if (!nb) continue;
      hg.fill(0, 0, nb + 1); hh.fill(0, 0, nb + 1); hc.fill(0, 0, nb + 1);
      for (let i = a; i < b; i++) { const s = idx[i], bin = B[s * d + f]; hg[bin] += g[s]; hh[bin] += h[s]; hc[bin]++; }
      let gl = 0, hl = 0, nl = 0;
      for (let bin = 0; bin < nb; bin++) {
        gl += hg[bin]; hl += hh[bin]; nl += hc[bin];
        if (nl < minLeaf || m - nl < minLeaf) continue;
        const gain = (gl * gl) / (hl + LAMBDA) + ((G - gl) * (G - gl)) / (H - hl + LAMBDA) - base;
        if (gain > leaf.gain + 1e-12) { leaf.gain = gain; leaf.f = f; leaf.bin = bin; }
      }
    }
    return leaf;
  };
  const leaves = [plan(node(), 0, n)];
  while (leaves.length < maxLeaves) {
    let bi = -1;
    for (let i = 0; i < leaves.length; i++) if (leaves[i].f >= 0 && (bi < 0 || leaves[i].gain > leaves[bi].gain)) bi = i;
    if (bi < 0) break;
    const L = leaves[bi];
    let i = L.a, j = L.b - 1;
    while (i <= j) { if (B[idx[i] * d + L.f] <= L.bin) i++; else { const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; } }
    imp[L.f] += L.gain;
    t.feat[L.id] = L.f; t.thr[L.id] = edges[L.f][L.bin];
    const l = node(), r = node();
    t.left[L.id] = l; t.right[L.id] = r;
    leaves.splice(bi, 1, plan(l, L.a, i), plan(r, i, L.b));
  }
  return pack(t);
}

export async function trainGTB(X, y, n, d, K, opts = {}, onProgress = () => {}) {
  const o = { trees: 100, shrinkage: 0.05, sampling: 0.7, maxNodes: 5, minLeaf: 1, seed: 42, ...opts };
  const rand = rng(o.seed), { edges, B } = makeBins(X, n, d, rand), imp = new Float64Array(d), cw = o.balanced ? balancedWeights(y, n, K) : null;
  const F = new Float64Array(n * K), P = new Float64Array(n * K), g = new Float64Array(n), h = new Float64Array(n);
  const m = Math.max(2, Math.round(n * o.sampling)), idx = new Int32Array(m), order = Int32Array.from({ length: n }, (_, i) => i), rounds = [];
  let last = Date.now();
  for (let r = 0; r < o.trees; r++) {
    for (let i = 0; i < n; i++) {
      let mx = -Infinity, s = 0;
      for (let k = 0; k < K; k++) if (F[i * K + k] > mx) mx = F[i * K + k];
      for (let k = 0; k < K; k++) { const e = Math.exp(F[i * K + k] - mx); P[i * K + k] = e; s += e; }
      for (let k = 0; k < K; k++) P[i * K + k] /= s;
    }
    for (let i = 0; i < m; i++) { const j = i + Math.floor(rand() * (n - i)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
    const round = [];
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < n; i++) { const p = P[i * K + k], w = cw ? cw[y[i]] : 1; g[i] = w * ((y[i] === k ? 1 : 0) - p); h[i] = w * p * (1 - p); }
      idx.set(order.subarray(0, m));
      const tree = growRegTree(B, g, h, d, idx, m, edges, Math.max(2, o.maxNodes), o.minLeaf, (K - 1) / K, imp);
      round.push(tree);
      for (let i = 0; i < n; i++) F[i * K + k] += o.shrinkage * walk(tree, X, i * d);
    }
    rounds.push(round);
    if (Date.now() - last > 60) { onProgress((r + 1) / o.trees); await tick(); last = Date.now(); }
  }
  const tot = imp.reduce((a, b) => a + b, 0) || 1;
  return { type: "GTB", d, K, rounds, shrinkage: o.shrinkage, importance: Array.from(imp, (v) => v / tot) };
}

function predictGTB(model, X, n, out) {
  const { d, K, rounds, shrinkage } = model, F = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    F.fill(0);
    const off = i * d;
    for (let r = 0; r < rounds.length; r++) for (let k = 0; k < K; k++) F[k] += shrinkage * walk(rounds[r][k], X, off);
    let best = 0;
    for (let k = 1; k < K; k++) if (F[k] > F[best]) best = k;
    out[i] = best;
  }
}

// ---------------------------------------------------------------- support vector machine (C-SVC, one-vs-one)

function kernelFn(o) {
  const { kernel, gamma, coef0, degree } = o;
  const dot = (A, a, Bm, b, d) => { let s = 0; for (let j = 0; j < d; j++) s += A[a + j] * Bm[b + j]; return s; };
  if (kernel === "LINEAR") return dot;
  if (kernel === "POLY") return (A, a, Bm, b, d) => Math.pow(gamma * dot(A, a, Bm, b, d) + coef0, degree);
  if (kernel === "SIGMOID") return (A, a, Bm, b, d) => Math.tanh(gamma * dot(A, a, Bm, b, d) + coef0);
  return (A, a, Bm, b, d) => { let s = 0; for (let j = 0; j < d; j++) { const t = A[a + j] - Bm[b + j]; s += t * t; } return Math.exp(-gamma * s); };
}

/** Maximal-violating-pair SMO with a full kernel cache. Returns alpha*y and the bias. */
function solveSVC(Z, rows, ys, d, Cp, Cn, kern) {
  const n = rows.length, Kc = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = kern(Z, rows[i] * d, Z, rows[j] * d, d); Kc[i * n + j] = v; Kc[j * n + i] = v; }
  const a = new Float64Array(n), G = new Float64Array(n).fill(-1), maxIter = Math.max(20000, 200 * n);
  let gmax = 0, gmin = 0;
  for (let it = 0; it < maxIter; it++) {
    let i = -1;
    gmax = -Infinity; gmin = Infinity;
    for (let t = 0; t < n; t++) {
      const v = -ys[t] * G[t];
      if ((ys[t] > 0 ? a[t] < Cp : a[t] > 0) && v > gmax) { gmax = v; i = t; }
      if ((ys[t] > 0 ? a[t] > 0 : a[t] < Cn) && v < gmin) gmin = v;
    }
    if (i < 0 || gmax - gmin < 1e-3) break;
    let j = -1, bestObj = Infinity;
    for (let t = 0; t < n; t++) {
      if (!(ys[t] > 0 ? a[t] > 0 : a[t] < Cn)) continue;
      const b = gmax + ys[t] * G[t];
      if (b <= 0) continue;
      const q = Math.max(Kc[i * n + i] + Kc[t * n + t] - 2 * Kc[i * n + t], 1e-12), obj = -(b * b) / q;
      if (obj < bestObj) { bestObj = obj; j = t; }
    }
    if (j < 0) break;
    const q = Math.max(Kc[i * n + i] + Kc[j * n + j] - 2 * Kc[i * n + j], 1e-12);
    let step = (gmax + ys[j] * G[j]) / q;
    // a_i += y_i*step, a_j -= y_j*step, both kept inside [0, C]
    step = Math.min(step, ys[i] > 0 ? Cp - a[i] : a[i], ys[j] > 0 ? a[j] : Cn - a[j]);
    if (step <= 0) break;
    const di = ys[i] * step, dj = -ys[j] * step;
    a[i] += di; a[j] += dj;
    for (let t = 0; t < n; t++) G[t] += ys[t] * (ys[i] * Kc[t * n + i] * di + ys[j] * Kc[t * n + j] * dj);
  }
  let sum = 0, free = 0;
  for (let t = 0; t < n; t++) if (a[t] > 1e-9 && a[t] < (ys[t] > 0 ? Cp : Cn) - 1e-9) { sum += -ys[t] * G[t]; free++; }
  const bias = free ? sum / free : (gmax + gmin) / 2;
  const sv = [], coef = [];
  for (let t = 0; t < n; t++) if (a[t] > 1e-9) { sv.push(rows[t]); coef.push(a[t] * ys[t]); }
  return { sv, coef, bias };
}

export async function trainSVM(X, y, n, d, K, opts = {}, onProgress = () => {}) {
  const o = { kernel: "RBF", cost: 10, gamma: 0.5, degree: 3, coef0: 0, maxTrain: 2000, seed: 42, ...opts };
  const rand = rng(o.seed), mean = new Float64Array(d), sd = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] += X[i * d + j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) { const t = X[i * d + j] - mean[j]; sd[j] += t * t; }
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j] / n) || 1;
  // a stratified subset keeps the kernel matrix small
  const byClass = Array.from({ length: K }, () => []);
  for (let i = 0; i < n; i++) byClass[y[i]].push(i);
  const keep = Math.min(1, o.maxTrain / n), rows = byClass.map((list) => (keep < 1 ? shuffle(list, rand).slice(0, Math.max(2, Math.round(list.length * keep))) : list));
  const used = rows.flat(), Z = new Float32Array(used.length * d), pos = new Map();
  // class weights from the pixels actually trained on, so they match the problem the solver sees
  let cw = null;
  if (o.balanced) { const present = rows.filter((l) => l.length).length; cw = rows.map((l) => (l.length ? used.length / (present * l.length) : 0)); }
  used.forEach((r, i) => { pos.set(r, i); for (let j = 0; j < d; j++) Z[i * d + j] = (X[r * d + j] - mean[j]) / sd[j]; });
  // gamma is given per feature, so a setting keeps its meaning when layers are added
  const kern = kernelFn({ ...o, gamma: o.gamma / d }), pairs = [], total = (K * (K - 1)) / 2;
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    const r = [...rows[a], ...rows[b]].map((x) => pos.get(x)), ys = new Float64Array(r.length);
    for (let i = 0; i < r.length; i++) ys[i] = i < rows[a].length ? 1 : -1;
    const sol = r.length ? solveSVC(Z, r, ys, d, o.cost * (cw ? cw[a] : 1), o.cost * (cw ? cw[b] : 1), kern) : { sv: [], coef: [], bias: 0 };
    const pair = { a, b, bias: sol.bias, coef: Float64Array.from(sol.coef), sv: new Float32Array(sol.sv.length * d) };
    sol.sv.forEach((row, i) => pair.sv.set(Z.subarray(row * d, row * d + d), i * d));
    if (o.kernel === "LINEAR") {
      pair.w = new Float64Array(d);
      sol.sv.forEach((row, i) => { for (let j = 0; j < d; j++) pair.w[j] += sol.coef[i] * Z[row * d + j]; });
    }
    pairs.push(pair);
    onProgress(pairs.length / total);
    await tick();
  }
  return { type: "SVM", d, K, pairs, mean, sd, kernel: o.kernel, gamma: o.gamma / d, coef0: o.coef0, degree: o.degree, trained: used.length, importance: null };
}

function predictSVM(model, X, n, out) {
  const { d, K, pairs, mean, sd } = model, kern = kernelFn(model), z = new Float32Array(d), votes = new Uint16Array(K);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) z[j] = (X[i * d + j] - mean[j]) / sd[j];
    votes.fill(0);
    for (const p of pairs) {
      let f = p.bias;
      if (p.w) for (let j = 0; j < d; j++) f += p.w[j] * z[j];
      else for (let s = 0; s < p.coef.length; s++) f += p.coef[s] * kern(p.sv, s * d, z, 0, d);
      votes[f >= 0 ? p.a : p.b]++;
    }
    let best = 0;
    for (let k = 1; k < K; k++) if (votes[k] > votes[best]) best = k;
    out[i] = best;
  }
}

export function predict(model, X, n, out = new Uint8Array(n)) {
  if (model.type === "RF") predictRF(model, X, n, out);
  else if (model.type === "GTB") predictGTB(model, X, n, out);
  else predictSVM(model, X, n, out);
  return out;
}

export function train(algo, X, y, n, d, K, opts, onProgress) {
  if (algo === "GTB") return trainGTB(X, y, n, d, K, opts, onProgress);
  if (algo === "SVM") return trainSVM(X, y, n, d, K, opts, onProgress);
  return trainRF(X, y, n, d, K, opts, onProgress);
}

// ---------------------------------------------------------------- accuracy

/** matrix[reference][classified]. */
export function accuracy(truth, pred, K) {
  const M = Array.from({ length: K }, () => new Array(K).fill(0)), n = truth.length;
  for (let i = 0; i < n; i++) M[truth[i]][pred[i]]++;
  const row = M.map((r) => r.reduce((a, b) => a + b, 0)), col = M[0].map((_, j) => M.reduce((a, r) => a + r[j], 0));
  let diag = 0, chance = 0;
  for (let k = 0; k < K; k++) { diag += M[k][k]; chance += row[k] * col[k]; }
  const oa = n ? diag / n : 0, pe = n ? chance / (n * n) : 0;
  return {
    n, matrix: M, oa, kappa: pe < 1 ? (oa - pe) / (1 - pe) : 1,
    pa: M.map((r, k) => (row[k] ? r[k] / row[k] : null)), ua: M.map((r, k) => (col[k] ? r[k] / col[k] : null)),
    f1: M.map((r, k) => (row[k] + col[k] ? (2 * r[k]) / (row[k] + col[k]) : null)),
  };
}

/**
 * Area-weighted accuracy after Olofsson et al. 2014 (Remote Sens. Environ. 148, 42-57), the estimator the
 * Semi-Automatic Classification Plugin reports. `matrix[reference][classified]` holds sample counts and `weights[k]`
 * the mapped area proportion of class k. Every figure is an estimate with its standard error (95 % CI = 1.96 se).
 * Map classes without test samples cannot be estimated: they are left out and the remaining weights renormalised.
 */
export function areaAccuracy(matrix, weights) {
  const K = matrix.length, nMap = Array.from({ length: K }, (_, i) => matrix.reduce((s, r) => s + r[i], 0));
  const used = nMap.map((n) => n > 0), wsum = weights.reduce((s, w, i) => s + (used[i] ? w : 0), 0) || 1;
  const W = weights.map((w, i) => (used[i] ? w / wsum : 0));
  // frac[i][j]: share of map class i's samples whose reference is j; p[i][j] the estimated area proportion
  const frac = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => (used[i] ? matrix[j][i] / nMap[i] : 0)));
  const p = frac.map((r, i) => r.map((f) => W[i] * f));
  const v = (i, j) => (nMap[i] > 1 ? (frac[i][j] * (1 - frac[i][j])) / (nMap[i] - 1) : 0);
  let oa = 0, voa = 0;
  for (let i = 0; i < K; i++) { oa += p[i][i]; voa += W[i] * W[i] * v(i, i); }
  const refArea = Array.from({ length: K }, (_, j) => p.reduce((s, r) => s + r[j], 0));
  const refSe = Array.from({ length: K }, (_, j) => { let s = 0; for (let i = 0; i < K; i++) s += W[i] * W[i] * v(i, j); return Math.sqrt(s); });
  const ua = frac.map((r, i) => (used[i] ? r[i] : null)), uaSe = ua.map((u, i) => (u == null ? null : Math.sqrt(v(i, i))));
  const pa = refArea.map((a, j) => (a > 0 ? p[j][j] / a : null));
  const paSe = pa.map((P, j) => {
    if (P == null) return null;
    let s = W[j] * W[j] * (1 - P) * (1 - P) * v(j, j);
    for (let i = 0; i < K; i++) if (i !== j) s += P * P * W[i] * W[i] * v(i, j);
    return Math.sqrt(s) / refArea[j];
  });
  return { weights: W, used, p, oa, oaSe: Math.sqrt(voa), ua, uaSe, pa, paSe, refArea, refSe };
}

/** Majority filter over a size×size window; 0 (NoData) stays 0 and never votes. */
export function majority(src, width, height, size, K) {
  const out = new Uint8Array(src.length), r = size >> 1, cnt = new Uint16Array(K + 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = src[y * width + x];
    if (!c) continue;
    cnt.fill(0);
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= height) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < width) cnt[src[yy * width + xx]]++; } }
    let best = c;
    for (let k = 1; k <= K; k++) if (cnt[k] > cnt[best]) best = k;
    out[y * width + x] = best;
  }
  return out;
}

/** Area per class value in m². Geographic grids use the cell area at each row's latitude. */
export function classAreas(cls, grid, K) {
  const [w, s, e, n] = grid.bounds, dx = (e - w) / grid.width, dy = (n - s) / grid.height, area = new Float64Array(K + 1), cells = new Float64Array(K + 1), R = 6371008.8, rad = Math.PI / 180;
  for (let y = 0; y < grid.height; y++) {
    const lat = n - (y + 0.5) * dy, a = grid.geographic ? dx * rad * R * Math.cos(lat * rad) * dy * rad * R : dx * dy;
    for (let x = 0; x < grid.width; x++) { const c = cls[y * grid.width + x]; area[c] += a; cells[c]++; }
  }
  return { area, cells };
}

// ---------------------------------------------------------------- GeoTIFF writer (tiled, uncompressed, little-endian)

/**
 * data: Uint8Array (8-bit) or Float32Array (float), pixel-interleaved, `samples` per pixel.
 * opts: { width, height, samples, bounds:[w,s,e,n], epsg, geographic, palette?: [[r,g,b] x up to 256] (1 sample, 8-bit),
 * rgb?: bool (photometric RGB, 3 samples), nodata?: number, names?: string[] (band descriptions, read by GDAL) }
 */
export function writeGeoTiff(data, opts) {
  const { width, height, samples = 1, bounds, epsg = 4326, geographic = true } = opts, T = 256;
  const float = data instanceof Float32Array, bps = float ? 4 : 1;
  const tx = Math.ceil(width / T), ty = Math.ceil(height / T), nt = tx * ty, tileBytes = T * T * samples * bps;
  const tags = [];
  const add = (tag, type, values) => tags.push({ tag, type, values });
  const ascii = (s) => [...new TextEncoder().encode(s)].concat(0);
  add(256, 4, [width]); add(257, 4, [height]);
  add(258, 3, new Array(samples).fill(8 * bps)); add(259, 3, [1]);
  add(262, 3, [opts.palette ? 3 : opts.rgb && samples === 3 ? 2 : 1]);
  add(277, 3, [samples]); add(284, 3, [1]);
  if (opts.palette) {
    const cm = new Array(768).fill(0);
    opts.palette.forEach((c, i) => { cm[i] = c[0] * 257; cm[256 + i] = c[1] * 257; cm[512 + i] = c[2] * 257; });
    add(320, 3, cm);
  }
  add(322, 3, [T]); add(323, 3, [T]);
  add(324, 4, new Array(nt).fill(0)); add(325, 4, new Array(nt).fill(tileBytes));
  add(339, 3, new Array(samples).fill(float ? 3 : 1));
  add(33550, 12, [(bounds[2] - bounds[0]) / width, (bounds[3] - bounds[1]) / height, 0]);
  add(33922, 12, [0, 0, 0, bounds[0], bounds[3], 0]);
  add(34735, 3, geographic ? [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, epsg] : [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg]);
  if (opts.names?.length) {
    const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    add(42112, 2, ascii(`<GDALMetadata>${opts.names.map((n, i) => `<Item name="DESCRIPTION" sample="${i}" role="description">${xml(n)}</Item>`).join("")}</GDALMetadata>`));
  }
  if (opts.nodata != null) add(42113, 2, ascii(String(opts.nodata)));
  tags.sort((a, b) => a.tag - b.tag);
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  let extra = 0;
  for (const t of tags) { t.bytes = t.values.length * size[t.type]; if (t.bytes > 4) { t.off = extra; extra += t.bytes + (t.bytes & 1); } }
  const ifd = 8, ifdLen = 2 + tags.length * 12 + 4, extraAt = ifd + ifdLen, dataAt = extraAt + extra;
  const buf = new ArrayBuffer(dataAt + nt * tileBytes), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, tags.length, true);
  const put = (at, type, v) => { if (type === 2) dv.setUint8(at, v); else if (type === 3) dv.setUint16(at, v, true); else if (type === 4) dv.setUint32(at, v, true); else dv.setFloat64(at, v, true); };
  tags.forEach((t, i) => {
    if (t.tag === 324) t.values = t.values.map((_, k) => dataAt + k * tileBytes);
    const at = ifd + 2 + i * 12;
    dv.setUint16(at, t.tag, true); dv.setUint16(at + 2, t.type, true); dv.setUint32(at + 4, t.values.length, true);
    const where = t.bytes > 4 ? extraAt + t.off : at + 8;
    if (t.bytes > 4) dv.setUint32(at + 8, where, true);
    t.values.forEach((v, k) => put(where + k * size[t.type], t.type, v));
  });
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), px = samples * bps; // little-endian host assumed (all current browsers)
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const base = dataAt + (j * tx + i) * tileBytes, cols = Math.min(T, width - i * T), rows = Math.min(T, height - j * T);
    for (let r = 0; r < rows; r++) {
      const src = ((j * T + r) * width + i * T) * px;
      u8.set(bytes.subarray(src, src + cols * px), base + r * T * px);
    }
  }
  return u8;
}

/** Three layers -> pixel-interleaved 8-bit RGB with a 2-98 % stretch per channel. 1-255 is data, 0 is NoData. */
export function compositeRgb(r, g, b, n, valid) {
  const out = new Uint8Array(n * 3), ch = [r, g, b];
  ch.forEach((L, c) => {
    const [lo, hi] = stretchLimits(L, NaN), k = 254 / (hi - lo);
    for (let i = 0; i < n; i++) {
      const v = L[i];
      if (!valid[i] || !Number.isFinite(v)) continue;
      out[i * 3 + c] = 1 + Math.round(Math.min(254, Math.max(0, (v - lo) * k)));
    }
  });
  for (let i = 0; i < n; i++) if (!valid[i]) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0;
  return out;
}

/** Layers -> pixel-interleaved Float32 stack; cells without data in every layer get `nodata`. */
export function compositeStack(layers, n, valid, nodata = -9999) {
  const d = layers.length, out = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    let ok = !!valid[i];
    if (ok) for (let j = 0; j < d; j++) if (!Number.isFinite(layers[j][i])) { ok = false; break; }
    for (let j = 0; j < d; j++) out[i * d + j] = ok ? layers[j][i] : nodata;
  }
  return out;
}

// ---------------------------------------------------------------- PNG resolution

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Set a PNG's physical resolution (pHYs chunk, after IHDR), so 300 dpi opens as 300 dpi in Word and print tools. */
export function pngWithDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [png.subarray(0, 8)], view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let p = 8; p + 8 <= png.length;) {
    const len = view.getUint32(p), type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]), end = p + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(p, end));
    if (type === "IHDR") parts.push(chunk);
    p = end;
  }
  const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

// ---------------------------------------------------------------- XLSX writer (stored zip, inline strings)

function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new Uint8Array(30 + name.length), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
    dv.setUint16(12, 0x21, true); // 1980-01-01
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true);
    h.set(name, 30);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, off, true);
    c.set(name, 46);
    parts.push(h, data); central.push(c);
    off += h.length + data.length;
  }
  const cdLen = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

/**
 * A workbook from plain rows. sheets: [{ name, rows: any[][], widths?: number[] }]. Numbers become numeric cells,
 * everything else text; a cell written as { v, bold: true } is bold.
 */
export function writeXlsx(sheets) {
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const col = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const sheetXml = (sh) => {
    const rows = sh.rows.map((row, r) => `<row r="${r + 1}">` + row.map((cell, c) => {
      const obj = cell && typeof cell === "object", v = obj ? cell.v : cell, ref = col(c) + (r + 1), st = obj && cell.bold ? ' s="1"' : "";
      if (v == null || v === "") return "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    }).join("") + "</row>").join("");
    const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const names = sheets.map((s, i) => x(String(s.name || "Sheet" + (i + 1)).replace(/[\\/?*[\]:]/g, " ").slice(0, 31)));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore([
    { name: "[Content_Types].xml", data: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) })),
  ]);
}

// ---------------------------------------------------------------- raster to polygons

/** 4-connected components of equal non-zero class. lab[i] = component id (1..n), compCls/size per component. */
export function labelComponents(cls, W, H) {
  const lab = new Int32Array(W * H), parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const c = cls[i];
    if (!c) continue;
    const u = y && cls[i - W] === c ? lab[i - W] : 0, l = x && cls[i - 1] === c ? lab[i - 1] : 0;
    if (!u && !l) { lab[i] = parent.length; parent.push(parent.length); }
    else if (u && l) { const a = find(u), b = find(l); lab[i] = Math.min(a, b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    else lab[i] = u || l;
  }
  const map = new Int32Array(parent.length);
  let n = 0;
  for (let k = 1; k < parent.length; k++) { const r = find(k); map[k] = r === k ? ++n : map[r]; }
  const size = new Int32Array(n + 1), compCls = new Uint8Array(n + 1);
  for (let i = 0; i < lab.length; i++) if (lab[i]) { const k = (lab[i] = map[lab[i]]); size[k]++; compCls[k] = cls[i]; }
  return { lab, n, size, compCls };
}

/** Sieve: patches under minPx cells take the class most of their 4-neighbours have (repeated until stable, at most 4 passes). */
export function sieve(src, W, H, minPx) {
  const cls = Uint8Array.from(src);
  if (minPx <= 1) return cls;
  for (let pass = 0; pass < 4; pass++) {
    const { lab, n, size } = labelComponents(cls, W, H), small = new Int32Array(n + 1);
    let m = 0;
    for (let k = 1; k <= n; k++) if (size[k] < minPx) small[k] = ++m;
    if (!m) break;
    const votes = new Int32Array((m + 1) * 256);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const s = small[lab[i]];
      if (!s) continue;
      const v = (j) => { if (lab[j] !== lab[i] && cls[j]) votes[s * 256 + cls[j]]++; };
      if (y) v(i - W); if (y < H - 1) v(i + W); if (x) v(i - 1); if (x < W - 1) v(i + 1);
    }
    const to = new Uint8Array(m + 1);
    for (let s = 1; s <= m; s++) { let best = 0, bv = 0; for (let c = 1; c < 256; c++) if (votes[s * 256 + c] > bv) { bv = votes[s * 256 + c]; best = c; } to[s] = best; }
    let changed = 0;
    for (let i = 0; i < cls.length; i++) { const s = small[lab[i]]; if (s && to[s]) { cls[i] = to[s]; changed++; } }
    if (!changed) break;
  }
  return cls;
}

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // E, S, W, N in pixel space (y down)

/**
 * Dissolved polygons per class along pixel edges. Each 4-connected patch is one polygon (outer ring + holes);
 * all patches of a class form one MultiPolygon. toXY(px, py) maps a pixel-corner to output coordinates.
 * Rings follow RFC 7946: exterior counter-clockwise, holes clockwise. Returns Map<class, { polygons, patches }>.
 */
export function polygonize(cls, W, H, toXY) {
  const { lab, n, compCls } = labelComponents(cls, W, H);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : lab[y * W + x]);
  // right / left pixel of an edge leaving vertex (x, y) in direction d
  const rightOf = (d, x, y) => (d === 0 ? at(x, y) : d === 1 ? at(x - 1, y) : d === 2 ? at(x - 1, y - 1) : at(x, y - 1));
  const leftOf = (d, x, y) => (d === 0 ? at(x, y - 1) : d === 1 ? at(x, y) : d === 2 ? at(x - 1, y) : at(x - 1, y - 1));
  const hSeen = new Uint8Array(W * (H + 1));
  const outers = new Array(n + 1), holes = new Array(n + 1);
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    const c = lab[y0 * W + x0];
    if (!c || at(x0, y0 - 1) === c || hSeen[y0 * W + x0] & 1) continue;
    const pts = [];
    let x = x0, y = y0, d = 0;
    for (;;) {
      if (d === 0) hSeen[y * W + x] |= 1;
      const nx = x + DX[d], ny = y + DY[d];
      let nd = -1;
      for (const t of [1, 0, 3]) { const dd = (d + t) & 3; if (rightOf(dd, nx, ny) === c && leftOf(dd, nx, ny) !== c) { nd = dd; break; } }
      if (nd !== d) pts.push(nx, ny);
      x = nx; y = ny; d = nd;
      if (x === x0 && y === y0 && d === 0) break;
    }
    // A patch that touches itself at a pixel corner passes that corner twice: split there so every ring is simple.
    // Traced with the patch on the right, a loop that runs clockwise on screen (area > 0, y down) bounds the patch.
    for (const loop of splitLoops(pts, W + 1)) (loopArea(loop) > 0 ? (outers[c] ??= []) : (holes[c] ??= [])).push(loop);
  }
  const ring = (loop) => { const r = []; for (let k = loop.length - 2; k >= 0; k -= 2) r.push(toXY(loop[k], loop[k + 1])); r.push(r[0]); return r; };
  const out = new Map();
  for (let k = 1; k <= n; k++) {
    const os = outers[k];
    if (!os) continue;
    const groups = os.map((o) => [o]);
    for (const h of holes[k] ?? []) {
      // the midpoint of a hole edge lies strictly inside the patch outline that holds it
      const mx = (h[0] + h[2]) / 2, my = (h[1] + h[3]) / 2;
      let gi = 0;
      if (os.length > 1) gi = Math.max(0, os.findIndex((o) => inLoop(mx, my, o)));
      groups[gi].push(h);
    }
    const e = out.get(compCls[k]) ?? { polygons: [], patches: 0 };
    for (const g of groups) e.polygons.push(g.map(ring));
    e.patches++;
    out.set(compCls[k], e);
  }
  return out;
}

/** Split a closed corner list [x0,y0,x1,y1,…] at repeated vertices into simple loops. */
function splitLoops(pts, stride) {
  const loops = [], stack = [], pos = new Map();
  for (let k = 0; k < pts.length; k += 2) {
    const key = pts[k + 1] * stride + pts[k], i = pos.get(key);
    if (i !== undefined) {
      const loop = stack.splice(i + 2);
      for (let j = 0; j < loop.length; j += 2) pos.delete(loop[j + 1] * stride + loop[j]);
      loop.push(pts[k], pts[k + 1]);
      if (loop.length >= 6) loops.push(loop.slice(-2).concat(loop.slice(0, -2)));
    } else {
      pos.set(key, stack.length);
      stack.push(pts[k], pts[k + 1]);
    }
  }
  if (stack.length >= 6) loops.push(stack);
  return loops;
}
function loopArea(l) {
  let a = 0;
  for (let k = 0, m = l.length; k < m; k += 2) { const j = (k + 2) % m; a += l[k] * l[j + 1] - l[j] * l[k + 1]; }
  return a;
}
function inLoop(x, y, l) {
  let c = false;
  for (let i = 0, m = l.length, j = m - 2; i < m; j = i, i += 2) {
    const xi = l[i], yi = l[i + 1], xj = l[j], yj = l[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const v = m ? parseInt(m[1], 16) : 0x888888;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 2-98 percentile limits of a band, ignoring NoData. */
export function stretchLimits(band, nodata) {
  const step = Math.max(1, Math.floor(band.length / 50000)), v = [];
  for (let i = 0; i < band.length; i += step) { const x = band[i]; if (Number.isFinite(x) && x !== nodata) v.push(x); }
  if (!v.length) return [0, 1];
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}
