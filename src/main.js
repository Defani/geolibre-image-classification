// Image Classification: GeoLibre plugin UI. Core (indices, classifiers, accuracy, GeoTIFF writer) is prepended by build.mjs.
const ID = "image-classification";
const PANEL = ID + "-panel";
const VERSION = "0.4.9";
const SRC = "icl-samples", DRAFT = "icl-draft";
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><style>*{fill:#000}@media (prefers-color-scheme:dark){*{fill:#fff}}</style><rect x="2" y="2" width="9" height="9" rx="1.5"/><rect x="13" y="2" width="9" height="9" rx="1.5" opacity=".55"/><rect x="2" y="13" width="9" height="9" rx="1.5" opacity=".55"/><rect x="13" y="13" width="9" height="9" rx="1.5"/></svg>',
  );

const COLORS = ["#1f78b4", "#33a02c", "#e31a1c", "#ff7f00", "#6a3d9a", "#b15928", "#17becf", "#e377c2", "#bcbd22", "#7f7f7f"];
const SCHEMES = {
  klhk: [["Primary Dryland Forest", "#60E663"], ["Secondary Dryland Forest", "#72FF00"], ["Primary Mangrove Forest", "#8EA704"], ["Secondary Mangrove Forest", "#C1A700"], ["Primary Swamp Forest", "#60E663"], ["Secondary Swamp Forest", "#72FF00"], ["Plantation Forest", "#D3E598"], ["Shrubland", "#EBC0A7"], ["Swamp Shrubland", "#EBC0A7"], ["Dryland Agriculture", "#F6FFA7"], ["Mixed Dryland Agriculture", "#EDF500"], ["Paddy Field", "#A8D6FF"], ["Aquaculture / Fish Pond", "#7AF4F4"], ["Transmigration Settlement", "#728EA7"], ["Plantation", "#E5D298"], ["Settlement", "#686868"], ["Airport / Port", "#D60073"], ["Open / Bare Land", "#D60073"], ["Mining Area", "#A70400"], ["Water Body", "#D4FCF7"], ["Swamp", "#98E5E5"], ["Savanna / Grassland", "#D5FF02"], ["Clouds", "#D1D1D1"]],
  mapbiomas: [["Forest Formation", "#1f8d49"], ["Mangrove", "#04381d"], ["Peat Swamp Forest", "#2f7360"], ["Other Non-Forest Natural", "#d89f5c"], ["Paddy Field", "#c71585"], ["Oil Palm", "#9065d0"], ["Timber Plantation", "#7a5900"], ["Other Agriculture", "#ffefc3"], ["Mining", "#9c0027"], ["Urban Area", "#d4271e"], ["Other Non-Vegetated", "#db4d4f"], ["Aquaculture", "#091077"], ["River, Lake, Ocean", "#2532e4"]],
  nlcd: [["Open Water", "#466b9f"], ["Perennial Ice/Snow", "#d1def8"], ["Developed, Open Space", "#dec5c5"], ["Developed, Low Intensity", "#d99282"], ["Developed, Medium Intensity", "#eb0000"], ["Developed High Intensity", "#ab0000"], ["Barren Land", "#b3ac9f"], ["Deciduous Forest", "#68ab5f"], ["Evergreen Forest", "#1c5f2c"], ["Mixed Forest", "#b5c58f"], ["Dwarf Scrub", "#af963c"], ["Shrub/Scrub", "#ccb879"], ["Grassland/Herbaceous", "#dfdfc2"], ["Sedge/Herbaceous", "#d1d182"], ["Lichens", "#a3cc51"], ["Moss", "#82ba9e"], ["Pasture/Hay", "#dcd939"], ["Cultivated Crops", "#ab6c28"], ["Woody Wetlands", "#b8d9eb"], ["Emergent Herbaceous Wetlands", "#6c9fb8"]],
};
const TABS = [["layers", "Layers"], ["samples", "Samples"], ["model", "Model"], ["results", "Results"], ["threshold", "Threshold"]];
const TOOLS = [["pan", "Pan"], ["point", "Point"], ["polygon", "Polygon"], ["circle", "Circle"], ["rect", "Rectangle"]];
const ALGO_NAMES = { RF: "Random Forest", GTB: "Gradient Tree Boost", SVM: "Support Vector Machine" };

