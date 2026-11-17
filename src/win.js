// Image Classification window: a full application window inside GeoLibre (title bar, menu bar, toolbar, docks, own
// image viewer, chart and analysis views, status bar). The right dock hosts the workflow steps rendered by main.js.
// Concatenated after core.js and main.js by build.mjs, so it shares their scope.

S.results = []; // every classification and labelled clustering of this session, newest last
S.view = "map"; // centre view
S.vp = null; // viewer transform { k, x, y } grid pixel -> screen
S.split = { left: "", right: "", pos: 50, mode: "swipe" };
S.chg = { a: -1, b: -1 };
S.log = [];
S.leftTab = "layers";
S.exp = null;
S.bandNames = "role";
S.winMode = "max";

const WIN_VIEWS = [["map", "Map"], ["split", "Split view"], ["charts", "Charts"], ["acc", "Accuracy"], ["change", "Change"], ["log", "Log"]];
const CLUSTER_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#86bcb6", "#d37295", "#fabfd2", "#b6992d", "#499894", "#79706e"];
const wIco = (d, size = 15) => `<svg class="wi" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${d}</svg>`;
const WI = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  min: '<path d="M6 12h12"/>', max: '<rect x="6" y="6" width="12" height="12" rx="1"/>', restore: '<rect x="5" y="8" width="11" height="11" rx="1"/><path d="M8 8V5h11v11h-3"/>', close: '<path d="M7 7l10 10M17 7L7 17"/>',
  folder: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 12v5M9.5 14.5h5"/>', save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M9 10l-2 2 2 2M15 10l2 2-2 2"/>', calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  run: '<path d="M7 5l12 7-12 7z"/>', down: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>', send: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

// ================================================================ window shell

function openWindow() {
  if (S.win?.isConnected) { S.win.hidden = false; S.pill?.remove(); S.pill = null; return true; }
  const w = (S.win = document.createElement("div"));
  w.className = "icl icw" + (S.winMode === "max" ? " max" : "");
  w.setAttribute("role", "dialog");
  w.setAttribute("aria-label", "Image Classification");
  w.innerHTML = `
    <div class="icw-title" data-w="drag">${wIco(WI.grid)}<b>Image Classification</b><span class="icw-sub" data-w="docname"></span><span class="icw-sp"></span>
      <button type="button" class="icw-wb" data-wa="min" aria-label="Minimise">${wIco(WI.min)}</button>
      <button type="button" class="icw-wb" data-wa="max" aria-label="Maximise or restore">${wIco(WI.restore)}</button>
      <button type="button" class="icw-wb close" data-wa="close" aria-label="Close window">${wIco(WI.close)}</button></div>
    <nav class="icw-menubar" data-w="menubar" aria-label="Menu"></nav>
    <div class="icw-tools" role="toolbar" aria-label="Tools" data-w="tools"></div>
    <div class="icw-body">
      <aside class="icw-left" data-w="left"></aside>
      <section class="icw-center"><div class="icw-tabs" data-w="tabs"></div><div class="icw-view" data-w="view"></div></section>
      <aside class="icw-right" data-w="right"></aside>
    </div>
    <footer class="icw-status" data-w="status"></footer>
    <div data-w="modal"></div>`;
  document.body.append(w);
  w.addEventListener("click", winClick);
  w.addEventListener("change", winChange);
  w.addEventListener("input", winInput);
  w.addEventListener("mousedown", onChartDown);
  w.addEventListener("dblclick", onChartDbl);
  w.querySelector("[data-w=drag]").addEventListener("mousedown", winDrag);
  // the right dock is the workflow panel main.js renders into (S.root)
  mount(w.querySelector("[data-w=right]"));
  winRefresh();
  return true;
}
const wq = (sel) => S.win?.querySelector(sel);
function closeWindow() {
  S.win?.remove(); S.win = null; S.pill?.remove(); S.pill = null; S.viewer = null;
  if (S.root) { S.root.remove(); }
}
function minimiseWindow() {
  if (!S.win) return;
  S.win.hidden = true;
  S.pill = document.createElement("button");
  S.pill.type = "button"; S.pill.className = "icw-pill";
  S.pill.innerHTML = `${wIco(WI.grid)}<span>Image Classification</span><b>${esc(S.result ? S.result.name : "Restore")}</b>`;
  S.pill.onclick = () => openWindow();
  document.body.append(S.pill);
}
function winDrag(e) {
  if (S.winMode === "max" || e.target.closest("button") || e.button !== 0) return;
  const r = S.win.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
  const move = (ev) => { S.win.style.left = Math.max(0, ev.clientX - ox) + "px"; S.win.style.top = Math.max(0, ev.clientY - oy) + "px"; };
  const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
}

/** Everything outside the right dock; cheap enough to redraw after each change. */
function winRefresh() {
  if (!S.win) return;
  const doc = wq("[data-w=docname]");
  if (doc) doc.textContent = "— " + (activeSetName() || "no image yet") + " · GeoLibre";
  wq("[data-w=menubar]").innerHTML = menuBar();
  wq("[data-w=tools]").innerHTML = toolBar();
  wq("[data-w=left]").innerHTML = leftDock();
  wq("[data-w=tabs]").innerHTML = WIN_VIEWS.map(([k, l]) => `<button type="button" class="icw-tab${S.view === k ? " on" : ""}" data-view="${k}">${l}</button>`).join("") + `<span class="icw-sp"></span><span class="icw-note">${esc(viewNote())}</span>`;
  renderView();
  winStatus();
  wq("[data-w=modal]").innerHTML = S.exp ? exportDialog() : "";
  const mx = S.win.querySelector('[data-wa="max"]');
  if (mx) mx.innerHTML = wIco(S.winMode === "max" ? WI.restore : WI.max);
}

// ---------------------------------------------------------------- image sets (dates / scenes)

/** Bands of one scene share a name once the band token is removed: PreFire_Band_B2 and PreFire_Band_B8 -> PreFire_Band. */
function setKeyOf(s) {
  if (s.tiff && s.tiff.count > 1) return "M:" + s.key;
  const base = s.name.replace(/(^|[_\- .])B(?:and)?[_ ]?(?:0?(?:8A|1[0-2]|[1-9])|0)(?![0-9A-Za-z]).*$/i, "");
  return base === s.name ? "S:" + s.key : (s.file ? "F:" + (s.group ?? "") + "/" : "L:") + base;
}
function setNameOf(key) {
  if (key.startsWith("M:") || key.startsWith("S:")) return S.sources.find((s) => key.slice(2) === s.key)?.name ?? key;
  return key.replace(/^[FL]:([^/]*\/)?/, "");
}
function imageSets() {
  const m = new Map();
  for (const s of S.sources) {
    if (!s.tiff) continue;
    const k = setKeyOf(s), e = m.get(k) ?? { key: k, name: setNameOf(k), bands: 0, roles: 0 };
    e.bands += s.tiff.count;
    for (const b of s.bands ?? []) if (S.inputs[b.key]?.role) e.roles++;
    m.set(k, e);
  }
  return [...m.values()];
}
function activeSet() {
  const sets = imageSets();
  if (!sets.some((x) => x.key === S.set)) S.set = sets.slice().sort((a, b) => b.roles - a.roles || b.bands - a.bands)[0]?.key ?? "";
  return S.set;
}
const activeSetName = () => (activeSet() ? setNameOf(activeSet()) : "");
const inActiveSet = (s) => !S.set || setKeyOf(s) === activeSet();

// ================================================================ menus and toolbar

const MENUS = () => [
  ["File", [["Add folder of GeoTIFFs…", "", "addFolder"], ["Add files…", "", "addFiles"], ["Refresh map layers", "", "refresh"], "-", ["Export to folder…", "Ctrl+E", "w:exp"], ["Send result to GeoLibre map", "", "w:send"], "-", ["Minimise window", "", "w:min"], ["Close window", "", "w:close"]]],
  ["Edit", [["Undo last sample", "Ctrl+Z", "undo"], ["Clear all samples", "", "clear"], "-", ["Save samples as layer", "", "save"]]],
  ["View", [...WIN_VIEWS.map(([k, l], i) => [l, String(i + 1), "v:" + k]), "-", ["Zoom to image", "0", "w:fit"]]],
  ["Layers", [["Inputs and indices", "", "s:layers"], ["Composite…", "", "w:comp"], ["Raster calculator…", "", "w:calc"]]],
  ["Samples", [["Draw point", "P", "t:point"], ["Draw polygon", "G", "t:polygon"], ["Draw circle", "C", "t:circle"], ["Draw rectangle", "R", "t:rect"], ["Pan", "H", "t:pan"], "-", ["Classes and import", "", "s:samples"]]],
  ["Classify", [["Supervised settings", "", "w:sup"], ["Unsupervised: K-means / ISODATA", "", "w:unsup"], "-", ["Run", "F5", "run"], ["Classify another image with this model", "", "w:apply"]]],
  ["Results", [["Charts", "", "v:charts"], ["Accuracy", "", "v:acc"], ["Smoothing and polygons", "", "s:results"], ["Convert to polygons", "", "polygons"]]],
  ["Analysis", [["Land cover change", "", "v:change"], ["Compare before / after", "", "v:split"], ["Threshold", "", "s:threshold"]]],
  ["Help", [["Tutorial: making samples", "", "w:help"]]],
];
function menuBar() {
  return MENUS().map(([name, items]) => {
    const open = S.menuOpen === name;
    return `<div class="icw-mwrap"><button type="button" class="icw-mb${open ? " on" : ""}" data-menu="${name}" aria-haspopup="menu" aria-expanded="${open}">${name}</button>${open ? `<div class="icw-dd" role="menu">${items.map((it) => it === "-" ? `<div class="icw-msep"></div>` : `<button type="button" class="icw-mi" role="menuitem" data-do="${it[2]}"><span>${esc(it[0])}</span><kbd>${esc(it[1])}</kbd></button>`).join("")}</div>` : ""}</div>`;
  }).join("");
}
function toolBar() {
  const c = activeClass();
  const tool = (k, label) => `<button type="button" class="icw-tb${S.tool === k ? " on" : ""}" data-tool="${k}" aria-pressed="${S.tool === k}" title="${label}" aria-label="${label}">${`<svg class="wi" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">${FL_ICONS[k]}</svg>`}</button>`;
  return `
    <button type="button" class="icw-tb" data-do="addFolder" title="Add folder of GeoTIFFs" aria-label="Add folder">${wIco(WI.folder)}</button>
    <span class="icw-tsep"></span>
    ${tool("pan", "Pan (move the image)")}${tool("point", "Draw point")}${tool("polygon", "Draw polygon")}${tool("circle", "Draw circle")}${tool("rect", "Draw rectangle")}
    <button type="button" class="icw-tb" data-do="undo" title="Undo last sample" aria-label="Undo last sample">${wIco(WI.undo)}</button>
    <span class="icw-tsep"></span>
    <label class="icw-mid"><span class="icw-lab">Class</span><select data-wk="active" aria-label="Active class">${S.classes.map((x) => `<option value="${x.code}"${x.code === S.active ? " selected" : ""}>${x.code} ${esc(x.name)}</option>`).join("") || `<option>No classes</option>`}</select>${c ? `<i class="icw-sw" style="background:${esc(c.color)}"></i>` : ""}</label>
    <span class="icw-tsep"></span>
    <button type="button" class="icw-tb${S.view === "split" ? " on" : ""}" data-do="v:split" title="Split view (before / after)" aria-label="Split view">${wIco(WI.split)}</button>
    <button type="button" class="icw-tb" data-do="w:calc" title="Raster calculator" aria-label="Raster calculator">${wIco(WI.calc)}</button>
    <span class="icw-sp"></span>
    <span class="icw-lab">${summary()}</span>
    <button type="button" class="icw-btn" data-do="run"${S.busy ? " disabled" : ""}>${wIco(WI.run)}${S.busy ? "Running…" : P().kind === "unsup" ? "Run clustering" : "Run classification"}</button>
    <button type="button" class="icw-btn2" data-do="w:exp"${S.result ? "" : " disabled"}>${wIco(WI.down)}Export</button>
    <button type="button" class="icw-btn2" data-do="w:send"${S.result ? "" : " disabled"}>${wIco(WI.send)}Send to GeoLibre map</button>`;
}

