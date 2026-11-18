// Accuracy method checks: node test/accuracy.mjs
import * as C from "../src/core.js";
let fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", label, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// two samples of different classes share cells 3 and 4: both drop them and the split says so
const sp = C.splitSamples([{ code: 1, cells: [1, 2, 3, 4] }, { code: 2, cells: [3, 4, 5, 6] }], { ratio: 0.5 });
const all = [...sp.train.cells, ...sp.test.cells].sort((a, b) => a - b);
eq("conflicting cells left out", all, [1, 2, 5, 6]);
eq("conflicts counted", sp.conflicts, 2);
// same class overlapping is not a conflict
eq("same-class overlap is fine", C.splitSamples([{ code: 1, cells: [1, 2] }, { code: 1, cells: [2, 3] }, { code: 2, cells: [9, 10] }], {}).conflicts, 0);

// by sample: whole samples on one side; a class with one sample falls back to pixels and is reported
const s2 = C.splitSamples([{ code: 1, cells: [1, 2, 3] }, { code: 1, cells: [11, 12, 13] }, { code: 1, cells: [21, 22, 23] }, { code: 2, cells: [31, 32, 33, 34] }], { by: "sample", ratio: 0.7, seed: 1 });
const side = (c) => (s2.train.cells.includes(c) ? "tr" : "te");
eq("sample stays together", [1, 11, 21].map((c) => [c, c + 1, c + 2].map(side).every((v) => v === side(c))), [true, true, true]);
eq("single-sample class reported", s2.pixelFallback, [2]);

// accuracy of the smoothed map, not of the model: the map says class 2 where the model said 1
const cls = Uint8Array.from([1, 1, 2, 2]);
const a = C.mapAccuracy(cls, [0, 1, 2, 3], [0, 0, 0, 1], [1, 2]);
eq("map accuracy OA", a.oa, 0.75);
eq("map accuracy matrix", a.matrix, [[2, 1], [0, 1]]);
if (fail) process.exit(1);
console.log("all passed");
