// Checks the unsupervised and statistics helpers on synthetic data: node test/unsup.mjs
import * as C from "../src/core.js";
const n = 3000, d = 2, X = new Float32Array(n * d), r = C.rng(1);
for (let i = 0; i < n; i++) { const g = i % 3; X[i * 2] = g * 5 + r(); X[i * 2 + 1] = g * 5 + r(); }
const k = await C.kmeans(X, n, d, 3);
console.log("kmeans", k.iterations, "it", k.centers.map((c) => c.map((v) => v.toFixed(1)).join(",")).sort().join(" | "), "(want 0.5,0.5 | 5.5,5.5 | 10.5,10.5)");
const iso = await C.isodata(X, n, d, 6, { maxStd: 0.8, minDist: 2 });
console.log("isodata from 6 ->", iso.centers.length, "clusters", iso.centers.map((c) => c.map((v) => v.toFixed(1)).join(",")).sort().join(" | "));
const L = [Float32Array.from([1, 2, 3, 4]), Float32Array.from([2, 4, 6, 8]), Float32Array.from([4, 3, 2, 1])];
console.log("corr", JSON.stringify(C.correlation(L, [0, 1, 2, 3]).map((row) => row.map((v) => +v.toFixed(2)))), "(want 1 1 -1)");
console.log("transitions", JSON.stringify(C.transitions(Uint8Array.from([1, 1, 2, 2]), Uint8Array.from([1, 2, 2, 2]), { width: 2, height: 2, bounds: [0, 0, 2, 2], geographic: false }, [1, 2])), "(want [[1,1],[0,2]])");
