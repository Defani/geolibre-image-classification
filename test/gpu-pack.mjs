// The packed model layout the WebGPU shaders read predicts what the model predicts: node test/gpu-pack.mjs
import * as C from "../src/core.js";
const r = C.rng(3), n = 3000, d = 6, K = 4, X = new Float32Array(n * d), y = new Uint8Array(n);
for (let i = 0; i < n; i++) { const k = i % K; y[i] = k; for (let j = 0; j < d; j++) X[i * d + j] = k * (j % 3) * 0.6 + r() * 1.5 + (j === 5 ? 100 : 0); }
let fail = 0;
for (const [algo, o] of [["RF", { trees: 60 }], ["GTB", { trees: 40, maxNodes: 6 }], ["SVM", { kernel: "RBF" }], ["SVM", { kernel: "LINEAR" }], ["SVM", { kernel: "POLY", degree: 2, coef0: 1 }], ["SVM", { kernel: "SIGMOID", gamma: 0.1 }]]) {
  const m = await C.train(algo, X, y, n, d, K, o), a = C.predict(m, X, n), b = C.predictPacked(C.packModel(m), X, n);
  let same = 0; for (let i = 0; i < n; i++) same += a[i] === b[i];
  const ok = algo === "RF" ? same === n : same / n >= 0.999;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", (algo + " " + (o.kernel ?? "")).padEnd(12), `${same}/${n} identical`);
}
if (fail) process.exit(1);
console.log("all passed");
