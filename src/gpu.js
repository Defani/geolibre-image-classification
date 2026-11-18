// WebGPU pixel prediction. Training stays on the CPU (a few thousand pixels); predicting every pixel of the image is
// the slow part, and each pixel is independent, so it runs as a compute shader. Same packed model as predictPacked().

const GPU = { dev: null, tried: false, name: "" };

async function gpuDevice() {
  if (GPU.dev || GPU.tried) return GPU.dev;
  GPU.tried = true;
  try {
    const a = await globalThis.navigator?.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!a) return null;
    const lim = Math.min(a.limits.maxStorageBufferBindingSize, a.limits.maxBufferSize, 1 << 30);
    GPU.dev = await a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: lim, maxBufferSize: lim } });
    GPU.name = [a.info?.vendor, a.info?.architecture || a.info?.description].filter(Boolean).join(" ") || "GPU";
    GPU.dev.lost.then(() => { GPU.dev = null; GPU.tried = false; });
  } catch (e) {
    console.warn("[Image Classification] WebGPU not available", e);
    GPU.dev = null;
  }
  return GPU.dev;
}

const WGSL_HEAD = `
struct Prm { n: u32, d: u32, K: u32, T: u32, mode: u32, kernel: u32, P: u32, deg: u32, shrink: f32, gamma: f32, coef0: f32, pad: f32 };
@group(0) @binding(0) var<uniform> prm: Prm;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> outc: array<u32>;
fn pix(g: vec3<u32>, nw: vec3<u32>) -> u32 { return g.x + g.y * nw.x * 64u; }
fn argmax(F: ptr<function, array<f32, 64>>) -> u32 {
  var best = 0u;
  for (var k = 1u; k < prm.K; k++) { if ((*F)[k] > (*F)[best]) { best = k; } }
  return best;
}`;

// RF (mode 0: one vote per tree) and GTB (mode 1: shrinkage x leaf value added to class t % K)
const WGSL_TREES = WGSL_HEAD + `
@group(0) @binding(3) var<storage, read> feat: array<i32>;
@group(0) @binding(4) var<storage, read> kids: array<i32>;
@group(0) @binding(5) var<storage, read> thr: array<f32>;
@group(0) @binding(6) var<storage, read> val: array<f32>;
@group(0) @binding(7) var<storage, read> roots: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = pix(g, nw);
  if (i >= prm.n) { return; }
  var F: array<f32, 64>;
  let off = i * prm.d;
  for (var t = 0u; t < prm.T; t++) {
    var k = i32(roots[t]);
    loop {
      let f = feat[k];
      if (f < 0) { break; }
      k = kids[k * 2 + select(1, 0, X[off + u32(f)] <= thr[k])];
    }
    if (prm.mode == 0u) { let c = u32(val[k]); F[c] = F[c] + 1.0; }
    else { let c = t % prm.K; F[c] = F[c] + prm.shrink * val[k]; }
  }
  outc[i] = argmax(&F);
}`;

// SVM one-vs-one; fz = [mean(d), sd(d), bias(P)], pairs = [a, b, svStart, svCount] per pair
const WGSL_SVM = WGSL_HEAD + `
@group(0) @binding(3) var<storage, read> fz: array<f32>;
@group(0) @binding(4) var<storage, read> pairs: array<u32>;
@group(0) @binding(5) var<storage, read> sv: array<f32>;
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> w: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = pix(g, nw);
  if (i >= prm.n) { return; }
  let d = prm.d;
  var z: array<f32, 128>;
  for (var j = 0u; j < d; j++) { z[j] = (X[i * d + j] - fz[j]) / fz[d + j]; }
  var F: array<f32, 64>;
  for (var p = 0u; p < prm.P; p++) {
    var f = fz[2u * d + p];
    if (prm.kernel == 0u) {
      for (var j = 0u; j < d; j++) { f += w[p * d + j] * z[j]; }
    } else {
      let s0 = pairs[p * 4u + 2u];
      for (var s = s0; s < s0 + pairs[p * 4u + 3u]; s++) {
        var dp = 0.0; var dist = 0.0;
        for (var j = 0u; j < d; j++) { let v = sv[s * d + j]; dp += v * z[j]; let q = v - z[j]; dist += q * q; }
        var kv = 0.0;
        if (prm.kernel == 1u) { kv = exp(-prm.gamma * dist); }
        else if (prm.kernel == 2u) { let b = prm.gamma * dp + prm.coef0; kv = 1.0; for (var e = 0u; e < prm.deg; e++) { kv *= b; } }
        else { kv = tanh(prm.gamma * dp + prm.coef0); }
        f += coef[s] * kv;
      }
    }
    let c = select(pairs[p * 4u + 1u], pairs[p * 4u], f >= 0.0);
    F[c] = F[c] + 1.0;
  }
  outc[i] = argmax(&F);
}`;