const S = {
  app: null, root: null, dispose: [], tab: "layers",
  sources: [], // [{ key, name, url, layerId?, file?, tiff?, error? }]
  inputs: {}, // "srcKey|band" -> { on, role }
  indexOn: { NDVI: true, NDWI: true, NDBI: true }, custom: [], // [{ name, expr }]
  sensor: "s2", gridKey: "", scale: "auto", cellFactor: 1,
  classes: [], active: 0, samples: [], seq: 1, tool: "pan", draft: [], cursor: null, scheme: "",
  stack: null, stackKey: "", reading: null, profile: null,
  run: null, result: null, resultLayerId: null, busy: false, msg: "",
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nf = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 2) => (v == null ? "–" : nf(v * 100, d));
const $ = (sel) => (S.win ?? S.root)?.querySelector(sel);
const opt = (pairs, sel) => pairs.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(t)}</option>`).join("");
const P = () => S.params;

S.params = {
  algo: "RF", rfTrees: 500, rfLeaf: 1, rfBag: 0.5, rfVars: "sqrt", rfDepth: 0,
  gtbTrees: 200, gtbShrink: 0.05, gtbSamp: 0.7, gtbNodes: 5,
  svmKernel: "RBF", svmCost: 10, svmGamma: 0.5, svmDegree: 3, svmCoef: 0,
  split: 0.7, splitBy: "pixel", maxPix: 500, seed: 42, balanced: false, gpu: true, smooth: 0, outName: "Land Cover (Random Forest)",
  kind: "sup", ualgo: "KM", uK: 8, uIter: 30, uTol: 0.5, uSample: 50000,
};

// ================================================================ raster sources

async function rasterLib() {
  const lib = await S.app.getMaplibreGlRaster?.();
  if (!lib?.loadGeoTIFF) throw new Error("This GeoLibre build cannot read GeoTIFF pixels for plugins.");
  return lib;
}

function bandNamesOf(layer, count) {
  const raw = layer?.metadata?.bandNames, names = [];
  if (Array.isArray(raw)) for (const p of raw) { if (Array.isArray(p) && typeof p[0] === "number") names[p[0] - 1] = String(p[1] ?? ""); }
  return Array.from({ length: count }, (_, i) => names[i] || `Band ${i + 1}`);
}

// Blob URLs of the layers this plugin put on the map in this page session, shared by every loaded copy of the plugin.
const BLOBS = (globalThis.__imageClassificationBlobs ??= new Set());
const layerBlob = (bytes) => { const url = URL.createObjectURL(new Blob([bytes], { type: "image/tiff" })); BLOBS.add(url); return url; };

function mapRasterLayers() {
  let layers = [];
  try { layers = S.app.getProjectSnapshot?.()?.layers ?? []; } catch { layers = []; }
  return layers
    .filter((l) => l.type === "cog" && l.id !== S.resultLayerId)
    .map((l) => {
      const url = l.metadata?.localBytesUrl || l.source?.url || "";
      // A blob the host does not hold and this session did not make is a composite or result from an earlier
      // session: its bytes are gone, and fetching it would only log a network error in Diagnostics.
      const gone = !l.metadata?.localBytesUrl && url.startsWith("blob:") && !BLOBS.has(url);
      return { key: "L:" + l.id, layerId: l.id, name: l.name, url, meta: l, gone };
    });
}

async function refreshSources() {
  const keep = new Map(S.sources.map((s) => [s.key, s]));
  const next = mapRasterLayers().map((s) => { const k = keep.get(s.key); if (!k) return s; k.meta = s.meta; k.name = s.name; return k; });
  for (const s of S.sources) if (s.file) next.push(s);
  S.sources = next;
  const lib = await rasterLib().catch((e) => { S.msg = e.message; return null; });
  if (!lib) return render();
  await Promise.all(S.sources.map(async (s) => {
    if (s.tiff || s.error) return;
    if (!s.url) { s.error = "Not readable (no file data in this session)"; return; }
    if (s.gone) { s.error = "Made in an earlier session, its pixels are no longer in memory. Use Show on map to make it again."; return; }
    try { s.tiff = await lib.loadGeoTIFF(s.url); } catch (e) { s.error = "Could not open: " + (e?.message ?? e); }
  }));
  for (const s of S.sources) {
    if (!s.tiff) continue;
    const names = s.file ? Array.from({ length: s.tiff.count }, (_, i) => (s.tiff.count === 1 ? s.name : `${s.name} · ${i + 1}`)) : bandNamesOf(s.meta, s.tiff.count);
    s.bands = names.map((n, i) => ({ key: s.key + "|" + i, label: s.tiff.count === 1 ? s.name : `${s.name} · ${n}`, index: i }));
    for (const b of s.bands) {
      const role = guessRole(s.tiff.count === 1 ? s.name : n0(b.label), S.sensor), inp = S.inputs[b.key];
      if (!inp) S.inputs[b.key] = { on: true, role, auto: true };
      else if (inp.auto && inp.role !== role) { inp.role = role; invalidate(); } // the layer's band names arrived after the first look
    }
  }
  if (!S.sources.some((s) => s.key === S.gridKey && s.tiff)) S.gridKey = pickGrid();
  render();
}
const n0 = (label) => label.split(" · ").pop();

function pickGrid() {
  const ok = S.sources.filter((s) => s.tiff);
  if (!ok.length) return "";
  // the finest grid: smallest pixel
  ok.sort((a, b) => Math.abs(a.tiff.transform[0]) - Math.abs(b.tiff.transform[0]));
  return ok[0].key;
}

/** GeoTIFFs read by the plugin itself: they are inputs here and never land in the Layers panel unless shown. */
function addFileSources(files, group = "") {
  let added = 0;
  for (const f of files) {
    if (!/\.tiff?$/i.test(f.name)) continue;
    const key = "F:" + (f.webkitRelativePath || f.name) + ":" + f.size;
    if (S.sources.some((s) => s.key === key)) continue;
    S.sources.push({ key, name: f.name.replace(/\.tiff?$/i, ""), url: URL.createObjectURL(f), file: f, group });
    added++;
  }
  S.sources.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name, undefined, { numeric: true }));
  say(added ? `Added ${added} GeoTIFF${added > 1 ? "s" : ""}${group ? ` from ${group}` : ""}.` : "No new GeoTIFF found.", !!added);
  refreshSources();
}
function pickFiles(folder) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  if (folder) inp.webkitdirectory = true; else inp.accept = ".tif,.tiff,image/tiff";
  inp.onchange = () => {
    const files = [...(inp.files ?? [])];
    const group = folder ? (files[0]?.webkitRelativePath?.split("/")[0] || "Folder") : "";
    addFileSources(files, group);
  };
  inp.click();
}
function addFiles() { pickFiles(false); }
async function addFolder() {
  if (S.app.pickLocalDirectoryFiles) {
    try {
      const files = await S.app.pickLocalDirectoryFiles();
      if (files?.length) return addFileSources(files, files[0].webkitRelativePath?.split("/")[0] || "Folder");
      if (files) return; // cancelled
    } catch (e) { console.warn("[Image Classification] folder picker", e); }
  }
  pickFiles(true);
}
function removeGroup(group) {
  for (const s of S.sources) if (s.file && (s.group ?? "") === group) URL.revokeObjectURL(s.url);
  S.sources = S.sources.filter((s) => !(s.file && (s.group ?? "") === group));
  for (const k of Object.keys(S.inputs)) if (!S.sources.some((s) => k.startsWith(s.key + "|"))) delete S.inputs[k];
  invalidate();
  if (!S.sources.some((s) => s.key === S.gridKey)) S.gridKey = pickGrid();
  render();
}

function selectedBands() {
  const out = [], set = activeSet();
  for (const s of S.sources) if (s.tiff && setKeyOf(s) === set) for (const b of s.bands) if (S.inputs[b.key]?.on) out.push({ src: s, band: b, role: S.inputs[b.key].role });
  return out;
}
function rolesPresent() {
  const r = {};
  for (const b of selectedBands()) if (b.role && !r[b.role]) r[b.role] = b;
  return r;
}
function indexDefs() {
  const roles = rolesPresent(), defs = [];
  for (const [name, def] of Object.entries(INDICES)) if (S.indexOn[name] && def.needs.every((k) => roles[k])) defs.push({ name, def });
  for (const c of S.custom) if (S.indexOn[c.name]) { try { const def = compileExpression(c.expr, Object.keys(roles)); defs.push({ name: c.name, def }); } catch { /* shown in the list */ } }
  return defs;
}
function featureNames() { return [...selectedBands().map((b) => b.band.label), ...indexDefs().map((d) => d.name)]; }

// ---------------------------------------------------------------- grid + reading

const isGeo = (crs) => crs === 4326 || crs === 4269 || crs === 4258 || (typeof crs === "object" && /geographic/i.test(crs?.type ?? ""));
function epsgOf(crs) { return typeof crs === "number" ? crs : crs?.id?.code ?? null; }

async function makeGrid() {
  const set = activeSet(), mine = S.sources.filter((s) => s.tiff && setKeyOf(s) === set).sort((a, b) => Math.abs(a.tiff.transform[0]) - Math.abs(b.tiff.transform[0]));
  const ref = mine.find((s) => s.key === S.gridKey) ?? mine[0];
  if (!ref) throw new Error("Choose a reference layer.");
  const t = ref.tiff, [a, b, c, d, e, f] = t.transform;
  if (b || d) throw new Error("Rotated rasters are not supported.");
  const k = Math.max(1, S.cellFactor), width = Math.max(1, Math.round(t.width / k)), height = Math.max(1, Math.round(t.height / k));
  const bounds = [c, f + e * t.height, c + a * t.width, f];
  const epsg = epsgOf(t.crs), geographic = isGeo(t.crs);
  let toCrs = (p) => p, toLL = (p) => p;
  if (!geographic) {
    const proj4 = await S.app.getProj4?.();
    const def = epsg && epsg >= 32601 && epsg <= 32760 ? `+proj=utm +zone=${epsg % 100}${epsg > 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs` : epsg ? "EPSG:" + epsg : null;
    if (!proj4 || !def) throw new Error("The reference layer's CRS cannot be converted to longitude/latitude.");
    let conv;
    try { conv = proj4("EPSG:4326", def); } catch { throw new Error(`Unknown CRS EPSG:${epsg}.`); }
    toCrs = (p) => conv.forward(p); toLL = (p) => conv.inverse(p);
  }
  return { width, height, bounds, epsg: epsg ?? 4326, geographic, crs: t.crs, toCrs, toLL, refKey: ref.key };
}

const sameCrs = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** Read one band of a GeoTIFF onto the grid, nearest neighbour, tile row by tile row. NoData and gaps become NaN. */
async function readOnGrid(tiff, band, grid, onTiles) {
  if (!sameCrs(tiff.crs, grid.crs)) throw new Error("All input layers must share the reference layer's CRS.");
  const [a, , c, , e, f] = tiff.transform, out = new Float32Array(grid.width * grid.height).fill(NaN);
  const gx = (grid.bounds[2] - grid.bounds[0]) / grid.width, gy = (grid.bounds[3] - grid.bounds[1]) / grid.height;
  const colPx = new Int32Array(grid.width), rowPx = new Int32Array(grid.height);
  for (let i = 0; i < grid.width; i++) colPx[i] = Math.floor((grid.bounds[0] + (i + 0.5) * gx - c) / a);
  for (let j = 0; j < grid.height; j++) rowPx[j] = Math.floor((grid.bounds[3] - (j + 0.5) * gy - f) / e);
  const TW = tiff.tileWidth, TH = tiff.tileHeight, nodata = tiff.nodata;
  let cx0 = Infinity, cx1 = -1;
  for (const p of colPx) if (p >= 0 && p < tiff.width) { cx0 = Math.min(cx0, p); cx1 = Math.max(cx1, p); }
  if (cx1 < 0) return out;
  const tx0 = Math.floor(cx0 / TW), tx1 = Math.floor(cx1 / TW), rowsByTile = new Map();
  for (let j = 0; j < grid.height; j++) { const p = rowPx[j]; if (p < 0 || p >= tiff.height) continue; const ty = Math.floor(p / TH); if (!rowsByTile.has(ty)) rowsByTile.set(ty, []); rowsByTile.get(ty).push(j); }
  const tys = [...rowsByTile.keys()].sort((x, y) => x - y);
  let done = 0;
  for (const ty of tys) {
    const tiles = [];
    for (let tx = tx0; tx <= tx1; tx += 8) {
      const batch = [];
      for (let k = tx; k <= Math.min(tx1, tx + 7); k++) batch.push(tiff.fetchTile(k, ty, { boundless: false }).then((t) => [k, t.array]).catch(() => [k, null]));
      tiles.push(...(await Promise.all(batch)));
    }
    const byX = new Map(tiles);
    for (const j of rowsByTile.get(ty)) {
      const ly = rowPx[j] - ty * TH, base = j * grid.width;
      for (let i = 0; i < grid.width; i++) {
        const p = colPx[i];
        if (p < 0 || p >= tiff.width) continue;
        const arr = byX.get(Math.floor(p / TW));
        if (!arr) continue;
        const lx = p - Math.floor(p / TW) * TW, idx = ly * arr.width + lx;
        const v = arr.layout === "band-separate" ? arr.bands[band][idx] : arr.data[idx * arr.count + band];
        if (v !== nodata && Number.isFinite(v)) out[base + i] = v;
      }
    }
    onTiles?.(++done / tys.length);
  }
  return out;
}

function stackKey() { return [S.gridKey, S.cellFactor, S.scale, ...selectedBands().map((b) => b.band.key)].join(","); }

/** Read every selected band onto the grid once; reused until the inputs change. */
async function ensureStack() {
  const key = stackKey();
  if (S.stack && S.stackKey === key) return S.stack;
  if (S.reading?.key === key) return S.reading.promise;
  const bands = selectedBands();
  if (!bands.length) throw new Error("Select at least one input layer.");
  const promise = (async () => {
    const grid = await makeGrid();
    if (grid.width * grid.height > 60e6) throw new Error(`The grid has ${nf(grid.width * grid.height)} cells. Use a coarser cell size.`);
    const data = [];
    for (let i = 0; i < bands.length; i++) {
      progress(`Reading ${bands[i].band.label}`, i / bands.length);
      try {
        data.push(await readOnGrid(bands[i].src.tiff, bands[i].band.index, grid, (p) => progress(`Reading ${bands[i].band.label}`, (i + p) / bands.length)));
      } catch (e) {
        const msg = e?.message ?? String(e);
        throw new Error(`${bands[i].band.label}: ${msg}${/not tiled/i.test(msg) ? ". Untick it in Layers, or convert it to a tiled (Cloud-Optimized) GeoTIFF." : ""}`);
      }
    }
    const sc = S.scale === "auto" ? autoScale(stretchLimits(data[0], NaN), S.sensor, bands.map((b) => b.band.label)) : { ...(SCALES[S.scale] ?? SCALES[1]), name: S.scale };
    const valid = new Uint8Array(grid.width * grid.height);
    for (let k = 0; k < valid.length; k++) { let ok = 1; for (const L of data) if (!Number.isFinite(L[k])) { ok = 0; break; } valid[k] = ok; }
    return { key, grid, bands, data, factor: sc.factor, offset: sc.offset, scaleName: sc.name, valid };
  })();
  S.reading = { key, promise };
  try {
    const st = await promise;
    if (S.reading?.key === key) { S.stack = st; S.stackKey = key; S.profile = null; }
    return st;
  } finally {
    if (S.reading?.key === key) S.reading = null;
    progress(null);
  }
}

/** Feature layers: raw bands then indices on reflectance, all Float32Array over the grid. */
function featureLayers(st) {
  const n = st.grid.width * st.grid.height, refl = {};
  st.bands.forEach((b, i) => {
    if (!b.role || refl[b.role]) return;
    const src = st.data[i], r = new Float32Array(n);
    for (let k = 0; k < n; k++) r[k] = src[k] * st.factor + st.offset;
    refl[b.role] = r;
  });
  const layers = [...st.data], names = st.bands.map((b) => b.band.label);
  for (const { name, def } of indexDefs()) { layers.push(computeIndex(def, refl, n)); names.push(name); }
  return { layers, names };
}

// ================================================================ samples on the map

// S.app is null once the plugin is deactivated, and the host may still run the panel cleanup after that.
function getMap() { return S.app?.getMap?.() ?? S.app?.getMapboxMap?.() ?? null; }

function sampleFC() {
  const cls = new Map(S.classes.map((c) => [c.code, c]));
  return {
    type: "FeatureCollection",
    features: S.samples.filter((s) => cls.has(s.code)).map((s) => ({ type: "Feature", id: s.id, properties: { code: s.code, name: cls.get(s.code).name, color: cls.get(s.code).color }, geometry: s.geometry })),
  };
}
function draftFC() {
  const d = S.draft, cur = S.cursor, feats = [];
  const color = activeClass()?.color ?? COLORS[0];
  if (d.length && cur) {
    let ring = null;
    if (S.tool === "rect") ring = rectRing(d[0], cur);
    else if (S.tool === "circle") ring = circleRing(d[0], cur);
    else ring = [...d, cur];
    if (ring) feats.push({ type: "Feature", properties: { color }, geometry: ring.length > 2 ? { type: "Polygon", coordinates: [[...ring, ring[0]]] } : { type: "LineString", coordinates: ring } });
  }
  for (const p of d) feats.push({ type: "Feature", properties: { color }, geometry: { type: "Point", coordinates: p } });
  if (S.identify && S.idValues) feats.push({ type: "Feature", properties: { color: "#000000" }, geometry: { type: "Point", coordinates: [S.idValues.lon, S.idValues.lat] } });
  return { type: "FeatureCollection", features: feats };
}
function rectRing(a, b) { return [a, [b[0], a[1]], b, [a[0], b[1]]]; }
function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function circleRing(c, edge) {
  const m = haversine(c, edge), dLat = m / 111320, dLon = m / (111320 * Math.cos((c[1] * Math.PI) / 180));
  return Array.from({ length: 48 }, (_, i) => { const t = (i * Math.PI) / 24; return [c[0] + dLon * Math.cos(t), c[1] + dLat * Math.sin(t)]; });
}

// Samples live as real GeoLibre layers, one per class, like Earth Engine's geometry imports: they draw above rasters
// in every renderer (the desktop draws COGs on a canvas above MapLibre's own layers), show in the Layers panel and
// save with the project. The sketch in progress and the identify pin are drawn on an SVG over the map instead.

S.classLayers = {}; // code -> { id, name, sig, color }
S.sampleGroup = null;

function classFC(c) {
  return { type: "FeatureCollection", features: S.samples.filter((s) => s.code === c.code).map((s) => ({ type: "Feature", properties: { class_code: c.code, class_name: c.name }, geometry: s.geometry })) };
}
function sampleStyle(color) {
  return JSON.stringify({ version: 8, sources: {}, layers: [
    { id: "s-fill", type: "fill", source: "s", paint: { "fill-color": color, "fill-opacity": 0.15 } },
    { id: "s-line", type: "line", source: "s", paint: { "line-color": color, "line-width": 2 } },
    // GeoLibre keeps one stroke colour per layer: a white circle stroke here would also turn the polygon outlines white
    { id: "s-pt", type: "circle", source: "s", paint: { "circle-color": color, "circle-radius": 5, "circle-stroke-color": color, "circle-stroke-width": 2 } },
  ] });
}
/**
 * Pick up a "Training samples" group already in the project (a reopened project, or the plugin reloaded): each of
 * its point/polygon layers becomes a class again, with its features as samples, so the next drawing joins it
 * instead of starting a second group.
 */
function adoptSampleLayers() {
  if (S.classes.length || S.samples.length) return;
  let snap;
  try { snap = S.app.getProjectSnapshot?.(); } catch { return; }
  // an earlier copy of the plugin may have left more than one such group: they all join the first
  const groups = (S.app.listLayerGroups?.() ?? []).filter((g) => g.name === "Training samples"), group = groups[0];
  if (!snap || !group) return;
  const ids = new Set(groups.map((g) => g.id));
  const members = (snap.layers ?? []).filter((l) => ids.has(l.groupId) && l.type === "geojson");
  let code = 0;
  for (const l of members) {
    const feats = (S.app.getLayerFeatures?.(l.id) ?? []).filter((f) => f?.geometry && /Point|Polygon/.test(f.geometry.type));
    if (!feats.length) continue;
    const twin = S.classes.find((x) => x.name === l.name);
    if (twin) {
      // the same class in two groups: one class, one layer (rewritten with all its samples on the next sync)
      for (const f of feats) S.samples.push({ id: S.seq++, code: twin.code, geometry: f.geometry });
      S.classLayers[twin.code].sig = "";
      try { S.app.removeLayer?.(l.id); } catch { /* gone */ }
      continue;
    }
    const given = Number(feats[0].properties?.class_code);
    const c = Number.isInteger(given) && given > 0 && given < 255 && !S.classes.some((x) => x.code === given) ? given : Math.max(code, ...S.classes.map((x) => x.code), 0) + 1;
    code = Math.max(code, c);
    const color = [l.style?.fillColor, l.style?.strokeColor].find((v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) ?? COLORS[(c - 1) % COLORS.length];
    S.classes.push({ code: c, name: l.name, color });
    for (const f of feats) S.samples.push({ id: S.seq++, code: c, geometry: f.geometry });
    const mine = S.samples.filter((s) => s.code === c);
    S.classLayers[c] = { id: l.id, name: l.name, sig: `${mine.length}|${mine[mine.length - 1].id}|${l.name}`, color };
  }
  if (!S.classes.length) return;
  S.classes.sort((a, b) => a.code - b.code);
  S.active = S.classes[0].code;
  S.sampleGroup = group.id;
  try {
    const stray = Object.values(S.classLayers).map((L) => L.id).filter((id) => members.some((l) => l.id === id && l.groupId !== group.id));
    if (stray.length) S.app.moveLayersToGroup?.(stray, group.id);
    for (const g of groups.slice(1)) S.app.removeLayerGroup?.(g.id);
  } catch (e) { console.warn("[Image Classification] sample groups", e); }
  if (Object.values(S.classLayers).some((L) => !L.sig)) setTimeout(() => { if (S.app) syncSampleLayers(); }, 0);
}
function addToSampleGroup(id) {
  const app = S.app, groups = app.listLayerGroups?.() ?? [];
  if (!S.sampleGroup || !groups.some((g) => g.id === S.sampleGroup)) S.sampleGroup = groups.find((g) => g.name === "Training samples")?.id ?? null;
  try {
    if (S.sampleGroup && groups.some((g) => g.id === S.sampleGroup)) app.moveLayersToGroup?.([id], S.sampleGroup);
    else S.sampleGroup = app.addLayerGroup?.("Training samples", [id]) ?? null;
  } catch (e) { console.warn("[Image Classification] sample group", e); }
}
function syncSampleLayers() {
  const app = S.app;
  if (!app?.addGeoJsonLayer) return;
  const live = new Set((app.listLayers?.() ?? []).map((l) => l.id)), used = new Set(S.samples.map((s) => s.code));
  for (const code of Object.keys(S.classLayers)) {
    if (S.classes.some((c) => c.code === +code) && used.has(+code)) continue;
    const L = S.classLayers[code];
    if (live.has(L.id)) { try { app.removeLayer?.(L.id); } catch { /* gone */ } }
    delete S.classLayers[code];
  }
  for (const c of S.classes) {
    if (!used.has(c.code)) continue;
    const mine = S.samples.filter((s) => s.code === c.code), sig = `${mine.length}|${mine[mine.length - 1].id}|${c.name}`;
    let L = S.classLayers[c.code];
    if (L && (!live.has(L.id) || L.name !== c.name)) { if (live.has(L.id)) { try { app.removeLayer?.(L.id); } catch { /* gone */ } } L = null; }
    if (!L) {
      const id = app.addGeoJsonLayer(c.name, classFC(c));
      L = S.classLayers[c.code] = { id, name: c.name, sig, color: "" };
      addToSampleGroup(id);
    } else if (L.sig !== sig && !app.updateGeoJsonLayer?.(L.id, classFC(c))) {
      try { app.removeLayer?.(L.id); } catch { /* gone */ }
      const id = app.addGeoJsonLayer(c.name, classFC(c));
      L = S.classLayers[c.code] = { id, name: c.name, sig, color: "" };
      addToSampleGroup(id);
    }
    L.sig = sig;
    if (L.color !== c.color) styleSampleLayer(L, c.color, 0);
  }
}
/** A layer added a moment ago may not be registered yet: retry the style until the host takes it. */
function styleSampleLayer(L, color, attempt) {
  let ok = false;
  try { const r = S.app.importLayerStyle?.(L.id, sampleStyle(color)); ok = !r || r.ok !== false; } catch { ok = false; }
  if (ok) { L.color = color; return; }
  if (attempt < 8) setTimeout(() => { if (Object.values(S.classLayers).includes(L) && L.color !== color) styleSampleLayer(L, color, attempt + 1); }, 150 * (attempt + 1));
  else console.warn("[Image Classification] could not style sample layer", L.id);
}
/** Edits made to a class layer in GeoLibre (GeoEditor, delete feature) become the samples of that class. */
function pullSampleLayers() {
  const live = new Set((S.app.listLayers?.() ?? []).map((l) => l.id));
  let changed = false;
  for (const [code, L] of Object.entries(S.classLayers)) {
    if (!live.has(L.id)) continue;
    const feats = (S.app.getLayerFeatures?.(L.id) ?? []).filter((f) => f?.geometry && /Point|Polygon/.test(f.geometry.type));
    const mine = S.samples.filter((s) => s.code === +code);
    if (feats.length === mine.length && feats.every((f, i) => JSON.stringify(f.geometry) === JSON.stringify(mine[i].geometry))) continue;
    S.samples = S.samples.filter((s) => s.code !== +code).concat(feats.map((f) => ({ id: S.seq++, code: +code, geometry: f.geometry })));
    changed = true;
  }
  if (changed) { S.profile = null; syncSampleLayers(); }
  return changed;
}

/** Overlay and toolbar sit on <body>, fixed over the map's box: the desktop may stack a raster canvas next to the
 * map container, above anything inside it, whatever its z-index. */
function mapBox() {
  const map = getMap();
  return map ? map.getContainer().getBoundingClientRect() : null;
}
function overlay() {
  const map = getMap();
  if (!map) return null;
  if (!S.ov || !S.ov.isConnected) {
    S.ov = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    S.ov.setAttribute("class", "icl-overlay");
    document.body.append(S.ov);
  }
  const r = mapBox();
  Object.assign(S.ov.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  return S.ov;
}
/** Samples, sketch and identify pin on the SVG over the map. The desktop paints raster layers above vector layers,
 * so the class layers alone can end up hidden under the image being sampled; the overlay keeps the samples in view. */
function drawOverlay() {
  if (S.win) { if (S.ov) S.ov.innerHTML = ""; drawViewer(); return; }
  const map = getMap(), ov = overlay();
  if (!ov) return;
  const fc = draftFC();
  if (!fc.features.length && !S.samples.length) { ov.innerHTML = ""; return; }
  const P = (c) => { const p = map.project(c); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
  let s = "";
  if (S.samples.length) {
    const live = new Map((S.app.listLayers?.() ?? []).map((l) => [l.id, l]));
    for (const c of S.classes) {
      const L = S.classLayers[c.code], info = L ? live.get(L.id) : null;
      if (info && info.visible === false) continue;
      const col = esc(c.color);
      for (const smp of S.samples) {
        if (smp.code !== c.code) continue;
        const g = smp.geometry;
        if (g.type === "Point") { const [x, y] = P(g.coordinates).split(","); s += `<circle cx="${x}" cy="${y}" r="5" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>`; }
        else if (g.type === "MultiPoint") for (const q of g.coordinates) { const [x, y] = P(q).split(","); s += `<circle cx="${x}" cy="${y}" r="5" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>`; }
        else {
          const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
          for (const poly of polys) s += `<path d="${poly.map((r) => "M" + r.map(P).join("L") + "Z").join("")}" fill="${col}" fill-opacity="0.25" fill-rule="evenodd" stroke="${col}" stroke-width="2"/>`;
        }
      }
    }
  }
  for (const f of fc.features) {
    const col = f.properties.color, g = f.geometry;
    if (g.type === "Polygon") s += `<path d="M${g.coordinates[0].map(P).join("L")}Z" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`;
    else if (g.type === "LineString") s += `<path d="M${g.coordinates.map(P).join("L")}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`;
    else { const [x, y] = P(g.coordinates).split(","); s += col === "#000000" ? `<path d="M${x - 8},${y}H${+x + 8}M${x},${y - 8}V${+y + 8}" stroke="#000" stroke-width="3"/><path d="M${x - 8},${y}H${+x + 8}M${x},${y - 8}V${+y + 8}" stroke="#fff" stroke-width="1.2"/>` : `<circle cx="${x}" cy="${y}" r="4" fill="#ffffff" stroke="${col}" stroke-width="2"/>`; }
  }
  ov.innerHTML = s;
}
function syncMap() {
  drawOverlay();
  syncSampleLayers();
}
function removeMapLayers() {
  S.ov?.remove();
  S.ov = null;
  S.fl?.remove();
  S.fl = null;
}

// ---------------------------------------------------------------- floating drawing toolbar on the map (like Earth Engine's geometry tools)

const FL_ICONS = {
  pan: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.3 15.5a1.5 1.5 0 0 1 2.4-1.8L8 16"/>',
  point: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
  polygon: '<path d="M5 8l7-5 7 5-2.5 11h-9z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
};
function renderFloat() {
  if (S.win) { S.fl?.remove(); S.fl = null; return; }
  const map = getMap();
  if (!map || !isOpen()) { S.fl?.remove(); S.fl = null; return; }
  if (!S.fl || !S.fl.isConnected) {
    S.fl = document.createElement("div");
    S.fl.className = "icl-float";
    S.fl.addEventListener("click", onFloatClick);
    S.fl.addEventListener("dblclick", (e) => e.stopPropagation());
    S.fl.addEventListener("mousedown", (e) => e.stopPropagation());
    document.body.append(S.fl);
  }
  const box = mapBox();
  Object.assign(S.fl.style, { left: box.left + 10 + "px", top: box.top + 10 + "px", maxHeight: Math.max(120, box.height - 20) + "px" });
  const counts = {};
  for (const s of S.samples) counts[s.code] = (counts[s.code] ?? 0) + 1;
  const tools = TOOLS.map(([k, l]) => `<button type="button" data-ft="${k}" class="${S.tool === k ? "on" : ""}" aria-pressed="${S.tool === k}" title="${l}" aria-label="${l}"><svg viewBox="0 0 24 24" aria-hidden="true">${FL_ICONS[k]}</svg></button>`).join("");
  const classes = S.classes.map((c) => `<button type="button" class="icl-fcls${c.code === S.active ? " on" : ""}" data-fc="${c.code}" title="Draw ${esc(c.name)}"><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span><b>${counts[c.code] ?? 0}</b></button>`).join("");
  const c = activeClass(), d = S.draft.length;
  const hint = S.tool === "pan" ? "" : S.tool === "point" ? "Click to add a point" : S.tool === "polygon" ? (d >= 3 ? "Click the first point, double-click or press Finish" : "Click to add vertices") : S.tool === "circle" ? (d ? "Release or click to set the radius" : "Drag from the centre, or click it") : d ? "Release or click the opposite corner" : "Drag a box, or click two corners";
  S.fl.innerHTML = `
    <div class="icl-ftools">${tools}<span class="icl-fsep"></span>
      <button type="button" data-fa="undo" title="Undo last" aria-label="Undo last"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button></div>
    <div class="icl-fhead"><span>Geometry imports</span><button type="button" data-fa="new" title="New class">+ New class</button></div>
    <div class="icl-fclasses">${classes || `<div class="icl-fempty">No classes yet</div>`}</div>
    ${hint ? `<div class="icl-fhint"><i style="background:${esc(c?.color ?? COLORS[0])}"></i><span>${esc(c ? c.name : "Class 1")}: ${hint}</span></div>` : ""}
    ${d ? `<div class="icl-fact">${S.tool === "polygon" && d >= 3 ? `<button type="button" data-fa="finish" class="pri">Finish</button>` : ""}<button type="button" data-fa="cancel">Cancel</button></div>` : ""}`;
}
function onFloatClick(e) {
  e.stopPropagation();
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.ft) return setTool(b.dataset.ft);
  if (b.dataset.fc) { S.active = +b.dataset.fc; S.draft = []; if (S.tool === "pan") setTool("polygon"); else { drawOverlay(); render(); } return; }
  if (b.dataset.fa === "finish") return finishPolygon();
  if (b.dataset.fa === "cancel") { S.draft = []; drawOverlay(); renderHint(); return; }
  if (b.dataset.fa === "undo") { if (S.draft.length) S.draft.pop(); else S.samples.pop(); invalidate(); syncMap(); render(); }
  else if (b.dataset.fa === "new") {
    const code = nextCode();
    S.classes.push({ code, name: "Class " + code, color: COLORS[(code - 1) % COLORS.length] });
    S.active = code; S.tab = "samples";
    if (S.tool === "pan") setTool("polygon"); else render();
    setTimeout(() => { const inp = $(`[data-name="${code}"]`); inp?.focus(); inp?.select(); }, 50);
  }
}

