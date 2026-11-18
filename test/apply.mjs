// Band matching for "Classify another image" and the reflectance scaling guess: node test/apply.mjs
import * as C from "../src/core.js";
let fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", label, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq("bandToken", ["S2_B8A.tif", "PreFire_Band_B1", "Band 03", "LC09_SR_B5", "ndvi"].map(C.bandToken), ["B8A", "B1", "B3", "B5", ""]);
eq("guessRole unchanged", [C.guessRole("S2_B8A.tif"), C.guessRole("LC09_SR_B5", "l8"), C.guessRole("x_B1"), C.guessRole("x_B4", "custom")], ["B8A", "B8", "", ""]);

// Sentinel-2 with B1 and B9 (no role) applied to the post-fire scene listed in another order
const s2 = (n) => ({ role: C.guessRole("x_" + n), token: n });
const pre = ["B1", "B2", "B3", "B4", "B8", "B9", "B11"].map(s2), post = ["B9", "B11", "B8", "B4", "B3", "B2", "B1"].map(s2);
eq("S2 with roleless B1/B9", C.matchBands(pre, post), [6, 5, 4, 3, 2, 0, 1]);
// custom sensor: nothing has a role, band numbers decide
const cu = (n) => ({ role: "", token: n });
eq("custom sensor by band number", C.matchBands(["B1", "B2", "B3"].map(cu), ["B3", "B1", "B2"].map(cu)), [1, 2, 0]);
// no role, no number: position among the free bands
eq("by position", C.matchBands([{ role: "" }, { role: "" }], [{ role: "" }, { role: "" }]), [0, 1]);
// Landsat 8 -> Sentinel-2 by role
const ls = (n) => ({ role: C.guessRole("x_" + n, "l8"), token: n });
eq("Landsat to S2 by role", C.matchBands(["B2", "B3", "B4", "B5"].map(ls), ["B8", "B4", "B3", "B2"].map(s2)), [3, 2, 1, 0]);
eq("missing band -> -1", C.matchBands(["B1", "B2"].map(s2), ["B2"].map(s2)), [-1, 0]);

eq("auto: 0-1", C.autoScale([0.01, 0.4], "s2").name, "1");
eq("auto: S2 DN", C.autoScale([150, 4200], "s2").name, "0.0001");
eq("auto: bright S2 is not Landsat", C.autoScale([6000, 9000], "s2", ["T49_B2"]).name, "0.0001");
eq("auto: Landsat C2 L2 by sensor", C.autoScale([7600, 22000], "l8").name, "lc2");
eq("auto: Landsat C2 L2 by file name", C.autoScale([7600, 22000], "s2", ["LC09_L2SP_119065_SR_B5"]).name, "lc2");
eq("auto: Landsat C1 SR stays 0.0001", C.autoScale([120, 4500], "l8").name, "0.0001");
const lc2 = C.SCALES.lc2;
eq("C2 L2 DN 7273 -> ~0, 43636 -> ~1", [7273, 43636].map((v) => +(v * lc2.factor + lc2.offset).toFixed(3)), [0, 1]);
if (fail) { console.log(fail, "failed"); process.exit(1); }
console.log("all passed");