/**
 * A GPU predictor for one trained model, or null when WebGPU is missing or the model does not fit the shaders
 * (more than 64 classes, or an SVM on more than 128 inputs). predict(X, m) resolves to class indices for m rows.
 */
async function gpuClassifier(model) {
  const pm = packModel(model);
  if (pm.K > 64 || (pm.type === "SVM" && pm.d > 128)) return null;
  if (pm.type === "SVM" && pm.kernel === 2 && !Number.isInteger(pm.degree)) return null;
  const dev = await gpuDevice();
  if (!dev) return null;
  const U = GPUBufferUsage, bufs = [];
  const store = (arr) => {
    const b = dev.createBuffer({ size: Math.max(16, Math.ceil(arr.byteLength / 4) * 4), usage: U.STORAGE | U.COPY_DST });
    dev.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
    bufs.push(b);
    return b;
  };
  const model_ = pm.type === "SVM"
    ? [store(Float32Array.from([...pm.mean, ...pm.sd, ...pm.bias])), store(pm.pairs), store(pm.sv), store(pm.coef), store(pm.w)]
    : [store(pm.feat), store(pm.kids), store(pm.thr), store(pm.val), store(pm.roots)];
  const module = dev.createShaderModule({ code: pm.type === "SVM" ? WGSL_SVM : WGSL_TREES });
  const info = await module.getCompilationInfo?.();
  const err = info?.messages?.find((m) => m.type === "error");
  if (err) { bufs.forEach((b) => b.destroy()); throw new Error("WGSL: " + err.message); }
  const pipe = await dev.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
  // a dispatch is kept short so the OS never takes the GPU for hung (Windows resets it after ~2 s)
  const work = pm.type === "SVM" ? pm.d * Math.max(pm.bias.length, pm.coef.length) : pm.trees * 8;
  const chunk = Math.max(4096, Math.min(1 << 20, Math.floor(2e9 / Math.max(1, work)), Math.floor((dev.limits.maxStorageBufferBindingSize - 16) / (pm.d * 4))));
  const prmBuf = dev.createBuffer({ size: 48, usage: U.UNIFORM | U.COPY_DST });
  const xBuf = dev.createBuffer({ size: chunk * pm.d * 4, usage: U.STORAGE | U.COPY_DST });
  const oBuf = dev.createBuffer({ size: chunk * 4, usage: U.STORAGE | U.COPY_SRC });
  const rBuf = dev.createBuffer({ size: chunk * 4, usage: U.MAP_READ | U.COPY_DST });
  bufs.push(prmBuf, xBuf, oBuf, rBuf);
  const group = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [prmBuf, xBuf, oBuf, ...model_].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const prm = new ArrayBuffer(48), pu = new Uint32Array(prm), pf = new Float32Array(prm);
  pu.set([0, pm.d, pm.K, pm.trees ?? 0, pm.type === "GTB" ? 1 : 0, pm.kernel ?? 0, pm.bias?.length ?? 0, pm.degree ?? 0]);
  pf.set([pm.shrinkage ?? 0, pm.gamma ?? 0, pm.coef0 ?? 0, 0], 8);
  return {
    name: GPU.name, chunk,
    async predict(X, m) {
      pu[0] = m;
      dev.queue.writeBuffer(prmBuf, 0, prm);
      dev.queue.writeBuffer(xBuf, 0, X.buffer, X.byteOffset, m * pm.d * 4);
      const groups = Math.ceil(m / 64), gx = Math.min(groups, 65535), gy = Math.ceil(groups / gx);
      const enc = dev.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(gx, gy); pass.end();
      enc.copyBufferToBuffer(oBuf, 0, rBuf, 0, m * 4);
      dev.queue.submit([enc.finish()]);
      await rBuf.mapAsync(GPUMapMode.READ, 0, m * 4);
      const res = Uint8Array.from(new Uint32Array(rBuf.getMappedRange(0, m * 4)));
      rBuf.unmap();
      return res;
    },
    destroy() { bufs.forEach((b) => b.destroy()); },
  };
}