function leftDock() {
  const head = `<div class="icw-dh"><button type="button" class="icw-dt${S.leftTab === "layers" ? " on" : ""}" data-left="layers">Layers</button><button type="button" class="icw-dt${S.leftTab === "classes" ? " on" : ""}" data-left="classes">Classes</button></div>`;
  if (S.leftTab === "classes") {
    const counts = {};
    for (const s of S.samples) counts[s.code] = (counts[s.code] ?? 0) + 1;
    return head + `<div class="icw-scroll">${S.classes.map((c) => `<button type="button" class="icw-row${c.code === S.active ? " on" : ""}" data-pick="${c.code}"><span class="icw-code" style="background:${esc(c.color)}">${c.code}</span><span class="icw-grow">${esc(c.name)}</span><span class="icw-lab">${counts[c.code] ?? 0}</span></button>`).join("") || `<div class="icw-empty">No classes yet. Add one in Samples.</div>`}</div>`;
  }
  const sets = imageSets(), act = activeSet();
  const res = S.results.map((r, i) => `<label class="icw-row"><input type="radio" name="icw-res" data-wk="result" value="${i}"${S.result === r ? " checked" : ""}><span class="icw-grow">${esc(r.name)}</span><span class="icw-lab">${r.accTest ? pct(r.accTest.oa, 1) + "%" : r.kind === "clusters" ? "clusters" : ""}</span></label>`).join("");
  const legend = S.result ? S.result.classes.filter((c) => S.result.codes.includes(c.code)).map((c) => { const t = S.result.codes.reduce((a, k) => a + S.result.areas.area[k], 0) || 1; return `<div class="icw-row"><i class="icw-sw" style="background:${esc(c.color)}"></i><span class="icw-grow">${esc(c.name)}</span><span class="icw-lab">${nf((S.result.areas.area[c.code] / t) * 100, 1)}%</span></div>`; }).join("") : "";
  return head + `<div class="icw-scroll">
    <div class="icw-cap">Images</div>
    ${sets.map((x) => `<label class="icw-row" title="Bands of one scene or date"><input type="radio" name="icw-set" data-wk="set" value="${esc(x.key)}"${x.key === act ? " checked" : ""}><span class="icw-grow">${esc(x.name)}</span><span class="icw-lab">${x.bands} b</span></label>`).join("") || `<div class="icw-empty">No raster yet. File → Add folder…</div>`}
    ${res ? `<div class="icw-cap">Results</div>${res}` : ""}
    ${S.result ? `<label class="icw-row"><span class="icw-grow">Result opacity</span><span class="icw-lab" data-w="opv">${Math.round((S.opacity ?? 0.8) * 100)}%</span></label><input type="range" class="icw-rg" min="0" max="1" step="0.05" value="${S.opacity ?? 0.8}" data-wk="opacity" aria-label="Result opacity">` : ""}
    <label class="icw-row"><input type="checkbox" data-wk="showSamples"${S.hideSamples ? "" : " checked"}><span class="icw-grow">Training samples</span><span class="icw-lab">${nf(S.samples.length)}</span></label>
    ${legend ? `<div class="icw-cap">Legend · ${esc(S.result.name)}</div>${legend}` : ""}
  </div>`;
}

function winStatus() {
  const el = wq("[data-w=status]");
  if (!el) return;
  const c = S.cursorInfo;
  el.innerHTML = `<span>${c ? esc(c.coord) : "–"}</span>${c?.value ? `<span>${esc(c.value)}</span>` : ""}${c?.cls ? `<span>class ${esc(c.cls)}</span>` : ""}<span>${S.stack ? `${nf(S.stack.grid.width)} × ${nf(S.stack.grid.height)} · EPSG:${S.stack.grid.epsg}` : ""}</span><span class="icw-sp"></span><span data-w="prog">${S.busy ? "Working…" : "Ready"}</span><span>Linked to GeoLibre</span>`;
}

function viewNote() {
  return { map: S.tool === "pan" ? "Drag to pan, wheel to zoom" : "Drawing: the image does not move; pick the hand to pan", split: "Drag the handle or the slider", charts: "Charts stay white for export", acc: S.result?.accTest ? `${nf(S.result.accTest.n)} test pixels` : "", change: "Two results on the same grid", log: "" }[S.view] ?? "";
}

// ================================================================ centre views

function renderView() {
  const el = wq("[data-w=view]");
  if (!el) return;
  if (S.view === "map" || S.view === "split") {
    if (!el.querySelector(".icw-viewer") || el.dataset.kind !== S.view) {
      el.dataset.kind = S.view;
      el.innerHTML = S.view === "split" ? splitBar() + `<div class="icw-viewer" data-w="viewer"><canvas></canvas></div>` : `<div class="icw-viewer" data-w="viewer"><canvas></canvas><div class="icw-zoom"><button type="button" data-do="w:zin" aria-label="Zoom in">+</button><button type="button" data-do="w:zout" aria-label="Zoom out">−</button><button type="button" data-do="w:fit" aria-label="Zoom to image">${wIco(WI.fit, 13)}</button></div></div>`;
      bindViewer(el.querySelector("[data-w=viewer]"));
    } else if (S.view === "split") el.querySelector(".icw-splitbar").outerHTML = splitBar();
    ensureViewImages().then(drawViewer);
    drawViewer();
    return;
  }
  el.dataset.kind = S.view;
  S.viewer = null;
  el.innerHTML = `<div class="icw-scroll icw-pad">${S.view === "charts" ? chartsView() : S.view === "acc" ? accView() : S.view === "change" ? changeView() : logView()}</div>`;
}

function splitBar() {
  const opts = layerChoices(), pick = (side) => opt(opts, S.split[side]);
  return `<div class="icw-splitbar"><label class="icw-f"><span>Before (left)</span><select data-wk="splitL">${pick("left")}</select></label><label class="icw-f"><span>After (right)</span><select data-wk="splitR">${pick("right")}</select></label>
    <div class="icw-seg" role="group" aria-label="Split mode"><button type="button" class="${S.split.mode === "swipe" ? "on" : ""}" data-split="swipe">Swipe</button><button type="button" class="${S.split.mode === "side" ? "on" : ""}" data-split="side">Side by side</button></div>
    <label class="icw-f icw-grow"><span>Position</span><input type="range" class="icw-rg" min="0" max="100" value="${S.split.pos}" data-wk="splitPos" aria-label="Split position"></label></div>`;
}
function layerChoices() {
  const out = [];
  for (const x of imageSets()) out.push(["img:" + x.key, "Image · " + x.name]);
  S.results.forEach((r, i) => out.push(["res:" + i, "Result · " + r.name]));
  if (!S.split.left && out.length) S.split.left = out[0][0];
  if (!S.split.right && out.length) S.split.right = (out.find((o) => o[0].startsWith("res:")) ?? out[out.length - 1])[0];
  return out;
}

// ---------------------------------------------------------------- viewer: canvas with pan, zoom and the drawing tools