const activeClass = () => S.classes.find((c) => c.code === S.active);
function nextCode() { return S.classes.reduce((m, c) => Math.max(m, c.code), 0) + 1; }

function commitSample(geometry) {
  if (!activeClass()) {
    const code = nextCode();
    S.classes.push({ code, name: "Class " + code, color: COLORS[(code - 1) % COLORS.length] });
    S.active = code;
  }
  S.samples.push({ id: S.seq++, code: S.active, geometry });
  S.draft = [];
  S.profile = null;
  syncMap();
  render();
  updateProfile();
}

// A reinstalled zip can load a new copy of the plugin without deactivating the old one: only the newest copy acts.
const INSTANCE = Math.random().toString(36).slice(2);
const current = () => globalThis.__imageClassificationInstance === INSTANCE;

function onMapClick(e) {
  if (!current()) return;
  if (S.identify && isOpen()) { identifyAt(e.lngLat.lng, e.lngLat.lat); return; }
  if (S.tool === "pan" || !isOpen()) return;
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (S.tool === "point") return commitSample({ type: "Point", coordinates: p });
  if (S.tool === "rect" || S.tool === "circle") {
    if (!S.draft.length) { S.draft = [p]; syncMap(); return renderHint(); }
    const ring = S.tool === "rect" ? rectRing(S.draft[0], p) : circleRing(S.draft[0], p);
    if (S.tool === "rect" && (S.draft[0][0] === p[0] || S.draft[0][1] === p[1])) return;
    return commitSample({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
  }
  if (e.originalEvent?.detail > 1) return; // the double click finishes the polygon
  if (S.draft.length >= 3) {
    // clicking the first vertex again closes the polygon, as in Earth Engine
    const m = getMap(), a = m.project(S.draft[0]), b = m.project(p);
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 10) return finishPolygon();
  }
  S.draft.push(p);
  syncMap();
  renderHint();
}
function finishPolygon() {
  if (S.tool !== "polygon" || S.draft.length < 3) return;
  const d = S.draft;
  commitSample({ type: "Polygon", coordinates: [[...d, d[0]]] });
}
function onDomDbl(e) { if (current() && S.tool === "polygon" && S.draft.length >= 3) { e.preventDefault(); e.stopPropagation(); finishPolygon(); } }
function onMapDbl(e) { if (current() && S.tool === "polygon" && S.draft.length >= 3) { e.preventDefault?.(); finishPolygon(); } }
function onMapMove(e) {
  if (!current() || S.tool === "pan") return;
  if (S.press && !S.draft.length && Math.hypot(e.point.x - S.press.x, e.point.y - S.press.y) > 4) { S.draft = [S.press.p]; S.dragging = true; renderHint(); }
  if (!S.draft.length) return;
  S.cursor = [e.lngLat.lng, e.lngLat.lat];
  drawOverlay();
}
// Rectangle and circle can also be dragged out in one stroke. The map itself only pans with the hand tool.
function onMapDown(e) {
  S.press = null; S.dragging = false;
  if (!current() || !isOpen() || (S.tool !== "rect" && S.tool !== "circle") || S.draft.length) return;
  if (e.originalEvent && e.originalEvent.button !== 0) return;
  S.press = { x: e.point.x, y: e.point.y, p: [e.lngLat.lng, e.lngLat.lat] };
}
function onMapUp(e) {
  const dragged = S.dragging && S.draft.length === 1;
  S.press = null; S.dragging = false;
  if (!dragged || !current()) return;
  const a = S.draft[0], p = [e.lngLat.lng, e.lngLat.lat];
  if (S.tool === "rect" && (a[0] === p[0] || a[1] === p[1])) { S.draft = []; syncMap(); return renderHint(); }
  const ring = S.tool === "rect" ? rectRing(a, p) : circleRing(a, p);
  commitSample({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
}
/** While a drawing tool is on, dragging draws: the map pans only with the hand tool (the wheel still zooms). */
function lockPan(map, lock) {
  try { if (lock) map.dragPan?.disable(); else map.dragPan?.enable(); } catch { /* map gone */ }
}
function onMapResize() { if (S.fl) renderFloat(); drawOverlay(); }
function onMapView() {
  if (!S.draft.length && !(S.identify && S.idValues) && !S.samples.length) return;
  if (S.ovFrame) return;
  S.ovFrame = requestAnimationFrame(() => { S.ovFrame = 0; drawOverlay(); });
}
function onKey(e) {
  if (current() && e.key === "Escape" && (S.full || S.menu)) { if (S.full) closeFull(); else { const id = S.menu.split(":")[0]; S.menu = null; redrawCard(id); } return; }
  if (!current() || S.tool === "pan" || !isOpen()) return;
  if (e.key === "Escape" && S.draft.length) { S.draft = []; syncMap(); renderHint(); }
  else if (e.key === "Enter") finishPolygon();
}

function setTool(tool) {
  S.tool = tool;
  S.draft = [];
  S.press = null; S.dragging = false;
  const map = S.win ? null : getMap();
  if (map) {
    lockPan(map, tool !== "pan");
    map.getCanvas().style.cursor = "";
    map.getContainer().classList.toggle("icl-draw", tool !== "pan"); // arrow cursor while digitising, the hand only for panning
    if (tool === "polygon") map.doubleClickZoom?.disable(); else map.doubleClickZoom?.enable();
  }
  syncMap();
  render();
}

function bindMap() {
  if (S.win) return; // the window draws on its own viewer
  const map = getMap();
  if (!map || S.mapBound === map) return;
  unbindMap();
  map.on("click", onMapClick); map.on("dblclick", onMapDbl); map.on("mousemove", onMapMove); map.on("mousedown", onMapDown); map.on("mouseup", onMapUp); map.on("move", onMapView); map.on("resize", onMapResize);
  // a DOM listener too: some hosts swallow MapLibre's dblclick
  map.getCanvasContainer().addEventListener("dblclick", onDomDbl, true);
  window.addEventListener("resize", onMapResize);
  try { S.mapRO?.disconnect(); S.mapRO = new ResizeObserver(() => onMapResize()); S.mapRO.observe(map.getContainer()); } catch { /* no ResizeObserver */ }
  lockPan(map, S.tool !== "pan");
  map.getContainer().classList.toggle("icl-draw", S.tool !== "pan");
  S.mapBound = map;
}
function unbindMap() {
  const map = S.mapBound;
  if (!map) return;
  map.off("click", onMapClick); map.off("dblclick", onMapDbl); map.off("mousemove", onMapMove); map.off("mousedown", onMapDown); map.off("mouseup", onMapUp); map.off("move", onMapView); map.off("resize", onMapResize);
  try { map.getCanvasContainer().removeEventListener("dblclick", onDomDbl, true); } catch { /* map gone */ }
  window.removeEventListener("resize", onMapResize);
  try { S.mapRO?.disconnect(); } catch { /* gone */ }
  S.mapRO = null;
  try { map.getCanvas().style.cursor = ""; map.getContainer().classList.remove("icl-draw"); map.doubleClickZoom?.enable(); } catch { /* map gone */ }
  lockPan(map, false);
  S.mapBound = null;
}

// ---------------------------------------------------------------- import / save samples

function vectorLayers() {
  return (S.app.listLayers?.() ?? []).filter((l) => l.type === "geojson" || l.type === "vector" || l.type === "wfs");
}
function importSamples() {
  const id = $("[data-k=impLayer]")?.value, field = $("[data-k=impCode]")?.value, nameField = $("[data-k=impName]")?.value;
  if (!id || !field) return say("Choose a layer and its class field.");
  const feats = (S.app.getLayerFeatures?.(id) ?? []).filter((f) => f?.geometry && /Point|Polygon/.test(f.geometry.type));
  if (!feats.length) return say("That layer has no points or polygons.");
  const byValue = new Map();
  let added = 0;
  for (const f of feats) {
    const raw = f.properties?.[field];
    if (raw == null || raw === "") continue;
    const key = String(raw).trim();
    let code = byValue.get(key);
    if (code == null) {
      const num = Number(key);
      const label = nameField ? String(f.properties?.[nameField] ?? "") : "";
      if (Number.isInteger(num) && num > 0 && num < 255) code = num;
      else code = S.classes.find((c) => c.name === key)?.code ?? nextCode();
      if (!S.classes.some((c) => c.code === code)) S.classes.push({ code, name: label || (Number.isInteger(num) ? "Class " + code : key), color: f.properties?.color && /^#[0-9a-f]{6}$/i.test(f.properties.color) ? f.properties.color : COLORS[(code - 1) % COLORS.length] });
      byValue.set(key, code);
    }
    S.samples.push({ id: S.seq++, code, geometry: f.geometry });
    added++;
  }
  S.classes.sort((a, b) => a.code - b.code);
  if (!activeClass() && S.classes.length) S.active = S.classes[0].code;
  S.profile = null;
  syncMap();
  say(`Imported ${nf(added)} samples in ${byValue.size} classes.`, true);
  render();
  updateProfile();
}
function saveSamples() {
  const fc = sampleFC();
  if (!fc.features.length) return say("No samples to save.");
  S.app.addGeoJsonLayer("Training samples", fc);
  say(`Added ${nf(fc.features.length)} samples as a layer.`, true);
}

// ---------------------------------------------------------------- spectral profile

function cellsForSamples(grid) {
  return S.samples.map((s) => {
    let g = s.geometry;
    if (!grid.geographic) {
      const pr = (p) => grid.toCrs(p);
      g = g.type === "Point" ? { type: "Point", coordinates: pr(g.coordinates) } : { type: g.type, coordinates: g.type === "Polygon" ? g.coordinates.map((r) => r.map(pr)) : g.coordinates.map((poly) => poly.map((r) => r.map(pr))) };
    }
    return { code: s.code, cells: sampleCells(g, grid) };
  });
}

async function updateProfile() {
  if (S.tab !== "samples") return;
  const box = $("[data-o=profile]");
  if (!box) return;
  if (!S.samples.length || !selectedBands().length) { S.profile = { empty: true }; return renderProfile(); }
  try {
    const st = await ensureStack();
    if (S.profile && S.profile.key === st.key && S.profile.n === S.samples.length) return renderProfile();
    const per = new Map();
    cellsForSamples(st.grid).forEach((s) => {
      const acc = per.get(s.code) ?? { n: 0, sum: new Float64Array(st.data.length) };
      for (const c of s.cells) { if (!st.valid[c]) continue; acc.n++; for (let b = 0; b < st.data.length; b++) acc.sum[b] += st.data[b][c] * st.factor + st.offset; }
      per.set(s.code, acc);
    });
    S.profile = { key: st.key, n: S.samples.length, labels: st.bands.map((b) => b.role || n0(b.band.label)), lines: [...per].filter(([, a]) => a.n).map(([code, a]) => ({ code, mean: Array.from(a.sum, (v) => v / a.n), n: a.n })) };
  } catch (e) {
    S.profile = { error: e?.message ?? String(e) };
  }
  renderProfile();
}

function renderProfile() {
  const box = $("[data-o=profile]");
  if (!box) return;
  const pr = S.profile;
  if (!pr || pr.empty) { box.innerHTML = `<div class="icl-note">Draw a sample to see its profile.</div>`; return; }
  if (pr.error) { box.innerHTML = `<div class="icl-err">${esc(pr.error)}</div>`; return; }
  if (!pr.lines.length) { box.innerHTML = `<div class="icl-note">No valid pixels under the samples.</div>`; return; }
  const cls = new Map(S.classes.map((c) => [c.code, c]));
  const factor = S.stack?.factor ?? 1;
  S.charts.profile = () => lineChart("profile", {
    labels: pr.labels,
    series: pr.lines.filter((l) => cls.has(l.code)).map((l) => ({ name: `${l.code} ${cls.get(l.code).name}`, color: cls.get(l.code).color, values: l.mean, bold: l.code === S.active })),
    title: "Mean spectral profile per class", xLabel: "Band", yLabel: factor === 1 ? "Value" : "Reflectance",
  });
  box.innerHTML = chartBox("profile");
}

// ================================================================ charts: d3-style SVG, white background in every theme, free text, 300 dpi PNG

const CH_FONT = "'Open Sans', 'Segoe UI', Arial, Helvetica, sans-serif";
const GRID = "#e5e7eb", AXIS = "#9ca3af", INK = "#1f2937", MUTED = "#4b5563";
S.charts = {}; S.notes = {}; S.textMode = null;

/** d3.ticks: 1, 2 or 5 × 10^k steps covering [lo, hi]. */
function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) hi = lo + 1;
  let step = 10 ** Math.floor(Math.log10((hi - lo) / count));
  const err = (count / (hi - lo)) * step;
  if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { lo: a, hi: b, ticks, step };
}
const tickFmt = (v, step) => (step >= 1 ? nf(v) : v.toFixed(Math.min(6, Math.max(0, -Math.floor(Math.log10(step))))));
const tw = (s, px = 10) => String(s).length * px * 0.56; // text width estimate for layout

function svgOpen(id, W, H, label) {
  return `<svg class="icl-chart" data-chart="${id}" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${CH_FONT}" font-size="10" role="img" aria-label="${esc(label)}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
}
function svgClose(id) {
  const notes = (S.notes[id] ?? []).map((n, i) => `<text class="icl-ntext" data-note="${i}" x="${n.x}" y="${n.y}" font-size="${n.size ?? 12}" fill="#000000">${esc(n.t)}</text>`).join("");
  return notes + "</svg>";
}
/** Left axis: light grid lines across the plot (to x1), grey labels, no frame. */
function axisLeft(x, y0, y1, ticks, ys, step, x1) {
  let s = `<g fill="none" stroke="${GRID}" shape-rendering="crispEdges">` + ticks.map((v) => `<line x1="${x1 == null ? x - 5 : x}" x2="${x1 ?? x}" y1="${Math.round(ys(v)) + 0.5}" y2="${Math.round(ys(v)) + 0.5}"/>`).join("") + "</g>";
  if (x1 == null) s += `<line x1="${x + 0.5}" x2="${x + 0.5}" y1="${y0}" y2="${y1}" stroke="${AXIS}" shape-rendering="crispEdges"/>`;
  s += ticks.map((v) => `<text x="${x - 8}" y="${ys(v)}" dy="0.32em" text-anchor="end" fill="${MUTED}">${tickFmt(v, step)}</text>`).join("");
  return s;
}
function axisBottom(y, x0, x1, ticks, xs, fmt) {
  let s = `<line x1="${x0}" x2="${x1}" y1="${y + 0.5}" y2="${y + 0.5}" stroke="${AXIS}" shape-rendering="crispEdges"/>`;
  s += ticks.map((v) => `<text x="${xs(v)}" y="${y + 8}" dy="0.71em" text-anchor="middle" fill="${MUTED}">${esc(fmt(v))}</text>`).join("");
  return s;
}
const chartTitle = (W, t) => (t ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">${esc(t)}</text>` : "");

/** Legend rows of square swatches, wrapped to the plot width. Returns { svg, height }. */
function legendRows(items, x0, y0, width) {
  let x = x0, y = y0, out = "";
  for (const it of items) {
    const w = 14 + tw(it.name) + 14;
    if (x + w > x0 + width && x > x0) { x = x0; y += 16; }
    out += `<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${esc(it.color)}"/><text x="${x + 14}" y="${y}" fill="${MUTED}">${esc(it.name)}</text>`;
    x += w;
  }
  return { svg: out, height: y - y0 + 16 };
}

function lineChart(id, o) {
  const W = 600, m = { l: 62, r: 18 };
  const leg = legendRows(o.series, m.l, 44, W - m.l - m.r);
  const top = 34 + leg.height + 6, H = top + 230 + 52, y0 = H - 52, y1 = top;
  let lo = Infinity, hi = -Infinity;
  for (const s of o.series) for (const v of s.values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const nt = niceTicks(Math.min(0, lo), hi, 6);
  const ys = (v) => y0 - ((v - nt.lo) / (nt.hi - nt.lo)) * (y0 - y1);
  const n = o.labels.length, xs = (i) => m.l + 12 + (n > 1 ? (i * (W - m.l - m.r - 24)) / (n - 1) : (W - m.l - m.r - 24) / 2);
  const every = Math.max(1, Math.ceil(n / 14)), idx = o.labels.map((_, i) => i).filter((i) => i % every === 0);
  let s = svgOpen(id, W, H, o.title) + chartTitle(W, o.title) + leg.svg;
  s += axisLeft(m.l, y0, y1, nt.ticks, ys, nt.step, W - m.r);
  s += axisBottom(y0, m.l, W - m.r, idx, xs, (i) => o.labels[i]);
  s += `<text transform="translate(16,${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(o.yLabel)}</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(o.xLabel)}</text>`;
  for (const se of o.series) {
    const pts = se.values.map((v, i) => [xs(i), ys(v)]);
    s += `<path d="M${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L")}" fill="none" stroke="${esc(se.color)}" stroke-width="${se.bold ? 2.75 : 1.75}" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${se.bold ? 3 : 2.5}" fill="${esc(se.color)}"/>`).join("");
  }
  return s + svgClose(id);
}

function barChart(id, o) {
  const W = 600, rowH = 30, m = { l: Math.min(200, 16 + Math.max(...o.rows.map((r) => tw(r.name, 11)))), r: 96, t: o.title ? 34 : 10, b: 46 };
  const H = m.t + o.rows.length * rowH + m.b, y0 = H - m.b;
  const nt = niceTicks(0, Math.max(...o.rows.map((r) => r.value), 1e-9), 6), xs = (v) => m.l + (v / nt.hi) * (W - m.l - m.r);
  let s = svgOpen(id, W, H, o.title || o.label) + chartTitle(W, o.title);
  s += `<g fill="none" stroke="${GRID}" shape-rendering="crispEdges">${nt.ticks.map((v) => `<line x1="${Math.round(xs(v)) + 0.5}" x2="${Math.round(xs(v)) + 0.5}" y1="${m.t}" y2="${y0}"/>`).join("")}</g>`;
  o.rows.forEach((r, i) => {
    const y = m.t + i * rowH, h = rowH * 0.66, w = Math.max(0, xs(r.value) - m.l);
    s += `<text x="${m.l - 9}" y="${y + rowH / 2}" dy="0.32em" text-anchor="end" font-size="11" fill="${MUTED}">${esc(r.name)}</text>`;
    s += `<rect x="${m.l}" y="${(y + (rowH - h) / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${esc(r.color ?? "#00758f")}"/>`;
    s += `<text x="${m.l + w + 6}" y="${y + rowH / 2}" dy="0.32em" fill="${INK}">${esc(r.label)}</text>`;
  });
  s += `<line x1="${m.l + 0.5}" x2="${m.l + 0.5}" y1="${m.t}" y2="${y0}" stroke="${AXIS}" shape-rendering="crispEdges"/>`;
  s += nt.ticks.map((v) => `<text x="${xs(v)}" y="${y0 + 8}" dy="0.71em" text-anchor="middle" fill="${MUTED}">${esc(tickFmt(v, nt.step))}</text>`).join("");
  s += `<text x="${(m.l + xs(nt.hi)) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(o.xLabel)}</text>`;
  return s + svgClose(id);
}

/** Confusion matrix as a drawing: mode "heat" shades each cell by its share of the reference class, "table" keeps it plain. */
const HEAT = [[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
function heatColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (HEAT.length - 1), i = Math.min(HEAT.length - 2, Math.floor(x)), f = x - i;
  return "rgb(" + HEAT[i].map((c, k) => Math.round(c + (HEAT[i + 1][k] - c) * f)).join(",") + ")";
}
function matrixChart(id, o) {
  const K = o.names.length, heat = o.mode === "heat", W = 600, short = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  const L = Math.min(180, 30 + Math.max(...o.names.map((n) => tw(n, 11)), tw("User's acc. %", 11))), R = 62, top = (o.title ? 30 : 6) + 22;
  const cw = (W - L - R - 12) / K, ch = Math.max(30, Math.min(52, cw * 0.62)), headH = 34, x0 = L, y0 = top + headH;
  const H = y0 + (K + 1) * ch + (heat ? 58 : 14);
  const fmtPct = (v) => (v == null ? "–" : nf(v * 100, 1));
  let s = svgOpen(id, W, H, o.title || "Confusion matrix");
  if (heat) s += `<defs><linearGradient id="icl-heat-${id}" x1="0" x2="1" y1="0" y2="0">${HEAT.map((c, i) => `<stop offset="${(i / (HEAT.length - 1)) * 100}%" stop-color="rgb(${c.join(",")})"/>`).join("")}</linearGradient></defs>`;
  s += chartTitle(W, o.title);
  s += `<text x="${x0 + (K * cw) / 2}" y="${top - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${MUTED}">Classified</text>`;
  s += `<text transform="translate(12,${y0 + (K * ch) / 2}) rotate(-90)" text-anchor="middle" font-size="11" font-weight="600" fill="${MUTED}">Reference</text>`;
  const chars = Math.max(2, Math.floor(cw / 6));
  o.names.forEach((n, j) => {
    const cx = x0 + j * cw + cw / 2, [code, ...rest] = n.split(" ");
    s += `<text x="${cx}" y="${top + 12}" text-anchor="middle" font-weight="600" fill="${INK}">${esc(code)}</text>`;
    if (rest.length) s += `<text x="${cx}" y="${top + 25}" text-anchor="middle" font-size="9" fill="${MUTED}">${esc(short(rest.join(" "), chars))}</text>`;
  });
  s += `<text x="${x0 + K * cw + R / 2 + 4}" y="${top + 18}" text-anchor="middle" font-size="9.5" fill="${MUTED}">Producer's %</text>`;
  o.matrix.forEach((row, i) => {
    const y = y0 + i * ch, tot = row.reduce((a, v) => a + v, 0) || 1;
    s += `<text x="${x0 - 8}" y="${y + ch / 2}" dy="0.32em" text-anchor="end" font-size="11" fill="${INK}">${esc(short(o.names[i], 28))}</text>`;
    row.forEach((v, j) => {
      const share = v / tot, x = x0 + j * cw, dark = heat && share > 0.5;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${heat ? heatColor(share) : i === j ? "#eef2f7" : "#ffffff"}" stroke="${heat ? "#ffffff" : GRID}" stroke-width="${heat ? 1.5 : 1}"/>`;
      const two = heat && ch >= 40 && cw >= 44;
      s += `<text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 - (two ? 6 : 0)).toFixed(1)}" dy="0.32em" text-anchor="middle" font-size="12" font-weight="${i === j ? 700 : 400}" fill="${dark ? "#ffffff" : INK}">${nf(v)}</text>`;
      if (two) s += `<text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 + 9).toFixed(1)}" dy="0.32em" text-anchor="middle" font-size="9" fill="${dark ? "#dbeafe" : MUTED}">${nf(share * 100, 1)}%</text>`;
    });
    s += `<text x="${x0 + K * cw + R / 2 + 4}" y="${y + ch / 2}" dy="0.32em" text-anchor="middle" font-size="11" fill="${INK}">${fmtPct(o.pa[i])}</text>`;
  });
  const yu = y0 + K * ch;
  s += `<text x="${x0 - 8}" y="${yu + ch / 2}" dy="0.32em" text-anchor="end" font-size="11" fill="${MUTED}">User's acc. %</text>`;
  o.ua.forEach((v, j) => { s += `<text x="${x0 + j * cw + cw / 2}" y="${yu + ch / 2}" dy="0.32em" text-anchor="middle" font-size="11" fill="${INK}">${fmtPct(v)}</text>`; });
  if (heat) {
    const gy = yu + ch + 14, gw = Math.min(220, K * cw), gx = x0 + (K * cw - gw) / 2;
    s += `<rect x="${gx}" y="${gy}" width="${gw}" height="9" fill="url(#icl-heat-${id})"/>`;
    s += `<text x="${gx}" y="${gy + 22}" text-anchor="middle" fill="${MUTED}">0%</text><text x="${gx + gw}" y="${gy + 22}" text-anchor="middle" fill="${MUTED}">100%</text>`;
    s += `<text x="${gx + gw / 2}" y="${gy + 22}" text-anchor="middle" fill="${MUTED}">share of reference pixels</text>`;
  }
  return s + svgClose(id);
}

// ---------------------------------------------------------------- result cards: chart / table, download, full screen

// Chart or Table per card; kept apart from S.view, which win.js uses for the centre view name
S.cardView = {};
S.cards = {}; S.menu = null; S.full = null; S.fullEl = null; S.exporting = false;
const ICO = {
  chart: '<path d="M4 20V11M10 20V5M16 20v-7M2.5 20h19"/>',
  table: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M3 10h18M3 15h18M9.5 4.5v15"/>',
  down: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;

function card(id, full = false) {
  const c = S.cards[id];
  if (!c) return "";
  const view = S.cardView[id] ?? "chart", texting = S.textMode === id, open = S.menu === id + (full ? ":full" : "");
  const seg = (v, icon, label) => `<button type="button" data-cv="${v}" data-card="${id}" class="${view === v ? "on" : ""}" aria-pressed="${view === v}">${ico(icon)}${label}</button>`;
  const menu = open ? `<div class="icl-menu" role="menu">${[["csv", "CSV"], ["xlsx", "Excel (XLSX)"], ["png", "PNG 300 dpi"], ["svg", "SVG"]].map(([f, l]) => `<button type="button" role="menuitem" data-cd="${f}" data-card="${id}">${l}</button>`).join("")}</div>` : "";
  return `<div class="icl-card${full ? " full" : ""}" data-card="${id}">
    <div class="icl-chead">
      <h3>${esc(c.title)}</h3>
      <div class="icl-vseg" role="group" aria-label="View">${seg("chart", "chart", c.chartLabel ?? "Chart")}${seg("table", "table", "Table")}</div>
      ${view === "chart" ? `<button type="button" class="icl-cbtn${texting ? " on" : ""}" data-ctx="${id}" aria-pressed="${texting}" title="Add text: click the chart to place it, drag to move, double-click to edit" aria-label="Add text">${ico("text")}</button>` : ""}
      <div class="icl-dl"><button type="button" class="icl-cbtn" data-cm="${id}" aria-haspopup="menu" aria-expanded="${open}" title="Download" aria-label="Download">${ico("down")}</button>${menu}</div>
      <button type="button" class="icl-cbtn" data-cf="${id}" title="${full ? "Close full screen" : "Full screen"}" aria-label="${full ? "Close full screen" : "Full screen"}">${ico(full ? "close" : "full")}</button>
    </div>
    <div class="icl-cbody">${view === "chart" ? `<div class="icl-cwrap${texting ? " texting" : ""}">${c.chart()}</div>` : `<div class="icl-scroll">${c.table()}</div>`}</div>
    ${c.note ? `<div class="icl-cnote">${esc(c.note)}</div>` : ""}
  </div>`;
}
function redrawCard(id) {
  for (const [el, full] of [[S.win ?? S.root, false], [S.fullEl, true]]) { const box = el?.querySelector(`[data-card="${id}"].icl-card`); if (box) box.outerHTML = card(id, full); }
}
function closeFull() { S.fullEl?.remove(); S.fullEl = null; S.full = null; S.menu = null; }
function openFull(id) {
  closeFull();
  S.full = id;
  const el = (S.fullEl = document.createElement("div"));
  el.className = "icl icl-full";
  el.innerHTML = `<div class="icl-fullbox">${card(id, true)}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el) closeFull(); else onClick(e); });
  el.addEventListener("mousedown", onChartDown);
  el.addEventListener("dblclick", onChartDbl);
  document.body.append(el);
}
const csvOf = (sheets) => {
  const q = (v) => { const t = v && typeof v === "object" ? v.v : v, x = t == null ? "" : String(t); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return sheets.map((sh) => [q(sh.name), ...sh.rows.map((r) => r.map(q).join(","))].join("\r\n")).join("\r\n\r\n") + "\r\n";
};
async function exportCard(id, fmt) {
  const c = S.cards[id];
  if (!c) return;
  const base = fileBase() + "_" + c.file;
  if (fmt === "csv") { const text = csvOf(c.sheets()); return S.app.exportTextFile ? S.app.exportTextFile(base + ".csv", text) : download(base + ".csv", text, "text/csv"); }
  if (fmt === "xlsx") return download(base + ".xlsx", writeXlsx(c.sheets()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  S.exporting = true;
  let svg;
  try { svg = S.cardView[id] === "table" && c.tableSvg ? c.tableSvg() : c.chart(); } finally { S.exporting = false; }
  return exportSvg(svg, base, fmt);
}

function chartBox(id) {
  const on = S.textMode === id;
  return `<div class="icl-cbox" data-cbox="${id}">
    <div class="icl-ctools">
      <button type="button" data-ct="text" data-chart="${id}" class="${on ? "on" : ""}" aria-pressed="${on}" title="Click the chart to place text; drag to move, double-click to edit">Text</button>
      <button type="button" data-ct="png" data-chart="${id}">PNG 300 dpi</button>
      <button type="button" data-ct="svg" data-chart="${id}">SVG</button>
    </div>
    <div class="icl-cwrap${on ? " texting" : ""}">${S.charts[id]()}</div>
  </div>`;
}
function redrawChart(id) {
  if (S.cards[id]) return redrawCard(id);
  const box = $(`[data-cbox="${id}"]`);
  if (box && S.charts[id]) box.outerHTML = chartBox(id);
}

function svgPoint(svg, e) {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [Math.round(p.x), Math.round(p.y)];
}
/** Inline editor over the chart; `done(text)` gets the trimmed text, or "" when cleared. */
function noteEditor(svg, x, y, value, done) {
  const wrap = svg.parentElement, r = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), k = r.width / svg.viewBox.baseVal.width;
  const inp = document.createElement("input");
  inp.type = "text"; inp.className = "icl-ninput"; inp.value = value; inp.placeholder = "Text";
  inp.style.left = Math.round(r.left - wr.left + x * k) + "px";
  inp.style.top = Math.round(r.top - wr.top + y * k - 20) + "px";
  wrap.append(inp);
  inp.focus(); inp.select();
  let closed = false;
  const finish = (ok) => { if (closed) return; closed = true; const v = inp.value.trim(); inp.remove(); if (ok) done(v); };
  inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}
function placeNote(svg, e) {
  const id = svg.dataset.chart, [x, y] = svgPoint(svg, e);
  S.textMode = null;
  noteEditor(svg, x, y, "", (t) => { if (t) (S.notes[id] ??= []).push({ x, y, t }); redrawChart(id); });
}
function editNote(el) {
  const svg = el.ownerSVGElement, id = svg.dataset.chart, i = +el.dataset.note, n = S.notes[id][i];
  el.style.visibility = "hidden";
  noteEditor(svg, n.x, n.y, n.t, (t) => { if (t) n.t = t; else S.notes[id].splice(i, 1); redrawChart(id); });
}
function onChartDown(e) {
  const el = e.target.closest?.("[data-note]");
  if (!el || e.button !== 0 || e.detail > 1) return;
  e.preventDefault();
  const svg = el.ownerSVGElement, n = S.notes[svg.dataset.chart][+el.dataset.note], [sx, sy] = svgPoint(svg, e), ox = n.x, oy = n.y;
  const move = (ev) => { const [x, y] = svgPoint(svg, ev); n.x = ox + x - sx; n.y = oy + y - sy; el.setAttribute("x", n.x); el.setAttribute("y", n.y); };
  const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
}
function onChartDbl(e) { const el = e.target.closest?.("[data-note]"); if (el) editNote(el); }

const CHART_FILES = { profile: "spectral_profile", areas: "class_areas", importance: "variable_importance" };
function exportChart(id, fmt) {
  if (!S.charts[id]) return Promise.resolve();
  return exportSvg(S.charts[id](), CHART_FILES[id] ?? id, fmt);
}
/** Save a chart drawing as SVG, or as a 300 dpi PNG. */
async function exportSvg(svg, base, fmt) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.replace(/ class="[^"]*"| data-[a-z]+="[^"]*"/g, "");
  if (fmt === "svg") return S.app.exportTextFile ? S.app.exportTextFile(base + ".svg", xml) : download(base + ".svg", xml, "image/svg+xml");
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), W = +vb[1], H = +vb[2], k = 300 / 96;
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    download(base + "_300dpi.png", pngWithDpi(new Uint8Array(await blob.arrayBuffer()), 300), "image/png");
  } finally { URL.revokeObjectURL(url); }
}

// ================================================================ run

/** 8.4 s · 1 min 20 s · 1 h 02 min 05 s */
function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "–";
  if (sec < 60) return `${nf(sec, sec < 10 ? 1 : 0)} s`;
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min ${String(s).padStart(2, "0")} s` : `${m} min ${String(s).padStart(2, "0")} s`;
}
function progress(label, frac) {
  if (label == null) {
    clearInterval(S.runTick); S.runTick = null; S.run = null;
    const bar = $("[data-o=prog]"); if (bar) bar.hidden = true;
    if (S.win) winStatus();
    return;
  }
  // the clock starts at the first progress call of a job and stops at progress(null)
  if (!S.run) { S.run = { t0: performance.now() }; S.runTick = setInterval(showProgress, 1000); }
  S.run.label = label; S.run.frac = frac;
  showProgress();
}
function runTimes() {
  const r = S.run; if (!r) return null;
  const el = (performance.now() - r.t0) / 1000, left = r.frac > 0.03 && r.frac < 1 && el > 3 ? (el * (1 - r.frac)) / r.frac : null;
  return { el, left };
}
function showProgress() {
  const r = S.run, t = runTimes(); if (!r || !t) return;
  const bar = $("[data-o=prog]");
  if (bar) {
    bar.hidden = false;
    bar.querySelector("span").textContent = `${r.label} · ${fmtDur(t.el)}${t.left != null ? ` · ~${fmtDur(t.left)} left` : ""}`;
    bar.querySelector("b").textContent = Math.round(r.frac * 100) + "%";
    bar.querySelector("i").style.width = Math.round(r.frac * 100) + "%";
  }
  const st = S.win?.querySelector("[data-w=prog]");
  if (st) st.textContent = `${r.label} · ${Math.round(r.frac * 100)}% · ${fmtDur(t.el)}${t.left != null ? ` · ~${fmtDur(t.left)} left` : ""}`;
}

async function runClassification() {
  if (S.busy) return;
  const p = P();
  pullSampleLayers();
  if (S.samples.length === 0 || new Set(S.samples.map((s) => s.code)).size < 2) { S.tab = "samples"; render(); return say("Draw samples for at least 2 classes."); }
  await refreshSources(); // layers removed from the map since the panel opened must not be read
  if (S.busy) return;
  S.busy = true; S.msg = ""; render();
  const t0 = performance.now();
  try {
    const st = await ensureStack();
    progress("Computing indices", 0);
    await tick();
    const { layers, names } = featureLayers(st);
    const d = layers.length, grid = st.grid;
    progress("Sampling pixels", 0);
    const sp = splitSamples(cellsForSamples(grid), { ratio: p.split, by: p.splitBy, maxPix: p.maxPix, seed: p.seed, valid: (c) => st.valid[c] && layers.every((L) => Number.isFinite(L[c])) });
    const K = sp.codes.length;
    if (K < 2) throw new Error("At least 2 classes need samples over valid pixels.");
    if (!sp.train.cells.length) throw new Error("No training pixels.");
    const Xtr = gather(layers, sp.train.cells), ytr = Uint8Array.from(sp.train.y);
    const opts = p.algo === "RF" ? { trees: p.rfTrees, minLeaf: p.rfLeaf, bag: p.rfBag, vars: p.rfVars, maxDepth: p.rfDepth, seed: p.seed }
      : p.algo === "GTB" ? { trees: p.gtbTrees, shrinkage: p.gtbShrink, sampling: p.gtbSamp, maxNodes: p.gtbNodes, seed: p.seed }
        : { kernel: p.svmKernel, cost: p.svmCost, gamma: p.svmGamma, degree: p.svmDegree, coef0: p.svmCoef, seed: p.seed };
    opts.balanced = !!p.balanced;
    const trees = p.algo === "RF" ? p.rfTrees : p.gtbTrees;
    const model = await train(p.algo, Xtr, ytr, sp.train.cells.length, d, K, opts, (f) => progress(p.algo === "SVM" ? "Training SVM" : `Training · tree ${Math.round(f * trees)} / ${trees}`, f));
    progress("Testing", 0); await tick();
    const accTest = sp.test.cells.length ? accuracy(Uint8Array.from(sp.test.y), predict(model, gather(layers, sp.test.cells), sp.test.cells.length), K) : null;
    const accTrain = accuracy(ytr, predict(model, Xtr, sp.train.cells.length), K);

    const n = grid.width * grid.height, tc = performance.now();
    const { cls, device } = await classifyPixels(model, layers, st.valid, n, sp.codes, "Classifying image");
    const classifySec = (performance.now() - tc) / 1000;
    const maxCode = S.classes.reduce((a, c) => Math.max(a, c.code), 0);
    const final = p.smooth ? majority(cls, grid.width, grid.height, p.smooth, Math.max(maxCode, ...sp.codes)) : cls;
    const areas = classAreas(final, grid, Math.max(maxCode, ...sp.codes));
    const featRoles = [...st.bands.map((b) => ({ role: b.role, token: bandToken(n0(b.band.label)), label: b.band.label })), ...indexDefs().map((x) => ({ index: x.name }))];
    pushResult({ kind: "classified", device, classifySec, algo: p.algo, opts, names, featRoles, model, sp, accTest, accTrain, grid, cls: final, areas, codes: sp.codes, classes: S.classes.map((c) => ({ ...c })), splitBy: p.splitBy, seconds: (performance.now() - t0) / 1000, smooth: p.smooth, name: (p.outName.trim() || "Land Cover") + (S.win && imageSets().length > 1 ? ` (${activeSetName()})` : "") });
    wlog(`${ALGO_NAMES[p.algo]} on ${activeSetName()}: ${nf(grid.width)} × ${nf(grid.height)} px (${nf(n)} px), ${d} inputs = ${nf((n * d * 4) / 1048576, 1)} MB stack in memory, ${nf(sp.train.cells.length)} training / ${nf(sp.test.cells.length)} test pixels, ${accTest ? `OA ${pct(accTest.oa)}%, kappa ${accTest.kappa.toFixed(3)}` : "no test pixels"}, image classified on ${device} in ${fmtDur(classifySec)}, total ${fmtDur((performance.now() - t0) / 1000)}`);
    if (!S.win) await addResultLayer();
    S.tab = "results";
  } catch (e) {
    console.warn("[Image Classification]", e);
    S.msg = e?.message ?? String(e);
  } finally {
    S.busy = false;
    progress(null);
    render();
  }
}

/**
 * Predict every valid pixel. On the GPU (WebGPU) when that is switched on and available, else on the CPU; a GPU
 * failure part-way falls back to the CPU for the rest. Returns class codes per cell and the device that did it.
 */
async function classifyPixels(model, layers, valid, n, codes, label) {
  const d = layers.length, cls = new Uint8Array(n);
  let gpu = null;
  if (P().gpu) gpu = await gpuClassifier(model).catch((e) => { console.warn("[Image Classification] GPU", e); return null; });
  const CH = gpu ? gpu.chunk : 32768, X = new Float32Array(CH * d), out = new Uint8Array(CH), idx = new Int32Array(CH);
  let device = gpu ? "GPU (" + gpu.name + ")" : "CPU", last = performance.now();
  for (let start = 0; start < n; start += CH) {
    let m = 0;
    for (let k = start; k < Math.min(n, start + CH); k++) {
      if (!valid[k]) continue;
      let ok = true;
      for (let j = 0; j < d; j++) { const v = layers[j][k]; if (!Number.isFinite(v)) { ok = false; break; } X[m * d + j] = v; }
      if (ok) idx[m++] = k;
    }
    if (m) {
      let res = null;
      if (gpu) {
        try { res = await gpu.predict(X, m); }
        catch (e) { console.warn("[Image Classification] GPU failed, finishing on the CPU", e); gpu.destroy(); gpu = null; device += " then CPU"; }
      }
      if (!res) res = predict(model, X, m, out);
      for (let i = 0; i < m; i++) cls[idx[i]] = codes[res[i]];
    }
    if (performance.now() - last > 80) { progress(label, start / n); await tick(); last = performance.now(); }
  }
  gpu?.destroy();
  return { cls, device };
}

function resultTiff(r) {
  const pal = Array.from({ length: 256 }, () => [0, 0, 0]);
  for (const c of r.classes) pal[c.code] = hexToRgb(c.color);
  return writeGeoTiff(r.cls, { width: r.grid.width, height: r.grid.height, samples: 1, bounds: r.grid.bounds, epsg: r.grid.epsg, geographic: r.grid.geographic, palette: pal, nodata: 0 });
}

async function addResultLayer() {
  const r = S.result;
  // the previous result stays on the map and keeps reading its blob: never revoke it here
  S.resultUrl = layerBlob(resultTiff(r));
  try {
    S.resultLayerId = await S.app.addCogLayer?.(r.name, S.resultUrl, { nodata: 0, zoomTo: false });
  } catch (e) {
    console.warn("[Image Classification] add layer", e);
    say("The result could not be shown on the map. Use Export GeoTIFF.");
  }
}

// ---------------------------------------------------------------- threshold + spectral value identifier

const OPS = [[">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"], ["==", "="]];
const TH_OUT = [["binary", "True / False raster"], ["true", "True only raster"], ["vector", "True polygons"]];
S.th = { layer: "", op: ">", value: 0, out: "binary", name: "", mmu: 0, tColor: "#1a9850", fColor: "#d9d9d9" };
const opFn = (op, t) => (op === ">" ? (v) => v > t : op === ">=" ? (v) => v >= t : op === "<" ? (v) => v < t : op === "<=" ? (v) => v <= t : (v) => v === t);
const opSym = (op) => OPS.find((o) => o[0] === op)?.[1] ?? op;

/** Bands and indices on the grid, computed once per stack and index selection. */
function featureCache(st) {
  const key = st.key + "|" + indexDefs().map((d) => d.name + ":" + (S.custom.find((c) => c.name === d.name)?.expr ?? "")).join(",");
  if (S.fcache?.key === key) return S.fcache;
  S.fcache = { key, ...featureLayers(st) };
  return S.fcache;
}
function thLayerName() {
  const names = featureNames();
  return names.includes(S.th.layer) ? S.th.layer : indexDefs()[0]?.name ?? names[0] ?? "";
}
const thExpr = () => `${thLayerName()} ${opSym(S.th.op)} ${S.th.value}`;

function tabThreshold() {
  const names = featureNames(), layer = thLayerName(), off = names.length && !S.busy ? "" : " disabled";
  const id = S.idValues;
  const idRows = id ? id.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${Number.isFinite(r.v) ? esc(fmtVal(r.v)) : "–"}</td><td><button type="button" class="icl-btn2 sm" data-use="${esc(r.name)}"${Number.isFinite(r.v) ? "" : " disabled"}>Use</button></td></tr>`).join("") : "";
  return `
  <section class="icl-sec">
    <h3 class="icl-head">Rule</h3>
    <div class="icl-row">
      <label class="icl-f"><span>Layer</span><select data-k="thLayer"${names.length ? "" : " disabled"}>${opt(names.map((n) => [n, n]), layer)}</select></label>
      <label class="icl-f" style="flex:0 0 64px"><span>Operator</span><select data-k="thOp">${opt(OPS, S.th.op)}</select></label>
      <label class="icl-f" style="flex:0 0 96px"><span>Value</span><input type="number" step="any" data-k="thValue" value="${S.th.value}"></label>
    </div>
    <div class="icl-stat" data-o="thstat">${names.length ? "Reading layers…" : "Select input layers on the Layers tab."}</div>
    <div data-o="hist"></div>
  </section>
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">Spectral value identifier</h3>
      <button type="button" class="icl-btn2 sm${S.identify ? " on" : ""}" data-a="identify" aria-pressed="${!!S.identify}">${S.identify ? "Stop" : "Identify"}</button></div>
    ${S.identify && !id ? `<div class="icl-note">Click a pixel on the map.</div>` : ""}
    ${id ? `<span class="icl-lab">${id.lon.toFixed(6)}, ${id.lat.toFixed(6)}${id.cls ? ` · class ${esc(id.cls)}` : ""}</span>
    <div class="icl-scroll" style="max-height:220px;overflow:auto"><table class="icl-table"><thead><tr><th>Layer</th><th>Value</th><th></th></tr></thead><tbody>${idRows}</tbody></table></div>` : ""}
  </section>
  <section class="icl-sec last">
    <h3 class="icl-head">Output</h3>
    <label class="icl-f"><span>Type</span><select data-k="thOut">${opt(TH_OUT, S.th.out)}</select></label>
    <div class="icl-row">
      <label class="icl-f"><span>True colour</span><input type="color" data-k="thT" value="${S.th.tColor}" style="width:100%"></label>
      ${S.th.out === "binary" ? `<label class="icl-f"><span>False colour</span><input type="color" data-k="thF" value="${S.th.fColor}" style="width:100%"></label>` : ""}
      ${S.th.out === "vector" ? `<label class="icl-f"><span>Minimum patch</span><select data-k="thMmu">${opt([[0, "None"], [0.1, "0.1 ha"], [0.25, "0.25 ha"], [0.5, "0.5 ha"], [1, "1 ha"]], S.th.mmu)}</select></label>` : ""}
    </div>
    <div class="icl-row">
      <label class="icl-f"><span>Layer name</span><input type="text" data-k="thName" maxlength="80" value="${esc(S.th.name || thExpr())}"></label>
      <button type="button" class="icl-btn" data-a="threshold"${off}>Create layer</button>
    </div>
  </section>`;
}
const fmtVal = (v) => (Math.abs(v) >= 1000 ? nf(v, 1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(4));

async function updateThreshold() {
  const stat = $("[data-o=thstat]"), box = $("[data-o=hist]");
  if (!stat || !featureNames().length) return;
  try {
    const st = await ensureStack(), fc = featureCache(st), name = thLayerName(), L = fc.layers[fc.names.indexOf(name)];
    if (!L || S.tab !== "threshold") return;
    const [lo0, hi0] = stretchLimits(L, NaN);
    // histogram over the 1-99 % range, extended to keep the threshold in view
    const pad = (hi0 - lo0) * 0.25, t = +S.th.value, lo = Math.min(lo0 - pad, Number.isFinite(t) ? t : lo0), hi = Math.max(hi0 + pad, Number.isFinite(t) ? t : hi0);
    const nb = 60, bins = new Float64Array(nb), test = opFn(S.th.op, t), g = st.grid;
    let pass = 0, valid = 0;
    for (let k = 0; k < L.length; k++) {
      const v = L[k];
      if (!st.valid[k] || !Number.isFinite(v)) continue;
      valid++;
      if (test(v)) pass++;
      const b = Math.floor(((v - lo) / (hi - lo)) * nb);
      if (b >= 0 && b < nb) bins[b]++;
    }
    const ha = (pass * cellAreaM2(g)) / 1e4;
    stat.innerHTML = `<b>${esc(thExpr())}</b> · ${nf(pass)} of ${nf(valid)} pixels (${valid ? nf((pass / valid) * 100, 1) : 0}%) · ≈ ${nf(ha)} ha`;
    S.charts.hist = () => histChart("hist", { bins, lo, hi, t, test, title: `${name} histogram`, xLabel: name, tColor: S.th.tColor });
    if (box) box.innerHTML = chartBox("hist");
  } catch (e) {
    stat.innerHTML = `<span class="icl-err">${esc(e?.message ?? e)}</span>`;
  }
}

function histChart(id, o) {
  const W = 600, H = 300, m = { l: 62, r: 18, t: 36, b: 46 }, y0 = H - m.b;
  const max = Math.max(...o.bins, 1), ny = niceTicks(0, max, 5), xt = niceTicks(o.lo, o.hi, 8);
  const xs = (v) => m.l + ((v - o.lo) / (o.hi - o.lo)) * (W - m.l - m.r), ys = (v) => y0 - (v / ny.hi) * (y0 - m.t), bw = (W - m.l - m.r) / o.bins.length;
  let s = svgOpen(id, W, H, o.title) + chartTitle(W, o.title);
  o.bins.forEach((c, i) => {
    if (!c) return;
    const mid = o.lo + ((i + 0.5) / o.bins.length) * (o.hi - o.lo);
    s += `<rect x="${(m.l + i * bw).toFixed(2)}" y="${ys(c).toFixed(2)}" width="${bw.toFixed(2)}" height="${(y0 - ys(c)).toFixed(2)}" fill="${o.test(mid) ? esc(o.tColor) : "#bdbdbd"}" stroke="#ffffff" stroke-width="0.5" shape-rendering="crispEdges"/>`;
  });
  s += axisLeft(m.l, y0, m.t, ny.ticks, ys, ny.step);
  s += axisBottom(y0, m.l, W - m.r, xt.ticks.filter((v) => v >= o.lo && v <= o.hi), xs, (v) => tickFmt(v, xt.step));
  if (Number.isFinite(o.t) && o.t >= o.lo && o.t <= o.hi) {
    s += `<line x1="${xs(o.t).toFixed(1)}" x2="${xs(o.t).toFixed(1)}" y1="${m.t - 4}" y2="${y0}" stroke="#d62728" stroke-width="1.5" shape-rendering="crispEdges"/>`;
    s += `<text x="${xs(o.t) + 4}" y="${m.t + 6}" fill="#d62728" font-size="11">${esc(String(o.t))}</text>`;
  }
  s += `<text transform="translate(16,${(y0 + m.t) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="#000">Pixels</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#000">${esc(o.xLabel)}</text>`;
  return s + svgClose(id);
}

function setIdentify(on, quiet) {
  S.identify = on;
  if (!on) S.idValues = null;
  if (on && S.tool !== "pan") setTool("pan");
  const map = getMap();
  try { if (map) map.getCanvas().style.cursor = on ? "crosshair" : ""; } catch { /* map gone */ }
  syncMap();
  if (!quiet) render();
}
async function identifyAt(lon, lat) {
  try {
    const st = await ensureStack(), g = st.grid, fc = featureCache(st);
    const p = g.geographic ? [lon, lat] : g.toCrs([lon, lat]);
    const cx = Math.floor(((p[0] - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * g.width), cy = Math.floor(((g.bounds[3] - p[1]) / (g.bounds[3] - g.bounds[1])) * g.height);
    const inside = cx >= 0 && cy >= 0 && cx < g.width && cy < g.height, k = cy * g.width + cx;
    const code = inside && S.result && S.result.grid.width === g.width ? S.result.cls[k] : 0;
    const cls = code ? `${code} ${S.result.classes.find((c) => c.code === code)?.name ?? ""}`.trim() : "";
    S.idValues = { lon, lat, cls, rows: fc.names.map((name, i) => ({ name, v: inside && st.valid[k] ? fc.layers[i][k] : NaN })) };
  } catch (e) {
    say(e?.message ?? String(e));
  }
  syncMap();
  render();
}

async function thresholdAction() {
  if (S.busy) return;
  S.busy = true; S.msg = ""; render();
  try {
    const st = await ensureStack(), g = st.grid, W = g.width, H = g.height, n = W * H, fc = featureCache(st);
    const name = thLayerName(), L = fc.layers[fc.names.indexOf(name)], t = +S.th.value;
    if (!L) throw new Error("Choose a layer.");
    if (!Number.isFinite(t)) throw new Error("Enter a threshold value.");
    // 1 = true, 2 = false, 0 = no data; the sieve needs both classes so small patches can merge into either
    const test = opFn(S.th.op, t), out = S.th.out, cls = new Uint8Array(n);
    let pass = 0;
    for (let k = 0; k < n; k++) {
      const v = L[k];
      if (!st.valid[k] || !Number.isFinite(v)) continue;
      if (test(v)) { cls[k] = 1; pass++; } else cls[k] = 2;
    }
    if (out === "true") for (let k = 0; k < n; k++) if (cls[k] === 2) cls[k] = 0;
    const label = ($("[data-k=thName]")?.value || "").trim() || thExpr();
    if (out === "vector") {
      progress("Tracing polygons", 0.5); await tick();
      const minPx = S.th.mmu > 0 ? Math.max(2, Math.round((S.th.mmu * 1e4) / cellAreaM2(g))) : 0;
      const mask = minPx ? sieve(cls, W, H, minPx) : cls;
      const dx = (g.bounds[2] - g.bounds[0]) / W, dy = (g.bounds[3] - g.bounds[1]) / H, r8 = (v) => Math.round(v * 1e8) / 1e8;
      const toXY = g.geographic ? (x, y) => [r8(g.bounds[0] + x * dx), r8(g.bounds[3] - y * dy)] : (x, y) => g.toLL([g.bounds[0] + x * dx, g.bounds[3] - y * dy]).map(r8);
      for (let k = 0; k < n; k++) if (mask[k] === 2) mask[k] = 0;
      const e = polygonize(mask, W, H, toXY).get(1);
      if (!e) throw new Error("No pixel meets the rule.");
      const ar = classAreas(mask, g, 1);
      const id = S.app.addGeoJsonLayer(label, { type: "FeatureCollection", features: [{ type: "Feature", properties: { rule: thExpr(), layer: name, operator: S.th.op, threshold: t, area_ha: Math.round(ar.area[1] / 100) / 100, patches: e.patches, min_patch_ha: S.th.mmu }, geometry: { type: "MultiPolygon", coordinates: e.polygons } }] });
      try { S.app.importLayerStyle?.(id, JSON.stringify({ version: 8, sources: {}, layers: [{ id: "t-fill", type: "fill", source: "t", paint: { "fill-color": S.th.tColor, "fill-opacity": 0.6 } }, { id: "t-line", type: "line", source: "t", paint: { "line-color": S.th.tColor, "line-width": 1 } }] })); } catch { /* unstyled */ }
      say(`Added "${label}": ${nf(e.patches)} polygons, ${nf(ar.area[1] / 1e4)} ha.`, true);
    } else {
      const pal = Array.from({ length: 256 }, () => [0, 0, 0]);
      pal[1] = hexToRgb(S.th.tColor); pal[2] = hexToRgb(S.th.fColor);
      const bytes = writeGeoTiff(cls, { width: W, height: H, bounds: g.bounds, epsg: g.epsg, geographic: g.geographic, samples: 1, palette: pal, nodata: 0, names: [thExpr()] });
      const url = layerBlob(bytes);
      S.compUrls = [...(S.compUrls ?? []), url];
      await S.app.addCogLayer?.(label, url, { nodata: 0, zoomTo: false });
      say(`Added "${label}": ${nf(pass)} true pixels (${nf((pass * cellAreaM2(g)) / 1e4)} ha).`, true);
    }
  } catch (e) {
    console.warn("[Image Classification] threshold", e);
    say(e?.message ?? String(e));
  } finally {
    S.busy = false;
    progress(null);
    const keep = S.msg, ok = S.msgOk;
    render();
    say(keep, ok);
  }
}

// ---------------------------------------------------------------- post-processing: raster to dissolved polygons

S.post = { mmu: 0 };
function cellAreaM2(g) {
  const dx = (g.bounds[2] - g.bounds[0]) / g.width, dy = (g.bounds[3] - g.bounds[1]) / g.height;
  if (!g.geographic) return dx * dy;
  const R = 6371008.8, rad = Math.PI / 180, lat = (g.bounds[1] + g.bounds[3]) / 2;
  return dx * rad * R * Math.cos(lat * rad) * dy * rad * R;
}
async function polygonsAction() {
  const r = S.result;
  if (!r || S.busy) return;
  S.busy = true; S.msg = ""; render();
  try {
    const g = r.grid, W = g.width, H = g.height;
    const minPx = S.post.mmu > 0 ? Math.max(2, Math.round((S.post.mmu * 1e4) / cellAreaM2(g))) : 0;
    progress(minPx ? `Removing patches under ${S.post.mmu} ha (${nf(minPx)} cells)` : "Labelling patches", 0.15); await tick();
    const cls = minPx ? sieve(r.cls, W, H, minPx) : r.cls;
    progress("Tracing polygons", 0.5); await tick();
    const dx = (g.bounds[2] - g.bounds[0]) / W, dy = (g.bounds[3] - g.bounds[1]) / H, r8 = (v) => Math.round(v * 1e8) / 1e8;
    const toXY = g.geographic ? (x, y) => [r8(g.bounds[0] + x * dx), r8(g.bounds[3] - y * dy)] : (x, y) => g.toLL([g.bounds[0] + x * dx, g.bounds[3] - y * dy]).map(r8);
    const polys = polygonize(cls, W, H, toXY);
    progress("Measuring areas", 0.9); await tick();
    const ar = classAreas(cls, g, 255), meta = new Map(r.classes.map((c) => [c.code, c]));
    const total = [...polys.keys()].reduce((s, c) => s + ar.area[c], 0) || 1;
    const features = [...polys].sort((a, b) => a[0] - b[0]).map(([code, e]) => ({
      type: "Feature",
      properties: {
        class_code: code, class_name: meta.get(code)?.name ?? `Class ${code}`,
        area_ha: Math.round(ar.area[code] / 100) / 100, area_pct: Math.round((ar.area[code] / total) * 1e4) / 100,
        patches: e.patches, color: meta.get(code)?.color ?? "#888888", algorithm: ALGO_NAMES[r.algo], min_patch_ha: S.post.mmu,
      },
      geometry: { type: "MultiPolygon", coordinates: e.polygons },
    }));
    const name = `${r.name} polygons`, id = S.app.addGeoJsonLayer(name, { type: "FeatureCollection", features });
    const match = ["match", ["get", "class_code"]];
    for (const f of features) match.push(f.properties.class_code, f.properties.color);
    match.push("#888888");
    try {
      S.app.importLayerStyle?.(id, JSON.stringify({ version: 8, sources: {}, layers: [
        { id: "classes-fill", type: "fill", source: "classes", paint: { "fill-color": match, "fill-opacity": 0.8 } },
        { id: "classes-line", type: "line", source: "classes", paint: { "line-color": "#000000", "line-width": 0.4 } },
      ] }));
    } catch (e) { console.warn("[Image Classification] polygon style", e); }
    const patches = features.reduce((s, f) => s + f.properties.patches, 0);
    say(`Added "${name}": ${features.length} classes, ${nf(patches)} patches.`, true);
  } catch (e) {
    console.warn("[Image Classification] polygons", e);
    say(e?.message ?? String(e));
  } finally {
    S.busy = false;
    progress(null);
    const keep = S.msg, ok = S.msgOk;
    render();
    say(keep, ok);
  }
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const fileBase = () => (S.result?.name || "land_cover").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "land_cover";
function exportTiff() { if (S.result) download(fileBase() + ".tif", resultTiff(S.result), "image/tiff"); }
/** Sheets of the accuracy report: summary, the test confusion matrix, and the area-weighted estimates. */
function accuracySheets(r) {
  const a = r.accTest, cls = new Map(r.classes.map((c) => [c.code, c])), name = (code) => `${code} ${cls.get(code)?.name ?? ""}`.trim();
  const B = (v) => ({ v, bold: true }), r4 = (v) => (v == null ? "" : +v.toFixed(4)), p2 = (v) => (v == null ? "" : +(v * 100).toFixed(2));
  const col = a.matrix[0].map((_, j) => a.matrix.reduce((s, rw) => s + rw[j], 0));
  const params = Object.entries(r.opts).filter(([k]) => k !== "balanced").map(([k, v]) => `${k} ${v}`).join(", ");
  const total = r.codes.reduce((s, c) => s + r.areas.area[c], 0) || 1, ar = areaAccuracy(a.matrix, r.codes.map((c) => r.areas.area[c] / total));
  const sheets = [
    { name: "Accuracy", widths: [34, 44], rows: [
      [B("Metric"), B("Value")],
      ["Overall accuracy (%)", p2(a.oa)], ["Kappa", r4(a.kappa)],
      ...(r.model.oob != null ? [["Out-of-bag accuracy (%)", p2(r.model.oob)]] : []),
      ["Overall accuracy, area-weighted (%)", p2(ar.oa)], ["  95% confidence interval (+/- %)", p2(1.96 * ar.oaSe)],
      [], ["Classifier", ALGO_NAMES[r.algo]], ["Parameters", params], ["Class weights", r.opts.balanced ? "Balanced (inverse class size)" : "None"],
      ["Inputs", r.names.join(", ")], ["Training pixels", r.sp.train.cells.length], ["Test pixels", r.sp.test.cells.length], ["Split by", r.splitBy ?? ""],
      ["Smoothing", r.smooth ? `Majority ${r.smooth} x ${r.smooth}` : "None"],
    ] },
    { name: "Confusion matrix", widths: [28, ...r.codes.map(() => 16), 10, 14], rows: [
      [B("Reference \\ Classified"), ...r.codes.map((c) => B(name(c))), B("Total"), B("Producer's accuracy (%)")],
      ...a.matrix.map((rw, k) => [name(r.codes[k]), ...rw, rw.reduce((s, v) => s + v, 0), p2(a.pa[k])]),
      ["Total", ...col, a.n, ""],
      ["User's accuracy (%)", ...a.ua.map(p2), "", ""],
      ["F1 score", ...a.f1.map(r4), "", ""],
    ] },
    { name: "Area-based accuracy", widths: [28, 14, 16, 12, 16, 12, 16, 16, 14], rows: [
      [B("Class"), B("Mapped area (ha)"), B("User's accuracy (%)"), B("+/- 95% CI"), B("Producer's accuracy (%)"), B("+/- 95% CI"), B("Estimated area (ha)"), B("+/- 95% CI (ha)"), B("Test pixels in class")],
      ...r.codes.map((c, k) => [name(c), +(r.areas.area[c] / 1e4).toFixed(2), p2(ar.ua[k]), ar.uaSe[k] == null ? "" : p2(1.96 * ar.uaSe[k]), p2(ar.pa[k]), ar.paSe[k] == null ? "" : p2(1.96 * ar.paSe[k]), +((ar.refArea[k] * total) / 1e4).toFixed(2), +((1.96 * ar.refSe[k] * total) / 1e4).toFixed(2), col[k]]),
      [],
      [B("Estimated area proportions (rows: classified, columns: reference)")],
      ["Classified \\ Reference", ...r.codes.map(name), "Mapped share"],
      ...ar.p.map((rw, i) => [name(r.codes[i]), ...rw.map((v) => +v.toFixed(6)), +ar.weights[i].toFixed(6)]),
      [],
      ["Method: Olofsson et al. 2014, Remote Sensing of Environment 148, 42-57. Each test pixel is weighted by the mapped area of its class."],
      ["The estimates assume the test pixels are a random sample of each mapped class. Pixels taken from hand-drawn samples only approximate that."],
    ] },
  ];
  return sheets;
}
function exportReport() { if (S.result?.accTest) exportCard("matrix", "csv"); }

// ================================================================ UI

function say(t, ok = false) {
  S.msg = t; S.msgOk = ok;
  const m = $("[data-o=msg]");
  if (m) { m.textContent = t; m.hidden = !t; m.className = ok ? "icl-ok" : "icl-err"; }
}
const isOpen = () => !!S.root?.isConnected;

function tabLayers() {
  const roles = rolesPresent();
  let lastGroup = null;
  // in the window only the bands of the selected image are listed; the others are in the Images list
  const srcRows = S.sources.filter((s) => !S.win || !s.tiff || setKeyOf(s) === activeSet()).map((s) => {
    const g = s.file ? s.group || "Files" : "Map layers";
    let head = "";
    if (g !== lastGroup) {
      lastGroup = g;
      const n = S.sources.filter((x) => (x.file ? x.group || "Files" : "Map layers") === g).length;
      head = `<div class="icl-group"><span>${esc(g)}</span><span class="icl-lab">${n}</span>${s.file ? `<button type="button" class="icl-icon ghost" data-rmgroup="${esc(s.group ?? "")}" aria-label="Remove ${esc(g)}" title="Remove these files">✕</button>` : ""}</div>`;
    }
    if (!s.tiff) return head + `<div class="icl-src"><b>${esc(s.name)}</b><span class="icl-err">${esc(s.error ?? "Opening…")}</span></div>`;
    return head + s.bands.map((b) => {
      const st = S.inputs[b.key];
      return `<div class="icl-band"><label class="icl-check"><input type="checkbox" data-band="${esc(b.key)}"${st.on ? " checked" : ""}><span>${esc(b.label)}</span></label>
        <select data-role="${esc(b.key)}" aria-label="Band role">${opt([["", "–"], ...ROLES.map((r) => [r, r])], st.role)}</select></div>`;
    }).join("");
  }).join("");
  const idx =[...Object.keys(INDICES).map((n) => ({ n, needs: INDICES[n].needs })), ...S.custom.map((c) => ({ n: c.name, custom: true, expr: c.expr }))].map((x) => {
    let ok = true, why = "";
    if (x.custom) { try { compileExpression(x.expr, Object.keys(roles)); } catch (e) { ok = false; why = e.message; } }
    else { const miss = x.needs.filter((k) => !roles[k]); ok = !miss.length; why = miss.length ? "Needs " + miss.join(", ") : x.needs.join(", "); }
    const on = ok && S.indexOn[x.n];
    return `<button type="button" class="icl-chip${on ? " on" : ""}" data-idx="${esc(x.n)}" aria-pressed="${on}" title="${esc(why)}"${ok ? "" : " disabled"}>${esc(x.n)}</button>`;
  }).join("");
  const nIdx = indexDefs().length, nB = selectedBands().length;
  const gridOpts = S.sources.filter((s) => s.tiff && (!S.win || setKeyOf(s) === activeSet())).map((s) => [s.key, `${s.name} (${nf(s.tiff.width)} × ${nf(s.tiff.height)})`]);
  return `
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">Input layers</h3><span class="icl-lab">${nB} selected</span>
      <button type="button" class="icl-btn2 sm" data-a="allBands">All</button><button type="button" class="icl-btn2 sm" data-a="noBands">None</button>
      <button type="button" class="icl-icon" data-a="refresh" title="Refresh layers" aria-label="Refresh layers">↻</button></div>
    <div class="icl-list">${srcRows || `<div class="icl-note">No raster layer on the map. Add GeoTIFFs with Add Data or below.</div>`}</div>
    <div class="icl-row">
      <button type="button" class="icl-btn2" data-a="addFolder" title="Read every GeoTIFF in a folder without adding them to the map">Add folder…</button>
      <button type="button" class="icl-btn2" data-a="addFiles">Add files…</button>
      <label class="icl-f"><span>Sensor</span><select data-k="sensor">${opt(SENSORS, S.sensor)}</select></label>
    </div>
  </section>
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">Indices</h3><span class="icl-lab">${nIdx} selected</span></div>
    <div class="icl-chips">${idx}</div>
    <div class="icl-row">
      <label class="icl-f" style="flex:0 0 84px"><span>Custom</span><input type="text" data-k="cName" placeholder="Name" maxlength="16"></label>
      <label class="icl-f"><span>Expression</span><input type="text" data-k="cExpr" placeholder="(B8 - B4) / (B8 + B4)"></label>
      <button type="button" class="icl-btn2" data-a="addIndex">Add</button>
    </div>
  </section>
  <section class="icl-sec">
    <h3 class="icl-head">Grid</h3>
    <label class="icl-f"><span>Reference layer</span><select data-k="grid">${opt(gridOpts, S.gridKey)}</select></label>
    <div class="icl-row">
      <label class="icl-f"><span>Cell size</span><select data-k="cell">${opt([[1, "Native"], [2, "2 × native"], [4, "4 × native"], [8, "8 × native"]], S.cellFactor)}</select></label>
      <label class="icl-f"><span>Reflectance scale</span><select data-k="scale">${opt([["auto", S.stack && S.scale === "auto" ? `Auto (${({ 1: "0–1", 0.0001: "× 0.0001", lc2: "Landsat C2 L2" })[S.stack.scaleName] ?? S.stack.scaleName})` : "Auto"], ["1", "1 (already 0–1)"], ["0.0001", "0.0001 (DN 0–10000)"], ["lc2", "Landsat C2 L2 (× 0.0000275 − 0.2)"]], S.scale)}</select></label>
    </div>
  </section>
  ${compositeSection()}`;
}

// ---------------------------------------------------------------- composite bands

const COMP_PRESETS = [["true", "True colour", ["B4", "B3", "B2"]], ["false", "False colour", ["B8", "B4", "B3"]], ["burn", "Burn scar", ["B11", "B8", "B3"]], ["swir", "SWIR", ["B12", "B8", "B4"]], ["agri", "Agriculture", ["B11", "B8", "B2"]], ["custom", "Custom", null]];
S.comp = { preset: "true", r: "", g: "", b: "", name: "" };

/** The three inputs of the RGB composite, by feature name; a preset wins when its bands are selected. */
function compChannels() {
  const names = featureNames(), roles = rolesPresent(), c = S.comp;
  const pre = COMP_PRESETS.find((p) => p[0] === c.preset)?.[2];
  if (pre && pre.every((r) => roles[r])) return pre.map((r) => roles[r].band.label);
  const pick = [c.r, c.g, c.b].map((v, i) => (names.includes(v) ? v : names[Math.min(i, names.length - 1)] ?? ""));
  return pick;
}
const SINGLE_RAMPS = [["viridis", "Viridis"], ["rdylgn", "Red–yellow–green"], ["spectral", "Spectral"], ["gray", "Grey"]];
S.single = { layer: "", ramp: "" };
function singleChoice() {
  const names = featureNames(), want = S.single.layer;
  const layer = names.includes(want) ? want : indexDefs()[0]?.name ?? names[0] ?? "";
  const isIdx = indexDefs().some((d) => d.name === layer);
  return { layer, ramp: S.single.ramp || (isIdx ? "rdylgn" : "gray") };
}
function compositeSection() {
  const names = featureNames(), [r, g, b] = compChannels(), roles = rolesPresent();
  const short = (n) => { const role = S.inputs[selectedBands().find((x) => x.band.label === n)?.band.key]?.role; return role ? (S.bandNames === "name" ? ROLE_NAMES[role] ?? role : role) : n; };
  const presetOk = (p) => !p[2] || p[2].every((k) => roles[k]);
  const ch = (k, v, label) => `<label class="icl-f"><span>${label}</span><select data-k="${k}"${names.length ? "" : " disabled"}>${opt(names.map((n) => [n, n]), v)}</select></label>`;
  const sc = singleChoice(), off = names.length && !S.busy ? "" : " disabled";
  return `
  <section class="icl-sec last" data-sec="composite">
    <div class="icl-mid"><h3 class="icl-head">Show on map</h3><span class="icl-lab">${names.length} layers available</span></div>
    <div class="icl-mid"><span class="icl-sub" style="flex:1">RGB composite</span><div class="icl-seg" style="flex:0 0 190px">${[["role", "Band number"], ["name", "Band name"]].map(([k, l]) => `<button type="button" data-bandnames="${k}" class="${S.bandNames === k ? "on" : ""}" aria-pressed="${S.bandNames === k}">${l}</button>`).join("")}</div></div>
    <label class="icl-f"><span>Preset</span><select data-k="cPreset">${COMP_PRESETS.map((p) => `<option value="${p[0]}"${p[0] === S.comp.preset ? " selected" : ""}${presetOk(p) ? "" : " disabled"}>${p[1]}${p[2] ? ` (${p[2].map((r) => (S.bandNames === "name" ? ROLE_NAMES[r] : r)).join(" ")})` : ""}</option>`).join("")}</select></label>
    <div class="icl-row">${ch("cR", r, "Red")}${ch("cG", g, "Green")}${ch("cB", b, "Blue")}</div>
    <div class="icl-row">
      <label class="icl-f"><span>Layer name</span><input type="text" data-k="cLayer" maxlength="80" value="${esc(S.comp.name || `Composite (${[r, g, b].map(short).join(" ")})`)}"></label>
      <button type="button" class="icl-btn" data-a="compRgb"${off}>Add RGB</button>
    </div>
    <span class="icl-sub">Single band or index</span>
    <div class="icl-row">
      <label class="icl-f"><span>Layer</span><select data-k="sLayer"${names.length ? "" : " disabled"}>${opt(names.map((n) => [n, n]), sc.layer)}</select></label>
      <label class="icl-f" style="flex:0 0 120px"><span>Colour ramp</span><select data-k="sRamp">${opt(SINGLE_RAMPS, sc.ramp)}</select></label>
      <button type="button" class="icl-btn" data-a="compSingle"${off}>Add</button>
    </div>
    <button type="button" class="icl-btn2" data-a="compStack"${off} title="Every selected band and index in one multiband GeoTIFF">Export stack GeoTIFF (${names.length} bands)</button>
  </section>`;
}

async function compositeAction(kind) {
  if (S.busy) return;
  S.busy = true; S.msg = ""; render();
  try {
    const st = await ensureStack();
    progress("Computing indices", 0); await tick();
    const { layers, names } = featureLayers(st), g = st.grid, n = g.width * g.height;
    const geo = { width: g.width, height: g.height, bounds: g.bounds, epsg: g.epsg, geographic: g.geographic };
    const label = ($("[data-k=cLayer]")?.value || "").trim() || "Composite";
    if (kind === "rgb") {
      const idx = compChannels().map((c) => names.indexOf(c));
      if (idx.some((i) => i < 0)) throw new Error("Choose three layers for red, green and blue.");
      progress("Stretching", 0.5); await tick();
      const bytes = writeGeoTiff(compositeRgb(layers[idx[0]], layers[idx[1]], layers[idx[2]], n, st.valid), { ...geo, samples: 3, rgb: true, nodata: 0, names: idx.map((i) => names[i]) });
      const url = layerBlob(bytes);
      S.compUrls = [...(S.compUrls ?? []), url];
      await S.app.addCogLayer?.(label, url, { bands: "1,2,3", nodata: 0, zoomTo: false });
      say(`Added "${label}" to the map.`, true);
    } else if (kind === "single") {
      const sc = singleChoice(), i = names.indexOf(sc.layer);
      if (i < 0) throw new Error("Choose a layer.");
      const L = layers[i], data = new Float32Array(n);
      for (let k = 0; k < n; k++) data[k] = st.valid[k] && Number.isFinite(L[k]) ? L[k] : -9999;
      const [lo, hi] = stretchLimits(L, NaN);
      const bytes = writeGeoTiff(data, { ...geo, samples: 1, nodata: -9999, names: [sc.layer] });
      const url = layerBlob(bytes);
      S.compUrls = [...(S.compUrls ?? []), url];
      await S.app.addCogLayer?.(sc.layer, url, { colormap: sc.ramp, rescaleMin: lo, rescaleMax: hi, nodata: -9999, zoomTo: false });
      say(`Added "${sc.layer}" to the map (stretch ${tickFmt(lo, 0.001)} to ${tickFmt(hi, 0.001)}).`, true);
    } else {
      progress("Writing stack", 0.5); await tick();
      const bytes = writeGeoTiff(compositeStack(layers, n, st.valid), { ...geo, samples: layers.length, nodata: -9999, names });
      download(label.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") + "_stack.tif", bytes, "image/tiff");
      say(`Exported ${layers.length} bands (${nf(bytes.length / 1048576, 1)} MB).`, true);
    }
  } catch (e) {
    console.warn("[Image Classification] composite", e);
    say(e?.message ?? String(e));
  } finally {
    S.busy = false;
    progress(null);
    const keep = S.msg, ok = S.msgOk;
    render();
    say(keep, ok);
  }
}

function tabSamples() {
  const counts = {};
  for (const s of S.samples) counts[s.code] = (counts[s.code] ?? 0) + 1;
  const rows = S.classes.map((c) => `
    <div class="icl-class${c.code === S.active ? " on" : ""}">
      <button type="button" class="icl-code" data-pick="${c.code}" aria-pressed="${c.code === S.active}" aria-label="Set active class">${c.code}</button>
      <input type="color" value="${esc(c.color)}" data-color="${c.code}" aria-label="Class colour">
      <input type="text" value="${esc(c.name)}" data-name="${c.code}" aria-label="Class name">
      <span class="icl-count">${counts[c.code] ?? 0}</span>
      <button type="button" class="icl-icon ghost" data-del="${c.code}" aria-label="Delete class" title="Delete class and its samples">✕</button>
    </div>`).join("");
  const pal = S.scheme ? SCHEMES[S.scheme].map(([n, c]) => `<button type="button" class="icl-pal" data-pal="${esc(n)}|${esc(c)}"><i class="icl-sw" style="background:${esc(c)}"></i>${esc(n)}</button>`).join("") : "";
  const vl = vectorLayers();
  return `
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">Classes</h3><span class="icl-lab">${nf(S.samples.length)} samples</span></div>
    <div class="icl-classes">${rows || `<div class="icl-note">No classes yet.</div>`}</div>
    <div class="icl-row">
      <label class="icl-f" style="flex:0 0 48px"><span>Code</span><input type="text" readonly value="${nextCode()}" aria-label="Automatic class code"></label>
      <label class="icl-f"><span>Name</span><input type="text" data-k="newName" placeholder="Class name" value="${esc(S.newName ?? "")}"></label>
      <input type="color" data-k="newColor" value="${esc(S.newColor ?? COLORS[(nextCode() - 1) % COLORS.length])}" aria-label="New class colour">
      <button type="button" class="icl-btn" data-a="addClass">Add class</button>
    </div>
    <label class="icl-f"><span>Scheme</span><select data-k="scheme">${opt([["", "Custom"], ["klhk", "KLHK"], ["mapbiomas", "MapBiomas"], ["nlcd", "NLCD"]], S.scheme)}</select></label>
    ${pal ? `<div class="icl-list pal">${pal}</div>` : ""}
  </section>
  <section class="icl-sec">
    <h3 class="icl-head">Draw samples</h3>
    <div class="icl-seg">${TOOLS.map(([k, l]) => `<button type="button" data-tool="${k}" class="${S.tool === k ? "on" : ""}" aria-pressed="${S.tool === k}">${l}</button>`).join("")}</div>
    <div class="icl-hint" data-o="hint"></div>
    <div class="icl-mid">
      <button type="button" class="icl-btn2 grow" data-a="undo">Undo last</button>
      <button type="button" class="icl-btn2 grow" data-a="clear">Clear all</button>
      <button type="button" class="icl-btn2 grow" data-a="save">Save as layer</button>
    </div>
    <div class="icl-row">
      <label class="icl-f"><span>From layer</span><select data-k="impLayer">${opt([["", "–"], ...vl.map((l) => [l.id, l.name])], S.impLayer ?? "")}</select></label>
      <label class="icl-f" style="flex:0 0 92px"><span>Class field</span><select data-k="impCode">${opt(fieldsOf(S.impLayer).map((f) => [f, f]), S.impCode)}</select></label>
      <label class="icl-f" style="flex:0 0 92px"><span>Name field</span><select data-k="impName">${opt([["", "–"], ...fieldsOf(S.impLayer).map((f) => [f, f])], S.impName ?? "")}</select></label>
    </div>
    <button type="button" class="icl-btn2" data-a="import">Import samples</button>
  </section>
  <section class="icl-sec last">
    <div class="icl-mid"><h3 class="icl-head">Spectral profile</h3><span class="icl-lab">mean per class</span></div>
    <div data-o="profile"><div class="icl-note">Reading layers…</div></div>
  </section>`;
}
function fieldsOf(id) {
  if (!id) return [];
  const keys = new Set();
  for (const f of (S.app.getLayerFeatures?.(id) ?? []).slice(0, 200)) for (const k of Object.keys(f?.properties ?? {})) if (!k.startsWith("__")) keys.add(k);
  return [...keys];
}

function slider(k, label, min, max, step, fmt = (v) => v) {
  return `<div class="icl-f"><span>${label}</span><div class="icl-mid"><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${P()[k]}" aria-label="${esc(label)}"><output data-v="${k}">${fmt(P()[k])}</output></div></div>`;
}
const FMT = { rfBag: (v) => Math.round(v * 100) + "%", gtbSamp: (v) => Math.round(v * 100) + "%", split: (v) => `${Math.round(v * 100)} / ${Math.round((1 - v) * 100)}`, gtbShrink: (v) => (+v).toFixed(2), svmGamma: (v) => (+v).toFixed(3) };
function tabModel() {
  const p = P();
  const kinds = `<section class="icl-sec"><div class="icl-seg">${[["sup", "Supervised"], ["unsup", "Unsupervised"]].map(([k, l]) => `<button type="button" data-kind="${k}" class="${p.kind === k ? "on" : ""}" aria-pressed="${p.kind === k}">${l}</button>`).join("")}</div></section>`;
  if (p.kind === "unsup") return kinds + unsupModel();
  return kinds + tabModelSup();
}
function tabModelSup() {
  const p = P();
  let body = "";
  if (p.algo === "RF") body = slider("rfTrees", "Number of trees", 10, 1000, 10) + slider("rfLeaf", "Min leaf population", 1, 20, 1) + slider("rfBag", "Bag fraction", 0.3, 1, 0.05, FMT.rfBag) +
    `<div class="icl-row"><label class="icl-f"><span>Variables per split</span><select data-p="rfVars">${opt([["sqrt", "Auto (√n)"], ["log2", "log₂ n + 1"], ["all", "All"]], p.rfVars)}</select></label>
     <label class="icl-f"><span>Max depth (0 = none)</span><input type="number" data-p="rfDepth" min="0" step="1" value="${p.rfDepth}"></label></div>`;
  else if (p.algo === "GTB") body = slider("gtbTrees", "Number of trees", 10, 500, 10) + slider("gtbShrink", "Learning rate (shrinkage)", 0.01, 0.3, 0.01, FMT.gtbShrink) + slider("gtbSamp", "Sampling rate", 0.3, 1, 0.05, FMT.gtbSamp) + slider("gtbNodes", "Max leaf nodes per tree", 2, 32, 1);
  else body = `<label class="icl-f"><span>Kernel</span><select data-p="svmKernel">${opt([["RBF", "RBF"], ["LINEAR", "Linear"], ["POLY", "Polynomial"], ["SIGMOID", "Sigmoid"]], p.svmKernel)}</select></label>` +
    slider("svmCost", "Cost (C)", 0.1, 100, 0.1) + (p.svmKernel !== "LINEAR" ? slider("svmGamma", "Gamma (per input)", 0.001, 2, 0.001, FMT.svmGamma) : "") +
    (p.svmKernel === "POLY" ? slider("svmDegree", "Degree", 1, 10, 1) : "") + (p.svmKernel === "POLY" || p.svmKernel === "SIGMOID" ? slider("svmCoef", "Coef0", 0, 5, 0.1) : "");
  return `
  <section class="icl-sec">
    <h3 class="icl-head">Classifier</h3>
    <select data-p="algo" aria-label="Algorithm">${opt(Object.entries(ALGO_NAMES), p.algo)}</select>
    ${body}
  </section>
  <section class="icl-sec">
    <h3 class="icl-head">Training / testing split</h3>
    ${slider("split", "Training share", 0.5, 0.95, 0.05, FMT.split)}
    <div class="icl-row">
      <label class="icl-f"><span>Split by</span><select data-p="splitBy">${opt([["pixel", "Pixel"], ["sample", "Sample"]], p.splitBy)}</select></label>
      <label class="icl-f"><span>Max pixels / sample</span><input type="number" data-p="maxPix" min="1" step="10" value="${p.maxPix}"></label>
      <label class="icl-f" style="flex:0 0 70px"><span>Seed</span><input type="number" data-p="seed" step="1" value="${p.seed}"></label>
    </div>
    <label class="icl-check" title="Predicts the image's pixels on the graphics card through WebGPU; training stays on the CPU. Falls back to the CPU where WebGPU is missing."><input type="checkbox" data-p="gpu"${p.gpu ? " checked" : ""}><span>Use GPU (WebGPU) to classify the image${globalThis.navigator?.gpu ? "" : " · not available in this browser"}</span></label>
    <label class="icl-check" title="Weights each class by the inverse of its training pixel count, so a class with few samples is not outvoted by a large one"><input type="checkbox" data-p="balanced"${p.balanced ? " checked" : ""}><span>Balance classes (weight by inverse class size)</span></label>
  </section>
  <section class="icl-sec last">
    <h3 class="icl-head">Output</h3>
    <label class="icl-f"><span>Layer name</span><input type="text" data-p="outName" value="${esc(p.outName)}" maxlength="80"></label>
    <label class="icl-f"><span>Smoothing</span><select data-p="smooth">${opt([[0, "None"], [3, "Majority 3 × 3"], [5, "Majority 5 × 5"]], p.smooth)}</select></label>
  </section>`;
}

function tabResults() {
  const r = S.result;
  if (!r) return `<section class="icl-sec last"><div class="icl-note center">No result yet.</div></section>`;
  const cls = new Map(r.classes.map((c) => [c.code, c])), nm = (c) => cls.get(c)?.name ?? "Class " + c, a = r.accTest;
  const tiles = [["Overall accuracy", a ? pct(a.oa) + "%" : "–"], ["Kappa", a ? a.kappa.toFixed(4) : "–"]];
  const params = r.algo === "SVM" ? `${r.opts.kernel}, C ${r.opts.cost}` : `${r.opts.trees} trees`;
  const lab = r.codes.map((c) => `${c} ${nm(c)}`), T = (v) => (S.exporting ? v : "");
  S.cards = {};
  if (a) {
    const mx = (mode, title) => matrixChart("matrix", { mode, title, names: lab, matrix: a.matrix, pa: a.pa, ua: a.ua });
    S.cards.matrix = {
      title: "Confusion matrix", chartLabel: "Heatmap", file: "confusion_matrix",
      chart: () => mx("heat", T("Confusion matrix (test)")), tableSvg: () => mx("table", "Confusion matrix (test)"),
      table: () => `<table class="icl-table"><thead><tr><th>Ref \\ Class</th>${r.codes.map((c) => `<th title="${esc(nm(c))}">${c}</th>`).join("")}<th>Total</th><th>PA %</th></tr></thead><tbody>
        ${a.matrix.map((row, k) => `<tr><td>${r.codes[k]} ${esc(nm(r.codes[k]))}</td>${row.map((v, j) => `<td${j === k ? ' class="d"' : ""}>${nf(v)}</td>`).join("")}<td>${nf(row.reduce((s, v) => s + v, 0))}</td><td>${pct(a.pa[k])}</td></tr>`).join("")}
        <tr><td>Total</td>${a.matrix[0].map((_, j) => `<td>${nf(a.matrix.reduce((s, rw) => s + rw[j], 0))}</td>`).join("")}<td>${nf(a.n)}</td><td></td></tr>
        <tr><td>UA %</td>${a.ua.map((v) => `<td>${pct(v)}</td>`).join("")}<td></td><td></td></tr></tbody></table>`,
      sheets: () => accuracySheets(r),
    };
  }
  const matrix = a ? card("matrix") : `<div class="icl-note">No test pixels: raise the test share or add samples.</div>`;
  const tot = r.codes.reduce((s, c) => s + r.areas.area[c], 0) || 1;
  S.cards.areas = {
    title: "Class areas", file: "class_areas",
    chart: () => barChart("areas", { title: T("Class areas"), label: "Class areas", xLabel: "Area (ha)", rows: r.codes.map((c) => ({ name: `${c} ${nm(c)}`, value: r.areas.area[c] / 1e4, color: cls.get(c)?.color, label: `${nf(r.areas.area[c] / 1e4)} ha · ${nf((r.areas.area[c] / tot) * 100, 1)}%` })) }),
    table: () => `<table class="icl-table"><thead><tr><th>Class</th><th>Area (ha)</th><th>Share %</th></tr></thead><tbody>${r.codes.map((c) => `<tr><td><i class="icl-sw" style="background:${esc(cls.get(c)?.color ?? "#888")}"></i> ${c} ${esc(nm(c))}</td><td>${nf(r.areas.area[c] / 1e4, 2)}</td><td>${nf((r.areas.area[c] / tot) * 100, 2)}</td></tr>`).join("")}<tr><td>Total</td><td>${nf(tot / 1e4, 2)}</td><td>100.00</td></tr></tbody></table>`,
    sheets: () => [{ name: "Class areas", widths: [10, 28, 16, 12], rows: [[{ v: "Code", bold: true }, { v: "Class", bold: true }, { v: "Area (ha)", bold: true }, { v: "Share (%)", bold: true }], ...r.codes.map((c) => [c, nm(c), +(r.areas.area[c] / 1e4).toFixed(2), +((r.areas.area[c] / tot) * 100).toFixed(2)]), ["", "Total", +(tot / 1e4).toFixed(2), 100]] }],
  };
  let imp = "";
  if (r.model.importance) {
    const list = r.names.map((n, i) => [n, r.model.importance[i]]).sort((x, y) => y[1] - x[1]);
    S.cards.importance = {
      title: "Variable importance", file: "variable_importance",
      chart: () => barChart("importance", { title: T("Variable importance"), label: "Variable importance", xLabel: "Importance (%)", rows: list.slice(0, 15).map(([n, v]) => ({ name: n, value: v * 100, color: "#00758f", label: nf(v * 100, 1) + "%" })) }),
      table: () => `<table class="icl-table"><thead><tr><th>Input</th><th>Importance %</th></tr></thead><tbody>${list.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${nf(v * 100, 2)}</td></tr>`).join("")}</tbody></table>`,
      sheets: () => [{ name: "Variable importance", widths: [24, 16], rows: [[{ v: "Input", bold: true }, { v: "Importance (%)", bold: true }], ...list.map(([n, v]) => [n, +(v * 100).toFixed(3)])] }],
    };
    imp = `<section class="icl-sec">${card("importance")}</section>`;
  }
  return `
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">Accuracy</h3><span class="icl-lab">${ALGO_NAMES[r.algo]} · ${params} · ${r.names.length} inputs</span></div>
    <div class="icl-tiles">${tiles.map(([k, v]) => `<div class="icl-tile"><span class="icl-lab">${k}</span><b>${v}</b></div>`).join("")}</div>
    <span class="icl-lab">${nf(r.sp.train.cells.length)} training · ${nf(r.sp.test.cells.length)} test pixels · ${fmtDur(r.seconds)}${r.sp.capped ? ` · ${r.sp.capped} samples capped at ${P().maxPix} px` : ""}</span>
  </section>
  <section class="icl-sec">${matrix}</section>
  <section class="icl-sec">${card("areas")}</section>
  ${imp}
  <section class="icl-sec">
    <h3 class="icl-head">Post-processing</h3>
    <div class="icl-row">
      <label class="icl-f"><span>Minimum patch</span><select data-k="mmu">${opt([[0, "None"], [0.1, "0.1 ha"], [0.25, "0.25 ha"], [0.5, "0.5 ha"], [1, "1 ha"], [2, "2 ha"], [5, "5 ha"]], S.post.mmu)}</select></label>
      <button type="button" class="icl-btn" data-a="polygons"${S.busy ? " disabled" : ""}>Convert to polygons</button>
    </div>
  </section>
  <section class="icl-sec last icl-mid">
    <button type="button" class="icl-btn2 grow" data-a="exportTiff">Export GeoTIFF</button>
    <button type="button" class="icl-btn2 grow" data-a="exportCsv"${r.accTest ? "" : " disabled"}>Download CSV</button>
  </section>`;
}

function summary() {
  return `${selectedBands().length + indexDefs().length} inputs · ${S.classes.length} classes · ${nf(S.samples.length)} samples`;
}

function render() {
  if (!S.root) return;
  if (S.tab !== "threshold" && S.identify) setIdentify(false, true);
  const body = S.tab === "layers" ? tabLayers() : S.tab === "samples" ? tabSamples() : S.tab === "model" ? tabModel() : S.tab === "threshold" ? tabThreshold() : S.win ? resultsDock() : tabResults();
  const i = TABS.findIndex((t) => t[0] === S.tab), scroll = S.root.querySelector(".icl-body")?.scrollTop ?? 0, sameTab = S.lastTab === S.tab;
  S.root.innerHTML = `
    <div class="icl-tabs" role="tablist">${TABS.map(([k, l], n) => `<button type="button" role="tab" data-tab="${k}" class="${S.tab === k ? "on" : ""}" aria-selected="${S.tab === k}"><span class="icl-num">${n + 1}</span>${l}</button>`).join("")}</div>
    <div class="icl-body">${body}</div>
    <div class="icl-foot">
      <div class="icl-prog" data-o="prog" hidden><div class="icl-mid"><span></span><b></b></div><div class="icl-track"><i></i></div></div>
      <div class="${S.msgOk ? "icl-ok" : "icl-err"}" data-o="msg" role="status"${S.msg ? "" : " hidden"}>${esc(S.msg)}</div>
      <div class="icl-mid">
        <span class="icl-sum">${summary()}</span>
        ${i > 0 && i < 4 ? `<button type="button" class="icl-btn2" data-a="back">Back</button>` : ""}
        ${i < 2 ? `<button type="button" class="icl-btn" data-a="next">Next</button>` : i < 4 ? `<button type="button" class="icl-btn" data-a="run"${S.busy ? " disabled" : ""}>${S.busy ? "Running…" : P().kind === "unsup" && S.tab === "model" ? "Run clustering" : S.result ? "Run again" : "Run classification"}</button>` : ""}
      </div>
    </div>`;
  if (sameTab) S.root.querySelector(".icl-body").scrollTop = scroll;
  S.lastTab = S.tab;
  if (S.tab === "samples") { renderHint(); if (S.profile && !S.profile.error) renderProfile(); updateProfile(); }
  if (S.tab === "threshold") updateThreshold();
  renderFloat();
  if (S.win) winRefresh();
}

function renderHint() {
  renderFloat();
  const h = $("[data-o=hint]");
  if (!h) return;
  const c = activeClass(), d = S.draft.length;
  const t = { pan: "Drag to move the map. Choose a tool to draw.", point: "Click the map to place a point.", polygon: d >= 3 ? "Click the first point, double-click or press Finish. Esc cancels." : "Click to add vertices.", circle: d ? "Release or click to set the radius." : "Drag from the centre, or click it.", rect: d ? "Release or click the opposite corner." : "Drag a box, or click two corners." }[S.tool];
  h.innerHTML = (S.tool !== "pan" ? `<i class="icl-sw" style="background:${esc(c?.color ?? COLORS[0])}"></i><b>${esc(c ? c.code + " " + c.name : "1 Class 1")}</b> ` : "") + esc(t);
}

function invalidate() { S.profile = null; }

function onClick(e) {
  if (S.menu && !e.target.closest(".icl-dl")) { const id = S.menu.split(":")[0]; S.menu = null; redrawCard(id); }
  const cb = e.target.closest("[data-cv],[data-cm],[data-cd],[data-cf],[data-ctx]");
  if (cb) {
    const d = cb.dataset, inFull = !!cb.closest(".icl-full");
    if (d.cv) { S.cardView[d.card] = d.cv; if (S.textMode === d.card) S.textMode = null; redrawCard(d.card); }
    else if (d.cm) { const key = d.cm + (inFull ? ":full" : ""); S.menu = S.menu === key ? null : key; redrawCard(d.cm); }
    else if (d.cd) { S.menu = null; redrawCard(d.card); exportCard(d.card, d.cd)?.catch?.((err) => say("Download failed: " + (err?.message ?? err))); }
    else if (d.cf) { if (inFull) closeFull(); else openFull(d.cf); }
    else if (d.ctx) { S.textMode = S.textMode === d.ctx ? null : d.ctx; redrawCard(d.ctx); }
    return;
  }
  const ct = e.target.closest("[data-ct]");
  if (ct) {
    const id = ct.dataset.chart;
    if (ct.dataset.ct === "text") { S.textMode = S.textMode === id ? null : id; redrawChart(id); }
    else exportChart(id, ct.dataset.ct).catch((err) => say("Chart export failed: " + (err?.message ?? err)));
    return;
  }
  const chart = e.target.closest("svg[data-chart]");
  if (chart) { if (S.textMode === chart.dataset.chart && !e.target.closest("[data-note]")) placeNote(chart, e); return; }
  const t = e.target.closest("button");
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { S.tab = ds.tab; S.msg = ""; return render(); }
  if (ds.tool) return setTool(ds.tool);
  if (ds.pick) { S.active = +ds.pick; S.draft = []; syncMap(); return render(); }
  if (ds.del) { const c = +ds.del; S.classes = S.classes.filter((x) => x.code !== c); S.samples = S.samples.filter((s) => s.code !== c); if (S.active === c) S.active = S.classes[0]?.code ?? 0; invalidate(); syncMap(); return render(); }
  if (ds.idx) { S.indexOn[ds.idx] = !S.indexOn[ds.idx]; return render(); }
  if (ds.bandnames) { S.bandNames = ds.bandnames; S.comp.name = ""; return render(); }
  if (ds.pal) { const [n, c] = ds.pal.split("|"); S.newName = n; S.newColor = c.toLowerCase(); return render(); }
  const a = ds.a;
  if (a === "next") { S.tab = TABS[TABS.findIndex((x) => x[0] === S.tab) + 1][0]; S.msg = ""; render(); }
  else if (a === "back") { S.tab = TABS[TABS.findIndex((x) => x[0] === S.tab) - 1][0]; S.msg = ""; render(); }
  else if (a === "run") (P().kind === "unsup" ? runClustering : runClassification)();
  else if (a === "refresh") refreshSources();
  else if (a === "addFiles") addFiles();
  else if (a === "addFolder") addFolder();
  else if (ds.rmgroup !== undefined) removeGroup(ds.rmgroup);
  else if (a === "compSingle") compositeAction("single");
  else if (a === "polygons") polygonsAction();
  else if (a === "identify") setIdentify(!S.identify);
  else if (a === "threshold") thresholdAction();
  else if (ds.use) { S.th.layer = ds.use; S.th.value = +fmtVal(S.idValues.rows.find((r) => r.name === ds.use).v); S.th.name = ""; render(); }
  else if (a === "allBands" || a === "noBands") { for (const k in S.inputs) S.inputs[k].on = a === "allBands"; invalidate(); render(); }
  else if (a === "addIndex") {
    const name = ($("[data-k=cName]").value || "").trim().toUpperCase().replace(/[^\w]/g, ""), expr = $("[data-k=cExpr]").value.trim();
    if (!name || !expr) return say("Give the index a name and an expression.");
    try { compileExpression(expr, ROLES); } catch (err) { return say(err.message); }
    if (INDICES[name] || S.custom.some((c) => c.name === name)) return say(`"${name}" already exists.`);
    S.custom.push({ name, expr }); S.indexOn[name] = true; S.msg = ""; render();
  }
  else if (a === "addClass") {
    const code = nextCode(), name = (S.newName ?? "").trim() || "Class " + code;
    S.classes.push({ code, name, color: S.newColor ?? COLORS[(code - 1) % COLORS.length] });
    S.active = code; S.newName = ""; S.newColor = COLORS[code % COLORS.length];
    if (S.tool === "pan") setTool("polygon"); else render();
  }
  else if (a === "undo") { if (S.draft.length) S.draft.pop(); else S.samples.pop(); invalidate(); syncMap(); render(); }
  else if (a === "clear") { S.samples = []; S.draft = []; invalidate(); syncMap(); render(); }
  else if (a === "save") saveSamples();
  else if (a === "import") importSamples();
  else if (a === "exportTiff") exportTiff();
  else if (a === "exportCsv") exportReport();
  else if (a === "compRgb") compositeAction("rgb");
  else if (a === "compStack") compositeAction("stack");
}

function onChange(e) {
  const t = e.target, ds = t.dataset;
  if (ds.band) { S.inputs[ds.band].on = t.checked; invalidate(); return render(); }
  if (ds.role) { S.inputs[ds.role].role = t.value; S.inputs[ds.role].auto = false; invalidate(); return render(); }
  if (ds.color) { const c = S.classes.find((x) => x.code === +ds.color); if (c) c.color = t.value; syncMap(); renderProfile(); renderFloat(); return; }
  if (ds.name) { const c = S.classes.find((x) => x.code === +ds.name); if (c) c.name = t.value.trim() || "Class " + c.code; syncMap(); renderProfile(); renderHint(); if (S.win) winRefresh(); return; }
  if (ds.p) {
    const p = P(), k = ds.p, num = t.type === "range" || t.type === "number" || k === "smooth";
    p[k] = t.type === "checkbox" ? t.checked : num ? +t.value : t.value;
    if (k === "algo") { p.outName = `Land Cover (${ALGO_NAMES[t.value].replace("Support Vector Machine", "SVM")})`; return render(); }
    if (k === "svmKernel") return render();
    const o = $(`[data-v=${k}]`); if (o) o.textContent = (FMT[k] ?? ((v) => v))(p[k]);
    return;
  }
  const k = ds.k;
  if (k === "sensor") { S.sensor = t.value; for (const s of S.sources) if (s.bands) for (const b of s.bands) S.inputs[b.key].role = guessRole(s.tiff.count === 1 ? s.name : n0(b.label), S.sensor); invalidate(); render(); }
  else if (k === "grid") { S.gridKey = t.value; invalidate(); }
  else if (k === "cell") { S.cellFactor = +t.value; invalidate(); }
  else if (k === "scale") { S.scale = t.value; invalidate(); }
  else if (k === "scheme") { S.scheme = t.value; render(); }
  else if (k === "cPreset") { S.comp.preset = t.value; S.comp.name = ""; if (t.value === "custom") [S.comp.r, S.comp.g, S.comp.b] = compChannels(); render(); }
  else if (k === "cR" || k === "cG" || k === "cB") { const cur = compChannels(); [S.comp.r, S.comp.g, S.comp.b] = cur; S.comp[k[1].toLowerCase()] = t.value; S.comp.preset = "custom"; S.comp.name = ""; render(); }
  else if (k === "cLayer") S.comp.name = t.value;
  else if (k === "sLayer") { S.single.layer = t.value; S.single.ramp = ""; render(); }
  else if (k === "sRamp") S.single.ramp = t.value;
  else if (k === "mmu") S.post.mmu = +t.value;
  else if (k === "thLayer") { S.th.layer = t.value; S.th.name = ""; render(); }
  else if (k === "thOp") { S.th.op = t.value; S.th.name = ""; render(); }
  else if (k === "thValue") { S.th.value = t.value === "" ? 0 : +t.value; S.th.name = ""; render(); }
  else if (k === "thOut") { S.th.out = t.value; render(); }
  else if (k === "thT") { S.th.tColor = t.value; updateThreshold(); }
  else if (k === "thF") S.th.fColor = t.value;
  else if (k === "thMmu") S.th.mmu = +t.value;
  else if (k === "thName") S.th.name = t.value;
  else if (k === "newName") S.newName = t.value;
  else if (k === "newColor") S.newColor = t.value;
  else if (k === "impLayer") { S.impLayer = t.value; S.impCode = fieldsOf(t.value).find((f) => /^(code|class|kelas|lc|id)$/i.test(f)) ?? fieldsOf(t.value)[0]; render(); }
  else if (k === "impCode") S.impCode = t.value;
  else if (k === "impName") S.impName = t.value;
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.p && t.type === "range") { P()[t.dataset.p] = +t.value; const o = $(`[data-v=${t.dataset.p}]`); if (o) o.textContent = (FMT[t.dataset.p] ?? ((v) => v))(+t.value); }
}

function mount(container) {
  if (!S.root) {
    S.root = document.createElement("div");
    S.root.className = "icl";
    S.root.addEventListener("click", onClick);
    S.root.addEventListener("change", onChange);
    S.root.addEventListener("input", onInput);
    S.root.addEventListener("mousedown", onChartDown);
    S.root.addEventListener("dblclick", onChartDbl);
  }
  container.classList.add("icl-host");
  container.append(S.root);
  bindMap();
  adoptSampleLayers();
  render();
  refreshSources();
  // the host may attach the container to the page only after render(): draw the toolbar once it is there
  for (const ms of [0, 250, 1000]) setTimeout(() => { if (isOpen()) { bindMap(); renderFloat(); drawOverlay(); } }, ms);
  return () => {
    try { if (S.app) setTool("pan"); } catch (e) { console.warn("[Image Classification] cleanup", e); }
    if (S.root?.parentElement === container) S.root.remove();
    S.fl?.remove(); S.fl = null;
  };
}

/** The plugin works in its own full window over GeoLibre (see win.js). */
function open() { return openWindow(); }
function openComposite() { openWindow(); winDo("w:comp"); }

export const plugin = {
  id: ID,
  name: "Image Classification",
  version: VERSION,
  activate(app) {
    S.app = app;
    globalThis.__imageClassificationInstance = INSTANCE;
    for (const el of document.querySelectorAll(".icl-float, .icl-overlay")) el.remove();
    // The desktop mounts and unmounts the docked panel in an order a plugin cannot rely on, so keep the floating
    // toolbar in step with the panel by looking every half second (cheap: two DOM checks).
    const watch = setInterval(() => {
      if (!current() || S.win) return;
      if (isOpen()) { if (!S.fl?.isConnected) { bindMap(); renderFloat(); drawOverlay(); } }
      else if (S.fl) { S.fl.remove(); S.fl = null; if (S.tool !== "pan") setTool("pan"); }
    }, 500);
    S.dispose.push(() => clearInterval(watch));
    S.docked = false;
    const items = [{ id: "open", label: "Image Classification…", icon: ICON, onSelect: open }, { id: "composite", label: "Composite Bands…", icon: ICON, onSelect: openComposite }];
    const offMenu = app.registerMenuContribution?.({ id: `${ID}-processing`, menu: "processing", items });
    if (typeof offMenu === "function") S.dispose.push(offMenu);
    const offBar = app.registerToolbarMenu?.({ id: `${ID}-menu`, label: "Image Classification", icon: ICON, items });
    if (typeof offBar === "function") S.dispose.push(offBar);
    // capture: the host handles Escape itself and stops it before it bubbles
    window.addEventListener("keydown", onKey, true);
    S.dispose.push(() => window.removeEventListener("keydown", onKey, true));
  },
  deactivate(app) {
    unbindMap();
    removeMapLayers();
    app?.closeFloatingPanel?.(PANEL);
    app?.closeRightPanel?.(PANEL);
    for (const d of S.dispose.splice(0)) { try { d(); } catch (e) { console.warn("[Image Classification] cleanup", e); } }
    for (const s of S.sources) if (s.file) URL.revokeObjectURL(s.url);
    // composites, thresholds and results stay on the map after the plugin goes; their blobs must outlive it
    S.compUrls = [];
    closeWindow();
    S.root?.remove();
    closeFull();
    // results, feature layers and canvases hold several copies of the image: let them go with the plugin
    S.imgCache?.clear();
    Object.assign(S, { root: null, sources: [], stack: null, stackKey: "", reading: null, result: null, results: [], fcache: null, chgCache: null, profile: null, baseKey: "", vp: null, app: null });
  },
};

export default plugin;