S.imgCache = new Map(); // key -> { canvas, grid }
async function ensureViewImages() {
  try {
    if (!selectedBands().length) return;
    const st = await ensureStack();
    const k = "img:" + activeSet() + "|" + st.key + "|" + compChannels().join(",");
    if (!S.imgCache.has(k)) S.imgCache.set(k, { canvas: compositeCanvas(st), grid: st.grid });
    S.baseKey = k;
    S.imgCache.set("img:" + activeSet(), S.imgCache.get(k));
    if (!S.vp) fitView();
  } catch (e) { say(e?.message ?? String(e)); }
}
function compositeCanvas(st) {
  const fc = featureCache(st), names = compChannels(), L = names.map((nm) => fc.layers[fc.names.indexOf(nm)]).map((x, i, a) => x ?? a.find(Boolean) ?? fc.layers[0]);
  const g = st.grid, n = g.width * g.height, rgb = compositeRgb(L[0], L[1], L[2], n, st.valid);
  const cv = document.createElement("canvas"); cv.width = g.width; cv.height = g.height;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(g.width, g.height);
  for (let i = 0; i < n; i++) { im.data[i * 4] = rgb[i * 3]; im.data[i * 4 + 1] = rgb[i * 3 + 1]; im.data[i * 4 + 2] = rgb[i * 3 + 2]; im.data[i * 4 + 3] = st.valid[i] ? 255 : 0; }
  ctx.putImageData(im, 0, 0);
  return cv;
}
function classCanvas(r) {
  const key = "res:" + S.results.indexOf(r) + ":" + (r.version ?? 0);
  if (S.imgCache.has(key)) return S.imgCache.get(key).canvas;
  const g = r.grid, n = g.width * g.height, cv = document.createElement("canvas"); cv.width = g.width; cv.height = g.height;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(g.width, g.height), pal = new Map(r.classes.map((c) => [c.code, hexToRgb(c.color)]));
  for (let i = 0; i < n; i++) { const p = pal.get(r.cls[i]); if (!p) continue; im.data[i * 4] = p[0]; im.data[i * 4 + 1] = p[1]; im.data[i * 4 + 2] = p[2]; im.data[i * 4 + 3] = 255; }
  ctx.putImageData(im, 0, 0);
  S.imgCache.set(key, { canvas: cv, grid: g });
  return cv;
}
function layerCanvas(choice) {
  if (!choice) return null;
  if (choice.startsWith("res:")) { const r = S.results[+choice.slice(4)]; return r ? classCanvas(r) : null; }
  return S.imgCache.get(choice)?.canvas ?? null;
}
function viewGrid() { return S.stack?.grid ?? S.result?.grid ?? null; }
function fitView() {
  const g = viewGrid(), box = S.viewer?.el;
  if (!g || !box) return;
  const W = box.clientWidth || 800, H = box.clientHeight || 600, k = Math.min(W / g.width, H / g.height) * 0.96;
  S.vp = { k, x: (W - g.width * k) / 2, y: (H - g.height * k) / 2 };
}
/** lon/lat -> grid pixel (fractional). */
function llToPx(p, g) {
  const q = g.geographic ? p : g.toCrs(p);
  return [((q[0] - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * g.width, ((g.bounds[3] - q[1]) / (g.bounds[3] - g.bounds[1])) * g.height];
}
function pxToLl(x, y, g) {
  const q = [g.bounds[0] + (x / g.width) * (g.bounds[2] - g.bounds[0]), g.bounds[3] - (y / g.height) * (g.bounds[3] - g.bounds[1])];
  return g.geographic ? q : g.toLL(q);
}
function bindViewer(el) {
  const cv = el.querySelector("canvas");
  S.viewer = { el, cv };
  const ro = new ResizeObserver(() => { if (!S.vp) fitView(); drawViewer(); });
  ro.observe(el);
  const toPx = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - S.vp.x) / S.vp.k, (e.clientY - r.top - S.vp.y) / S.vp.k]; };
  let drag = null;
  el.addEventListener("wheel", (e) => {
    if (!S.vp) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    S.vp = { k: S.vp.k * f, x: mx - (mx - S.vp.x) * f, y: my - (my - S.vp.y) * f };
    drawViewer();
  }, { passive: false });
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !S.vp) return;
    if (S.view === "split" && S.split.mode === "swipe" && Math.abs(e.clientX - cv.getBoundingClientRect().left - (cv.clientWidth * S.split.pos) / 100) < 12) { drag = { split: true }; return; }
    const g = viewGrid();
    if (S.tool === "pan" || S.view === "split" || !g) { drag = { pan: true, x: e.clientX, y: e.clientY, vx: S.vp.x, vy: S.vp.y }; el.classList.add("grabbing"); return; }
    const [px, py] = toPx(e);
    if ((S.tool === "rect" || S.tool === "circle") && !S.draft.length) drag = { shape: true, start: pxToLl(px, py, g), sx: e.clientX, sy: e.clientY };
  });
  window.addEventListener("mousemove", (e) => {
    if (!S.viewer || S.viewer.el !== el) return;
    if (drag?.split) { const r = cv.getBoundingClientRect(); S.split.pos = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); drawViewer(); return; }
    if (drag?.pan) { S.vp.x = drag.vx + e.clientX - drag.x; S.vp.y = drag.vy + e.clientY - drag.y; drawViewer(); return; }
    const g = viewGrid();
    if (!g || !S.vp || e.target.closest?.(".icw-viewer") !== el) return;
    const [px, py] = toPx(e), ll = pxToLl(px, py, g);
    if (drag?.shape && !S.draft.length && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { S.draft = [drag.start]; drag.dragging = true; }
    S.cursor = ll;
    hoverInfo(px, py, ll);
    if (S.draft.length) drawViewer();
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag || !S.viewer || S.viewer.el !== el) return;
    el.classList.remove("grabbing");
    if (drag.split) { drag = null; const i = wq("[data-wk=splitPos]"); if (i) i.value = S.split.pos; return; }
    const d = drag; drag = null;
    // a rectangle or circle dragged out in one stroke; the click that follows the release must not start another
    if (d.shape && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) {
      const g = viewGrid(), [px, py] = toPx(e);
      S.draft = [d.start];
      S.skipClick = true;
      finishShape(pxToLl(px, py, g));
    }
  });
  el.addEventListener("click", (e) => {
    if (S.skipClick) { S.skipClick = false; return; }
    if (S.tool === "pan" || S.view === "split" || !S.vp || (S.tool === "polygon" && e.detail > 1)) return;
    const g = viewGrid();
    if (!g) return say("Load an image first: File → Add folder.");
    const [px, py] = toPx(e), p = pxToLl(px, py, g);
    if (S.tool === "point") return commitSample({ type: "Point", coordinates: p });
    if (S.tool === "rect" || S.tool === "circle") { if (!S.draft.length) { S.draft = [p]; drawViewer(); return; } return finishShape(p); }
    if (S.draft.length >= 3) { const a = llToPx(S.draft[0], g); if (Math.hypot((a[0] - px) * S.vp.k, (a[1] - py) * S.vp.k) <= 10) return finishPolygon(); }
    S.draft.push(p);
    drawViewer();
  });
  el.addEventListener("dblclick", (e) => { if (S.tool === "polygon" && S.draft.length >= 3) { e.preventDefault(); finishPolygon(); } });
  el.addEventListener("mouseleave", () => { S.cursorInfo = null; winStatus(); });
}
function finishShape(p) {
  const a = S.draft[0];
  if (S.tool === "rect" && (a[0] === p[0] || a[1] === p[1])) { S.draft = []; drawViewer(); return; }
  const ring = S.tool === "rect" ? rectRing(a, p) : circleRing(a, p);
  commitSample({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
}
function hoverInfo(px, py, ll) {
  const g = viewGrid(), x = Math.floor(px), y = Math.floor(py), inside = x >= 0 && y >= 0 && x < g.width && y < g.height, k = y * g.width + x;
  let value = "", cls = "";
  if (inside && S.stack && S.stack.grid.width === g.width) {
    const fc = S.fcache, bits = [];
    if (fc) for (let i = 0; i < Math.min(fc.names.length, 4); i++) { const v = fc.layers[i][k]; if (Number.isFinite(v)) bits.push(`${n0(fc.names[i])} ${fmtVal(v)}`); }
    value = bits.join(" · ");
  }
  if (inside && S.result && S.result.grid.width === g.width) { const c = S.result.cls[k], m = S.result.classes.find((q) => q.code === c); if (m) cls = `${c} ${m.name}`; }
  S.cursorInfo = { coord: `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`, value, cls };
  winStatus();
}
function drawViewer() {
  const v = S.viewer;
  if (!v || !v.el.isConnected) return;
  const cv = v.cv, W = v.el.clientWidth, H = v.el.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H);
  const g = viewGrid();
  if (!g) { ctx.fillStyle = "#9ca3af"; ctx.font = "13px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(S.sources.length ? "Reading bands…" : "No image yet. File → Add folder of GeoTIFFs", W / 2, H / 2); return; }
  if (!S.vp) fitView();
  const { k, x, y } = S.vp;
  ctx.imageSmoothingEnabled = false;
  const put = (img, alpha = 1) => { if (!img) return; ctx.globalAlpha = alpha; ctx.drawImage(img, x, y, g.width * k, g.height * k); ctx.globalAlpha = 1; };
  if (S.view === "split") {
    const L = layerCanvas(S.split.left), R = layerCanvas(S.split.right);
    if (S.split.mode === "side") {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W / 2 - 1, H); ctx.clip(); put(L); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(W / 2 + 1, 0, W / 2, H); ctx.clip(); ctx.translate(W / 2, 0); put(R); ctx.restore();
      ctx.fillStyle = "#2a2a31"; ctx.fillRect(W / 2 - 1, 0, 2, H);
    } else {
      const sx = (W * S.split.pos) / 100;
      put(L);
      ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, W - sx, H); ctx.clip(); put(R); ctx.restore();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(sx - 1, 0, 2, H);
      ctx.beginPath(); ctx.arc(sx, H / 2, 15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(sx - 4, H / 2 - 5); ctx.lineTo(sx - 9, H / 2); ctx.lineTo(sx - 4, H / 2 + 5); ctx.moveTo(sx + 4, H / 2 - 5); ctx.lineTo(sx + 9, H / 2); ctx.lineTo(sx + 4, H / 2 + 5); ctx.stroke();
    }
    const tag = (t, tx, align) => { ctx.font = "600 12px Inter, sans-serif"; const w = ctx.measureText(t).width + 16; const bx = align === "right" ? tx - w : tx; ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(bx, 10, w, 24); ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(t, bx + 8, 26); };
    const nm = (c) => layerChoices().find((o) => o[0] === c)?.[1] ?? "";
    tag("Before · " + nm(S.split.left).replace(/^(Image|Result) · /, ""), 10, "left");
    tag("After · " + nm(S.split.right).replace(/^(Image|Result) · /, ""), (S.split.mode === "side" ? W - 10 : W - 10), "right");
    return;
  }
  put(S.imgCache.get(S.baseKey)?.canvas);
  if (S.result && S.result.grid.width === g.width && S.result.grid.height === g.height) put(classCanvas(S.result), S.opacity ?? 0.8);
  // samples and sketch
  const P = (ll) => { const p = llToPx(ll, g); return [x + p[0] * k, y + p[1] * k]; };
  if (!S.hideSamples) for (const c of S.classes) for (const s of S.samples) {
    if (s.code !== c.code) continue;
    const gm = s.geometry;
    ctx.strokeStyle = c.color; ctx.fillStyle = c.color; ctx.lineWidth = 2;
    if (gm.type === "Point" || gm.type === "MultiPoint") for (const q of gm.type === "Point" ? [gm.coordinates] : gm.coordinates) { const [a, b] = P(q); ctx.beginPath(); ctx.arc(a, b, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
    else for (const poly of gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates) {
      ctx.beginPath(); for (const r of poly) r.forEach((q, i) => { const [a, b] = P(q); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.globalAlpha = 0.25; ctx.fill("evenodd"); ctx.globalAlpha = 1; ctx.stroke();
    }
  }
  if (S.draft.length) {
    const col = activeClass()?.color ?? COLORS[0], cur = S.cursor;
    let ring = S.tool === "rect" && cur ? rectRing(S.draft[0], cur) : S.tool === "circle" && cur ? circleRing(S.draft[0], cur) : [...S.draft, ...(cur ? [cur] : [])];
    ctx.setLineDash([6, 4]); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    ring.forEach((q, i) => { const [a, b] = P(q); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
    if (ring.length > 2) ctx.closePath();
    ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); ctx.setLineDash([]);
    for (const q of S.draft) { const [a, b] = P(q); ctx.beginPath(); ctx.arc(a, b, 4, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = col; ctx.stroke(); }
  }
  v.el.classList.toggle("drawing", S.tool !== "pan");
}

// ================================================================ charts (white in every theme)

/** matplotlib-style confusion or change matrix: square Blues cells, colour bar, axis titles, dashed grid. */
function matrixSvg(id, o) {
  const K = o.rows.length, side = Math.min(360, Math.max(200, K * 56)), cs = side / K, L = 30 + Math.max(...o.rowNames.map((n) => tw(n, 11))), T = o.title ? 52 : 30, W = L + side + 96, H = T + side + 54;
  const vmax = o.vmax ?? Math.max(1, ...o.rows.flat()), x0 = L, y0 = T;
  let s = svgOpen(id, W, H, o.title || o.label) + `<defs><linearGradient id="${id}-cb" x1="0" x2="0" y1="1" y2="0">${HEAT_STOPS.map((c, i) => `<stop offset="${(i / (HEAT_STOPS.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`;
  if (o.title) s += `<text x="${x0 + side / 2}" y="20" text-anchor="middle" font-size="16" fill="#111827">${esc(o.title)}</text>`;
  o.rows.forEach((r, i) => r.forEach((v, j) => {
    const t = Math.min(1, (o.share ? v / (r.reduce((a, b) => a + b, 0) || 1) : v / vmax)), x = x0 + j * cs, y = y0 + i * cs;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" fill="${blues(t)}"/>`;
    s += `<text x="${(x + cs / 2).toFixed(1)}" y="${(y + cs / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${cs > 50 ? 13 : 11}" fill="${t > 0.5 ? "#ffffff" : "#111827"}">${esc(o.fmt ? o.fmt(v) : nf(v))}</text>`;
  }));
  for (let i = 0; i < K; i++) {
    const c = x0 + (i + 0.5) * cs, r = y0 + (i + 0.5) * cs;
    s += `<line x1="${c.toFixed(1)}" x2="${c.toFixed(1)}" y1="${y0}" y2="${y0 + side}" stroke="#9ca3af" stroke-opacity=".55" stroke-dasharray="3 3"/><line x1="${x0}" x2="${x0 + side}" y1="${r.toFixed(1)}" y2="${r.toFixed(1)}" stroke="#9ca3af" stroke-opacity=".55" stroke-dasharray="3 3"/>`;
    s += `<text x="${c.toFixed(1)}" y="${y0 - 7}" text-anchor="middle" font-size="11" fill="#111827">${esc(o.colNames[i])}</text><line x1="${c.toFixed(1)}" x2="${c.toFixed(1)}" y1="${y0 + side}" y2="${y0 + side + 4}" stroke="#111827"/>`;
    s += `<text x="${x0 - 7}" y="${r.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="11" fill="#111827">${esc(o.rowNames[i])}</text><line x1="${x0 - 4}" x2="${x0}" y1="${r.toFixed(1)}" y2="${r.toFixed(1)}" stroke="#111827"/>`;
  }
  s += `<rect x="${x0}" y="${y0}" width="${side}" height="${side}" fill="none" stroke="#111827"/>`;
  s += `<text x="${x0 + side / 2}" y="${y0 + side + 30}" text-anchor="middle" font-size="13" fill="#111827">${esc(o.xLabel)}</text><text transform="translate(14,${y0 + side / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#111827">${esc(o.yLabel)}</text>`;
  const cbx = x0 + side + 18;
  s += `<rect x="${cbx}" y="${y0}" width="14" height="${side}" fill="url(#${id}-cb)" stroke="#111827" stroke-width=".8"/>`;
  const top = o.share ? 1 : vmax, ticks = niceTicks(0, top, 5).ticks.filter((t) => t <= top + 1e-9);
  for (const t of ticks) { const y = y0 + side - (t / top) * side; s += `<line x1="${cbx + 14}" x2="${cbx + 18}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#111827"/><text x="${cbx + 21}" y="${y.toFixed(1)}" dominant-baseline="central" font-size="10" fill="#111827">${o.share ? Math.round(t * 100) + "%" : nf(t)}</text>`; }
  s += `<text transform="translate(${W - 8},${y0 + side / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="#111827">${esc(o.cbLabel)}</text>`;
  return s + svgClose(id);
}
const HEAT_STOPS = ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"];
function blues(t) {
  const C = HEAT_STOPS.map(hexToRgb), x = Math.max(0, Math.min(1, t)) * (C.length - 1), i = Math.min(C.length - 2, Math.floor(x)), f = x - i;
  return "rgb(" + C[i].map((c, q) => Math.round(c + (C[i + 1][q] - c) * f)).join(",") + ")";
}
const COOL = ["#3b4cc0", "#8db0fe", "#dddcdc", "#f49a7b", "#b40426"];
function coolwarm(r) {
  const C = COOL.map(hexToRgb), x = ((Math.max(-1, Math.min(1, r)) + 1) / 2) * (C.length - 1), i = Math.min(C.length - 2, Math.floor(x)), f = x - i;
  return "rgb(" + C[i].map((c, q) => Math.round(c + (C[i + 1][q] - c) * f)).join(",") + ")";
}
/** seaborn-style annotated correlation heatmap (coolwarm, −1 … 1). */
function corrSvg(id, names, R) {
  const K = names.length, side = Math.min(480, Math.max(240, K * 40)), cs = side / K, L = 20 + Math.max(...names.map((n) => tw(n, 11))), W = L + side + 80, H = 14 + side + 20 + Math.max(...names.map((n) => tw(n, 11)));
  let s = svgOpen(id, W, H, "Input correlation") + `<defs><linearGradient id="${id}-cb" x1="0" x2="0" y1="1" y2="0">${COOL.map((c, i) => `<stop offset="${i / (COOL.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`;
  R.forEach((r, i) => r.forEach((v, j) => {
    const x = L + j * cs, y = 10 + i * cs;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" fill="${coolwarm(v)}"/>`;
    s += `<text x="${(x + cs / 2).toFixed(1)}" y="${(y + cs / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${cs > 36 ? 11 : 9}" fill="${Math.abs(v) > 0.7 ? "#ffffff" : "#111827"}">${Math.abs(v - 1) < 1e-9 ? "1" : v.toFixed(2).replace(/^(-?)0\./, "$1.")}</text>`;
  }));
  names.forEach((nm, i) => {
    const c = L + (i + 0.5) * cs, r = 10 + (i + 0.5) * cs;
    s += `<text x="${L - 6}" y="${r.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="11" fill="#111827">${esc(nm)}</text>`;
    s += `<text transform="translate(${c.toFixed(1)},${14 + side}) rotate(-90)" text-anchor="end" dominant-baseline="central" font-size="11" fill="#111827">${esc(nm)}</text>`;
  });
  const cbx = L + side + 18;
  s += `<rect x="${cbx}" y="10" width="14" height="${side}" fill="url(#${id}-cb)"/>`;
  for (const t of [-1, -0.5, 0, 0.5, 1]) { const y = 10 + side - ((t + 1) / 2) * side; s += `<line x1="${cbx + 14}" x2="${cbx + 18}" y1="${y}" y2="${y}" stroke="#111827"/><text x="${cbx + 21}" y="${y}" dominant-baseline="central" font-size="10" fill="#111827">${t.toFixed(2)}</text>`; }
  return s + svgClose(id);
}
function donutSvg(id, items, centre, unit) {
  const W = 560, H = 280, cx = 140, cy = 140, r1 = 118, r0 = 66, tot = items.reduce((a, b) => a + b.value, 0) || 1;
  let s = svgOpen(id, W, H, "Class areas"), acc = 0;
  const pt = (r, a) => [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)];
  for (const it of items) {
    if (!it.value) continue;
    const a0 = (acc / tot) * 2 * Math.PI; acc += it.value; const a1 = (acc / tot) * 2 * Math.PI - 1e-6, big = a1 - a0 > Math.PI ? 1 : 0;
    s += `<path d="M${pt(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${pt(r0, a0)}Z" fill="${esc(it.color)}" stroke="#ffffff" stroke-width="2"/>`;
  }
  s += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${esc(centre)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="#4b5563">${esc(unit)}</text>`;
  items.forEach((it, i) => {
    const y = 40 + i * Math.min(28, 210 / Math.max(1, items.length));
    s += `<rect x="300" y="${y - 6}" width="12" height="12" fill="${esc(it.color)}"/><text x="320" y="${y}" dominant-baseline="central" font-size="12" fill="#111827">${esc(it.name)}</text><text x="540" y="${y}" text-anchor="end" dominant-baseline="central" font-size="12" font-weight="600" fill="#111827">${nf((it.value / tot) * 100, 1)}%</text>`;
  });
  return s + svgClose(id);
}
/** Spectral profile against wavelength, band numbers on top, ±1 SD of the selected class on a second axis. */
function profileSvg(id, prof) {
  const W = 760, H = 320, x0 = 70, x1 = 560, y0 = 270, y1 = 50;
  const nmMin = Math.min(...prof.nm) - 60, nmMax = Math.max(...prof.nm) + 60;
  const top = niceTicks(0, Math.max(...prof.lines.flatMap((l) => l.mean.map((m, i) => m + (l.sd[i] ?? 0)))), 6), sdTop = niceTicks(0, Math.max(1e-6, ...prof.lines.flatMap((l) => l.sd)), 5);
  const X = (w) => x0 + ((w - nmMin) / (nmMax - nmMin)) * (x1 - x0), Y = (v) => y0 - (v / top.hi) * (y0 - y1), Y2 = (v) => y0 - (v / sdTop.hi) * (y0 - y1);
  let s = svgOpen(id, W, H, "Spectral profile");
  s += `<text x="${(x0 + x1) / 2}" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">${esc(prof.sensor)} bands</text>`;
  prof.nm.forEach((w, i) => { s += `<text x="${X(w).toFixed(1)}" y="${i % 2 ? 44 : 34}" text-anchor="middle" font-size="10.5" fill="#111827">${esc(prof.bands[i])}</text>`; });
  for (const w of prof.markers) s += `<line x1="${X(w).toFixed(1)}" x2="${X(w).toFixed(1)}" y1="${y1}" y2="${y0}" stroke="#111827" stroke-dasharray="4 3" stroke-width=".9"/>`;
  s += `<rect x="${x0}" y="${y1}" width="${x1 - x0}" height="${y0 - y1}" fill="none" stroke="#111827"/>`;
  for (const t of top.ticks) s += `<line x1="${x0 - 4}" x2="${x0}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="#111827"/><text x="${x0 - 7}" y="${Y(t).toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="11" fill="#111827">${tickFmt(t, top.step)}</text>`;
  for (const t of sdTop.ticks) s += `<line x1="${x1}" x2="${x1 + 4}" y1="${Y2(t).toFixed(1)}" y2="${Y2(t).toFixed(1)}" stroke="#111827"/><text x="${x1 + 7}" y="${Y2(t).toFixed(1)}" dominant-baseline="central" font-size="11" fill="#111827">${tickFmt(t, sdTop.step)}</text>`;
  for (const t of niceTicks(nmMin, nmMax, 8).ticks.filter((t) => t >= nmMin && t <= nmMax)) s += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${y0}" y2="${y0 + 4}" stroke="#111827"/><text x="${X(t).toFixed(1)}" y="${y0 + 16}" text-anchor="middle" font-size="11" fill="#111827">${t}</text>`;
  s += `<text x="${(x0 + x1) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">Wavelength (nm)</text>`;
  s += `<text transform="translate(18,${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">${esc(prof.yLabel)}</text>`;
  s += `<text transform="translate(${x1 + 52},${(y0 + y1) / 2}) rotate(90)" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">Standard deviation</text>`;
  const sel = prof.lines.find((l) => l.active) ?? prof.lines[0];
  if (sel) sel.mean.forEach((m, i) => {
    const x = X(prof.nm[i]), sd = sel.sd[i];
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(m + sd).toFixed(1)}" y2="${Y(Math.max(0, m - sd)).toFixed(1)}" stroke="#6b7280"/><line x1="${x - 3}" x2="${x + 3}" y1="${Y(m + sd).toFixed(1)}" y2="${Y(m + sd).toFixed(1)}" stroke="#6b7280"/><line x1="${x - 3}" x2="${x + 3}" y1="${Y(Math.max(0, m - sd)).toFixed(1)}" y2="${Y(Math.max(0, m - sd)).toFixed(1)}" stroke="#6b7280"/>`;
    s += `<rect x="${(x - 3.5).toFixed(1)}" y="${(Y2(sd) - 3.5).toFixed(1)}" width="7" height="7" fill="#ffffff" stroke="#374151"/>`;
  });
  prof.lines.forEach((l, k) => {
    s += `<path d="M${l.mean.map((m, i) => X(prof.nm[i]).toFixed(1) + " " + Y(m).toFixed(1)).join("L")}" fill="none" stroke="${esc(l.color)}" stroke-width="${l.active ? 2.8 : 2}" stroke-dasharray="${k % 3 === 2 ? "7 4" : k % 3 === 1 && k > 3 ? "2 3" : ""}" stroke-linejoin="round"/>`;
    const y = 64 + k * 22;
    s += `<line x1="610" x2="640" y1="${y}" y2="${y}" stroke="${esc(l.color)}" stroke-width="2.2" stroke-dasharray="${k % 3 === 2 ? "7 4" : k % 3 === 1 && k > 3 ? "2 3" : ""}"/><text x="648" y="${y}" dominant-baseline="central" font-size="12" fill="#111827">${esc(l.name)}</text>`;
  });
  const ly = 64 + prof.lines.length * 22;
  s += `<line x1="610" x2="640" y1="${ly}" y2="${ly}" stroke="#6b7280"/><rect x="621.5" y="${ly - 3.5}" width="7" height="7" fill="#fff" stroke="#374151"/><text x="648" y="${ly}" dominant-baseline="central" font-size="12" fill="#111827">±1 SD (${esc(sel?.name ?? "")})</text>`;
  return s + svgClose(id);
}
function sankeySvg(id, T, from, to, colors, labels) {
  const W = 620, H = 360, K = T.length, row = T.map((r) => r.reduce((a, b) => a + b, 0)), col = T[0].map((_, j) => T.reduce((a, r) => a + r[j], 0)), tot = row.reduce((a, b) => a + b, 0) || 1;
  const gap = 8, sc = (H - 60 - (K - 1) * gap) / tot, xl = 160, xr = 448;
  const place = (v) => { let y = 24; return v.map((q) => { const o = { y, h: q * sc }; y += q * sc + gap; return o; }); };
  const L = place(row), R = place(col), lo = new Array(K).fill(0), ro = new Array(K).fill(0);
  let s = svgOpen(id, W, H, "Sankey diagram");
  T.forEach((r, i) => r.forEach((v, j) => {
    const h = v * sc; if (h < 0.2) return;
    const ya = L[i].y + lo[i], yb = R[j].y + ro[j]; lo[i] += h; ro[j] += h;
    const a = xl + 12, b = xr, m = (a + b) / 2;
    s += `<path d="M${a} ${ya.toFixed(2)}C${m} ${ya.toFixed(2)} ${m} ${yb.toFixed(2)} ${b} ${yb.toFixed(2)}L${b} ${(yb + h).toFixed(2)}C${m} ${(yb + h).toFixed(2)} ${m} ${(ya + h).toFixed(2)} ${a} ${(ya + h).toFixed(2)}Z" fill="${esc(colors[i])}" fill-opacity="${i === j ? 0.28 : 0.6}"><title>${esc(labels[i])} → ${esc(labels[j])}: ${nf(v, 1)} ha</title></path>`;
  }));
  labels.forEach((nm, i) => {
    s += `<rect x="${xl}" y="${L[i].y.toFixed(2)}" width="12" height="${Math.max(0.5, L[i].h).toFixed(2)}" fill="${esc(colors[i])}"/><text x="${xl - 6}" y="${(L[i].y + L[i].h / 2 - 6).toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="11" fill="#111827">${esc(nm)}</text><text x="${xl - 6}" y="${(L[i].y + L[i].h / 2 + 7).toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="10" fill="#6b7280">${nf(row[i])} ha</text>`;
    s += `<rect x="${xr}" y="${R[i].y.toFixed(2)}" width="12" height="${Math.max(0.5, R[i].h).toFixed(2)}" fill="${esc(colors[i])}"/><text x="${xr + 18}" y="${(R[i].y + R[i].h / 2 - 6).toFixed(1)}" dominant-baseline="central" font-size="11" fill="#111827">${esc(nm)}</text><text x="${xr + 18}" y="${(R[i].y + R[i].h / 2 + 7).toFixed(1)}" dominant-baseline="central" font-size="10" fill="#6b7280">${nf(col[i])} ha</text>`;
  });
  s += `<text x="${xl + 6}" y="${H - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#111827">${esc(from)}</text><text x="${xr + 6}" y="${H - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#111827">${esc(to)}</text>`;
  return s + svgClose(id);
}
function gainsSvg(id, names, colors, deltas) {
  const W = 760, rowH = 30, H = 40 + names.length * rowH + 30, mx = niceTicks(0, Math.max(1, ...deltas.map(Math.abs)), 4), cx = 430, half = 270, X = (v) => cx + (v / mx.hi) * half;
  let s = svgOpen(id, W, H, "Gains and losses");
  for (const t of [...mx.ticks.map((t) => -t).reverse(), ...mx.ticks.slice(1)]) s += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="14" y2="${H - 30}" stroke="#e5e7eb"/><text x="${X(t).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="10.5" fill="#374151">${t > 0 ? "+" : ""}${nf(t)}</text>`;
  s += `<line x1="${cx}" x2="${cx}" y1="14" y2="${H - 30}" stroke="#374151"/>`;
  deltas.forEach((d, i) => {
    const y = 22 + i * rowH, x = d >= 0 ? cx : X(d), w = Math.abs(X(d) - cx);
    s += `<text x="150" y="${y + 10}" text-anchor="end" dominant-baseline="central" font-size="11.5" fill="#374151">${esc(names[i])}</text><rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="20" fill="${d >= 0 ? "#1890ff" : "#fa8c16"}"/>`;
    s += `<text x="${(d >= 0 ? X(d) + 6 : X(d) - 6).toFixed(1)}" y="${y + 10}" text-anchor="${d >= 0 ? "start" : "end"}" dominant-baseline="central" font-size="11" fill="#111827">${d >= 0 ? "+" : "−"}${nf(Math.abs(d), 1)} ha</text>`;
  });
  return s + svgClose(id);
}

// ---------------------------------------------------------------- views built from cards

function chartsView() {
  const r = S.result;
  buildCards(r);
  const ids = ["matrix", "areas", "importance", "profile", "corr"].filter((id) => S.cards[id]);
  if (!ids.length) return `<div class="icw-empty big">Charts appear once there is an image (spectral profile, input correlation) and a result (confusion matrix, class areas, variable importance).</div>`;
  return `<div class="icw-cards icl-white">${ids.map((id) => `<div class="${id === "profile" || id === "corr" ? "wide" : ""}">${card(id)}</div>`).join("")}</div>`;
}
function buildCards(r) {
  const keep = { profile: S.cards.profile, corr: S.cards.corr };
  S.cards = {};
  if (r) {
    const nm = (c) => r.classes.find((x) => x.code === c)?.name ?? "Class " + c, a = r.accTest;
    if (a) S.cards.matrix = {
      title: "Confusion matrix", chartLabel: "Heatmap", file: "confusion_matrix",
      chart: () => matrixSvg("matrix", { title: S.exporting ? "Confusion Matrix" : "", rows: a.matrix, rowNames: r.codes.map(nm), colNames: r.codes.map(nm), xLabel: "Predicted label", yLabel: "True label", cbLabel: "Number of pixels" }),
      table: () => `<table class="icl-table"><thead><tr><th>True \\ Predicted</th>${r.codes.map((c) => `<th>${esc(nm(c))}</th>`).join("")}<th>PA %</th></tr></thead><tbody>${a.matrix.map((row, k) => `<tr><td>${esc(nm(r.codes[k]))}</td>${row.map((v, j) => `<td${j === k ? ' class="d"' : ""}>${nf(v)}</td>`).join("")}<td>${pct(a.pa[k])}</td></tr>`).join("")}<tr><td>UA %</td>${a.ua.map((v) => `<td>${pct(v)}</td>`).join("")}<td></td></tr></tbody></table>`,
      sheets: () => accuracySheets(r),
    };
    const tot = r.codes.reduce((s, c) => s + r.areas.area[c], 0) || 1;
    S.cards.areas = {
      title: "Class areas", file: "class_areas",
      chart: () => donutSvg("areas", r.codes.map((c) => ({ name: nm(c), color: r.classes.find((x) => x.code === c)?.color ?? "#888", value: r.areas.area[c] / 1e4 })), nf(tot / 1e4), "ha"),
      table: () => `<table class="icl-table"><thead><tr><th>Class</th><th>Area (ha)</th><th>Share %</th></tr></thead><tbody>${r.codes.map((c) => `<tr><td>${esc(nm(c))}</td><td>${nf(r.areas.area[c] / 1e4, 2)}</td><td>${nf((r.areas.area[c] / tot) * 100, 2)}</td></tr>`).join("")}</tbody></table>`,
      sheets: () => [{ name: "Class areas", widths: [10, 28, 16, 12], rows: [[{ v: "Code", bold: true }, { v: "Class", bold: true }, { v: "Area (ha)", bold: true }, { v: "Share (%)", bold: true }], ...r.codes.map((c) => [c, nm(c), +(r.areas.area[c] / 1e4).toFixed(2), +((r.areas.area[c] / tot) * 100).toFixed(2)])] }],
    };
    if (r.model?.importance) {
      const list = r.names.map((n, i) => [n0(n), r.model.importance[i]]).sort((x, y) => y[1] - x[1]);
      S.cards.importance = {
        title: "Variable importance", file: "variable_importance",
        chart: () => barChart("importance", { title: S.exporting ? "Variable importance" : "", label: "Variable importance", xLabel: "Importance (%)", rows: list.slice(0, 15).map(([n, v]) => ({ name: n, value: v * 100, color: "#1890ff", label: nf(v * 100, 1) + "%" })) }),
        table: () => `<table class="icl-table"><thead><tr><th>Input</th><th>Importance %</th></tr></thead><tbody>${list.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${nf(v * 100, 2)}</td></tr>`).join("")}</tbody></table>`,
        sheets: () => [{ name: "Variable importance", widths: [24, 16], rows: [[{ v: "Input", bold: true }, { v: "Importance (%)", bold: true }], ...list.map(([n, v]) => [n, +(v * 100).toFixed(3)])] }],
      };
    }
  }
  if (keep.profile) S.cards.profile = keep.profile;
  if (keep.corr) S.cards.corr = keep.corr;
  if (!S.statsBusy && S.stack && S.cardsKey !== statsKey()) computeStats();
}
const statsKey = () => (S.stack?.key ?? "") + "|" + S.samples.length + "|" + S.classes.map((c) => c.code + c.name + c.color).join(",") + "|" + S.active + "|" + indexDefs().map((d) => d.name).join(",");
/** Spectral profile (mean, SD per class over sample pixels) and input correlation (random valid pixels). */
async function computeStats() {
  S.statsBusy = true;
  try {
    const st = await ensureStack(), fc = featureCache(st), g = st.grid;
    const bands = st.bands.map((b, i) => ({ i, role: b.role })).filter((b) => b.role && ROLE_NM[b.role]).sort((a, b) => ROLE_NM[a.role] - ROLE_NM[b.role]);
    const per = new Map();
    if (bands.length) for (const s of cellsForSamples(g)) {
      const e = per.get(s.code) ?? { n: 0, sum: new Float64Array(bands.length), sq: new Float64Array(bands.length) };
      for (const c of s.cells) { if (!st.valid[c]) continue; e.n++; bands.forEach((b, j) => { const v = st.data[b.i][c] * st.factor; e.sum[j] += v; e.sq[j] += v * v; }); }
      per.set(s.code, e);
    }
    const lines = S.classes.filter((c) => per.get(c.code)?.n).map((c) => { const e = per.get(c.code); return { name: c.name, color: c.color, active: c.code === S.active, mean: Array.from(e.sum, (v) => v / e.n), sd: Array.from(e.sum, (v, j) => Math.sqrt(Math.max(0, e.sq[j] / e.n - (v / e.n) ** 2))) }; });
    if (lines.length) {
      const prof = { sensor: SENSORS.find((x) => x[0] === S.sensor)?.[1] ?? "Image", nm: bands.map((b) => ROLE_NM[b.role]), bands: bands.map((b) => b.role.replace("B", "")), markers: bands.filter((b) => ["B4", "B8", "B11"].includes(b.role)).map((b) => ROLE_NM[b.role]), lines, yLabel: st.factor === 1 ? "Value" : "Spectral reflectance" };
      S.cards.profile = {
        title: "Spectral profile", file: "spectral_profile", chart: () => profileSvg("profile", prof),
        table: () => `<table class="icl-table"><thead><tr><th>Class</th>${bands.map((b) => `<th>${b.role}</th>`).join("")}</tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.name)}</td>${l.mean.map((m, j) => `<td>${m.toFixed(4)} ± ${l.sd[j].toFixed(4)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
        sheets: () => [{ name: "Spectral profile", rows: [[{ v: "Class", bold: true }, ...bands.flatMap((b) => [{ v: b.role + " mean", bold: true }, { v: b.role + " SD", bold: true }])], ...lines.map((l) => [l.name, ...l.mean.flatMap((m, j) => [+m.toFixed(5), +l.sd[j].toFixed(5)])])] }],
      };
    } else delete S.cards.profile;
    const valid = [], rand = rng(7), n = g.width * g.height;
    for (let t = 0; t < 400000 && valid.length < 30000; t++) { const c = Math.floor(rand() * n); if (st.valid[c] && fc.layers.every((L) => Number.isFinite(L[c]))) valid.push(c); }
    if (valid.length > 50 && fc.layers.length > 1) {
      const R = correlation(fc.layers, valid), names = fc.names.map(n0);
      S.cards.corr = {
        title: "Input correlation", chartLabel: "Heatmap", file: "input_correlation", chart: () => corrSvg("corr", names, R),
        table: () => `<table class="icl-table"><thead><tr><th></th>${names.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${R.map((r, i) => `<tr><td>${esc(names[i])}</td>${r.map((v) => `<td>${v.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
        sheets: () => [{ name: "Correlation", rows: [["", ...names.map((x) => ({ v: x, bold: true }))], ...R.map((r, i) => [{ v: names[i], bold: true }, ...r.map((v) => +v.toFixed(4))])] }],
        note: `Pearson r over ${nf(valid.length)} random pixels. Pairs near ±1 carry the same information.`,
      };
    }
    S.cardsKey = statsKey();
  } catch (e) { console.warn("[Image Classification] stats", e); }
  S.statsBusy = false;
  if (S.view === "charts") renderView();
}

function accView() {
  const r = S.result;
  if (!r?.accTest) return `<div class="icw-empty big">${r ? "This result has no test pixels (clusters, or a 100 % training share)." : "Run a classification to see its accuracy."}</div>`;
  const a = r.accTest, tot = r.codes.reduce((s, c) => s + r.areas.area[c], 0) || 1, ar = areaAccuracy(a.matrix, r.codes.map((c) => r.areas.area[c] / tot));
  const nm = (c) => r.classes.find((x) => x.code === c)?.name ?? c, col = a.matrix[0].map((_, j) => a.matrix.reduce((s, rw) => s + rw[j], 0));
  const ci = (v) => (v == null ? "–" : nf(v * 100, 1));
  return `<div class="icw-kpis">
      <div class="icw-kpi"><span>Overall accuracy</span><b>${pct(a.oa)}%</b><small>${nf(a.n)} test pixels</small></div>
      <div class="icw-kpi"><span>Kappa</span><b>${a.kappa.toFixed(3)}</b><small>agreement beyond chance</small></div>
      <div class="icw-kpi"><span>Out-of-bag</span><b>${r.model?.oob != null ? pct(r.model.oob) + "%" : "–"}</b><small>trees on unseen pixels</small></div>
      <div class="icw-kpi"><span>Area-weighted OA</span><b>${pct(ar.oa)}%</b><small>± ${nf(1.96 * ar.oaSe * 100, 2)} (95% CI)</small></div>
    </div>
    <div class="icl-white"><div class="icl-card"><div class="icl-chead"><h3>Area-based accuracy</h3><span class="icw-lab dark">Olofsson et al. 2014 · ± 95% CI</span></div><div class="icl-cbody"><div class="icl-scroll"><table class="icl-table"><thead><tr><th>Class</th><th>Mapped (ha)</th><th>User's acc. %</th><th>Producer's acc. %</th><th>Estimated area (ha)</th><th>F1</th></tr></thead><tbody>
      ${r.codes.map((c, k) => `<tr><td><i class="icw-sw" style="background:${esc(r.classes.find((x) => x.code === c)?.color ?? "#888")}"></i> ${esc(nm(c))}</td><td>${nf(r.areas.area[c] / 1e4, 1)}</td><td>${ci(ar.ua[k])} ± ${ci(ar.uaSe[k] == null ? null : 1.96 * ar.uaSe[k])}</td><td>${ci(ar.pa[k])} ± ${ci(ar.paSe[k] == null ? null : 1.96 * ar.paSe[k])}</td><td>${nf((ar.refArea[k] * tot) / 1e4, 1)} ± ${nf((1.96 * ar.refSe[k] * tot) / 1e4, 0)}</td><td>${a.f1[k] == null ? "–" : a.f1[k].toFixed(3)}</td></tr>`).join("")}
    </tbody></table></div><p class="icw-lab dark">Each test pixel is weighted by the mapped area of its class. Pixels taken from hand-drawn samples only approximate the random sample the method assumes.</p></div></div>
    <div class="icl-card"><div class="icl-chead"><h3>Confusion matrix (table)</h3></div><div class="icl-cbody"><div class="icl-scroll"><table class="icl-table"><thead><tr><th>True \\ Predicted</th>${r.codes.map((c) => `<th>${esc(nm(c))}</th>`).join("")}<th>Total</th><th>PA %</th></tr></thead><tbody>
      ${a.matrix.map((row, k) => `<tr><td>${esc(nm(r.codes[k]))}</td>${row.map((v, j) => `<td${j === k ? ' class="d"' : ""}>${nf(v)}</td>`).join("")}<td>${nf(row.reduce((s, v) => s + v, 0))}</td><td>${pct(a.pa[k])}</td></tr>`).join("")}
      <tr><td>Total</td>${col.map((v) => `<td>${nf(v)}</td>`).join("")}<td>${nf(a.n)}</td><td></td></tr><tr><td>UA %</td>${a.ua.map((v) => `<td>${pct(v)}</td>`).join("")}<td></td><td></td></tr></tbody></table></div></div></div></div>`;
}

function changeView() {
  const list = S.results;
  if (list.length < 2) return `<div class="icw-empty big">Land cover change compares two results on the same grid. Classify one image, then use Classify → Classify another image with this model (or run again on another date) to get the second.</div>`;
  if (!(S.chg.a >= 0 && S.chg.a < list.length)) S.chg.a = Math.max(0, list.length - 2);
  if (!(S.chg.b >= 0 && S.chg.b < list.length) || S.chg.b === S.chg.a) S.chg.b = list.length - 1 === S.chg.a ? 0 : list.length - 1;
  const A = list[S.chg.a], B = list[S.chg.b], pick = (k, v) => `<select data-wk="${k}">${list.map((r, i) => `<option value="${i}"${i === v ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`;
  const head = `<div class="icw-row2"><label class="icw-f"><span>From (earlier)</span>${pick("chgA", S.chg.a)}</label><label class="icw-f"><span>To (later)</span>${pick("chgB", S.chg.b)}</label></div>`;
  if (A.grid.width !== B.grid.width || A.grid.height !== B.grid.height) return head + `<div class="icw-empty">The two results are on different grids (${A.grid.width} × ${A.grid.height} and ${B.grid.width} × ${B.grid.height}). Classify both images on the same reference grid.</div>`;
  const codes = [...new Set([...A.codes, ...B.codes])].sort((x, y) => x - y), meta = (c) => B.classes.find((x) => x.code === c) ?? A.classes.find((x) => x.code === c) ?? { name: "Class " + c, color: "#888" };
  const key = S.chg.a + ":" + S.chg.b + ":" + (A.version ?? 0) + ":" + (B.version ?? 0);
  if (S.chgCache?.key !== key) S.chgCache = { key, T: transitions(A.cls, B.cls, A.grid, codes).map((r) => r.map((v) => v / 1e4)) };
  const T = S.chgCache.T, names = codes.map((c) => meta(c).name), colors = codes.map((c) => meta(c).color);
  const row = T.map((r) => r.reduce((a, b) => a + b, 0)), col = T[0].map((_, j) => T.reduce((a, r) => a + r[j], 0)), tot = row.reduce((a, b) => a + b, 0) || 1, same = T.reduce((a, r, i) => a + r[i], 0), delta = col.map((v, i) => v - row[i]);
  const gi = delta.indexOf(Math.max(...delta)), li = delta.indexOf(Math.min(...delta));
  S.cards.change = {
    title: "Change matrix", chartLabel: "Heatmap", file: "change_matrix",
    chart: () => matrixSvg("change", { title: S.exporting ? "Change matrix (ha)" : "", rows: T, rowNames: names, colNames: names, xLabel: B.name, yLabel: A.name, cbLabel: "Share of the earlier class", share: true, fmt: (v) => (v > 0 && v < 1 ? "<1" : nf(v)) }),
    table: () => `<table class="icl-table"><thead><tr><th>From \\ To (ha)</th>${names.map((x) => `<th>${esc(x)}</th>`).join("")}<th>Total</th></tr></thead><tbody>${T.map((r, i) => `<tr><td>${esc(names[i])}</td>${r.map((v, j) => `<td${i === j ? ' class="d"' : ""}>${nf(v, 1)}</td>`).join("")}<td>${nf(row[i], 1)}</td></tr>`).join("")}<tr><td>Total</td>${col.map((v) => `<td>${nf(v, 1)}</td>`).join("")}<td>${nf(tot, 1)}</td></tr></tbody></table>`,
    sheets: () => [{ name: "Change matrix (ha)", rows: [[{ v: "From \\ To", bold: true }, ...names.map((x) => ({ v: x, bold: true })), { v: "Total", bold: true }], ...T.map((r, i) => [names[i], ...r.map((v) => +v.toFixed(2)), +row[i].toFixed(2)]), ["Total", ...col.map((v) => +v.toFixed(2)), +tot.toFixed(2)]] },
      { name: "Gains and losses", rows: [[{ v: "Class", bold: true }, { v: A.name + " (ha)", bold: true }, { v: B.name + " (ha)", bold: true }, { v: "Net change (ha)", bold: true }], ...names.map((x, i) => [x, +row[i].toFixed(2), +col[i].toFixed(2), +delta[i].toFixed(2)])] }],
  };
  S.cards.sankey = { title: "Sankey diagram", file: "sankey", chart: () => sankeySvg("sankey", T, A.name, B.name, colors, names), table: S.cards.change.table, sheets: S.cards.change.sheets };
  S.cards.gains = { title: "Gains and losses", file: "gains_losses", chart: () => gainsSvg("gains", names, colors, delta), table: () => `<table class="icl-table"><thead><tr><th>Class</th><th>Before (ha)</th><th>After (ha)</th><th>Net (ha)</th></tr></thead><tbody>${names.map((x, i) => `<tr><td>${esc(x)}</td><td>${nf(row[i], 1)}</td><td>${nf(col[i], 1)}</td><td>${delta[i] >= 0 ? "+" : ""}${nf(delta[i], 1)}</td></tr>`).join("")}</tbody></table>`, sheets: S.cards.change.sheets };
  return head + `<div class="icw-kpis">
      <div class="icw-kpi"><span>Unchanged</span><b>${nf((same / tot) * 100, 1)}%</b><small>${nf(same)} ha</small></div>
      <div class="icw-kpi"><span>Changed</span><b>${nf(tot - same)} ha</b><small>${nf(((tot - same) / tot) * 100, 1)}% of the area</small></div>
      <div class="icw-kpi"><span>Largest gain</span><b>+${nf(delta[gi], 1)} ha</b><small>${esc(names[gi])}</small></div>
      <div class="icw-kpi"><span>Largest loss</span><b>−${nf(Math.abs(delta[li]), 1)} ha</b><small>${esc(names[li])}</small></div>
    </div><div class="icw-cards icl-white"><div>${card("change")}</div><div>${card("sankey")}</div><div class="wide">${card("gains")}</div></div>`;
}
function logView() {
  return `<div class="icw-log">${S.log.length ? S.log.map((l) => `<div><span>${esc(l.t)}</span>${esc(l.m)}</div>`).join("") : `<div class="icw-empty">Nothing yet.</div>`}</div>`;
}
function wlog(m) {
  const d = new Date();
  S.log.push({ t: d.toTimeString().slice(0, 8), m });
  if (S.view === "log") renderView();
}

// ================================================================ unsupervised (Model step)

function unsupModel() {
  const p = P(), cl = S.clusters;
  const rows = cl ? cl.info.map((k, i) => `<tr><td><span class="icl-mid"><i class="icl-sw" style="background:${CLUSTER_COLORS[i % CLUSTER_COLORS.length]}"></i>${i + 1}</span></td><td>${nf(k.share, 1)}%</td>${cl.ndviIdx >= 0 ? `<td>${k.ndvi.toFixed(2)}</td>` : ""}<td><select data-clu="${i}" aria-label="Class for cluster ${i + 1}">${opt([["", "–"], ...S.classes.map((c) => [c.code, `${c.code} ${c.name}`])], cl.map[i] ?? "")}</select></td></tr>`).join("") : "";
  return `
  <section class="icl-sec">
    <h3 class="icl-head">Clustering</h3>
    <div class="icl-seg">${[["KM", "K-means"], ["ISO", "ISODATA"]].map(([k, l]) => `<button type="button" data-ualgo="${k}" class="${p.ualgo === k ? "on" : ""}" aria-pressed="${p.ualgo === k}">${l}</button>`).join("")}</div>
    ${slider("uK", p.ualgo === "ISO" ? "Starting clusters" : "Number of clusters", 2, 30, 1)}
    ${slider("uIter", "Max iterations", 5, 100, 5)}
    <div class="icl-row">
      <label class="icl-f"><span>Stop when changed below (%)</span><input type="number" data-p="uTol" min="0" step="0.1" value="${p.uTol}"></label>
      <label class="icl-f"><span>Sample pixels</span><input type="number" data-p="uSample" min="1000" step="1000" value="${p.uSample}"></label>
      <label class="icl-f" style="flex:0 0 64px"><span>Seed</span><input type="number" data-p="seed" value="${p.seed}"></label>
    </div>
    ${cl ? `<span class="icl-lab">Last run: ${cl.algo === "ISO" ? "ISODATA" : "K-means"}, ${cl.info.length} clusters, ${cl.iterations} iterations, ${nf(cl.changed * 100, 2)}% changed in the last pass.</span>` : ""}
  </section>
  ${cl ? `<section class="icl-sec"><div class="icl-mid"><h3 class="icl-head">Label clusters</h3><span class="icl-lab">${S.classes.length ? "suggested from class profiles" : "add classes in Samples to label"}</span></div>
    <div class="icl-scroll"><table class="icl-table"><thead><tr><th>Cluster</th><th>Pixels</th>${cl.ndviIdx >= 0 ? `<th>${esc(cl.ndviName)}</th>` : ""}<th style="text-align:left">Class</th></tr></thead><tbody>${rows}</tbody></table></div>
    <button type="button" class="icl-btn2" data-a="applyClusters"${S.classes.length ? "" : " disabled"}>Apply labels as land cover</button></section>` : ""}`;
}
async function runClustering() {
  if (S.busy) return;
  const p = P();
  await refreshSources();
  S.busy = true; S.msg = ""; render();
  const t0 = performance.now();
  try {
    const st = await ensureStack(), { layers, names } = featureLayers(st), d = layers.length, g = st.grid, n = g.width * g.height;
    const ok = (k) => st.valid[k] && layers.every((L) => Number.isFinite(L[k]));
    const mu = new Float64Array(d), sd = new Float64Array(d), rand = rng(p.seed), pick = [];
    for (let t = 0; t < n * 4 && pick.length < p.uSample; t++) { const k = Math.floor(rand() * n); if (ok(k)) pick.push(k); }
    if (pick.length < p.uK * 5) throw new Error("Too few valid pixels to cluster.");
    for (let j = 0; j < d; j++) { let s = 0, q = 0; for (const k of pick) { s += layers[j][k]; q += layers[j][k] ** 2; } mu[j] = s / pick.length; sd[j] = Math.sqrt(Math.max(1e-12, q / pick.length - mu[j] ** 2)); }
    const X = new Float32Array(pick.length * d);
    pick.forEach((k, i) => { for (let j = 0; j < d; j++) X[i * d + j] = (layers[j][k] - mu[j]) / sd[j]; });
    progress(p.ualgo === "ISO" ? "ISODATA" : "K-means", 0);
    const fn = p.ualgo === "ISO" ? isodata : kmeans, res = await fn(X, pick.length, d, p.uK, { maxIter: p.uIter, tol: p.uTol / 100, seed: p.seed }, (f) => progress(p.ualgo === "ISO" ? "ISODATA" : "K-means", f));
    const K = res.centers.length, cls = new Uint8Array(n), cnt = new Float64Array(K), row = new Float32Array(d);
    let last = performance.now();
    for (let k = 0; k < n; k++) {
      if (!ok(k)) continue;
      for (let j = 0; j < d; j++) row[j] = (layers[j][k] - mu[j]) / sd[j];
      const c = nearestCenter(row, 0, d, res.centers); cls[k] = c + 1; cnt[c]++;
      if ((k & 65535) === 0 && performance.now() - last > 80) { progress("Labelling pixels", k / n); await tick(); last = performance.now(); }
    }
    const tot = cnt.reduce((a, b) => a + b, 0) || 1, ndviIdx = names.findIndex((x) => /^(NDVI|NBR)$/i.test(x));
    const centersRaw = res.centers.map((c) => c.map((v, j) => v * sd[j] + mu[j]));
    // suggest a class per cluster: nearest class mean over sample pixels, where samples exist
    const map = {}, sp = S.samples.length ? splitSamples(cellsForSamples(g), { ratio: 1, maxPix: 500, seed: p.seed, valid: ok }) : null;
    if (sp?.train.cells.length) {
      const means = sp.codes.map((code, ki) => { const cells = sp.train.cells.filter((_, i) => sp.train.y[i] === ki); return Array.from({ length: d }, (_, j) => cells.reduce((a, c) => a + (layers[j][c] - mu[j]) / sd[j], 0) / Math.max(1, cells.length)); });
      res.centers.forEach((c, i) => { map[i] = sp.codes[nearestCenter(c, 0, d, means)]; });
    }
    S.clusters = { algo: p.ualgo, cls, grid: g, names, iterations: res.iterations, changed: res.changed, map, ndviIdx, ndviName: names[ndviIdx] ?? "", info: centersRaw.map((c, i) => ({ share: (cnt[i] / tot) * 100, ndvi: ndviIdx >= 0 ? c[ndviIdx] : 0 })) };
    const classes = S.clusters.info.map((_, i) => ({ code: i + 1, name: "Cluster " + (i + 1), color: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }));
    pushResult({ kind: "clusters", algo: p.ualgo, names, model: { importance: null }, accTest: null, grid: g, cls, areas: classAreas(cls, g, K), codes: classes.map((c) => c.code), classes, seconds: (performance.now() - t0) / 1000, name: `${p.ualgo === "ISO" ? "ISODATA" : "K-means"} (${K} clusters)` });
    wlog(`${p.ualgo === "ISO" ? "ISODATA" : "K-means"}: ${K} clusters from ${nf(pick.length)} pixels, ${res.iterations} iterations, ${nf((performance.now() - t0) / 1000, 1)} s`);
  } catch (e) {
    console.warn("[Image Classification] clustering", e);
    S.msg = e?.message ?? String(e);
  } finally { S.busy = false; progress(null); render(); }
}
function applyClusters() {
  const cl = S.clusters;
  if (!cl) return;
  const lut = new Uint8Array(256);
  cl.info.forEach((_, i) => (lut[i + 1] = +cl.map[i] || 0));
  const cls = cl.cls.map((v) => lut[v]), codes = [...new Set(Object.values(cl.map).map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (!codes.length) return say("Give at least one cluster a class.");
  const maxCode = Math.max(...codes);
  pushResult({ kind: "labelled", algo: cl.algo, names: cl.names, model: { importance: null }, accTest: null, grid: cl.grid, cls, areas: classAreas(cls, cl.grid, maxCode), codes, classes: S.classes.map((c) => ({ ...c })), seconds: 0, name: `Land Cover (${cl.algo === "ISO" ? "ISODATA" : "K-means"})` });
  wlog(`Clusters labelled into ${codes.length} classes.`);
  render();
}

// ================================================================ results: list, smoothing, another image

function pushResult(r) {
  r.version = (r.version ?? 0) + 1;
  S.results.push(r);
  S.result = r;
  S.split.right = "res:" + (S.results.length - 1);
}
/** Classify another image set with the current model: bands are matched by role, indices recomputed. */
async function applyToSet(key) {
  const r = S.result;
  if (!r?.model?.trees && !r?.model?.rounds && !r?.model?.pairs) return say("Run a supervised classification first.");
  if (S.busy) return;
  const prev = S.set;
  S.busy = true; render();
  try {
    S.set = key;
    const st = await ensureStack(), fc = featureLayers(st), byRole = {};
    st.bands.forEach((b, i) => { if (b.role && !byRole[b.role]) byRole[b.role] = st.data[i]; });
    const layers = r.featRoles.map((f) => (f.role ? byRole[f.role] : fc.layers[fc.names.indexOf(f.index)]));
    const miss = r.featRoles.filter((f, i) => !layers[i]).map((f) => f.role || f.index);
    if (miss.length) throw new Error(`${setNameOf(key)} lacks ${miss.join(", ")}.`);
    const g = st.grid, n = g.width * g.height, d = layers.length, cls = new Uint8Array(n), CH = 32768, X = new Float32Array(CH * d), out = new Uint8Array(CH), idx = new Int32Array(CH);
    for (let start = 0; start < n; start += CH) {
      let m = 0;
      for (let k = start; k < Math.min(n, start + CH); k++) { if (!st.valid[k]) continue; let ok = true; for (let j = 0; j < d; j++) { const v = layers[j][k]; if (!Number.isFinite(v)) { ok = false; break; } X[m * d + j] = v; } if (ok) idx[m++] = k; }
      if (m) { predict(r.model, X, m, out); for (let i = 0; i < m; i++) cls[idx[i]] = r.codes[out[i]]; }
      progress("Classifying " + setNameOf(key), start / n); await tick();
    }
    const maxCode = Math.max(...r.codes);
    pushResult({ ...r, kind: "applied", accTest: null, grid: g, cls, areas: classAreas(cls, g, maxCode), name: `Land Cover (${setNameOf(key)})`, version: 0 });
    wlog(`Applied the model to ${setNameOf(key)}.`);
    S.imgCache.set("img:" + key, { canvas: compositeCanvas(st), grid: g });
  } catch (e) { say(e?.message ?? String(e)); }
  finally { S.set = prev; S.busy = false; progress(null); render(); }
}
function smoothResult(size) {
  const r = S.result;
  if (!r) return;
  r.raw ??= r.cls;
  const maxCode = Math.max(...r.codes);
  r.cls = size ? majority(r.raw, r.grid.width, r.grid.height, size, maxCode) : r.raw;
  let changed = 0;
  for (let i = 0; i < r.cls.length; i++) if (r.cls[i] !== r.raw[i]) changed++;
  r.smooth = size; r.smoothChanged = changed; r.version++;
  r.areas = classAreas(r.cls, r.grid, maxCode);
  const W = r.grid.width, H = r.grid.height, comps = labelComponents(r.cls, W, H), per = {};
  for (let k = 1; k <= comps.n; k++) per[comps.compCls[k]] = (per[comps.compCls[k]] ?? 0) + 1;
  r.patches = per;
  wlog(size ? `Majority ${size} × ${size}: ${nf(changed)} pixels changed (${nf((changed / r.cls.length) * 100, 2)}%), ${nf(comps.n)} patches.` : "Smoothing removed.");
  render();
}
function resultsDock() {
  const r = S.result;
  if (!r) return `<section class="icl-sec last"><div class="icl-note center">No result yet.</div></section>`;
  const a = r.accTest, sets = imageSets().filter((x) => x.key !== activeSet());
  if (!r.patches) { const c = labelComponents(r.cls, r.grid.width, r.grid.height), per = {}; for (let k = 1; k <= c.n; k++) per[c.compCls[k]] = (per[c.compCls[k]] ?? 0) + 1; r.patches = per; }
  const nm = (c) => r.classes.find((x) => x.code === c);
  return `
  <section class="icl-sec">
    <div class="icl-mid"><h3 class="icl-head">${esc(r.name)}</h3></div>
    ${a ? `<div class="icl-tiles"><div class="icl-tile"><span class="icl-lab">Overall accuracy</span><b>${pct(a.oa)}%</b></div><div class="icl-tile"><span class="icl-lab">Kappa</span><b>${a.kappa.toFixed(3)}</b></div></div>` : ""}
    <span class="icl-lab">${r.kind === "clusters" ? "Clusters: label them on the Model step." : `${ALGO_NAMES[r.algo] ?? r.algo}${r.sp ? ` · ${nf(r.sp.train.cells.length)} training and ${nf(r.sp.test.cells.length)} test pixels` : ""} · ${nf(r.seconds, 1)} s`}</span>
    <div class="icl-mid"><button type="button" class="icl-btn2 grow" data-do="v:charts">Charts</button><button type="button" class="icl-btn2 grow" data-do="v:acc"${a ? "" : " disabled"}>Accuracy</button><button type="button" class="icl-btn2 grow" data-do="v:split">Before / after</button></div>
  </section>
  <section class="icl-sec">
    <h3 class="icl-head">Smoothing</h3>
    <div class="icl-seg">${[[0, "None"], [3, "Majority 3 × 3"], [5, "Majority 5 × 5"]].map(([k, l]) => `<button type="button" data-smooth="${k}" class="${(r.smooth || 0) === k ? "on" : ""}" aria-pressed="${(r.smooth || 0) === k}">${l}</button>`).join("")}</div>
    <span class="icl-lab">${r.smooth ? `${nf(r.smoothChanged ?? 0)} pixels changed (${nf(((r.smoothChanged ?? 0) / r.cls.length) * 100, 2)}%). Areas and charts use the smoothed map; accuracy stays that of the classifier.` : "Each pixel takes the most common class around it."}</span>
  </section>
  <section class="icl-sec">
    <h3 class="icl-head">Convert to polygons</h3>
    <span class="icl-lab">One polygon per patch, dissolved by class, with code, name, area (ha) and patch count.</span>
    <div class="icl-scroll"><table class="icl-table"><thead><tr><th>Class</th><th>Area (ha)</th><th>Patches</th></tr></thead><tbody>${r.codes.map((c) => `<tr><td><i class="icl-sw" style="background:${esc(nm(c)?.color ?? "#888")}"></i> ${esc(nm(c)?.name ?? c)}</td><td>${nf(r.areas.area[c] / 1e4, 1)}</td><td>${nf(r.patches[c] ?? 0)}</td></tr>`).join("")}</tbody></table></div>
    <button type="button" class="icl-btn2" data-a="polygons"${S.busy ? " disabled" : ""}>Convert to polygons</button>
  </section>
  ${sets.length && r.featRoles ? `<section class="icl-sec"><h3 class="icl-head">Classify another image</h3><span class="icl-lab">Same model, bands matched by role. Use it for before / after and change analysis.</span>
    <div class="icl-row"><label class="icl-f"><span>Image</span><select data-k="applySet">${opt(sets.map((x) => [x.key, x.name]), S.applySet ?? sets[0].key)}</select></label><button type="button" class="icl-btn" data-a="applySet">Classify</button></div></section>` : ""}
  <section class="icl-sec last">
    <h3 class="icl-head">Export</h3>
    <button type="button" class="icl-btn" data-do="w:exp">Export to folder…</button>
    <button type="button" class="icl-btn2" data-do="w:send">Send result to GeoLibre map</button>
  </section>`;
}

// ================================================================ export to a folder on this computer

const EXPORTS = [
  ["tif", "Classified raster", "GeoTIFF (codes + colour table)"], ["poly", "Polygons, dissolved by class", "GeoJSON"], ["acc", "Accuracy report", "Excel (.xlsx)"],
  ["charts", "Charts", "PNG 300 dpi + SVG"], ["samples", "Training samples", "GeoJSON"], ["change", "Land cover change", "Excel (.xlsx)"],
];
function exportDialog() {
  const e = S.exp, can = { tif: !!S.result, poly: !!S.result, acc: !!S.result?.accTest, charts: !!S.result || !!S.cards.profile, samples: S.samples.length > 0, change: S.results.length > 1 };
  return `<div class="icw-modal"><section class="icw-dialog" role="dialog" aria-label="Export to folder">
    <div class="icw-dhd"><div class="icw-grow"><b>Export to this computer</b><div class="icw-lab">${"showDirectoryPicker" in window ? "Files are written straight into the folder you pick." : "This browser saves each file to your Downloads folder."}</div></div><button type="button" class="icw-wb" data-do="w:expClose" aria-label="Close">${wIco(WI.close)}</button></div>
    <div class="icw-dbody">
      <label class="icw-f"><span>File name prefix</span><input type="text" data-wk="expPrefix" value="${esc(e.prefix)}"></label>
      <div class="icw-list">${EXPORTS.map(([k, label, fmt]) => `<label class="icw-row${can[k] ? "" : " off"}"><input type="checkbox" data-exp="${k}"${e.sel[k] && can[k] ? " checked" : ""}${can[k] ? "" : " disabled"}><span class="icw-grow"><b>${label}</b><br><span class="icw-lab">${fmt}</span></span></label>`).join("")}</div>
    </div>
    <div class="icw-dft"><span class="icw-lab icw-grow" data-w="expStatus">${esc(e.status ?? "")}</span><button type="button" class="icw-btn2" data-do="w:expClose">Cancel</button><button type="button" class="icw-btn" data-do="w:expGo">${"showDirectoryPicker" in window ? "Choose folder and export" : "Export"}</button></div>
  </section></div>`;
}
async function svgToPng(svg) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), W = +vb[1], H = +vb[2], k = 300 / 96;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.replace(/ class="[^"]*"| data-[a-z]+="[^"]*"/g, ""), url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const cv = document.createElement("canvas"); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    return { png: pngWithDpi(new Uint8Array(await blob.arrayBuffer()), 300), svg: xml };
  } finally { URL.revokeObjectURL(url); }
}
async function runExport() {
  const e = S.exp, r = S.result, files = [], pre = (e.prefix || "").replace(/[^\w.-]+/g, "_");
  const add = (name, data, type) => files.push({ name: pre + name, data, type });
  const status = (t) => { e.status = t; const el = wq("[data-w=expStatus]"); if (el) el.textContent = t; };
  let dir = null;
  if ("showDirectoryPicker" in window) { try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); } catch { return; } }
  try {
    status("Preparing files…");
    if (e.sel.tif && r) add(fileBase() + ".tif", resultTiff(r), "image/tiff");
    if (e.sel.poly && r) add(fileBase() + "_polygons.geojson", JSON.stringify(polygonsFC(r)), "application/geo+json");
    if (e.sel.acc && r?.accTest) add(fileBase() + "_accuracy.xlsx", writeXlsx(accuracySheets(r)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (e.sel.samples && S.samples.length) add("training_samples.geojson", JSON.stringify(sampleFC()), "application/geo+json");
    if (e.sel.change && S.results.length > 1) { const v = S.view; S.view = "change"; changeView(); S.view = v; if (S.cards.change) add("land_cover_change.xlsx", writeXlsx(S.cards.change.sheets()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
    if (e.sel.charts) {
      buildCards(r);
      S.exporting = true;
      try { for (const id of ["matrix", "areas", "importance", "profile", "corr"]) { const c = S.cards[id]; if (!c) continue; const out = await svgToPng(c.chart()); add(`chart_${c.file}_300dpi.png`, out.png, "image/png"); add(`chart_${c.file}.svg`, out.svg, "image/svg+xml"); } }
      finally { S.exporting = false; }
    }
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      status(`Writing ${i + 1} of ${files.length}: ${f.name}`);
      if (dir) { const h = await dir.getFileHandle(f.name, { create: true }), w = await h.createWritable(); await w.write(f.data); await w.close(); }
      else { download(f.name, f.data, f.type); await new Promise((res) => setTimeout(res, 300)); }
    }
    status(`Saved ${files.length} files${dir ? " in " + dir.name : ""}.`);
    wlog(`Exported ${files.length} files${dir ? " to folder " + dir.name : ""}.`);
  } catch (err) { status("Export failed: " + (err?.message ?? err)); }
}
function polygonsFC(r) {
  const g = r.grid, W = g.width, H = g.height, dx = (g.bounds[2] - g.bounds[0]) / W, dy = (g.bounds[3] - g.bounds[1]) / H, r8 = (v) => Math.round(v * 1e8) / 1e8;
  const toXY = g.geographic ? (x, y) => [r8(g.bounds[0] + x * dx), r8(g.bounds[3] - y * dy)] : (x, y) => g.toLL([g.bounds[0] + x * dx, g.bounds[3] - y * dy]).map(r8);
  const polys = polygonize(r.cls, W, H, toXY), meta = new Map(r.classes.map((c) => [c.code, c]));
  return { type: "FeatureCollection", features: [...polys].sort((a, b) => a[0] - b[0]).map(([code, e]) => ({ type: "Feature", properties: { class_code: code, class_name: meta.get(code)?.name ?? `Class ${code}`, area_ha: Math.round(r.areas.area[code] / 100) / 100, patches: e.patches, color: meta.get(code)?.color ?? "#888888" }, geometry: { type: "MultiPolygon", coordinates: e.polygons } })) };
}

// ================================================================ events

function winDo(a) {
  S.menuOpen = "";
  if (!a) return;
  if (a.startsWith("v:")) { S.view = a.slice(2); return winRefresh(); }
  if (a.startsWith("s:")) { S.tab = a.slice(2); render(); return winRefresh(); }
  if (a.startsWith("t:")) { if (S.view !== "map") S.view = "map"; setTool(a.slice(2)); return winRefresh(); }
  switch (a) {
    case "w:min": return minimiseWindow();
    case "w:close": return closeWindow();
    case "w:fit": fitView(); return drawViewer();
    case "w:zin": case "w:zout": { if (!S.vp || !S.viewer) return; const f = a === "w:zin" ? 1.4 : 1 / 1.4, W = S.viewer.el.clientWidth / 2, H = S.viewer.el.clientHeight / 2; S.vp = { k: S.vp.k * f, x: W - (W - S.vp.x) * f, y: H - (H - S.vp.y) * f }; return drawViewer(); }
    case "w:exp": S.exp = { prefix: (activeSetName() || "classification") + "_", sel: { tif: true, poly: true, acc: true, charts: true, samples: true, change: S.results.length > 1 } }; return winRefresh();
    case "w:expClose": S.exp = null; return winRefresh();
    case "w:expGo": return runExport();
    case "w:send": if (S.result) addResultLayer().then(() => wlog(`Sent "${S.result.name}" to the GeoLibre map.`)); return;
    case "w:comp": S.tab = "layers"; render(); setTimeout(() => $("[data-sec=composite]")?.scrollIntoView({ block: "start" }), 50); return winRefresh();
    case "w:calc": S.tab = "layers"; render(); setTimeout(() => $("[data-k=cExpr]")?.focus(), 50); return winRefresh();
    case "w:sup": P().kind = "sup"; S.tab = "model"; render(); return winRefresh();
    case "w:unsup": P().kind = "unsup"; S.tab = "model"; render(); return winRefresh();
    case "w:apply": S.tab = "results"; render(); return winRefresh();
    case "w:help": wlog("Tutorial: pick a class, choose Point, Polygon, Circle or Rectangle on the toolbar and draw on the image. The image pans only with the hand tool."); S.view = "log"; return winRefresh();
    case "run": return P().kind === "unsup" ? runClustering() : runClassification();
    case "addFolder": return addFolder();
    case "addFiles": return addFiles();
    case "refresh": return refreshSources();
    case "undo": if (S.draft.length) S.draft.pop(); else S.samples.pop(); invalidate(); syncMap(); return render();
    case "clear": S.samples = []; S.draft = []; invalidate(); syncMap(); return render();
    case "save": return saveSamples();
    case "polygons": return polygonsAction();
  }
}
function winClick(e) {
  const t = e.target;
  // main.js handles the workflow dock (S.root) itself and may already have re-rendered it, detaching the target
  const inDock = S.root && e.composedPath().includes(S.root);
  if (S.menuOpen && !t.closest(".icw-mwrap")) { S.menuOpen = ""; wq("[data-w=menubar]").innerHTML = menuBar(); }
  const b = t.closest("button");
  if (b?.dataset.wa) { if (b.dataset.wa === "min") return minimiseWindow(); if (b.dataset.wa === "close") return closeWindow(); S.winMode = S.winMode === "max" ? "win" : "max"; S.win.classList.toggle("max", S.winMode === "max"); if (S.winMode === "max") Object.assign(S.win.style, { left: "", top: "" }); S.vp = null; return winRefresh(); }
  if (b?.dataset.menu) { S.menuOpen = S.menuOpen === b.dataset.menu ? "" : b.dataset.menu; wq("[data-w=menubar]").innerHTML = menuBar(); return; }
  if (b?.dataset.do) { e.stopPropagation(); return winDo(b.dataset.do); }
  if (b?.dataset.view) { S.view = b.dataset.view; return winRefresh(); }
  if (b?.dataset.left) { S.leftTab = b.dataset.left; return winRefresh(); }
  if (b?.dataset.split) { S.split.mode = b.dataset.split; return renderView(); }
  if (b?.dataset.smooth != null && inDock) return smoothResult(+b.dataset.smooth);
  if (b?.dataset.ualgo) { P().ualgo = b.dataset.ualgo; return render(); }
  if (b?.dataset.kind) { P().kind = b.dataset.kind; render(); return winRefresh(); }
  if (b?.dataset.a === "applyClusters") return applyClusters();
  if (b?.dataset.a === "applySet") return applyToSet($("[data-k=applySet]")?.value);
  if (inDock) return;
  if (b?.dataset.pick) { S.active = +b.dataset.pick; render(); return; }
  onClick(e); // chart cards in the centre
}
function winChange(e) {
  const t = e.target, k = t.dataset.wk;
  if (t.dataset.clu != null && S.clusters) { S.clusters.map[+t.dataset.clu] = t.value; return; }
  if (t.dataset.exp && S.exp) { S.exp.sel[t.dataset.exp] = t.checked; return; }
  if (!k) { if (S.root && e.composedPath().includes(S.root)) return; return onChange(e); }
  if (k === "active") { S.active = +t.value; S.draft = []; render(); return; }
  if (k === "set") { S.set = t.value; S.vp = null; invalidate(); render(); return; }
  if (k === "result") { S.result = S.results[+t.value]; render(); return; }
  if (k === "showSamples") { S.hideSamples = !t.checked; return drawViewer(); }
  if (k === "splitL") S.split.left = t.value;
  else if (k === "splitR") S.split.right = t.value;
  else if (k === "chgA") { S.chg.a = +t.value; return renderView(); }
  else if (k === "chgB") { S.chg.b = +t.value; return renderView(); }
  else if (k === "expPrefix" && S.exp) S.exp.prefix = t.value;
  drawViewer();
}
function winInput(e) {
  const t = e.target, k = t.dataset.wk;
  if (k === "opacity") { S.opacity = +t.value; const o = wq("[data-w=opv]"); if (o) o.textContent = Math.round(S.opacity * 100) + "%"; return drawViewer(); }
  if (k === "splitPos") { S.split.pos = +t.value; return drawViewer(); }
  if (k === "expPrefix" && S.exp) S.exp.prefix = t.value;
}
