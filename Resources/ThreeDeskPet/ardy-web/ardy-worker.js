var __defProp = Object.defineProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/runtime/ddim.ts
function ddimStepForIndex(timesteps, alphasCumprod, alphasCumprodPrevious, inferenceIndex) {
  if (!Number.isSafeInteger(inferenceIndex) || inferenceIndex < 0 || inferenceIndex >= timesteps.length) {
    throw new RangeError("DDIM inference index is out of range");
  }
  const timestep = timesteps[inferenceIndex];
  const alpha = alphasCumprod[timestep];
  const alphaPrevious = alphasCumprodPrevious[timestep];
  if (!Number.isFinite(alpha) || !Number.isFinite(alphaPrevious) || alpha <= 0 || alpha > 1 || alphaPrevious <= 0 || alphaPrevious > 1) {
    throw new RangeError(`Invalid DDIM alpha at timestep ${timestep}`);
  }
  return { timestep, alpha, alphaPrevious };
}
function applyDdimStepInPlace(sample, predictedX0, step, start = 0, end = sample.length) {
  if (sample.length !== predictedX0.length) {
    throw new RangeError("DDIM sample and prediction lengths differ");
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > sample.length) {
    throw new RangeError("Invalid DDIM update range");
  }
  const sqrtAlpha = Math.sqrt(step.alpha);
  const sqrtReciprocalMinusOne = Math.sqrt(1 / step.alpha - 1);
  const sqrtPrevious = Math.sqrt(step.alphaPrevious);
  const sqrtOneMinusPrevious = Math.sqrt(1 - step.alphaPrevious);
  for (let index = start; index < end; index += 1) {
    const predicted = predictedX0[index];
    const epsilon = sqrtReciprocalMinusOne === 0 ? 0 : (sample[index] / sqrtAlpha - predicted) / sqrtReciprocalMinusOne;
    sample[index] = Math.fround(
      predicted * sqrtPrevious + epsilon * sqrtOneMinusPrevious
    );
  }
}

// src/runtime/random.ts
var UINT32_RANGE = 4294967296;
function seedToUint32(seed2) {
  if (typeof seed2 === "number") {
    return Math.trunc(seed2) >>> 0;
  }
  const bytes = new TextEncoder().encode(seed2);
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
var PortableRandom = class {
  seed;
  #state;
  #spareNormal;
  constructor(seed2) {
    this.seed = seedToUint32(seed2);
    this.#state = this.seed;
  }
  snapshot() {
    return {
      seed: this.seed,
      state: this.#state,
      ...this.#spareNormal === void 0 ? {} : { spareNormal: this.#spareNormal }
    };
  }
  restore(snapshot) {
    if (snapshot.seed !== this.seed || !Number.isSafeInteger(snapshot.state) || snapshot.state < 0 || snapshot.state >= UINT32_RANGE || snapshot.spareNormal !== void 0 && !Number.isFinite(snapshot.spareNormal)) {
      throw new TypeError("Portable random snapshot is invalid");
    }
    this.#state = snapshot.state >>> 0;
    this.#spareNormal = snapshot.spareNormal;
  }
  nextUint32() {
    this.#state = this.#state + 1831565813 >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return (value ^ value >>> 14) >>> 0;
  }
  nextFloat() {
    return (this.nextUint32() + 1) / (UINT32_RANGE + 1);
  }
  nextNormal() {
    if (this.#spareNormal !== void 0) {
      const result = this.#spareNormal;
      this.#spareNormal = void 0;
      return result;
    }
    let x = 0;
    let y = 0;
    let radiusSquared = 0;
    do {
      x = 2 * this.nextFloat() - 1;
      y = 2 * this.nextFloat() - 1;
      radiusSquared = x * x + y * y;
    } while (radiusSquared <= Number.EPSILON || radiusSquared >= 1);
    const scale = Math.sqrt(-2 * Math.log(radiusSquared) / radiusSquared);
    this.#spareNormal = y * scale;
    return x * scale;
  }
  fillNormal(target, start = 0, end = target.length) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > target.length) {
      throw new RangeError("Invalid Gaussian fill range");
    }
    for (let index = start; index < end; index += 1) {
      target[index] = Math.fround(this.nextNormal());
    }
  }
};

// node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs
var ort_webgpu_bundle_min_exports = {};
__export(ort_webgpu_bundle_min_exports, {
  InferenceSession: () => Xf,
  TRACE: () => $a,
  TRACE_EVENT_BEGIN: () => $e,
  TRACE_EVENT_END: () => ze,
  TRACE_FUNC_BEGIN: () => tt,
  TRACE_FUNC_END: () => rt,
  Tensor: () => Le,
  default: () => vl,
  env: () => Q,
  registerBackend: () => Qe
});
var Hr = Object.defineProperty;
var jf = Object.getOwnPropertyDescriptor;
var Hf = Object.getOwnPropertyNames;
var qf = Object.prototype.hasOwnProperty;
var qr = ((a) => typeof __require < "u" ? __require : typeof Proxy < "u" ? new Proxy(a, { get: (r, s) => (typeof __require < "u" ? __require : r)[s] }) : a)(function(a) {
  if (typeof __require < "u") return __require.apply(this, arguments);
  throw Error('Dynamic require of "' + a + '" is not supported');
});
var k = (a, r) => () => (a && (r = a(a = 0)), r);
var At = (a, r) => {
  for (var s in r) Hr(a, s, { get: r[s], enumerable: true });
};
var Yf = (a, r, s, f) => {
  if (r && typeof r == "object" || typeof r == "function") for (let i of Hf(r)) !qf.call(a, i) && i !== s && Hr(a, i, { get: () => r[i], enumerable: !(f = jf(r, i)) || f.enumerable });
  return a;
};
var zt = (a) => Yf(Hr({}, "__esModule", { value: true }), a);
var Vt;
var Ke;
var Qe;
var Jf;
var va;
var Yr = k(() => {
  "use strict";
  Vt = /* @__PURE__ */ new Map(), Ke = [], Qe = (a, r, s) => {
    if (r && typeof r.init == "function" && typeof r.createInferenceSessionHandler == "function") {
      let f = Vt.get(a);
      if (f === void 0) Vt.set(a, { backend: r, priority: s });
      else {
        if (f.priority > s) return;
        if (f.priority === s && f.backend !== r) throw new Error(`cannot register backend "${a}" using priority ${s}`);
      }
      if (s >= 0) {
        let i = Ke.indexOf(a);
        i !== -1 && Ke.splice(i, 1);
        for (let d = 0; d < Ke.length; d++) if (Vt.get(Ke[d]).priority <= s) {
          Ke.splice(d, 0, a);
          return;
        }
        Ke.push(a);
      }
      return;
    }
    throw new TypeError("not a valid backend");
  }, Jf = async (a) => {
    let r = Vt.get(a);
    if (!r) return "backend not found.";
    if (r.initialized) return r.backend;
    if (r.aborted) return r.error;
    {
      let s = !!r.initPromise;
      try {
        return s || (r.initPromise = r.backend.init(a)), await r.initPromise, r.initialized = true, r.backend;
      } catch (f) {
        return s || (r.error = `${f}`, r.aborted = true), r.error;
      } finally {
        delete r.initPromise;
      }
    }
  }, va = async (a) => {
    let r = a.executionProviders || [], s = r.map((y) => typeof y == "string" ? y : y.name), f = s.length === 0 ? Ke : s, i, d = [], l = /* @__PURE__ */ new Set();
    for (let y of f) {
      let w = await Jf(y);
      typeof w == "string" ? d.push({ name: y, err: w }) : (i || (i = w), i === w && l.add(y));
    }
    if (!i) throw new Error(`no available backend found. ERR: ${d.map((y) => `[${y.name}] ${y.err}`).join(", ")}`);
    for (let { name: y, err: w } of d) s.includes(y) && console.warn(`removing requested execution provider "${y}" from session options because it is not available: ${w}`);
    let m = r.filter((y) => l.has(typeof y == "string" ? y : y.name));
    return [i, new Proxy(a, { get: (y, w) => w === "executionProviders" ? m : Reflect.get(y, w) })];
  };
});
var Ea = k(() => {
  "use strict";
  Yr();
});
var Sa;
var Aa = k(() => {
  "use strict";
  Sa = "1.27.0";
});
var Ia;
var ie;
var Jr = k(() => {
  "use strict";
  Aa();
  Ia = "warning", ie = { wasm: {}, webgl: {}, webgpu: {}, versions: { common: Sa }, set logLevel(a) {
    if (a !== void 0) {
      if (typeof a != "string" || ["verbose", "info", "warning", "error", "fatal"].indexOf(a) === -1) throw new Error(`Unsupported logging level: ${a}`);
      Ia = a;
    }
  }, get logLevel() {
    return Ia;
  } };
  Object.defineProperty(ie, "logLevel", { enumerable: true });
});
var Q;
var xa = k(() => {
  "use strict";
  Jr();
  Q = ie;
});
var La;
var Ba;
var Oa = k(() => {
  "use strict";
  La = (a, r) => {
    let s = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
    s.width = a.dims[3], s.height = a.dims[2];
    let f = s.getContext("2d");
    if (f != null) {
      let i, d;
      r?.tensorLayout !== void 0 && r.tensorLayout === "NHWC" ? (i = a.dims[2], d = a.dims[3]) : (i = a.dims[3], d = a.dims[2]);
      let l = r?.format !== void 0 ? r.format : "RGB", m = r?.norm, y, w;
      m === void 0 || m.mean === void 0 ? y = [255, 255, 255, 255] : typeof m.mean == "number" ? y = [m.mean, m.mean, m.mean, m.mean] : (y = [m.mean[0], m.mean[1], m.mean[2], 0], m.mean[3] !== void 0 && (y[3] = m.mean[3])), m === void 0 || m.bias === void 0 ? w = [0, 0, 0, 0] : typeof m.bias == "number" ? w = [m.bias, m.bias, m.bias, m.bias] : (w = [m.bias[0], m.bias[1], m.bias[2], 0], m.bias[3] !== void 0 && (w[3] = m.bias[3]));
      let T = d * i, g = 0, v = T, S = T * 2, U = -1;
      l === "RGBA" ? (g = 0, v = T, S = T * 2, U = T * 3) : l === "RGB" ? (g = 0, v = T, S = T * 2) : l === "RBG" && (g = 0, S = T, v = T * 2);
      for (let R = 0; R < d; R++) for (let H = 0; H < i; H++) {
        let C = (a.data[g++] - w[0]) * y[0], M = (a.data[v++] - w[1]) * y[1], q = (a.data[S++] - w[2]) * y[2], B = U === -1 ? 255 : (a.data[U++] - w[3]) * y[3];
        f.fillStyle = "rgba(" + C + "," + M + "," + q + "," + B + ")", f.fillRect(H, R, 1, 1);
      }
      if ("toDataURL" in s) return s.toDataURL();
      throw new Error("toDataURL is not supported");
    } else throw new Error("Can not access image data");
  }, Ba = (a, r) => {
    let s = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), f;
    if (s != null) {
      let i, d, l;
      r?.tensorLayout !== void 0 && r.tensorLayout === "NHWC" ? (i = a.dims[2], d = a.dims[1], l = a.dims[3]) : (i = a.dims[3], d = a.dims[2], l = a.dims[1]);
      let m = r !== void 0 && r.format !== void 0 ? r.format : "RGB", y = r?.norm, w, T;
      y === void 0 || y.mean === void 0 ? w = [255, 255, 255, 255] : typeof y.mean == "number" ? w = [y.mean, y.mean, y.mean, y.mean] : (w = [y.mean[0], y.mean[1], y.mean[2], 255], y.mean[3] !== void 0 && (w[3] = y.mean[3])), y === void 0 || y.bias === void 0 ? T = [0, 0, 0, 0] : typeof y.bias == "number" ? T = [y.bias, y.bias, y.bias, y.bias] : (T = [y.bias[0], y.bias[1], y.bias[2], 0], y.bias[3] !== void 0 && (T[3] = y.bias[3]));
      let g = d * i;
      if (r !== void 0 && (r.format !== void 0 && l === 4 && r.format !== "RGBA" || l === 3 && r.format !== "RGB" && r.format !== "BGR")) throw new Error("Tensor format doesn't match input tensor dims");
      let v = 4, S = 0, U = 1, R = 2, H = 3, C = 0, M = g, q = g * 2, B = -1;
      m === "RGBA" ? (C = 0, M = g, q = g * 2, B = g * 3) : m === "RGB" ? (C = 0, M = g, q = g * 2) : m === "RBG" && (C = 0, q = g, M = g * 2), f = s.createImageData(i, d);
      for (let W = 0; W < d * i; S += v, U += v, R += v, H += v, W++) f.data[S] = (a.data[C++] - T[0]) * w[0], f.data[U] = (a.data[M++] - T[1]) * w[1], f.data[R] = (a.data[q++] - T[2]) * w[2], f.data[H] = B === -1 ? 255 : (a.data[B++] - T[3]) * w[3];
    } else throw new Error("Can not access image data");
    return f;
  };
});
var Xr;
var Ma;
var Ua;
var Ca;
var Da;
var Pa;
var _a = k(() => {
  "use strict";
  jt();
  Xr = (a, r) => {
    if (a === void 0) throw new Error("Image buffer must be defined");
    if (r.height === void 0 || r.width === void 0) throw new Error("Image height and width must be defined");
    if (r.tensorLayout === "NHWC") throw new Error("NHWC Tensor layout is not supported yet");
    let { height: s, width: f } = r, i = r.norm ?? { mean: 255, bias: 0 }, d, l;
    typeof i.mean == "number" ? d = [i.mean, i.mean, i.mean, i.mean] : d = [i.mean[0], i.mean[1], i.mean[2], i.mean[3] ?? 255], typeof i.bias == "number" ? l = [i.bias, i.bias, i.bias, i.bias] : l = [i.bias[0], i.bias[1], i.bias[2], i.bias[3] ?? 0];
    let m = r.format !== void 0 ? r.format : "RGBA", y = r.tensorFormat !== void 0 && r.tensorFormat !== void 0 ? r.tensorFormat : "RGB", w = s * f, T = y === "RGBA" ? new Float32Array(w * 4) : new Float32Array(w * 3), g = 4, v = 0, S = 1, U = 2, R = 3, H = 0, C = w, M = w * 2, q = -1;
    m === "RGB" && (g = 3, v = 0, S = 1, U = 2, R = -1), y === "RGBA" ? q = w * 3 : y === "RBG" ? (H = 0, M = w, C = w * 2) : y === "BGR" && (M = 0, C = w, H = w * 2);
    for (let W = 0; W < w; W++, v += g, U += g, S += g, R += g) T[H++] = (a[v] + l[0]) / d[0], T[C++] = (a[S] + l[1]) / d[1], T[M++] = (a[U] + l[2]) / d[2], q !== -1 && R !== -1 && (T[q++] = (a[R] + l[3]) / d[3]);
    return y === "RGBA" ? new le("float32", T, [1, 4, s, f]) : new le("float32", T, [1, 3, s, f]);
  }, Ma = async (a, r) => {
    let s = typeof HTMLImageElement < "u" && a instanceof HTMLImageElement, f = typeof ImageData < "u" && a instanceof ImageData, i = typeof ImageBitmap < "u" && a instanceof ImageBitmap, d = typeof a == "string", l, m = r ?? {}, y = () => {
      if (typeof document < "u") return document.createElement("canvas");
      if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
      throw new Error("Canvas is not supported");
    }, w = (T) => typeof HTMLCanvasElement < "u" && T instanceof HTMLCanvasElement || T instanceof OffscreenCanvas ? T.getContext("2d") : null;
    if (s) {
      let T = y();
      T.width = a.width, T.height = a.height;
      let g = w(T);
      if (g != null) {
        let v = a.height, S = a.width;
        if (r !== void 0 && r.resizedHeight !== void 0 && r.resizedWidth !== void 0 && (v = r.resizedHeight, S = r.resizedWidth), r !== void 0) {
          if (m = r, r.tensorFormat !== void 0) throw new Error("Image input config format must be RGBA for HTMLImageElement");
          m.tensorFormat = "RGBA", m.height = v, m.width = S;
        } else m.tensorFormat = "RGBA", m.height = v, m.width = S;
        g.drawImage(a, 0, 0), l = g.getImageData(0, 0, S, v).data;
      } else throw new Error("Can not access image data");
    } else if (f) {
      let T, g;
      if (r !== void 0 && r.resizedWidth !== void 0 && r.resizedHeight !== void 0 ? (T = r.resizedHeight, g = r.resizedWidth) : (T = a.height, g = a.width), r !== void 0 && (m = r), m.format = "RGBA", m.height = T, m.width = g, r !== void 0) {
        let v = y();
        v.width = g, v.height = T;
        let S = w(v);
        if (S != null) S.putImageData(a, 0, 0), l = S.getImageData(0, 0, g, T).data;
        else throw new Error("Can not access image data");
      } else l = a.data;
    } else if (i) {
      if (r === void 0) throw new Error("Please provide image config with format for Imagebitmap");
      let T = y();
      T.width = a.width, T.height = a.height;
      let g = w(T);
      if (g != null) {
        let v = a.height, S = a.width;
        return g.drawImage(a, 0, 0, S, v), l = g.getImageData(0, 0, S, v).data, m.height = v, m.width = S, Xr(l, m);
      } else throw new Error("Can not access image data");
    } else {
      if (d) return new Promise((T, g) => {
        let v = y(), S = w(v);
        if (!a || !S) return g();
        let U = new Image();
        U.crossOrigin = "Anonymous", U.src = a, U.onload = () => {
          v.width = U.width, v.height = U.height, S.drawImage(U, 0, 0, v.width, v.height);
          let R = S.getImageData(0, 0, v.width, v.height);
          m.height = v.height, m.width = v.width, T(Xr(R.data, m));
        };
      });
      throw new Error("Input data provided is not supported - aborted tensor creation");
    }
    if (l !== void 0) return Xr(l, m);
    throw new Error("Input data provided is not supported - aborted tensor creation");
  }, Ua = (a, r) => {
    let { width: s, height: f, download: i, dispose: d } = r, l = [1, f, s, 4];
    return new le({ location: "texture", type: "float32", texture: a, dims: l, download: i, dispose: d });
  }, Ca = (a, r) => {
    let { dataType: s, dims: f, download: i, dispose: d } = r;
    return new le({ location: "gpu-buffer", type: s ?? "float32", gpuBuffer: a, dims: f, download: i, dispose: d });
  }, Da = (a, r) => {
    let { dataType: s, dims: f, download: i, dispose: d } = r;
    return new le({ location: "ml-tensor", type: s ?? "float32", mlTensor: a, dims: f, download: i, dispose: d });
  }, Pa = (a, r, s) => new le({ location: "cpu-pinned", type: a, data: r, dims: s ?? [r.length] });
});
var et;
var It;
var Ra;
var Na;
var ka = k(() => {
  "use strict";
  et = /* @__PURE__ */ new Map([["float32", Float32Array], ["uint8", Uint8Array], ["int8", Int8Array], ["uint16", Uint16Array], ["int16", Int16Array], ["int32", Int32Array], ["bool", Uint8Array], ["float64", Float64Array], ["uint32", Uint32Array], ["int4", Uint8Array], ["uint4", Uint8Array]]), It = /* @__PURE__ */ new Map([[Float32Array, "float32"], [Uint8Array, "uint8"], [Int8Array, "int8"], [Uint16Array, "uint16"], [Int16Array, "int16"], [Int32Array, "int32"], [Float64Array, "float64"], [Uint32Array, "uint32"]]), Ra = false, Na = () => {
    if (!Ra) {
      Ra = true;
      let a = typeof BigInt64Array < "u" && BigInt64Array.from, r = typeof BigUint64Array < "u" && BigUint64Array.from, s = globalThis.Float16Array, f = typeof s < "u" && s.from;
      a && (et.set("int64", BigInt64Array), It.set(BigInt64Array, "int64")), r && (et.set("uint64", BigUint64Array), It.set(BigUint64Array, "uint64")), f ? (et.set("float16", s), It.set(s, "float16")) : et.set("float16", Uint16Array);
    }
  };
});
var Wa;
var Fa;
var Ga = k(() => {
  "use strict";
  jt();
  Wa = (a) => {
    let r = 1;
    for (let s = 0; s < a.length; s++) {
      let f = a[s];
      if (typeof f != "number" || !Number.isSafeInteger(f)) throw new TypeError(`dims[${s}] must be an integer, got: ${f}`);
      if (f < 0) throw new RangeError(`dims[${s}] must be a non-negative integer, got: ${f}`);
      r *= f;
    }
    return r;
  }, Fa = (a, r) => {
    switch (a.location) {
      case "cpu":
        return new le(a.type, a.data, r);
      case "cpu-pinned":
        return new le({ location: "cpu-pinned", data: a.data, type: a.type, dims: r });
      case "texture":
        return new le({ location: "texture", texture: a.texture, type: a.type, dims: r });
      case "gpu-buffer":
        return new le({ location: "gpu-buffer", gpuBuffer: a.gpuBuffer, type: a.type, dims: r });
      case "ml-tensor":
        return new le({ location: "ml-tensor", mlTensor: a.mlTensor, type: a.type, dims: r });
      default:
        throw new Error(`tensorReshape: tensor location ${a.location} is not supported`);
    }
  };
});
var le;
var jt = k(() => {
  "use strict";
  Oa();
  _a();
  ka();
  Ga();
  le = class {
    constructor(r, s, f) {
      Na();
      let i, d;
      if (typeof r == "object" && "location" in r) switch (this.dataLocation = r.location, i = r.type, d = r.dims, r.location) {
        case "cpu-pinned": {
          let m = et.get(i);
          if (!m) throw new TypeError(`unsupported type "${i}" to create tensor from pinned buffer`);
          if (!(r.data instanceof m)) throw new TypeError(`buffer should be of type ${m.name}`);
          this.cpuData = r.data;
          break;
        }
        case "texture": {
          if (i !== "float32") throw new TypeError(`unsupported type "${i}" to create tensor from texture`);
          this.gpuTextureData = r.texture, this.downloader = r.download, this.disposer = r.dispose;
          break;
        }
        case "gpu-buffer": {
          if (i !== "float32" && i !== "float16" && i !== "int32" && i !== "int64" && i !== "uint32" && i !== "uint8" && i !== "bool" && i !== "uint4" && i !== "int4") throw new TypeError(`unsupported type "${i}" to create tensor from gpu buffer`);
          this.gpuBufferData = r.gpuBuffer, this.downloader = r.download, this.disposer = r.dispose;
          break;
        }
        case "ml-tensor": {
          if (i !== "float32" && i !== "float16" && i !== "int32" && i !== "int64" && i !== "uint32" && i !== "uint64" && i !== "int8" && i !== "uint8" && i !== "bool" && i !== "uint4" && i !== "int4") throw new TypeError(`unsupported type "${i}" to create tensor from MLTensor`);
          this.mlTensorData = r.mlTensor, this.downloader = r.download, this.disposer = r.dispose;
          break;
        }
        default:
          throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
      }
      else {
        let m, y;
        if (typeof r == "string") if (i = r, y = f, r === "string") {
          if (!Array.isArray(s)) throw new TypeError("A string tensor's data must be a string array.");
          m = s;
        } else {
          let w = et.get(r);
          if (w === void 0) throw new TypeError(`Unsupported tensor type: ${r}.`);
          if (Array.isArray(s)) {
            if (r === "float16" && w === Uint16Array || r === "uint4" || r === "int4") throw new TypeError(`Creating a ${r} tensor from number array is not supported. Please use ${w.name} as data.`);
            r === "uint64" || r === "int64" ? m = w.from(s, BigInt) : m = w.from(s);
          } else if (s instanceof w) m = s;
          else if (s instanceof Uint8ClampedArray) if (r === "uint8") m = Uint8Array.from(s);
          else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
          else if (r === "float16" && s instanceof Uint16Array && w !== Uint16Array) m = new globalThis.Float16Array(s.buffer, s.byteOffset, s.length);
          else throw new TypeError(`A ${i} tensor's data must be type of ${w}`);
        }
        else if (y = s, Array.isArray(r)) {
          if (r.length === 0) throw new TypeError("Tensor type cannot be inferred from an empty array.");
          let w = typeof r[0];
          if (w === "string") i = "string", m = r;
          else if (w === "boolean") i = "bool", m = Uint8Array.from(r);
          else throw new TypeError(`Invalid element type of data array: ${w}.`);
        } else if (r instanceof Uint8ClampedArray) i = "uint8", m = Uint8Array.from(r);
        else {
          let w = It.get(r.constructor);
          if (w === void 0) throw new TypeError(`Unsupported type for tensor data: ${r.constructor}.`);
          i = w, m = r;
        }
        if (y === void 0) y = [m.length];
        else if (!Array.isArray(y)) throw new TypeError("A tensor's dims must be a number array");
        d = y, this.cpuData = m, this.dataLocation = "cpu";
      }
      let l = Wa(d);
      if (this.cpuData && l !== this.cpuData.length && !((i === "uint4" || i === "int4") && Math.ceil(l / 2) === this.cpuData.length)) throw new Error(`Tensor's size(${l}) does not match data length(${this.cpuData.length}).`);
      this.type = i, this.dims = d, this.size = l;
    }
    static async fromImage(r, s) {
      return Ma(r, s);
    }
    static fromTexture(r, s) {
      return Ua(r, s);
    }
    static fromGpuBuffer(r, s) {
      return Ca(r, s);
    }
    static fromMLTensor(r, s) {
      return Da(r, s);
    }
    static fromPinnedBuffer(r, s, f) {
      return Pa(r, s, f);
    }
    toDataURL(r) {
      return La(this, r);
    }
    toImageData(r) {
      return Ba(this, r);
    }
    get data() {
      if (this.ensureValid(), !this.cpuData) throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
      return this.cpuData;
    }
    get location() {
      return this.dataLocation;
    }
    get texture() {
      if (this.ensureValid(), !this.gpuTextureData) throw new Error("The data is not stored as a WebGL texture.");
      return this.gpuTextureData;
    }
    get gpuBuffer() {
      if (this.ensureValid(), !this.gpuBufferData) throw new Error("The data is not stored as a WebGPU buffer.");
      return this.gpuBufferData;
    }
    get mlTensor() {
      if (this.ensureValid(), !this.mlTensorData) throw new Error("The data is not stored as a WebNN MLTensor.");
      return this.mlTensorData;
    }
    async getData(r) {
      switch (this.ensureValid(), this.dataLocation) {
        case "cpu":
        case "cpu-pinned":
          return this.data;
        case "texture":
        case "gpu-buffer":
        case "ml-tensor": {
          if (!this.downloader) throw new Error("The current tensor is not created with a specified data downloader.");
          if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
          try {
            this.isDownloading = true;
            let s = await this.downloader();
            return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = s, r && this.disposer && (this.disposer(), this.disposer = void 0), s;
          } finally {
            this.isDownloading = false;
          }
        }
        default:
          throw new Error(`cannot get data from location: ${this.dataLocation}`);
      }
    }
    dispose() {
      if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
      this.disposer && (this.disposer(), this.disposer = void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
    }
    ensureValid() {
      if (this.dataLocation === "none") throw new Error("The tensor is disposed.");
    }
    reshape(r) {
      if (this.ensureValid(), this.downloader || this.disposer) throw new Error("Cannot reshape a tensor that owns GPU resource.");
      return Fa(this, r);
    }
  };
});
var Le;
var Zr = k(() => {
  "use strict";
  jt();
  Le = le;
});
var $a;
var za;
var tt;
var rt;
var $e;
var ze;
var Kr = k(() => {
  "use strict";
  Jr();
  $a = (a, r) => {
    (typeof ie.trace > "u" ? !ie.wasm.trace : !ie.trace) || console.timeStamp(`${a}::ORT::${r}`);
  }, za = (a, r) => {
    let s = new Error().stack?.split(/\r\n|\r|\n/g) || [], f = false;
    for (let i = 0; i < s.length; i++) {
      if (f && !s[i].includes("TRACE_FUNC")) {
        let d = `FUNC_${a}::${s[i].trim().split(" ")[1]}`;
        r && (d += `::${r}`), $a("CPU", d);
        return;
      }
      s[i].includes("TRACE_FUNC") && (f = true);
    }
  }, tt = (a) => {
    (typeof ie.trace > "u" ? !ie.wasm.trace : !ie.trace) || za("BEGIN", a);
  }, rt = (a) => {
    (typeof ie.trace > "u" ? !ie.wasm.trace : !ie.trace) || za("END", a);
  }, $e = (a) => {
    (typeof ie.trace > "u" ? !ie.wasm.trace : !ie.trace) || console.time(`ORT::${a}`);
  }, ze = (a) => {
    (typeof ie.trace > "u" ? !ie.wasm.trace : !ie.trace) || console.timeEnd(`ORT::${a}`);
  };
});
var Ht;
var Va = k(() => {
  "use strict";
  Yr();
  Zr();
  Kr();
  Ht = class a {
    constructor(r) {
      this.handler = r;
    }
    async run(r, s, f) {
      tt(), $e("InferenceSession.run");
      let i = {}, d = {};
      if (typeof r != "object" || r === null || r instanceof Le || Array.isArray(r)) throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
      let l = true;
      if (typeof s == "object") {
        if (s === null) throw new TypeError("Unexpected argument[1]: cannot be null.");
        if (s instanceof Le) throw new TypeError("'fetches' cannot be a Tensor");
        if (Array.isArray(s)) {
          if (s.length === 0) throw new TypeError("'fetches' cannot be an empty array.");
          l = false;
          for (let w of s) {
            if (typeof w != "string") throw new TypeError("'fetches' must be a string array or an object.");
            if (this.outputNames.indexOf(w) === -1) throw new RangeError(`'fetches' contains invalid output name: ${w}.`);
            i[w] = null;
          }
          if (typeof f == "object" && f !== null) d = f;
          else if (typeof f < "u") throw new TypeError("'options' must be an object.");
        } else {
          let w = false, T = Object.getOwnPropertyNames(s);
          for (let g of this.outputNames) if (T.indexOf(g) !== -1) {
            let v = s[g];
            (v === null || v instanceof Le) && (w = true, l = false, i[g] = v);
          }
          if (w) {
            if (typeof f == "object" && f !== null) d = f;
            else if (typeof f < "u") throw new TypeError("'options' must be an object.");
          } else d = s;
        }
      } else if (typeof s < "u") throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
      for (let w of this.inputNames) if (typeof r[w] > "u") throw new Error(`input '${w}' is missing in 'feeds'.`);
      if (l) for (let w of this.outputNames) i[w] = null;
      let m = await this.handler.run(r, i, d), y = {};
      for (let w in m) if (Object.hasOwnProperty.call(m, w)) {
        let T = m[w];
        T instanceof Le ? y[w] = T : y[w] = new Le(T.type, T.data, T.dims);
      }
      return ze("InferenceSession.run"), rt(), y;
    }
    async release() {
      return this.handler.dispose();
    }
    static async create(r, s, f, i) {
      tt(), $e("InferenceSession.create");
      let d, l = {};
      if (typeof r == "string") {
        if (d = r, typeof s == "object" && s !== null) l = s;
        else if (typeof s < "u") throw new TypeError("'options' must be an object.");
      } else if (r instanceof Uint8Array) {
        if (d = r, typeof s == "object" && s !== null) l = s;
        else if (typeof s < "u") throw new TypeError("'options' must be an object.");
      } else if (r instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && r instanceof SharedArrayBuffer) {
        let T = r, g = 0, v = r.byteLength;
        if (typeof s == "object" && s !== null) l = s;
        else if (typeof s == "number") {
          if (g = s, !Number.isSafeInteger(g)) throw new RangeError("'byteOffset' must be an integer.");
          if (g < 0 || g >= T.byteLength) throw new RangeError(`'byteOffset' is out of range [0, ${T.byteLength}).`);
          if (v = r.byteLength - g, typeof f == "number") {
            if (v = f, !Number.isSafeInteger(v)) throw new RangeError("'byteLength' must be an integer.");
            if (v <= 0 || g + v > T.byteLength) throw new RangeError(`'byteLength' is out of range (0, ${T.byteLength - g}].`);
            if (typeof i == "object" && i !== null) l = i;
            else if (typeof i < "u") throw new TypeError("'options' must be an object.");
          } else if (typeof f < "u") throw new TypeError("'byteLength' must be a number.");
        } else if (typeof s < "u") throw new TypeError("'options' must be an object.");
        d = new Uint8Array(T, g, v);
      } else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
      let [m, y] = await va(l), w = await m.createInferenceSessionHandler(d, y);
      return ze("InferenceSession.create"), rt(), new a(w);
    }
    startProfiling() {
      this.handler.startProfiling();
    }
    endProfiling() {
      this.handler.endProfiling();
    }
    get inputNames() {
      return this.handler.inputNames;
    }
    get outputNames() {
      return this.handler.outputNames;
    }
    get inputMetadata() {
      return this.handler.inputMetadata;
    }
    get outputMetadata() {
      return this.handler.outputMetadata;
    }
  };
});
var Xf;
var ja = k(() => {
  "use strict";
  Va();
  Xf = Ht;
});
var Ha = k(() => {
  "use strict";
});
var qa = k(() => {
  "use strict";
});
var Ya = k(() => {
  "use strict";
});
var Ja = k(() => {
  "use strict";
});
var Qr = {};
At(Qr, { InferenceSession: () => Xf, TRACE: () => $a, TRACE_EVENT_BEGIN: () => $e, TRACE_EVENT_END: () => ze, TRACE_FUNC_BEGIN: () => tt, TRACE_FUNC_END: () => rt, Tensor: () => Le, env: () => Q, registerBackend: () => Qe });
var Ve = k(() => {
  "use strict";
  Ea();
  xa();
  ja();
  Zr();
  Ha();
  qa();
  Kr();
  Ya();
  Ja();
});
var qt = k(() => {
  "use strict";
});
var Qa = {};
At(Qa, { default: () => Zf });
var Za;
var Ka;
var Zf;
var es = k(() => {
  "use strict";
  en();
  je();
  Yt();
  Za = "ort-wasm-proxy-worker", Ka = globalThis.self?.name === Za;
  Ka && (self.onmessage = (a) => {
    let { type: r, in: s } = a.data;
    try {
      switch (r) {
        case "init-wasm":
          Jt(s.wasm).then(() => {
            Xt(s).then(() => {
              postMessage({ type: r });
            }, (f) => {
              postMessage({ type: r, err: f });
            });
          }, (f) => {
            postMessage({ type: r, err: f });
          });
          break;
        case "init-ep": {
          let { epName: f, env: i } = s;
          Zt(i, f).then(() => {
            postMessage({ type: r });
          }, (d) => {
            postMessage({ type: r, err: d });
          });
          break;
        }
        case "copy-from": {
          let { buffer: f } = s, i = xt(f);
          postMessage({ type: r, out: i });
          break;
        }
        case "create": {
          let { model: f, options: i } = s;
          Kt(f, i).then((d) => {
            postMessage({ type: r, out: d });
          }, (d) => {
            postMessage({ type: r, err: d });
          });
          break;
        }
        case "release":
          Qt(s), postMessage({ type: r });
          break;
        case "run": {
          let { sessionId: f, inputIndices: i, inputs: d, outputIndices: l, options: m } = s;
          er(f, i, d, l, new Array(l.length).fill(null), m).then((y) => {
            y.some((w) => w[3] !== "cpu") ? postMessage({ type: r, err: "Proxy does not support non-cpu tensor location." }) : postMessage({ type: r, out: y }, rr([...d, ...y]));
          }, (y) => {
            postMessage({ type: r, err: y });
          });
          break;
        }
        case "end-profiling":
          tr(s), postMessage({ type: r });
          break;
        default:
      }
    } catch (f) {
      postMessage({ type: r, err: f });
    }
  });
  Zf = Ka ? null : (a) => new Worker(a ?? ge, { type: "module", name: Za });
});
var rs = {};
At(rs, { default: () => Kf });
async function ts(a = {}) {
  var r = a, s = !!globalThis.window, f = !!globalThis.WorkerGlobalScope, i = f && self.name?.startsWith("em-pthread");
  r.mountExternalData = (e, t) => {
    e.startsWith("./") && (e = e.substring(2)), (r.Vc || (r.Vc = /* @__PURE__ */ new Map())).set(e, t);
  }, r.unmountExternalData = () => {
    delete r.Vc;
  }, globalThis.SharedArrayBuffer ?? new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true }).buffer.constructor;
  let d = () => {
    let e = (t) => (...n) => {
      let o = Me;
      return n = t(...n), Me != o ? new Promise((u, c) => {
        Br = { resolve: u, reject: c };
      }) : n;
    };
    (() => {
      for (let t of ["_OrtAppendExecutionProvider", "_OrtCreateSession", "_OrtRun", "_OrtRunWithBinding", "_OrtBindInput"]) r[t] = e(r[t]);
    })(), typeof jsepRunAsync < "u" && (r._OrtRun = jsepRunAsync(r._OrtRun), r._OrtRunWithBinding = jsepRunAsync(r._OrtRunWithBinding)), d = void 0;
  };
  r.asyncInit = () => {
    d?.();
  };
  var l, m, y = (e, t) => {
    throw t;
  }, w = import.meta.url, T = "";
  if (s || f) {
    try {
      T = new URL(".", w).href;
    } catch {
    }
    f && (m = (e) => {
      var t = new XMLHttpRequest();
      return t.open("GET", e, false), t.responseType = "arraybuffer", t.send(null), new Uint8Array(t.response);
    }), l = async (e) => {
      if (oe(e)) return new Promise((n, o) => {
        var u = new XMLHttpRequest();
        u.open("GET", e, true), u.responseType = "arraybuffer", u.onload = () => {
          u.status == 200 || u.status == 0 && u.response ? n(u.response) : o(u.status);
        }, u.onerror = o, u.send(null);
      });
      var t = await fetch(e, { credentials: "same-origin" });
      if (t.ok) return t.arrayBuffer();
      throw Error(t.status + " : " + t.url);
    };
  }
  var g, v, S, U, R, H, C = console.log.bind(console), M = console.error.bind(console), q = C, B = M, W = false, oe = (e) => e.startsWith("file://");
  function p() {
    Fe.buffer != X.buffer && se();
  }
  if (i) {
    let e = function(t) {
      try {
        var n = t.data, o = n.Pc;
        if (o === "load") {
          let u = [];
          self.onmessage = (c) => u.push(c), H = () => {
            postMessage({ Pc: "loaded" });
            for (let c of u) e(c);
            self.onmessage = e;
          };
          for (let c of n.ee) r[c] && !r[c].proxy || (r[c] = (...h) => {
            postMessage({ Pc: "callHandler", de: c, args: h });
          }, c == "print" && (q = r[c]), c == "printErr" && (B = r[c]));
          Fe = n.ke, se(), v = n.le, bt(), $t();
        } else if (o === "run") {
          (function(u) {
            var c = (p(), A)[u + 52 >>> 2 >>> 0];
            u = (p(), A)[u + 56 >>> 2 >>> 0], Uo(c, c - u), D(c);
          })(n.Oc), Fr(n.Oc, 0, 0, 1, 0, 0), bn(), Ir(n.Oc), ne || (po(), ne = true);
          try {
            zs(n.ie, n.Xc);
          } catch (u) {
            if (u != "unwind") throw u;
          }
        } else n.target !== "setimmediate" && (o === "checkMailbox" ? ne && Pt() : o && (B(`worker: received unknown command ${o}`), B(n)));
      } catch (u) {
        throw xo(), u;
      }
    };
    var Sc = e, ne = false;
    self.onunhandledrejection = (t) => {
      throw t.reason || t;
    }, self.onmessage = e;
  }
  var X, J, Ce, Z, x, A, _, ae, me, Y, we, re = false;
  function se() {
    var e = Fe.buffer;
    r.HEAP8 = X = new Int8Array(e), Ce = new Int16Array(e), r.HEAPU8 = J = new Uint8Array(e), Z = new Uint16Array(e), r.HEAP32 = x = new Int32Array(e), r.HEAPU32 = A = new Uint32Array(e), _ = new Float32Array(e), ae = new Float64Array(e), me = new BigInt64Array(e), Y = new BigUint64Array(e);
  }
  function yr() {
    re = true, i ? H() : ke.$b();
  }
  function Te(e) {
    throw B(e = "Aborted(" + e + ")"), W = true, e = new WebAssembly.RuntimeError(e + ". Build with -sASSERTIONS for more info."), R?.(e), e;
  }
  function qe() {
    return { a: { f: Vs, J: js, k: Hs, p: qs, l: Ys, sa: Js, b: Xs, ca: Zs, Ja: Sn, q: Ks, da: Ln, Za: Bn, Fa: On, Ha: Mn, _a: Un, Xa: Cn, Qa: Dn, Wa: Pn, oa: _n, Ga: Rn, Yb: Nn, Ya: kn, Zb: Wn, db: Qs, Da: ti, Tb: ri, Rb: oi, Ca: si, M: ii, I: ui, Sb: fi, ja: yi, Ub: bi, Ta: wi, Wb: Ti, Ka: vi, Pb: Ei, ka: Si, Sa: Ir, ab: Ai, U: Bi, n: Di, c: Sr, rb: Pi, w: _i, L: Ri, z: Ni, j: ki, o: qn, sb: Wi, G: Fi, T: Gi, h: $i, u: zi, m: Vi, i: ji, Na: Hi, Oa: qi, Pa: Yi, La: Zn, Ma: Kn, Qb: Qn, eb: Xi, cb: Qi, Y: eu, qb: tu, la: ru, bb: Zi, fb: nu, $a: ou, Xb: au, N: Ji, gb: su, X: iu, Vb: uu, nb: bu, C: wu, ra: gu, qa: Tu, pb: vu, W: Eu, v: Su, mb: Au, lb: Iu, kb: xu, ob: Lu, jb: Bu, ib: Ou, hb: Mu, Ua: ao, Va: so, Ia: wr, V: io, na: uo, Ra: fo, ma: co, Cb: $f, xa: Rf, Db: Gf, ya: _f, F: Af, e: cf, s: uf, x: sf, B: Tf, Fb: Cf, ba: Uf, D: pf, za: Df, $: Nf, ga: Mf, Gb: Of, Hb: Bf, Ba: If, Aa: Lf, Ib: xf, wa: Ff, aa: Pf, d: ff, A: lf, r: df, Bb: zf, t: hf, y: Ef, H: mf, E: yf, K: Sf, R: kf, ia: gf, _: Wf, Kb: wf, Lb: bf, Jb: vf, g: Cu, a: Fe, Ob: Ye, Eb: Du, ha: Pu, O: _u, pa: Ru, Mb: Nu, ta: ku, Q: Wu, yb: Fu, zb: Gu, ua: $u, ea: zu, P: Vu, Ea: ju, va: Hu, Z: qu, wb: Yu, _b: Ju, S: Xu, Ab: Zu, tb: Ku, ub: ef, vb: tf, fa: rf, xb: nf, Nb: of } };
  }
  async function bt() {
    function e(o, u) {
      var c = ke = o.exports;
      o = {};
      for (let [h, b] of Object.entries(c)) typeof b == "function" ? (c = Ii(b), o[h] = c) : o[h] = b;
      return ke = o, ke = function() {
        var h = ke, b = (I) => (F) => I(F) >>> 0, E = (I) => () => I() >>> 0;
        return (h = Object.assign({}, h)).ac = b(h.ac), h.Dc = E(h.Dc), h.Fc = b(h.Fc), h.sd = /* @__PURE__ */ ((I) => (F, j) => I(F, j) >>> 0)(h.sd), h.xd = b(h.xd), h.yd = E(h.yd), h.Cd = b(h.Cd), h;
      }(), hn.push(ke.jd), lo = (o = ke).ac, po = o.bc, r._OrtInit = o.cc, r._OrtGetLastError = o.dc, r._OrtCreateSessionOptions = o.ec, r._OrtAppendExecutionProvider = o.fc, r._OrtAddFreeDimensionOverride = o.gc, r._OrtAddSessionConfigEntry = o.hc, r._OrtReleaseSessionOptions = o.ic, r._OrtCreateSession = o.jc, r._OrtReleaseSession = o.kc, r._OrtGetInputOutputCount = o.lc, r._OrtGetInputOutputMetadata = o.mc, r._OrtFree = o.nc, r._OrtCreateTensor = o.oc, r._OrtGetTensorData = o.pc, r._OrtReleaseTensor = o.qc, r._OrtCreateRunOptions = o.rc, r._OrtAddRunConfigEntry = o.sc, r._OrtReleaseRunOptions = o.tc, r._OrtCreateBinding = o.uc, r._OrtBindInput = o.vc, r._OrtBindOutput = o.wc, r._OrtClearBoundOutputs = o.xc, r._OrtReleaseBinding = o.yc, r._OrtRunWithBinding = o.zc, r._OrtRun = o.Ac, r._OrtEndProfiling = o.Bc, Pr = r._OrtGetWebGpuDevice = o.Cc, Ft = o.Dc, xe = r._free = o.Ec, pt = r._malloc = o.Fc, mo = r._wgpuBufferRelease = o.Gc, ho = r._wgpuCreateInstance = o.Hc, yo = o.Ic, bo = o.Jc, wo = o.Kc, go = o.Lc, To = o.Mc, vo = o.Qc, Eo = o._c, So = o.$c, Ao = o.ad, _r = o.cd, Rr = o.dd, Nr = o.ed, kr = o.fd, Et = o.gd, Wr = o.hd, Io = o.id, Fr = o.ld, xo = o.md, Lo = o.nd, Bo = o.od, Gr = o.pd, Oo = o.qd, Mo = o.rd, $r = o.sd, N = o.td, St = o.ud, Uo = o.vd, D = o.wd, Gt = o.xd, P = o.yd, Co = o.zd, zr = o.Ad, Do = o.Bd, Po = o.Cd, _o = o.Dd, Vr = o.Ed, Ro = o.Fd, No = o.Gd, ko = o.Hd, Wo = o.Id, Fo = o.Jd, Go = o.Kd, $o = o.Ld, zo = o.Md, Vo = o.Nd, jo = o.Od, Ho = o.Pd, qo = o.Qd, Yo = o.Rd, Jo = o.Sd, Xo = o.Ud, Zo = o.Vd, Ko = o.Wd, Qo = o.Xd, ea = o.Zd, ta = o._d, ra = o.$d, na = o.ae, oa = o.be, aa = o.ce, sa = o.qe, ia = o.re, ua = o.se, fa = o.te, ca = o.ue, da = o.ve, la = o.we, pa = o.xe, ma = o.ye, ha = o.ze, ya = o.Ae, ba = o.$e, wa = o.af, ga = o.bf, Ta = o.cf, v = u, ke;
    }
    var t, n = qe();
    return r.instantiateWasm ? new Promise((o) => {
      r.instantiateWasm(n, (u, c) => {
        o(e(u, c));
      });
    }) : i ? e(new WebAssembly.Instance(v, qe()), v) : (we ??= r.locateFile ? r.locateFile ? r.locateFile("ort-wasm-simd-threaded.asyncify.wasm", T) : T + "ort-wasm-simd-threaded.asyncify.wasm" : new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href, t = await async function(o) {
      var u = we;
      if (!g && !oe(u)) try {
        var c = fetch(u, { credentials: "same-origin" });
        return await WebAssembly.instantiateStreaming(c, o);
      } catch (h) {
        B(`wasm streaming compile failed: ${h}`), B("falling back to ArrayBuffer instantiation");
      }
      return async function(h, b) {
        try {
          var E = await async function(I) {
            if (!g) try {
              var F = await l(I);
              return new Uint8Array(F);
            } catch {
            }
            if (I == we && g) I = new Uint8Array(g);
            else {
              if (!m) throw "both async and sync fetching of the wasm failed";
              I = m(I);
            }
            return I;
          }(h);
          return await WebAssembly.instantiate(E, b);
        } catch (I) {
          B(`failed to asynchronously prepare wasm: ${I}`), Te(I);
        }
      }(u, o);
    }(n), e(t.instance, t.module));
  }
  class wt {
    name = "ExitStatus";
    constructor(t) {
      this.message = `Program terminated with exit(${t})`, this.status = t;
    }
  }
  var Se = (e) => {
    e.terminate(), e.onmessage = () => {
    };
  }, Ae = [], Be = 0, ee = null, K = (e) => {
    We.length == 0 && (gn(), wn(We[0]));
    var t = We.pop();
    if (!t) return 6;
    gt.push(t), Je[e.Oc] = t, t.Oc = e.Oc;
    var n = { Pc: "run", ie: e.he, Xc: e.Xc, Oc: e.Oc };
    return t.postMessage(n, e.Zc), 0;
  }, G = 0, V = (e, t, ...n) => {
    var o, u = 16 * n.length, c = P(), h = Gt(u), b = h >>> 3;
    for (o of n) typeof o == "bigint" ? ((p(), me)[b++ >>> 0] = 1n, (p(), me)[b++ >>> 0] = o) : ((p(), me)[b++ >>> 0] = 0n, (p(), ae)[b++ >>> 0] = o);
    return e = Lo(e, 0, u, h, t), D(c), e;
  };
  function Ye(e) {
    if (i) return V(0, 1, e);
    if (S = e, !(0 < G)) {
      for (var t of gt) Se(t);
      for (t of We) Se(t);
      We = [], gt = [], Je = {}, W = true;
    }
    y(0, new wt(e));
  }
  function br(e) {
    if (i) return V(1, 0, e);
    wr(e);
  }
  var wr = (e) => {
    if (S = e, i) throw br(e), "unwind";
    Ye(e);
  }, We = [], gt = [], hn = [], Je = {}, yn = (e) => {
    var t = e.Oc;
    delete Je[t], We.push(e), gt.splice(gt.indexOf(e), 1), e.Oc = 0, Bo(t);
  };
  function bn() {
    hn.forEach((e) => e());
  }
  var wn = (e) => new Promise((t) => {
    e.onmessage = (u) => {
      var c = u.data;
      if (u = c.Pc, c.Wc && c.Wc != Ft()) {
        var h = Je[c.Wc];
        h ? h.postMessage(c, c.Zc) : B(`Internal error! Worker sent a message "${u}" to target pthread ${c.Wc}, but that thread no longer exists!`);
      } else u === "checkMailbox" ? Pt() : u === "spawnThread" ? K(c) : u === "cleanupThread" ? he(() => {
        yn(Je[c.je]);
      }) : u === "loaded" ? (e.loaded = true, t(e)) : c.target === "setimmediate" ? e.postMessage(c) : u === "uncaughtException" ? e.onerror(c.error) : u === "callHandler" ? r[c.de](...c.args) : u && B(`worker sent an unknown command ${u}`);
    }, e.onerror = (u) => {
      throw B(`worker sent an error! ${u.filename}:${u.lineno}: ${u.message}`), u;
    };
    var n, o = [];
    for (n of []) r.propertyIsEnumerable(n) && o.push(n);
    e.postMessage({ Pc: "load", ee: o, ke: Fe, le: v });
  });
  function gn() {
    var e = new Worker((() => {
      let t = URL;
      return import.meta.url > "file:" && import.meta.url < "file;" ? new t("ort.webgpu.bundle.min.mjs", import.meta.url) : new URL(import.meta.url);
    })(), { type: "module", workerData: "em-pthread", name: "em-pthread" });
    We.push(e);
  }
  var Fe, zs = (e, t) => {
    G = 0, e = Vr(e, t), 0 < G ? S = e : Gr(e);
  }, Ct = [], Dt = 0, ce = (e) => -9007199254740992 > e || 9007199254740992 < e ? NaN : Number(e);
  function Vs(e) {
    var t = new gr(e >>>= 0);
    return (p(), X)[t.Rc + 12 >>> 0] == 0 && (Tn(t, true), Dt--), vn(t, false), Ct.push(t), Po(e);
  }
  var ft = 0, js = () => {
    N(0, 0);
    var e = Ct.pop();
    Co(e.Yc), ft = 0;
  };
  function Tn(e, t) {
    t = t ? 1 : 0, (p(), X)[e.Rc + 12 >>> 0] = t;
  }
  function vn(e, t) {
    t = t ? 1 : 0, (p(), X)[e.Rc + 13 >>> 0] = t;
  }
  class gr {
    constructor(t) {
      this.Yc = t, this.Rc = t - 24;
    }
  }
  var Tr = (e) => {
    var t = ft;
    if (!t) return St(0), 0;
    var n = new gr(t);
    (p(), A)[n.Rc + 16 >>> 2 >>> 0] = t;
    var o = (p(), A)[n.Rc + 4 >>> 2 >>> 0];
    if (!o) return St(0), t;
    for (var u of e) {
      if (u === 0 || u === o) break;
      if (Do(u, o, n.Rc + 16)) return St(u), t;
    }
    return St(o), t;
  };
  function Hs() {
    return Tr([]);
  }
  function qs(e) {
    return Tr([e >>> 0]);
  }
  function Ys(e, t, n, o) {
    return Tr([e >>> 0, t >>> 0, n >>> 0, o >>> 0]);
  }
  var Js = () => {
    var e = Ct.pop();
    e || Te("no exception to throw");
    var t = e.Yc;
    throw (p(), X)[e.Rc + 13 >>> 0] == 0 && (Ct.push(e), vn(e, true), Tn(e, false), Dt++), zr(t), ft = t;
  };
  function Xs(e, t, n) {
    var o = new gr(e >>>= 0);
    throw t >>>= 0, n >>>= 0, (p(), A)[o.Rc + 16 >>> 2 >>> 0] = 0, (p(), A)[o.Rc + 4 >>> 2 >>> 0] = t, (p(), A)[o.Rc + 8 >>> 2 >>> 0] = n, zr(e), Dt++, ft = e;
  }
  var Zs = () => Dt;
  function En(e, t, n, o) {
    return i ? V(2, 1, e, t, n, o) : Sn(e, t, n, o);
  }
  function Sn(e, t, n, o) {
    if (e >>>= 0, t >>>= 0, n >>>= 0, o >>>= 0, !globalThis.SharedArrayBuffer) return 6;
    var u = [];
    return i && u.length === 0 ? En(e, t, n, o) : (e = { he: n, Oc: e, Xc: o, Zc: u }, i ? (e.Pc = "spawnThread", postMessage(e, u), 0) : K(e));
  }
  function Ks(e) {
    throw ft ||= e >>> 0, ft;
  }
  var An = globalThis.TextDecoder && new TextDecoder(), In = (e, t, n, o) => {
    if (n = t + n, o) return n;
    for (; e[t] && !(t >= n); ) ++t;
    return t;
  }, xn = (e, t = 0, n, o) => {
    if (16 < (n = In(e, t >>>= 0, n, o)) - t && e.buffer && An) return An.decode(e.buffer instanceof ArrayBuffer ? e.subarray(t, n) : e.slice(t, n));
    for (o = ""; t < n; ) {
      var u = e[t++];
      if (128 & u) {
        var c = 63 & e[t++];
        if ((224 & u) == 192) o += String.fromCharCode((31 & u) << 6 | c);
        else {
          var h = 63 & e[t++];
          65536 > (u = (240 & u) == 224 ? (15 & u) << 12 | c << 6 | h : (7 & u) << 18 | c << 12 | h << 6 | 63 & e[t++]) ? o += String.fromCharCode(u) : (u -= 65536, o += String.fromCharCode(55296 | u >> 10, 56320 | 1023 & u));
        }
      } else o += String.fromCharCode(u);
    }
    return o;
  }, ct = (e, t, n) => (e >>>= 0) ? xn((p(), J), e, t, n) : "";
  function Ln(e, t, n) {
    return i ? V(3, 1, e, t, n) : 0;
  }
  function Bn(e, t) {
    if (i) return V(4, 1, e, t);
  }
  function On(e, t) {
    if (i) return V(5, 1, e, t);
  }
  function Mn(e, t, n) {
    if (i) return V(6, 1, e, t, n);
  }
  function Un(e, t, n) {
    return i ? V(7, 1, e, t, n) : 0;
  }
  function Cn(e, t) {
    if (i) return V(8, 1, e, t);
  }
  function Dn(e, t, n) {
    if (i) return V(9, 1, e, t, n);
  }
  function Pn(e, t, n, o) {
    if (i) return V(10, 1, e, t, n, o);
  }
  function _n(e, t, n, o) {
    if (i) return V(11, 1, e, t, n, o);
  }
  function Rn(e, t, n, o) {
    if (i) return V(12, 1, e, t, n, o);
  }
  function Nn(e) {
    if (i) return V(13, 1, e);
  }
  function kn(e, t) {
    if (i) return V(14, 1, e, t);
  }
  function Wn(e, t, n) {
    if (i) return V(15, 1, e, t, n);
  }
  var Qs = () => Te(""), Oe = (e) => {
    e >>>= 0;
    for (var t = ""; ; ) {
      var n = (p(), J)[e++ >>> 0];
      if (!n) return t;
      t += String.fromCharCode(n);
    }
  }, vr = {}, Er = {}, ei = {}, dt = class extends Error {
    constructor(e) {
      super(e), this.name = "BindingError";
    }
  };
  function De(e, t, n = {}) {
    return function(o, u, c = {}) {
      var h = u.name;
      if (!o) throw new dt(`type "${h}" must have a positive integer typeid pointer`);
      if (Er.hasOwnProperty(o)) {
        if (c.fe) return;
        throw new dt(`Cannot register type '${h}' twice`);
      }
      Er[o] = u, delete ei[o], vr.hasOwnProperty(o) && (u = vr[o], delete vr[o], u.forEach((b) => b()));
    }(e, t, n);
  }
  var Fn = (e, t, n) => {
    switch (t) {
      case 1:
        return n ? (o) => (p(), X)[o >>> 0] : (o) => (p(), J)[o >>> 0];
      case 2:
        return n ? (o) => (p(), Ce)[o >>> 1 >>> 0] : (o) => (p(), Z)[o >>> 1 >>> 0];
      case 4:
        return n ? (o) => (p(), x)[o >>> 2 >>> 0] : (o) => (p(), A)[o >>> 2 >>> 0];
      case 8:
        return n ? (o) => (p(), me)[o >>> 3 >>> 0] : (o) => (p(), Y)[o >>> 3 >>> 0];
      default:
        throw new TypeError(`invalid integer width (${t}): ${e}`);
    }
  };
  function ti(e, t, n, o, u) {
    e >>>= 0, n >>>= 0, t = Oe(t >>> 0);
    let c = (h) => h;
    if (o = o === 0n) {
      let h = 8 * n;
      c = (b) => BigInt.asUintN(h, b), u = c(u);
    }
    De(e, { name: t, Nc: c, Tc: (h, b) => (typeof b == "number" && (b = BigInt(b)), b), Sc: Fn(t, n, !o), Uc: null });
  }
  function ri(e, t, n, o) {
    De(e >>>= 0, { name: t = Oe(t >>> 0), Nc: function(u) {
      return !!u;
    }, Tc: function(u, c) {
      return c ? n : o;
    }, Sc: function(u) {
      return this.Nc((p(), J)[u >>> 0]);
    }, Uc: null });
  }
  var Gn = [], Xe = [0, 1, , 1, null, 1, true, 1, false, 1];
  function Sr(e) {
    9 < (e >>>= 0) && --Xe[e + 1] === 0 && (Xe[e] = void 0, Gn.push(e));
  }
  var ve = (e) => {
    if (!e) throw new dt(`Cannot use deleted val. handle = ${e}`);
    return Xe[e];
  }, Ie = (e) => {
    switch (e) {
      case void 0:
        return 2;
      case null:
        return 4;
      case true:
        return 6;
      case false:
        return 8;
      default:
        let t = Gn.pop() || Xe.length;
        return Xe[t] = e, Xe[t + 1] = 1, t;
    }
  };
  function Ar(e) {
    return this.Nc((p(), A)[e >>> 2 >>> 0]);
  }
  var ni = { name: "emscripten::val", Nc: (e) => {
    var t = ve(e);
    return Sr(e), t;
  }, Tc: (e, t) => Ie(t), Sc: Ar, Uc: null };
  function oi(e) {
    return De(e >>> 0, ni);
  }
  var ai = (e, t) => {
    switch (t) {
      case 4:
        return function(n) {
          return this.Nc((p(), _)[n >>> 2 >>> 0]);
        };
      case 8:
        return function(n) {
          return this.Nc((p(), ae)[n >>> 3 >>> 0]);
        };
      default:
        throw new TypeError(`invalid float width (${t}): ${e}`);
    }
  };
  function si(e, t, n) {
    n >>>= 0, De(e >>>= 0, { name: t = Oe(t >>> 0), Nc: (o) => o, Tc: (o, u) => u, Sc: ai(t, n), Uc: null });
  }
  function ii(e, t, n, o, u) {
    e >>>= 0, n >>>= 0, t = Oe(t >>> 0);
    let c = (b) => b;
    if (o === 0) {
      var h = 32 - 8 * n;
      c = (b) => b << h >>> h, u = c(u);
    }
    De(e, { name: t, Nc: c, Tc: (b, E) => E, Sc: Fn(t, n, o !== 0), Uc: null });
  }
  function ui(e, t, n) {
    function o(c) {
      var h = (p(), A)[c >>> 2 >>> 0];
      return c = (p(), A)[c + 4 >>> 2 >>> 0], new u((p(), X).buffer, c, h);
    }
    var u = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array][t];
    De(e >>>= 0, { name: n = Oe(n >>> 0), Nc: o, Sc: o }, { fe: true });
  }
  var Pe = (e, t, n) => {
    var o = (p(), J);
    if (t >>>= 0, 0 < n) {
      var u = t;
      n = t + n - 1;
      for (var c = 0; c < e.length; ++c) {
        var h = e.codePointAt(c);
        if (127 >= h) {
          if (t >= n) break;
          o[t++ >>> 0] = h;
        } else if (2047 >= h) {
          if (t + 1 >= n) break;
          o[t++ >>> 0] = 192 | h >> 6, o[t++ >>> 0] = 128 | 63 & h;
        } else if (65535 >= h) {
          if (t + 2 >= n) break;
          o[t++ >>> 0] = 224 | h >> 12, o[t++ >>> 0] = 128 | h >> 6 & 63, o[t++ >>> 0] = 128 | 63 & h;
        } else {
          if (t + 3 >= n) break;
          o[t++ >>> 0] = 240 | h >> 18, o[t++ >>> 0] = 128 | h >> 12 & 63, o[t++ >>> 0] = 128 | h >> 6 & 63, o[t++ >>> 0] = 128 | 63 & h, c++;
        }
      }
      o[t >>> 0] = 0, e = t - u;
    } else e = 0;
    return e;
  }, _e = (e) => {
    for (var t = 0, n = 0; n < e.length; ++n) {
      var o = e.charCodeAt(n);
      127 >= o ? t++ : 2047 >= o ? t += 2 : 55296 <= o && 57343 >= o ? (t += 4, ++n) : t += 3;
    }
    return t;
  };
  function fi(e, t) {
    De(e >>>= 0, { name: t = Oe(t >>> 0), Nc(n) {
      var o = (p(), A)[n >>> 2 >>> 0];
      return o = ct(n + 4, o, true), xe(n), o;
    }, Tc(n, o) {
      o instanceof ArrayBuffer && (o = new Uint8Array(o));
      var u = typeof o == "string";
      if (!(u || ArrayBuffer.isView(o) && o.BYTES_PER_ELEMENT == 1)) throw new dt("Cannot pass non-string to std::string");
      var c = u ? _e(o) : o.length, h = pt(4 + c + 1), b = h + 4;
      return (p(), A)[h >>> 2 >>> 0] = c, u ? Pe(o, b, c + 1) : (p(), J).set(o, b >>> 0), n !== null && n.push(xe, h), h;
    }, Sc: Ar, Uc(n) {
      xe(n);
    } });
  }
  var $n = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, ci = (e, t, n) => {
    if (e >>>= 1, 16 < (t = In((p(), Z), e, t / 2, n)) - e && $n) return $n.decode((p(), Z).slice(e, t));
    for (n = ""; e < t; ++e) {
      var o = (p(), Z)[e >>> 0];
      n += String.fromCharCode(o);
    }
    return n;
  }, di = (e, t, n) => {
    if (n ??= 2147483647, 2 > n) return 0;
    var o = t;
    n = (n -= 2) < 2 * e.length ? n / 2 : e.length;
    for (var u = 0; u < n; ++u) {
      var c = e.charCodeAt(u);
      (p(), Ce)[t >>> 1 >>> 0] = c, t += 2;
    }
    return (p(), Ce)[t >>> 1 >>> 0] = 0, t - o;
  }, li = (e) => 2 * e.length, pi = (e, t, n) => {
    var o = "";
    e >>>= 2;
    for (var u = 0; !(u >= t / 4); u++) {
      var c = (p(), A)[e + u >>> 0];
      if (!c && !n) break;
      o += String.fromCodePoint(c);
    }
    return o;
  }, mi = (e, t, n) => {
    if (t >>>= 0, n ??= 2147483647, 4 > n) return 0;
    var o = t;
    n = o + n - 4;
    for (var u = 0; u < e.length; ++u) {
      var c = e.codePointAt(u);
      if (65535 < c && u++, (p(), x)[t >>> 2 >>> 0] = c, (t += 4) + 4 > n) break;
    }
    return (p(), x)[t >>> 2 >>> 0] = 0, t - o;
  }, hi = (e) => {
    for (var t = 0, n = 0; n < e.length; ++n) 65535 < e.codePointAt(n) && n++, t += 4;
    return t;
  };
  function yi(e, t, n) {
    if (e >>>= 0, t >>>= 0, n = Oe(n >>>= 0), t === 2) var o = ci, u = di, c = li;
    else o = pi, u = mi, c = hi;
    De(e, { name: n, Nc: (h) => {
      var b = (p(), A)[h >>> 2 >>> 0];
      return b = o(h + 4, b * t, true), xe(h), b;
    }, Tc: (h, b) => {
      if (typeof b != "string") throw new dt(`Cannot pass non-string to C++ string type ${n}`);
      var E = c(b), I = pt(4 + E + t);
      return (p(), A)[I >>> 2 >>> 0] = E / t, u(b, I + 4, E + t), h !== null && h.push(xe, I), I;
    }, Sc: Ar, Uc(h) {
      xe(h);
    } });
  }
  function bi(e, t) {
    De(e >>>= 0, { ge: true, name: t = Oe(t >>> 0), Nc: () => {
    }, Tc: () => {
    } });
  }
  function wi(e) {
    Fr(e >>> 0, !f, 1, !s, 131072, false), bn();
  }
  var he = (e) => {
    if (!W) try {
      if (e(), !(0 < G)) try {
        i ? Ft() && Gr(S) : wr(S);
      } catch (t) {
        t instanceof wt || t == "unwind" || y(0, t);
      }
    } catch (t) {
      t instanceof wt || t == "unwind" || y(0, t);
    }
  }, gi = !Atomics.waitAsync || globalThis.navigator?.userAgent && 91 > Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./) || [])[2]);
  function Ir(e) {
    e >>>= 0, gi || (Atomics.waitAsync((p(), x), e >>> 2, e).value.then(Pt), e += 128, Atomics.store((p(), x), e >>> 2, 1));
  }
  var Pt = () => he(() => {
    var e = Ft();
    e && (Ir(e), Mo());
  });
  function Ti(e, t) {
    (e >>>= 0) == t >>> 0 ? setTimeout(Pt) : i ? postMessage({ Wc: e, Pc: "checkMailbox" }) : (e = Je[e]) && e.postMessage({ Pc: "checkMailbox" });
  }
  var xr = [];
  function vi(e, t, n, o, u) {
    for (t >>>= 0, u >>>= 0, xr.length = 0, n = u >>> 3, o = u + o >>> 3; n < o; ) {
      var c;
      c = (p(), me)[n++ >>> 0] ? (p(), me)[n++ >>> 0] : (p(), ae)[n++ >>> 0], xr.push(c);
    }
    return (t ? jr[t] : af[e])(...xr);
  }
  var Ei = () => {
    G = 0;
  };
  function Si(e) {
    e >>>= 0, i ? postMessage({ Pc: "cleanupThread", je: e }) : yn(Je[e]);
  }
  function Ai(e) {
  }
  var _t = (e) => {
    try {
      e();
    } catch (t) {
      Te(t);
    }
  };
  function Ii(e) {
    var t = (...n) => {
      Rt.push(e);
      try {
        return e(...n);
      } finally {
        W || (Rt.pop(), Me && Ge === 1 && Rt.length === 0 && (Ge = 0, G += 1, _t(wa), typeof Fibers < "u" && Fibers.De()));
      }
    };
    return jn.set(e, t), t;
  }
  var Ge = 0, Me = null, zn = 0, Rt = [], Lr = /* @__PURE__ */ new Map(), Vn = /* @__PURE__ */ new Map(), jn = /* @__PURE__ */ new Map(), xi = 0, Br = null, Li = [], Hn = (e) => function(t) {
    if (!W) {
      if (Ge === 0) {
        var n = false, o = false;
        t((u = 0) => {
          if (!W && (zn = u, n = true, o)) {
            Ge = 2, _t(() => ga(Me)), typeof MainLoop < "u" && MainLoop.Yd && MainLoop.resume(), u = false;
            try {
              var c = function() {
                var E = (p(), x)[Me + 8 >>> 2 >>> 0];
                return E = Vn.get(E), E = jn.get(E), --G, E();
              }();
            } catch (E) {
              c = E, u = true;
            }
            var h = false;
            if (!Me) {
              var b = Br;
              b && (Br = null, (u ? b.reject : b.resolve)(c), h = true);
            }
            if (u && !h) throw c;
          }
        }), o = true, n || (Ge = 1, Me = function() {
          var u = pt(65548), c = u + 12;
          if ((p(), A)[u >>> 2 >>> 0] = c, (p(), A)[u + 4 >>> 2 >>> 0] = c + 65536, c = Rt[0], !Lr.has(c)) {
            var h = xi++;
            Lr.set(c, h), Vn.set(h, c);
          }
          return c = Lr.get(c), (p(), x)[u + 8 >>> 2 >>> 0] = c, u;
        }(), typeof MainLoop < "u" && MainLoop.Yd && MainLoop.pause(), _t(() => ba(Me)));
      } else Ge === 2 ? (Ge = 0, _t(Ta), xe(Me), Me = null, Li.forEach(he)) : Te(`invalid state: ${Ge}`);
      return zn;
    }
  }((t) => {
    e().then(t);
  });
  function Bi(e) {
    return e >>>= 0, Hn(async () => {
      var t = await ve(e);
      return Ie(t);
    });
  }
  var Or = [], Oi = (e) => {
    var t = Or.length;
    return Or.push(e), t;
  }, Mi = (e, t) => {
    for (var n = Array(e), o = 0; o < e; ++o) {
      var u = o, c = (p(), A)[t + 4 * o >>> 2 >>> 0], h = Er[c];
      if (h === void 0) throw e = `parameter ${o}`, c = lo(c), t = Oe(c), xe(c), new dt(`${e} has unknown type ${t}`);
      n[u] = h;
    }
    return n;
  }, Ui = (e, t, n) => {
    var o = [];
    return e = e(o, n), o.length && ((p(), A)[t >>> 2 >>> 0] = Ie(o)), e;
  }, Ci = {}, Nt = (e) => {
    var t = Ci[e];
    return t === void 0 ? Oe(e) : t;
  };
  function Di(e, t, n) {
    var [o, ...u] = Mi(e, t >>> 0);
    t = o.Tc.bind(o);
    var c = u.map((E) => E.Sc.bind(E));
    e--;
    var h = { toValue: ve };
    switch (e = c.map((E, I) => {
      var F = `argFromPtr${I}`;
      return h[F] = E, `${F}(args${I ? "+" + 8 * I : ""})`;
    }), n) {
      case 0:
        var b = "toValue(handle)";
        break;
      case 2:
        b = "new (toValue(handle))";
        break;
      case 3:
        b = "";
        break;
      case 1:
        h.getStringOrSymbol = Nt, b = "toValue(handle)[getStringOrSymbol(methodName)]";
    }
    return b += `(${e})`, o.ge || (h.toReturnWire = t, h.emval_returnValue = Ui, b = `return emval_returnValue(toReturnWire, destructorsRef, ${b})`), b = `return function (handle, methodName, destructorsRef, args) {
  ${b}
  }`, n = new Function(Object.keys(h), b)(...Object.values(h)), b = `methodCaller<(${u.map((E) => E.name)}) => ${o.name}>`, Oi(Object.defineProperty(n, "name", { value: b }));
  }
  function Pi(e, t) {
    return t >>>= 0, (e = ve(e >>> 0)) == ve(t);
  }
  function _i(e) {
    return (e >>>= 0) ? (e = Nt(e), Ie(globalThis[e])) : Ie(globalThis);
  }
  function Ri(e) {
    return e = Nt(e >>> 0), Ie(r[e]);
  }
  function Ni(e, t) {
    return t >>>= 0, e = ve(e >>> 0), t = ve(t), Ie(e[t]);
  }
  function ki(e) {
    9 < (e >>>= 0) && (Xe[e + 1] += 1);
  }
  function qn(e, t, n, o, u) {
    return Or[e >>> 0](t >>> 0, n >>> 0, o >>> 0, u >>> 0);
  }
  function Wi(e, t, n, o, u) {
    return qn(e >>> 0, t >>> 0, n >>> 0, o >>> 0, u >>> 0);
  }
  function Fi() {
    return Ie([]);
  }
  function Gi(e) {
    e = ve(e >>> 0);
    for (var t = Array(e.length), n = 0; n < e.length; n++) t[n] = e[n];
    return Ie(t);
  }
  function $i(e) {
    return Ie(Nt(e >>> 0));
  }
  function zi() {
    return Ie({});
  }
  function Vi(e) {
    for (var t = ve(e >>>= 0); t.length; ) {
      var n = t.pop();
      t.pop()(n);
    }
    Sr(e);
  }
  function ji(e, t, n) {
    t >>>= 0, n >>>= 0, e = ve(e >>> 0), t = ve(t), n = ve(n), e[t] = n;
  }
  function Hi(e, t) {
    e = ce(e), t >>>= 0, e = new Date(1e3 * e), (p(), x)[t >>> 2 >>> 0] = e.getUTCSeconds(), (p(), x)[t + 4 >>> 2 >>> 0] = e.getUTCMinutes(), (p(), x)[t + 8 >>> 2 >>> 0] = e.getUTCHours(), (p(), x)[t + 12 >>> 2 >>> 0] = e.getUTCDate(), (p(), x)[t + 16 >>> 2 >>> 0] = e.getUTCMonth(), (p(), x)[t + 20 >>> 2 >>> 0] = e.getUTCFullYear() - 1900, (p(), x)[t + 24 >>> 2 >>> 0] = e.getUTCDay(), e = (e.getTime() - Date.UTC(e.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 864e5 | 0, (p(), x)[t + 28 >>> 2 >>> 0] = e;
  }
  var Yn = (e) => e % 4 == 0 && (e % 100 != 0 || e % 400 == 0), Jn = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Xn = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  function qi(e, t) {
    e = ce(e), t >>>= 0, e = new Date(1e3 * e), (p(), x)[t >>> 2 >>> 0] = e.getSeconds(), (p(), x)[t + 4 >>> 2 >>> 0] = e.getMinutes(), (p(), x)[t + 8 >>> 2 >>> 0] = e.getHours(), (p(), x)[t + 12 >>> 2 >>> 0] = e.getDate(), (p(), x)[t + 16 >>> 2 >>> 0] = e.getMonth(), (p(), x)[t + 20 >>> 2 >>> 0] = e.getFullYear() - 1900, (p(), x)[t + 24 >>> 2 >>> 0] = e.getDay();
    var n = (Yn(e.getFullYear()) ? Jn : Xn)[e.getMonth()] + e.getDate() - 1 | 0;
    (p(), x)[t + 28 >>> 2 >>> 0] = n, (p(), x)[t + 36 >>> 2 >>> 0] = -60 * e.getTimezoneOffset(), n = new Date(e.getFullYear(), 6, 1).getTimezoneOffset();
    var o = new Date(e.getFullYear(), 0, 1).getTimezoneOffset();
    e = 0 | (n != o && e.getTimezoneOffset() == Math.min(o, n)), (p(), x)[t + 32 >>> 2 >>> 0] = e;
  }
  function Yi(e) {
    e >>>= 0;
    var t = new Date((p(), x)[e + 20 >>> 2 >>> 0] + 1900, (p(), x)[e + 16 >>> 2 >>> 0], (p(), x)[e + 12 >>> 2 >>> 0], (p(), x)[e + 8 >>> 2 >>> 0], (p(), x)[e + 4 >>> 2 >>> 0], (p(), x)[e >>> 2 >>> 0], 0), n = (p(), x)[e + 32 >>> 2 >>> 0], o = t.getTimezoneOffset(), u = new Date(t.getFullYear(), 6, 1).getTimezoneOffset(), c = new Date(t.getFullYear(), 0, 1).getTimezoneOffset(), h = Math.min(c, u);
    return 0 > n ? (p(), x)[e + 32 >>> 2 >>> 0] = +(u != c && h == o) : 0 < n != (h == o) && (u = Math.max(c, u), t.setTime(t.getTime() + 6e4 * ((0 < n ? h : u) - o))), (p(), x)[e + 24 >>> 2 >>> 0] = t.getDay(), n = (Yn(t.getFullYear()) ? Jn : Xn)[t.getMonth()] + t.getDate() - 1 | 0, (p(), x)[e + 28 >>> 2 >>> 0] = n, (p(), x)[e >>> 2 >>> 0] = t.getSeconds(), (p(), x)[e + 4 >>> 2 >>> 0] = t.getMinutes(), (p(), x)[e + 8 >>> 2 >>> 0] = t.getHours(), (p(), x)[e + 12 >>> 2 >>> 0] = t.getDate(), (p(), x)[e + 16 >>> 2 >>> 0] = t.getMonth(), (p(), x)[e + 20 >>> 2 >>> 0] = t.getYear(), e = t.getTime(), BigInt(isNaN(e) ? -1 : e / 1e3);
  }
  function Zn(e, t, n, o, u, c, h) {
    return i ? V(16, 1, e, t, n, o, u, c, h) : -52;
  }
  function Kn(e, t, n, o, u, c) {
    if (i) return V(17, 1, e, t, n, o, u, c);
  }
  var Tt = {}, Ji = () => performance.timeOrigin + performance.now();
  function Qn(e, t) {
    if (i) return V(18, 1, e, t);
    if (Tt[e] && (clearTimeout(Tt[e].id), delete Tt[e]), !t) return 0;
    var n = setTimeout(() => {
      delete Tt[e], he(() => Oo(e, performance.timeOrigin + performance.now()));
    }, t);
    return Tt[e] = { id: n, Ce: t }, 0;
  }
  function Xi(e, t, n, o) {
    e >>>= 0, t >>>= 0, n >>>= 0, o >>>= 0;
    var u = (/* @__PURE__ */ new Date()).getFullYear(), c = new Date(u, 0, 1).getTimezoneOffset();
    u = new Date(u, 6, 1).getTimezoneOffset();
    var h = Math.max(c, u);
    (p(), A)[e >>> 2 >>> 0] = 60 * h, (p(), x)[t >>> 2 >>> 0] = +(c != u), e = (t = (b) => {
      var E = Math.abs(b);
      return `UTC${0 <= b ? "-" : "+"}${String(Math.floor(E / 60)).padStart(2, "0")}${String(E % 60).padStart(2, "0")}`;
    })(c), t = t(u), u < c ? (Pe(e, n, 17), Pe(t, o, 17)) : (Pe(e, o, 17), Pe(t, n, 17));
  }
  var Zi = () => Date.now(), Ki = 1;
  function Qi(e, t, n) {
    if (n >>>= 0, !(0 <= e && 3 >= e)) return 28;
    if (e === 0) e = Date.now();
    else {
      if (!Ki) return 52;
      e = performance.timeOrigin + performance.now();
    }
    return e = Math.round(1e6 * e), (p(), me)[n >>> 3 >>> 0] = BigInt(e), 0;
  }
  var Mr = [], eo = (e, t) => {
    Mr.length = 0;
    for (var n; n = (p(), J)[e++ >>> 0]; ) {
      var o = n != 105;
      t += (o &= n != 112) && t % 8 ? 4 : 0, Mr.push(n == 112 ? (p(), A)[t >>> 2 >>> 0] : n == 106 ? (p(), me)[t >>> 3 >>> 0] : n == 105 ? (p(), x)[t >>> 2 >>> 0] : (p(), ae)[t >>> 3 >>> 0]), t += o ? 8 : 4;
    }
    return Mr;
  };
  function eu(e, t, n) {
    return e >>>= 0, t = eo(t >>> 0, n >>> 0), jr[e](...t);
  }
  function tu(e, t, n) {
    return e >>>= 0, t = eo(t >>> 0, n >>> 0), jr[e](...t);
  }
  var ru = () => {
  };
  function nu(e, t) {
    return B(ct(e >>> 0, t >>> 0));
  }
  var ou = () => {
    throw G += 1, "unwind";
  };
  function au() {
    return 4294901760;
  }
  var su = () => 1, iu = () => navigator.hardwareConcurrency;
  function uu(e) {
    e >>>= 0;
    var t = (p(), J).length;
    if (e <= t || 4294901760 < e) return false;
    for (var n = 1; 4 >= n; n *= 2) {
      var o = t * (1 + 0.2 / n);
      o = Math.min(o, e + 100663296);
      e: {
        o = (Math.min(4294901760, 65536 * Math.ceil(Math.max(e, o) / 65536)) - Fe.buffer.byteLength + 65535) / 65536 | 0;
        try {
          Fe.grow(o), se();
          var u = 1;
          break e;
        } catch {
        }
        u = void 0;
      }
      if (u) return true;
    }
    return false;
  }
  var Ue = (e) => {
    var t = _e(e) + 1, n = Gt(t);
    return Pe(e, n, t), n;
  }, Ur = (e, t) => {
    (p(), A)[e >>> 2 >>> 0] = t;
    var n = (p(), A)[e >>> 2 >>> 0];
    (p(), A)[e + 4 >>> 2 >>> 0] = (t - n) / 4294967296;
  }, vt = (e) => (p(), A)[e >>> 2 >>> 0] + 4294967296 * (p(), x)[e + 4 >>> 2 >>> 0], de = [], fu = (e, t) => {
    de[e >>> 0] = t;
  }, Re = [], kt = [], lt = (e, t) => {
    kt[e] = new Promise((n) => t.finally(() => n(e)));
  }, L = (e) => {
    if (e) return de[e >>> 0];
  }, cu = (e, t) => {
    for (e = (p(), A)[e >>> 2 >>> 0]; e; e = (p(), A)[e >>> 2 >>> 0]) t[(p(), x)[e + 4 >>> 2 >>> 0]](e);
  }, Wt = (e, t, n) => {
    (p(), A)[e >>> 2 >>> 0] = t, (p(), A)[e + 4 >>> 2 >>> 0] = n;
  }, to = (e) => {
    var t = (p(), A)[e >>> 2 >>> 0];
    return e = (p(), A)[e + 4 >>> 2 >>> 0], ct(t, e);
  }, Ne = (e) => {
    var t = (p(), A)[e >>> 2 >>> 0];
    return e = (p(), A)[e + 4 >>> 2 >>> 0], t ? ct(t, e) : e === 0 ? "" : void 0;
  }, du = (e) => {
    var t = Ne(e + 4), n = (n = (p(), A)[e + 12 >>> 2 >>> 0]) ? L(n) : "auto";
    if (e += 16) {
      var o = L((p(), A)[e + 4 >>> 2 >>> 0]), u = (p(), A)[e + 16 >>> 2 >>> 0], c = (p(), A)[e + 20 >>> 2 >>> 0];
      if (u) {
        for (var h = {}, b = 0; b < u; ++b) {
          var E = c + 24 * b;
          h[to(E + 4)] = (p(), ae)[E + 16 >>> 3 >>> 0];
        }
        u = h;
      } else u = void 0;
      e = { module: o, constants: u, entryPoint: Ne(e + 8) };
    } else e = void 0;
    return { label: t, layout: n, compute: e };
  }, ro = (e, t) => {
    function n(o, u) {
      o = e[o], (p(), A)[t + u >>> 2 >>> 0] = o;
    }
    n("maxTextureDimension1D", 4), n("maxTextureDimension2D", 8), n("maxTextureDimension3D", 12), n("maxTextureArrayLayers", 16), n("maxBindGroups", 20), n("maxBindGroupsPlusVertexBuffers", 24), n("maxBindingsPerBindGroup", 28), n("maxDynamicUniformBuffersPerPipelineLayout", 32), n("maxDynamicStorageBuffersPerPipelineLayout", 36), n("maxSampledTexturesPerShaderStage", 40), n("maxSamplersPerShaderStage", 44), n("maxStorageBuffersPerShaderStage", 48), n("maxStorageTexturesPerShaderStage", 52), n("maxUniformBuffersPerShaderStage", 56), n("minUniformBufferOffsetAlignment", 80), n("minStorageBufferOffsetAlignment", 84), Ur(t + 64, e.maxUniformBufferBindingSize), Ur(t + 72, e.maxStorageBufferBindingSize), n("maxVertexBuffers", 88), Ur(t + 96, e.maxBufferSize), n("maxVertexAttributes", 104), n("maxVertexBufferArrayStride", 108), n("maxInterStageShaderVariables", 112), n("maxColorAttachments", 116), n("maxColorAttachmentBytesPerSample", 120), n("maxComputeWorkgroupStorageSize", 124), n("maxComputeInvocationsPerWorkgroup", 128), n("maxComputeWorkgroupSizeX", 132), n("maxComputeWorkgroupSizeY", 136), n("maxComputeWorkgroupSizeZ", 140), n("maxComputeWorkgroupsPerDimension", 144), e.Be !== void 0 && n("maxImmediateSize", 148);
  }, lu = [, "validation", "out-of-memory", "internal"], pu = [, "compatibility", "core"], no = { 1: "core-features-and-limits", 2: "depth-clip-control", 3: "depth32float-stencil8", 4: "texture-compression-bc", 5: "texture-compression-bc-sliced-3d", 6: "texture-compression-etc2", 7: "texture-compression-astc", 8: "texture-compression-astc-sliced-3d", 9: "timestamp-query", 10: "indirect-first-instance", 11: "shader-f16", 12: "rg11b10ufloat-renderable", 13: "bgra8unorm-storage", 14: "float32-filterable", 15: "float32-blendable", 16: "clip-distances", 17: "dual-source-blending", 18: "subgroups", 19: "texture-formats-tier1", 20: "texture-formats-tier2", 21: "primitive-index", 22: "texture-component-swizzle", 327692: "chromium-experimental-unorm16-texture-formats", 327729: "chromium-experimental-multi-draw-indirect" }, mu = [, "low-power", "high-performance"], hu = [, "occlusion", "timestamp"], yu = { undefined: 1, unknown: 1, destroyed: 2 };
  function bu(e, t, n, o, u, c) {
    t = ce(t), n = ce(n), o >>>= 0, u >>>= 0, c >>>= 0;
    var h = L(e >>> 0);
    if (e = {}, c) {
      var b = (p(), A)[c + 12 >>> 2 >>> 0];
      if (b) {
        var E = (p(), A)[c + 16 >>> 2 >>> 0];
        e.requiredFeatures = Array.from((p(), A).subarray(E >>> 2 >>> 0, E + 4 * b >>> 2 >>> 0), (O) => no[O]);
      }
      var I = (p(), A)[c + 20 >>> 2 >>> 0];
      if (I) {
        let O = function(ye, fe, Ze = false) {
          fe = I + fe, (fe = (p(), A)[fe >>> 2 >>> 0]) == 4294967295 || Ze && fe == 0 || (F[ye] = fe);
        }, ue = function(ye, fe) {
          fe = I + fe;
          var Ze = (p(), A)[fe >>> 2 >>> 0], Vf = (p(), A)[fe + 4 >>> 2 >>> 0];
          Ze == 4294967295 && Vf == 4294967295 || (F[ye] = vt(fe));
        };
        var j = O, te = ue, F = {};
        O("maxTextureDimension1D", 4), O("maxTextureDimension2D", 8), O("maxTextureDimension3D", 12), O("maxTextureArrayLayers", 16), O("maxBindGroups", 20), O("maxBindGroupsPlusVertexBuffers", 24), O("maxDynamicUniformBuffersPerPipelineLayout", 32), O("maxDynamicStorageBuffersPerPipelineLayout", 36), O("maxSampledTexturesPerShaderStage", 40), O("maxSamplersPerShaderStage", 44), O("maxStorageBuffersPerShaderStage", 48), O("maxStorageTexturesPerShaderStage", 52), O("maxUniformBuffersPerShaderStage", 56), O("minUniformBufferOffsetAlignment", 80), O("minStorageBufferOffsetAlignment", 84), ue("maxUniformBufferBindingSize", 64), ue("maxStorageBufferBindingSize", 72), O("maxVertexBuffers", 88), ue("maxBufferSize", 96), O("maxVertexAttributes", 104), O("maxVertexBufferArrayStride", 108), O("maxInterStageShaderVariables", 112), O("maxColorAttachments", 116), O("maxColorAttachmentBytesPerSample", 120), O("maxComputeWorkgroupStorageSize", 124), O("maxComputeInvocationsPerWorkgroup", 128), O("maxComputeWorkgroupSizeX", 132), O("maxComputeWorkgroupSizeY", 136), O("maxComputeWorkgroupSizeZ", 140), O("maxComputeWorkgroupsPerDimension", 144), O("maxImmediateSize", 148, true), e.requiredLimits = F;
      }
      (b = (p(), A)[c + 24 >>> 2 >>> 0]) && (b = { label: Ne(b + 4) }, e.defaultQueue = b), e.label = Ne(c + 4);
    }
    G += 1, lt(t, h.requestDevice(e).then((O) => {
      --G, he(() => {
        de[u >>> 0] = O.queue, de[o >>> 0] = O, G += 1, lt(n, O.lost.then((ue) => {
          he(() => {
            O.onuncapturederror = () => {
            };
            var ye = P(), fe = Ue(ue.message);
            Rr(n, yu[ue.reason], fe), D(ye);
          }), --G;
        })), O.onuncapturederror = (ue) => {
          var ye = 5;
          ue.error instanceof GPUValidationError ? ye = 2 : ue.error instanceof GPUOutOfMemoryError ? ye = 3 : ue.error instanceof GPUInternalError && (ye = 4);
          var fe = P();
          ue = Ue(ue.error.message), Io(o, ye, ue), D(fe);
        }, "adapterInfo" in O || (O.adapterInfo = h.info), Wr(t, 1, o, 0);
      });
    }, (O) => {
      --G, he(() => {
        var ue = P(), ye = Ue(O.message);
        Wr(t, 3, o, ye), n && Rr(n, 4, ye), D(ue);
      });
    }));
  }
  function wu(e) {
    var t = L(e >>>= 0), n = Re[e];
    if (n) {
      for (var o = 0; o < n.length; ++o) n[o]();
      delete Re[e];
    }
    t.destroy();
  }
  function gu(e, t, n) {
    n >>>= 0;
    var o = L(e >>>= 0);
    n == 4294967295 && (n = void 0);
    try {
      var u = o.getMappedRange(t >>> 0, n);
    } catch {
      return 0;
    }
    var c = $r(16, u.byteLength);
    return (p(), J).set(new Uint8Array(u), c >>> 0), Re[e].push(() => xe(c)), c;
  }
  function Tu(e, t, n) {
    n >>>= 0;
    var o = L(e >>>= 0);
    n == 4294967295 && (n = void 0);
    try {
      var u = o.getMappedRange(t >>> 0, n);
    } catch {
      return 0;
    }
    var c = $r(16, u.byteLength);
    return (p(), J).fill(0, c, u.byteLength), Re[e].push(() => {
      new Uint8Array(u).set((p(), J).subarray(c >>> 0, c + u.byteLength >>> 0)), xe(c);
    }), c;
  }
  function vu(e, t, n, o, u) {
    e >>>= 0, t = ce(t), n = ce(n), u >>>= 0;
    var c = L(e);
    Re[e] = [], u == 4294967295 && (u = void 0), G += 1, lt(t, c.mapAsync(n, o >>> 0, u).then(() => {
      --G, he(() => {
        Nr(t, 1, 0);
      });
    }, (h) => {
      --G, he(() => {
        P();
        var b = Ue(h.message);
        Nr(t, h.name === "AbortError" ? 4 : h.name === "OperationError" ? 3 : 0, b), delete Re[e];
      });
    }));
  }
  function Eu(e) {
    var t = L(e >>>= 0), n = Re[e];
    if (n) {
      for (var o = 0; o < n.length; ++o) n[o]();
      delete Re[e], t.unmap();
    }
  }
  function Su(e) {
    delete de[e >>> 0];
  }
  function Au(e, t, n) {
    e >>>= 0, t >>>= 0, n >>>= 0;
    var o = !!(p(), A)[t + 32 >>> 2 >>> 0];
    t = { label: Ne(t + 4), usage: (p(), A)[t + 16 >>> 2 >>> 0], size: vt(t + 24), mappedAtCreation: o }, e = L(e);
    try {
      var u = e.createBuffer(t);
    } catch {
      return false;
    }
    return de[n >>> 0] = u, o && (Re[n] = []), true;
  }
  function Iu(e, t, n, o) {
    e >>>= 0, t = ce(t), o >>>= 0, n = du(n >>> 0), e = L(e), G += 1, lt(t, e.createComputePipelineAsync(n).then((u) => {
      --G, he(() => {
        de[o >>> 0] = u, _r(t, 1, o, 0);
      });
    }, (u) => {
      --G, he(() => {
        var c = P(), h = Ue(u.message);
        _r(t, u.reason === "validation" ? 3 : u.reason === "internal" ? 4 : 0, o, h), D(c);
      });
    }));
  }
  function xu(e, t, n) {
    e >>>= 0, t >>>= 0, n >>>= 0;
    var o = (p(), A)[t >>> 2 >>> 0], u = (p(), x)[o + 4 >>> 2 >>> 0];
    t = { label: Ne(t + 4), code: "" }, u === 2 && (t.code = to(o + 8)), e = L(e).createShaderModule(t), de[n >>> 0] = e;
  }
  var Lu = (e) => {
    (e = L(e)).onuncapturederror = null, e.destroy();
  };
  function Bu(e, t) {
    t = ce(t), e = L(e >>> 0), G += 1, lt(t, e.popErrorScope().then((n) => {
      --G, he(() => {
        var o = 5;
        n ? n instanceof GPUValidationError ? o = 2 : n instanceof GPUOutOfMemoryError ? o = 3 : n instanceof GPUInternalError && (o = 4) : o = 1;
        var u = P(), c = n ? Ue(n.message) : 0;
        kr(t, 1, o, c), D(u);
      });
    }, (n) => {
      --G, he(() => {
        var o = P(), u = Ue(n.message);
        kr(t, 1, 5, u), D(o);
      });
    }));
  }
  function Ou(e, t, n, o) {
    if (t = ce(t), o >>>= 0, n >>>= 0) {
      var u = { featureLevel: pu[(p(), x)[n + 4 >>> 2 >>> 0]], powerPreference: mu[(p(), x)[n + 8 >>> 2 >>> 0]], forceFallbackAdapter: !!(p(), A)[n + 12 >>> 2 >>> 0] };
      (e = (p(), A)[n >>> 2 >>> 0]) !== 0 && (p(), u.Fe = !!(p(), A)[e + 8 >>> 2 >>> 0]);
    }
    "gpu" in navigator ? (G += 1, lt(t, navigator.gpu.requestAdapter(u).then((c) => {
      --G, he(() => {
        if (c) de[o >>> 0] = c, Et(t, 1, o, 0);
        else {
          var h = P(), b = Ue("WebGPU not available on this browser (requestAdapter returned null)");
          Et(t, 3, o, b), D(h);
        }
      });
    }, (c) => {
      --G, he(() => {
        var h = P(), b = Ue(c.message);
        Et(t, 4, o, b), D(h);
      });
    }))) : (u = P(), e = Ue("WebGPU not available on this browser (navigator.gpu is not available)"), Et(t, 3, o, e), D(u));
  }
  function Mu(e, t, n) {
    return e >>>= 0, t >>>= 0, n >>>= 0, Hn(async () => {
      var o = [];
      if (n) {
        var u = (p(), x)[n >>> 2 >>> 0];
        o.length = t + 1, o[t] = new Promise((b) => setTimeout(b, u, 0));
      } else o.length = t;
      for (var c = 0; c < t; ++c) {
        var h = vt(e + 8 * c);
        if (!(h in kt)) return h;
        o[c] = kt[h];
      }
      return o = await Promise.race(o), delete kt[o], o;
    });
  }
  var Cr, Dr = {}, oo = () => {
    if (!Cr) {
      var e, t = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8", _: "./this.program" };
      for (e in Dr) Dr[e] === void 0 ? delete t[e] : t[e] = Dr[e];
      var n = [];
      for (e in t) n.push(`${e}=${t[e]}`);
      Cr = n;
    }
    return Cr;
  };
  function ao(e, t) {
    if (i) return V(19, 1, e, t);
    e >>>= 0, t >>>= 0;
    var n, o = 0, u = 0;
    for (n of oo()) {
      var c = t + o;
      (p(), A)[e + u >>> 2 >>> 0] = c, o += Pe(n, c, 1 / 0) + 1, u += 4;
    }
    return 0;
  }
  function so(e, t) {
    if (i) return V(20, 1, e, t);
    e >>>= 0, t >>>= 0;
    var n = oo();
    for (var o of ((p(), A)[e >>> 2 >>> 0] = n.length, e = 0, n)) e += _e(o) + 1;
    return (p(), A)[t >>> 2 >>> 0] = e, 0;
  }
  function io(e) {
    return i ? V(21, 1, e) : 52;
  }
  function uo(e, t, n, o) {
    return i ? V(22, 1, e, t, n, o) : 52;
  }
  function fo(e, t, n, o) {
    return i ? V(23, 1, e, t, n, o) : 70;
  }
  var Uu = [null, [], []];
  function co(e, t, n, o) {
    if (i) return V(24, 1, e, t, n, o);
    t >>>= 0, n >>>= 0, o >>>= 0;
    for (var u = 0, c = 0; c < n; c++) {
      var h = (p(), A)[t >>> 2 >>> 0], b = (p(), A)[t + 4 >>> 2 >>> 0];
      t += 8;
      for (var E = 0; E < b; E++) {
        var I = e, F = (p(), J)[h + E >>> 0], j = Uu[I];
        F === 0 || F === 10 ? ((I === 1 ? q : B)(xn(j)), j.length = 0) : j.push(F);
      }
      u += b;
    }
    return (p(), A)[o >>> 2 >>> 0] = u, 0;
  }
  function Cu(e) {
    return e >>> 0;
  }
  function Du(e, t) {
    return ro(L(e >>> 0).limits, t >>> 0), 1;
  }
  function Pu(e, t) {
    return L(e >>> 0).features.has(no[t]);
  }
  function _u(e) {
    return BigInt(L(e >>> 0).size);
  }
  function Ru(e) {
    return BigInt(L(e >>> 0).usage);
  }
  function Nu(e, t) {
    if (e >>>= 0, t >>>= 0) {
      var n = Ne(t + 4);
      n = { label: n, timestampWrites: t = (t = (p(), A)[t + 12 >>> 2 >>> 0]) !== 0 ? { querySet: L((p(), A)[t + 4 >>> 2 >>> 0]), beginningOfPassWriteIndex: (p(), A)[t + 8 >>> 2 >>> 0], endOfPassWriteIndex: (p(), A)[t + 12 >>> 2 >>> 0] } : void 0 };
    }
    return t = L(e), e = To(0), n = t.beginComputePass(n), de[e >>> 0] = n, e;
  }
  function ku(e, t, n, o) {
    n = ce(n), (o = ce(o)) == -1 && (o = void 0), (e = L(e >>> 0)).clearBuffer(L(t >>> 0), n, o);
  }
  function Wu(e, t, n, o, u, c) {
    n = ce(n), u = ce(u), c = ce(c), L(e >>> 0).copyBufferToBuffer(L(t >>> 0), n, L(o >>> 0), u, c);
  }
  function Fu(e) {
    var t = L(e >>> 0);
    return e = wo(0), t = t.finish(), de[e >>> 0] = t, e;
  }
  function Gu(e, t, n, o, u, c) {
    c = ce(c), L(e >>> 0).resolveQuerySet(L(t >>> 0), n, o, L(u >>> 0), c);
  }
  function $u(e, t, n, o) {
    L(e >>> 0).dispatchWorkgroups(t, n, o);
  }
  function zu(e, t, n) {
    n = ce(n), L(e >>> 0).dispatchWorkgroupsIndirect(L(t >>> 0), n);
  }
  function Vu(e) {
    L(e >>> 0).end();
  }
  function ju(e, t, n, o, u) {
    o >>>= 0, u >>>= 0, e = L(e >>> 0), n = L(n >>> 0), o == 0 ? e.setBindGroup(t, n) : e.setBindGroup(t, n, (p(), A), u >>> 2, o);
  }
  function Hu(e, t) {
    L(e >>> 0).setPipeline(L(t >>> 0));
  }
  function qu(e, t, n) {
    L(e >>> 0).Ee(L(t >>> 0), n);
  }
  function Yu(e, t) {
    var n = L(e >>> 0);
    return e = bo(0), t = n.getBindGroupLayout(t), de[e >>> 0] = t, e;
  }
  function Ju(e, t) {
    function n(u) {
      var c = (p(), A)[u + 8 >>> 2 >>> 0], h = (p(), A)[u + 32 >>> 2 >>> 0], b = (p(), A)[u + 36 >>> 2 >>> 0], E = 0;
      return cu(u, { 327681: (I) => {
        E = (p(), A)[I + 8 >>> 2 >>> 0];
      } }), c ? ((h = vt(u + 24)) == -1 && (h = void 0), c = { buffer: L(c), offset: vt(u + 16), size: h }) : c = L(h || b || E), { binding: (p(), A)[u + 4 >>> 2 >>> 0], resource: c };
    }
    e >>>= 0, t = { label: Ne((t >>>= 0) + 4), layout: L((p(), A)[t + 12 >>> 2 >>> 0]), entries: function(u, c) {
      for (var h = [], b = 0; b < u; ++b) h.push(n(c + 40 * b));
      return h;
    }((p(), A)[t + 16 >>> 2 >>> 0], (p(), A)[t + 20 >>> 2 >>> 0]) }, e = L(e);
    var o = yo(0);
    return fu(o, e.createBindGroup(t)), o;
  }
  function Xu(e, t) {
    var n;
    return e >>>= 0, (t >>>= 0) && (n = { label: Ne(t + 4) }), t = L(e), e = go(0), n = t.createCommandEncoder(n), de[e >>> 0] = n, e;
  }
  function Zu(e, t) {
    e >>>= 0, t >>>= 0, t = { type: hu[(p(), x)[t + 12 >>> 2 >>> 0]], count: (p(), A)[t + 16 >>> 2 >>> 0] };
    var n = L(e);
    return e = vo(0), t = n.createQuerySet(t), de[e >>> 0] = t, e;
  }
  function Ku(e, t) {
    e = L(e >>> 0).adapterInfo, t >>>= 0, (p(), A)[t + 52 >>> 2 >>> 0] = e.subgroupMinSize, (p(), A)[t + 56 >>> 2 >>> 0] = e.subgroupMaxSize;
    var n = e.vendor + e.architecture + e.device + e.description, o = _e(n) + 1, u = pt(o);
    return u && Pe(n, u, o), n = u, o = _e(e.vendor), Wt(t + 4, n, o), n += o, o = _e(e.architecture), Wt(t + 12, n, o), n += o, o = _e(e.device), Wt(t + 20, n, o), Wt(t + 28, n + o, _e(e.description)), (p(), x)[t + 36 >>> 2 >>> 0] = 2, e = e.isFallbackAdapter ? 3 : 4, (p(), x)[t + 40 >>> 2 >>> 0] = e, (p(), A)[t + 44 >>> 2 >>> 0] = 0, (p(), A)[t + 48 >>> 2 >>> 0] = 0, 1;
  }
  var Qu = { "core-features-and-limits": 1, "depth-clip-control": 2, "depth32float-stencil8": 3, "texture-compression-bc": 4, "texture-compression-bc-sliced-3d": 5, "texture-compression-etc2": 6, "texture-compression-astc": 7, "texture-compression-astc-sliced-3d": 8, "timestamp-query": 9, "indirect-first-instance": 10, "shader-f16": 11, "rg11b10ufloat-renderable": 12, "bgra8unorm-storage": 13, "float32-filterable": 14, "float32-blendable": 15, "clip-distances": 16, "dual-source-blending": 17, subgroups: 18, "texture-formats-tier1": 19, "texture-formats-tier2": 20, "primitive-index": 21, "texture-component-swizzle": 22, "chromium-experimental-unorm16-texture-formats": 327692, "chromium-experimental-multi-draw-indirect": 327729 };
  function ef(e, t) {
    t >>>= 0;
    var n = L(e >>> 0);
    e = pt(4 * n.features.size);
    var o = 0, u = 0;
    for (let c of n.features) 0 <= (n = Qu[c]) && ((p(), x)[e + o >>> 2 >>> 0] = n, o += 4, u++);
    (p(), A)[t + 4 >>> 2 >>> 0] = e, (p(), A)[t >>> 2 >>> 0] = u;
  }
  function tf(e, t) {
    return ro(L(e >>> 0).limits, t >>> 0), 1;
  }
  function rf(e, t) {
    L(e >>> 0).pushErrorScope(lu[t]);
  }
  function nf(e, t, n) {
    t >>>= 0, n >>>= 0, e = L(e >>> 0), t = Array.from((p(), x).subarray(n >>> 2 >>> 0, n + 4 * t >>> 2 >>> 0), (o) => L(o)), e.submit(t);
  }
  function of(e, t, n, o, u) {
    n = ce(n), o >>>= 0, u >>>= 0, e = L(e >>> 0), t = L(t >>> 0), o = (p(), J).subarray(o >>> 0, o + u >>> 0), e.writeBuffer(t, n, o, 0, u);
  }
  i || function() {
    for (var e = r.numThreads - 1; e--; ) gn();
    Ae.push(async () => {
      var t = async function() {
        if (!i) return Promise.all(We.map(wn));
      }();
      Be++, await t, --Be == 0 && ee && (t = ee, ee = null, t());
    });
  }(), i || (Fe = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true }), se()), r.wasmBinary && (g = r.wasmBinary), r.stackSave = () => P(), r.stackRestore = (e) => D(e), r.stackAlloc = (e) => Gt(e), r.setValue = function(e, t, n = "i8") {
    switch (n.endsWith("*") && (n = "*"), n) {
      case "i1":
      case "i8":
        (p(), X)[e >>> 0] = t;
        break;
      case "i16":
        (p(), Ce)[e >>> 1 >>> 0] = t;
        break;
      case "i32":
        (p(), x)[e >>> 2 >>> 0] = t;
        break;
      case "i64":
        (p(), me)[e >>> 3 >>> 0] = BigInt(t);
        break;
      case "float":
        (p(), _)[e >>> 2 >>> 0] = t;
        break;
      case "double":
        (p(), ae)[e >>> 3 >>> 0] = t;
        break;
      case "*":
        (p(), A)[e >>> 2 >>> 0] = t;
        break;
      default:
        Te(`invalid type for setValue: ${n}`);
    }
  }, r.getValue = function(e, t = "i8") {
    switch (t.endsWith("*") && (t = "*"), t) {
      case "i1":
      case "i8":
        return (p(), X)[e >>> 0];
      case "i16":
        return (p(), Ce)[e >>> 1 >>> 0];
      case "i32":
        return (p(), x)[e >>> 2 >>> 0];
      case "i64":
        return (p(), me)[e >>> 3 >>> 0];
      case "float":
        return (p(), _)[e >>> 2 >>> 0];
      case "double":
        return (p(), ae)[e >>> 3 >>> 0];
      case "*":
        return (p(), A)[e >>> 2 >>> 0];
      default:
        Te(`invalid type for getValue: ${t}`);
    }
  }, r.UTF8ToString = ct, r.stringToUTF8 = Pe, r.lengthBytesUTF8 = _e;
  var lo, po, Pr, Ft, xe, pt, mo, ho, yo, bo, wo, go, To, vo, Eo, So, Ao, _r, Rr, Nr, kr, Et, Wr, Io, Fr, xo, Lo, Bo, Gr, Oo, Mo, $r, N, St, Uo, D, Gt, P, Co, zr, Do, Po, _o, Vr, Ro, No, ko, Wo, Fo, Go, $o, zo, Vo, jo, Ho, qo, Yo, Jo, Xo, Zo, Ko, Qo, ea, ta, ra, na, oa, aa, sa, ia, ua, fa, ca, da, la, pa, ma, ha, ya, ba, wa, ga, Ta, ke, af = [Ye, br, En, Ln, Bn, On, Mn, Un, Cn, Dn, Pn, _n, Rn, Nn, kn, Wn, Zn, Kn, Qn, ao, so, io, uo, fo, co], jr = { 1028716: (e, t, n, o, u) => {
    if (r === void 0 || !r.Vc) return 1;
    if ((e = ct(Number(e >>> 0))).startsWith("./") && (e = e.substring(2)), !(e = r.Vc.get(e))) return 2;
    if (t = Number(t >>> 0), n = Number(n >>> 0), o = Number(o >>> 0), t + n > e.byteLength) return 3;
    try {
      let c = e.subarray(t, t + n);
      switch (u) {
        case 0:
          (p(), J).set(c, o >>> 0);
          break;
        case 1:
          r.bd ? r.bd(o, c) : r.pe(o, c);
          break;
        default:
          return 4;
      }
      return 0;
    } catch {
      return 4;
    }
  }, 1029540: (e, t, n) => {
    r.Td(e, (p(), J).subarray(t >>> 0, t + n >>> 0));
  }, 1029604: () => r.ne(), 1029646: (e) => {
    r.kd(e);
  }, 1029683: () => typeof wasmOffsetConverter < "u" };
  function sf(e, t, n, o) {
    var u = P();
    try {
      return zo(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function uf(e, t, n) {
    var o = P();
    try {
      return Fo(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      N(1, 0);
    }
  }
  function ff(e) {
    var t = P();
    try {
      Ro(e);
    } catch (n) {
      if (D(t), n !== n + 0) throw n;
      N(1, 0);
    }
  }
  function cf(e, t) {
    var n = P();
    try {
      return Vr(e, t);
    } catch (o) {
      if (D(n), o !== o + 0) throw o;
      N(1, 0);
    }
  }
  function df(e, t, n) {
    var o = P();
    try {
      _o(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      N(1, 0);
    }
  }
  function lf(e, t) {
    var n = P();
    try {
      Vo(e, t);
    } catch (o) {
      if (D(n), o !== o + 0) throw o;
      N(1, 0);
    }
  }
  function pf(e, t, n, o, u, c, h) {
    var b = P();
    try {
      return Wo(e, t, n, o, u, c, h);
    } catch (E) {
      if (D(b), E !== E + 0) throw E;
      N(1, 0);
    }
  }
  function mf(e, t, n, o, u, c) {
    var h = P();
    try {
      No(e, t, n, o, u, c);
    } catch (b) {
      if (D(h), b !== b + 0) throw b;
      N(1, 0);
    }
  }
  function hf(e, t, n, o) {
    var u = P();
    try {
      $o(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function yf(e, t, n, o, u, c, h) {
    var b = P();
    try {
      Ho(e, t, n, o, u, c, h);
    } catch (E) {
      if (D(b), E !== E + 0) throw E;
      N(1, 0);
    }
  }
  function bf(e, t, n, o, u, c, h) {
    var b = P();
    try {
      qo(e, t, n, o, u, c, h);
    } catch (E) {
      if (D(b), E !== E + 0) throw E;
      N(1, 0);
    }
  }
  function wf(e, t, n, o, u, c, h, b) {
    var E = P();
    try {
      ra(e, t, n, o, u, c, h, b);
    } catch (I) {
      if (D(E), I !== I + 0) throw I;
      N(1, 0);
    }
  }
  function gf(e, t, n, o, u, c, h, b, E, I, F, j) {
    var te = P();
    try {
      Yo(e, t, n, o, u, c, h, b, E, I, F, j);
    } catch (O) {
      if (D(te), O !== O + 0) throw O;
      N(1, 0);
    }
  }
  function Tf(e, t, n, o, u) {
    var c = P();
    try {
      return jo(e, t, n, o, u);
    } catch (h) {
      if (D(c), h !== h + 0) throw h;
      N(1, 0);
    }
  }
  function vf(e, t, n, o, u, c) {
    var h = P();
    try {
      na(e, t, n, o, u, c);
    } catch (b) {
      if (D(h), b !== b + 0) throw b;
      N(1, 0);
    }
  }
  function Ef(e, t, n, o, u) {
    var c = P();
    try {
      ko(e, t, n, o, u);
    } catch (h) {
      if (D(c), h !== h + 0) throw h;
      N(1, 0);
    }
  }
  function Sf(e, t, n, o, u, c, h, b) {
    var E = P();
    try {
      Go(e, t, n, o, u, c, h, b);
    } catch (I) {
      if (D(E), I !== I + 0) throw I;
      N(1, 0);
    }
  }
  function Af(e) {
    var t = P();
    try {
      return oa(e);
    } catch (n) {
      if (D(t), n !== n + 0) throw n;
      N(1, 0);
    }
  }
  function If(e, t, n) {
    var o = P();
    try {
      return aa(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      N(1, 0);
    }
  }
  function xf(e, t) {
    var n = P();
    try {
      return ya(e, t);
    } catch (o) {
      if (D(n), o !== o + 0) throw o;
      return N(1, 0), 0n;
    }
  }
  function Lf(e) {
    var t = P();
    try {
      return Jo(e);
    } catch (n) {
      if (D(t), n !== n + 0) throw n;
      return N(1, 0), 0n;
    }
  }
  function Bf(e, t, n, o) {
    var u = P();
    try {
      return sa(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function Of(e, t, n, o, u) {
    var c = P();
    try {
      return ia(e, t, n, o, u);
    } catch (h) {
      if (D(c), h !== h + 0) throw h;
      N(1, 0);
    }
  }
  function Mf(e, t, n, o, u, c) {
    var h = P();
    try {
      return ua(e, t, n, o, u, c);
    } catch (b) {
      if (D(h), b !== b + 0) throw b;
      N(1, 0);
    }
  }
  function Uf(e, t, n, o, u, c) {
    var h = P();
    try {
      return ea(e, t, n, o, u, c);
    } catch (b) {
      if (D(h), b !== b + 0) throw b;
      N(1, 0);
    }
  }
  function Cf(e, t, n, o, u, c) {
    var h = P();
    try {
      return fa(e, t, n, o, u, c);
    } catch (b) {
      if (D(h), b !== b + 0) throw b;
      N(1, 0);
    }
  }
  function Df(e, t, n, o, u, c, h, b) {
    var E = P();
    try {
      return ta(e, t, n, o, u, c, h, b);
    } catch (I) {
      if (D(E), I !== I + 0) throw I;
      N(1, 0);
    }
  }
  function Pf(e, t, n, o, u) {
    var c = P();
    try {
      return ca(e, t, n, o, u);
    } catch (h) {
      if (D(c), h !== h + 0) throw h;
      return N(1, 0), 0n;
    }
  }
  function _f(e, t, n, o) {
    var u = P();
    try {
      return da(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function Rf(e, t, n, o) {
    var u = P();
    try {
      return la(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function Nf(e, t, n, o, u, c, h, b, E, I, F, j) {
    var te = P();
    try {
      return pa(e, t, n, o, u, c, h, b, E, I, F, j);
    } catch (O) {
      if (D(te), O !== O + 0) throw O;
      N(1, 0);
    }
  }
  function kf(e, t, n, o, u, c, h, b, E, I, F) {
    var j = P();
    try {
      ma(e, t, n, o, u, c, h, b, E, I, F);
    } catch (te) {
      if (D(j), te !== te + 0) throw te;
      N(1, 0);
    }
  }
  function Wf(e, t, n, o, u, c, h, b, E, I, F, j, te, O, ue, ye) {
    var fe = P();
    try {
      ha(e, t, n, o, u, c, h, b, E, I, F, j, te, O, ue, ye);
    } catch (Ze) {
      if (D(fe), Ze !== Ze + 0) throw Ze;
      N(1, 0);
    }
  }
  function Ff(e, t, n) {
    var o = P();
    try {
      return Zo(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      return N(1, 0), 0n;
    }
  }
  function Gf(e, t, n) {
    var o = P();
    try {
      return Xo(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      N(1, 0);
    }
  }
  function $f(e, t, n) {
    var o = P();
    try {
      return Ko(e, t, n);
    } catch (u) {
      if (D(o), u !== u + 0) throw u;
      N(1, 0);
    }
  }
  function zf(e, t, n, o) {
    var u = P();
    try {
      Qo(e, t, n, o);
    } catch (c) {
      if (D(u), c !== c + 0) throw c;
      N(1, 0);
    }
  }
  function $t() {
    if (0 < Be) ee = $t;
    else if (i) U?.(r), yr();
    else {
      for (var e = Ae; 0 < e.length; ) e.shift()(r);
      0 < Be ? ee = $t : (r.calledRun = true, W || (yr(), U?.(r)));
    }
  }
  return i || (ke = await bt(), $t()), r.PTR_SIZE = 4, r.webgpuInit = (e) => {
    let t = /* @__PURE__ */ new WeakMap(), n, o, u = 1;
    r.webgpuRegisterDevice = (b) => {
      if (o !== void 0) throw Error("another WebGPU EP inference session is being created.");
      if (b) {
        var E = t.get(b);
        if (!E) {
          let I = ((F, j = 0) => {
            var te = Ao(j);
            return j = So(j, te), de[te >>> 0] = F.queue, de[j >>> 0] = F, j;
          })(b, E = ho(0));
          E = [u++, E, I], t.set(b, E);
        }
        return n = b, o = E[0], E;
      }
      n = void 0, o = 0;
    };
    let c = /* @__PURE__ */ new Map();
    r.webgpuOnCreateSession = (b) => {
      if (o !== void 0) {
        var E = o;
        if (o = void 0, b) {
          let I = Pr(E);
          c.set(b, I), E === 0 && e(n ?? L(I));
        }
        n = void 0;
      }
    }, r.webgpuOnReleaseSession = (b) => {
      c.delete(b);
    };
    let h = Symbol("gpuBufferMetadata");
    r.webgpuRegisterBuffer = (b, E, I) => {
      if (I) return b[h] = [I, NaN], I;
      if (I = b[h]) return I[1]++, I[0];
      if ((E = c.get(E)) === void 0) throw Error("Invalid session handle passed to webgpuRegisterBuffer");
      return E = ((F, j = 0) => (F.mapState === "unmapped" || Te(), j = Eo(j), de[j >>> 0] = F, j))(b, E), b[h] = [E, 1], E;
    }, r.webgpuUnregisterBuffer = (b) => {
      let E = b[h];
      if (!E) throw Error("Buffer is not registered");
      E[1]--, E[1] === 0 && (mo(E[0]), delete b[h]);
    }, r.webgpuGetBuffer = (b) => L(b), r.webgpuCreateDownloader = (b, E, I) => {
      if ((I = c.get(I)) === void 0) throw Error("Invalid session handle passed to webgpuRegisterBuffer");
      let F = L(I), j = 16 * Math.ceil(Number(E) / 16);
      return async () => {
        let te = F.createBuffer({ size: j, usage: 9 });
        try {
          let O = F.createCommandEncoder();
          return O.copyBufferToBuffer(b, 0, te, 0, j), F.queue.submit([O.finish()]), await te.mapAsync(GPUMapMode.READ), te.getMappedRange().slice(0, E);
        } finally {
          te.destroy();
        }
      };
    }, r.bd = (b, E) => {
      var I = E.buffer;
      let F = E.byteOffset, j = E.byteLength;
      if (E = 16 * Math.ceil(Number(j) / 16), b = L(b), !n) {
        var te = Pr(o);
        n = L(te);
      }
      let O = (te = n.createBuffer({ mappedAtCreation: true, size: E, usage: 6 })).getMappedRange();
      new Uint8Array(O).set(new Uint8Array(I, F, j)), te.unmap(), (I = n.createCommandEncoder()).copyBufferToBuffer(te, 0, b, 0, E), n.queue.submit([I.finish()]), te.destroy();
    };
  }, r.webnnInit = (e) => {
    let t = e[0];
    [r.ne, r.kd, r.webnnEnsureTensor, r.Td, r.webnnDownloadTensor, r.me, r.webnnEnableTraceEvent] = e.slice(1), r.webnnReleaseTensorId = r.kd, r.webnnUploadTensor = r.Td, r.webnnRegisterMLContext = r.me, r.webnnOnRunStart = (n) => t.onRunStart(n), r.webnnOnRunEnd = t.onRunEnd.bind(t), r.webnnOnReleaseSession = (n) => {
      t.onReleaseSession(n);
    }, r.webnnCreateMLTensorDownloader = (n, o) => t.createMLTensorDownloader(n, o), r.webnnRegisterMLTensor = (n, o, u, c) => t.registerMLTensor(n, o, u, c), r.webnnCreateMLContext = (n) => t.createMLContext(n), r.webnnRegisterMLConstant = (n, o, u, c, h, b) => t.registerMLConstant(n, o, u, c, h, r.Vc, b), r.webnnRegisterGraphInput = t.registerGraphInput.bind(t), r.webnnIsGraphInput = t.isGraphInput.bind(t), r.webnnRegisterGraphOutput = t.registerGraphOutput.bind(t), r.webnnIsGraphOutput = t.isGraphOutput.bind(t), r.webnnCreateTemporaryTensor = t.createTemporaryTensor.bind(t), r.webnnIsGraphInputOutputTypeSupported = t.isGraphInputOutputTypeSupported.bind(t);
  }, re ? r : new Promise((e, t) => {
    U = e, R = t;
  });
}
var Kf;
var Qf;
var ns = k(() => {
  "use strict";
  Kf = ts, Qf = globalThis.self?.name?.startsWith("em-pthread");
  Qf && ts();
});
var ss;
var rn;
var ec;
var ge;
var is;
var tn;
var tc;
var rc;
var us;
var nc;
var os;
var fs;
var as;
var cs;
var Yt = k(() => {
  "use strict";
  qt();
  ss = typeof location > "u" ? void 0 : location.origin, rn = import.meta.url > "file:" && import.meta.url < "file;", ec = () => {
    if (true) {
      if (rn) {
        let a = URL;
        return new URL(new a("ort.webgpu.bundle.min.mjs", import.meta.url).href, ss).href;
      }
      return import.meta.url;
    }
  }, ge = ec(), is = () => {
    if (ge && !ge.startsWith("blob:")) return ge.substring(0, ge.lastIndexOf("/") + 1);
  }, tn = (a, r) => {
    try {
      let s = r ?? ge;
      return (s ? new URL(a, s) : new URL(a)).origin === ss;
    } catch {
      return false;
    }
  }, tc = (a, r) => {
    let s = r ?? ge;
    try {
      return (s ? new URL(a, s) : new URL(a)).href;
    } catch {
      return;
    }
  }, rc = (a, r) => `${r ?? "./"}${a}`, us = async (a) => {
    let s = await (await fetch(a, { credentials: "same-origin" })).blob();
    return URL.createObjectURL(s);
  }, nc = async (a) => (await import(
    /*webpackIgnore:true*/
    /*@vite-ignore*/
    a
  )).default, os = (es(), zt(Qa)).default, fs = async () => {
    if (!ge) throw new Error("Failed to load proxy worker: cannot determine the script source URL.");
    if (tn(ge)) return [void 0, os()];
    let a = await us(ge);
    return [a, os(a)];
  }, as = (ns(), zt(rs)).default, cs = async (a, r, s, f) => {
    let i = as && !(a || r);
    if (i) if (ge) i = tn(ge) || f && !s;
    else if (f && !s) i = true;
    else throw new Error("cannot determine the script source URL.");
    if (i) return [void 0, as];
    {
      let d = "ort-wasm-simd-threaded.asyncify.mjs", l = a ?? tc(d, r), m = s && l && !tn(l, r), y = m ? await us(l) : l ?? rc(d, r);
      return [m ? y : void 0, await nc(y)];
    }
  };
});
var nn;
var on;
var nr;
var ds;
var oc;
var ac;
var sc;
var Jt;
var z;
var je = k(() => {
  "use strict";
  Yt();
  on = false, nr = false, ds = false, oc = () => {
    if (typeof SharedArrayBuffer > "u") return false;
    try {
      return typeof MessageChannel < "u" && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
    } catch {
      return false;
    }
  }, ac = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
    } catch {
      return false;
    }
  }, sc = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]));
    } catch {
      return false;
    }
  }, Jt = async (a) => {
    if (on) return Promise.resolve();
    if (nr) throw new Error("multiple calls to 'initializeWebAssembly()' detected.");
    if (ds) throw new Error("previous call to 'initializeWebAssembly()' failed.");
    nr = true;
    let r = a.initTimeout, s = a.numThreads;
    if (a.simd !== false) {
      if (a.simd === "relaxed") {
        if (!sc()) throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.");
      } else if (!ac()) throw new Error("WebAssembly SIMD is not supported in the current environment.");
    }
    let f = oc();
    s > 1 && !f && (typeof self < "u" && !self.crossOriginIsolated && console.warn("env.wasm.numThreads is set to " + s + ", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."), console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."), a.numThreads = s = 1);
    let i = a.wasmPaths, d = typeof i == "string" ? i : void 0, l = i?.mjs, m = l?.href ?? l, y = i?.wasm, w = y?.href ?? y, T = a.wasmBinary, [g, v] = await cs(m, d, s > 1, !!T || !!w), S = false, U = [];
    if (r > 0 && U.push(new Promise((R) => {
      setTimeout(() => {
        S = true, R();
      }, r);
    })), U.push(new Promise((R, H) => {
      let C = { numThreads: s };
      if (T) C.wasmBinary = T, C.locateFile = (M) => M;
      else if (w || d) C.locateFile = (M) => w ?? d + M;
      else if (m && m.indexOf("blob:") !== 0) C.locateFile = (M) => new URL(M, m).href;
      else if (g) {
        let M = is();
        M && (C.locateFile = (q) => M + q);
      }
      v(C).then((M) => {
        nr = false, on = true, nn = M, R(), g && URL.revokeObjectURL(g);
      }, (M) => {
        nr = false, ds = true, H(M);
      });
    })), await Promise.race(U), S) throw new Error(`WebAssembly backend initializing failed due to timeout: ${r}ms`);
  }, z = () => {
    if (on && nn) return nn;
    throw new Error("WebAssembly is not initialized yet.");
  };
});
var be;
var Lt;
var $;
var or = k(() => {
  "use strict";
  je();
  be = (a, r) => {
    let s = z(), f = s.lengthBytesUTF8(a) + 1, i = s._malloc(f);
    return s.stringToUTF8(a, i, f), r.push(i), i;
  }, Lt = (a, r, s, f) => {
    if (typeof a == "object" && a !== null) {
      if (s.has(a)) throw new Error("Circular reference in options");
      s.add(a);
    }
    Object.entries(a).forEach(([i, d]) => {
      let l = r ? r + i : i;
      if (typeof d == "object") Lt(d, l + ".", s, f);
      else if (typeof d == "string" || typeof d == "number") f(l, d.toString());
      else if (typeof d == "boolean") f(l, d ? "1" : "0");
      else throw new Error(`Can't handle extra config type: ${typeof d}`);
    });
  }, $ = (a) => {
    let r = z(), s = r.stackSave();
    try {
      let f = r.PTR_SIZE, i = r.stackAlloc(2 * f);
      r._OrtGetLastError(i, i + f);
      let d = Number(r.getValue(i, f === 4 ? "i32" : "i64")), l = r.getValue(i + f, "*"), m = l ? r.UTF8ToString(l) : "";
      throw new Error(`${a} ERROR_CODE: ${d}, ERROR_MESSAGE: ${m}`);
    } finally {
      r.stackRestore(s);
    }
  };
});
var ls;
var ps = k(() => {
  "use strict";
  je();
  or();
  ls = (a) => {
    let r = z(), s = 0, f = [], i = a || {};
    try {
      if (a?.logSeverityLevel === void 0) i.logSeverityLevel = 2;
      else if (typeof a.logSeverityLevel != "number" || !Number.isInteger(a.logSeverityLevel) || a.logSeverityLevel < 0 || a.logSeverityLevel > 4) throw new Error(`log severity level is not valid: ${a.logSeverityLevel}`);
      if (a?.logVerbosityLevel === void 0) i.logVerbosityLevel = 0;
      else if (typeof a.logVerbosityLevel != "number" || !Number.isInteger(a.logVerbosityLevel)) throw new Error(`log verbosity level is not valid: ${a.logVerbosityLevel}`);
      a?.terminate === void 0 && (i.terminate = false);
      let d = 0;
      return a?.tag !== void 0 && (d = be(a.tag, f)), s = r._OrtCreateRunOptions(i.logSeverityLevel, i.logVerbosityLevel, !!i.terminate, d), s === 0 && $("Can't create run options."), a?.extra !== void 0 && Lt(a.extra, "", /* @__PURE__ */ new WeakSet(), (l, m) => {
        let y = be(l, f), w = be(m, f);
        r._OrtAddRunConfigEntry(s, y, w) !== 0 && $(`Can't set a run config entry: ${l} - ${m}.`);
      }), [s, f];
    } catch (d) {
      throw s !== 0 && r._OrtReleaseRunOptions(s), f.forEach((l) => r._free(l)), d;
    }
  };
});
var ic;
var uc;
var fc;
var Bt;
var ot;
var cc;
var ms;
var hs = k(() => {
  "use strict";
  je();
  or();
  ic = (a) => {
    switch (a) {
      case "disabled":
        return 0;
      case "basic":
        return 1;
      case "extended":
        return 2;
      case "layout":
        return 3;
      case "all":
        return 99;
      default:
        throw new Error(`unsupported graph optimization level: ${a}`);
    }
  }, uc = (a) => {
    switch (a) {
      case "sequential":
        return 0;
      case "parallel":
        return 1;
      default:
        throw new Error(`unsupported execution mode: ${a}`);
    }
  }, fc = (a) => {
    a.extra || (a.extra = {}), a.extra.session || (a.extra.session = {});
    let r = a.extra.session;
    r.use_ort_model_bytes_directly || (r.use_ort_model_bytes_directly = "1"), a.executionProviders && a.executionProviders.some((s) => (typeof s == "string" ? s : s.name) === "webgpu") && (a.enableMemPattern = false);
  }, Bt = (a, r, s, f) => {
    let i = be(r, f), d = be(s, f);
    z()._OrtAddSessionConfigEntry(a, i, d) !== 0 && $(`Can't set a session config entry: ${r} - ${s}.`);
  }, ot = (a, r, s, f) => {
    let i = be(r, f), d = be(s, f);
    a.push([i, d]);
  }, cc = async (a, r, s) => {
    let f = r.executionProviders;
    for (let i of f) {
      let d = typeof i == "string" ? i : i.name, l = [];
      switch (d) {
        case "webnn":
          if (d = "WEBNN", Bt(a, "session.disable_quant_qdq", "1", s), Bt(a, "session.disable_qdq_constant_folding", "1", s), typeof i != "string") {
            let v = i?.deviceType;
            v && Bt(a, "deviceType", v, s);
          }
          break;
        case "webgpu":
          {
            d = "WebGPU";
            let g;
            if (typeof i != "string") {
              let S = i;
              if (S.device) if (typeof GPUDevice < "u" && S.device instanceof GPUDevice) g = S.device;
              else throw new Error("Invalid GPU device set in WebGPU EP options.");
              let { enableGraphCapture: U } = r;
              if (typeof U == "boolean" && U && ot(l, "enableGraphCapture", "1", s), typeof S.preferredLayout == "string" && ot(l, "preferredLayout", S.preferredLayout, s), S.forceCpuNodeNames) {
                let R = Array.isArray(S.forceCpuNodeNames) ? S.forceCpuNodeNames : [S.forceCpuNodeNames];
                ot(l, "forceCpuNodeNames", R.join(`
`), s);
              }
              S.validationMode && ot(l, "validationMode", S.validationMode, s);
            }
            let v = z().webgpuRegisterDevice(g);
            if (v) {
              let [S, U, R] = v;
              ot(l, "deviceId", S.toString(), s), ot(l, "webgpuInstance", U.toString(), s), ot(l, "webgpuDevice", R.toString(), s);
            }
          }
          break;
        case "wasm":
        case "cpu":
          continue;
        default:
          throw new Error(`not supported execution provider: ${d}`);
      }
      let m = be(d, s), y = l.length, w = 0, T = 0;
      if (y > 0) {
        w = z()._malloc(y * z().PTR_SIZE), s.push(w), T = z()._malloc(y * z().PTR_SIZE), s.push(T);
        for (let g = 0; g < y; g++) z().setValue(w + g * z().PTR_SIZE, l[g][0], "*"), z().setValue(T + g * z().PTR_SIZE, l[g][1], "*");
      }
      await z()._OrtAppendExecutionProvider(a, m, w, T, y) !== 0 && $(`Can't append execution provider: ${d}.`);
    }
  }, ms = async (a) => {
    let r = z(), s = 0, f = [], i = a || {};
    fc(i);
    try {
      let d = ic(i.graphOptimizationLevel ?? "all"), l = uc(i.executionMode ?? "sequential"), m = typeof i.logId == "string" ? be(i.logId, f) : 0, y = i.logSeverityLevel ?? 2;
      if (!Number.isInteger(y) || y < 0 || y > 4) throw new Error(`log severity level is not valid: ${y}`);
      let w = i.logVerbosityLevel ?? 0;
      if (!Number.isInteger(w) || w < 0 || w > 4) throw new Error(`log verbosity level is not valid: ${w}`);
      let T = typeof i.optimizedModelFilePath == "string" ? be(i.optimizedModelFilePath, f) : 0;
      if (s = r._OrtCreateSessionOptions(d, !!i.enableCpuMemArena, !!i.enableMemPattern, l, !!i.enableProfiling, 0, m, y, w, T), s === 0 && $("Can't create session options."), i.executionProviders && await cc(s, i, f), i.enableGraphCapture !== void 0) {
        if (typeof i.enableGraphCapture != "boolean") throw new Error(`enableGraphCapture must be a boolean value: ${i.enableGraphCapture}`);
        Bt(s, "enableGraphCapture", i.enableGraphCapture.toString(), f);
      }
      if (i.freeDimensionOverrides) for (let [g, v] of Object.entries(i.freeDimensionOverrides)) {
        if (typeof g != "string") throw new Error(`free dimension override name must be a string: ${g}`);
        if (typeof v != "number" || !Number.isInteger(v) || v < 0) throw new Error(`free dimension override value must be a non-negative integer: ${v}`);
        let S = be(g, f);
        r._OrtAddFreeDimensionOverride(s, S, v) !== 0 && $(`Can't set a free dimension override: ${g} - ${v}.`);
      }
      return i.extra !== void 0 && Lt(i.extra, "", /* @__PURE__ */ new WeakSet(), (g, v) => {
        Bt(s, g, v, f);
      }), [s, f];
    } catch (d) {
      throw s !== 0 && r._OrtReleaseSessionOptions(s) !== 0 && $("Can't release session options."), f.forEach((l) => r._free(l)), d;
    }
  };
});
var He;
var ar;
var mt;
var at;
var Ot;
var sr;
var ir;
var an;
var st = k(() => {
  "use strict";
  He = (a) => {
    switch (a) {
      case "int8":
        return 3;
      case "uint8":
        return 2;
      case "bool":
        return 9;
      case "int16":
        return 5;
      case "uint16":
        return 4;
      case "int32":
        return 6;
      case "uint32":
        return 12;
      case "float16":
        return 10;
      case "float32":
        return 1;
      case "float64":
        return 11;
      case "string":
        return 8;
      case "int64":
        return 7;
      case "uint64":
        return 13;
      case "int4":
        return 22;
      case "uint4":
        return 21;
      default:
        throw new Error(`unsupported data type: ${a}`);
    }
  }, ar = (a) => {
    switch (a) {
      case 3:
        return "int8";
      case 2:
        return "uint8";
      case 9:
        return "bool";
      case 5:
        return "int16";
      case 4:
        return "uint16";
      case 6:
        return "int32";
      case 12:
        return "uint32";
      case 10:
        return "float16";
      case 1:
        return "float32";
      case 11:
        return "float64";
      case 8:
        return "string";
      case 7:
        return "int64";
      case 13:
        return "uint64";
      case 22:
        return "int4";
      case 21:
        return "uint4";
      default:
        throw new Error(`unsupported data type: ${a}`);
    }
  }, mt = (a, r) => {
    let s = [-1, 4, 1, 1, 2, 2, 4, 8, -1, 1, 2, 8, 4, 8, -1, -1, -1, -1, -1, -1, -1, 0.5, 0.5][a], f = typeof r == "number" ? r : r.reduce((i, d) => i * d, 1);
    return s > 0 ? Math.ceil(f * s) : void 0;
  }, at = (a) => {
    switch (a) {
      case "float16":
        return typeof Float16Array < "u" ? Float16Array : Uint16Array;
      case "float32":
        return Float32Array;
      case "uint8":
        return Uint8Array;
      case "int8":
        return Int8Array;
      case "uint16":
        return Uint16Array;
      case "int16":
        return Int16Array;
      case "int32":
        return Int32Array;
      case "bool":
        return Uint8Array;
      case "float64":
        return Float64Array;
      case "uint32":
        return Uint32Array;
      case "int64":
        return BigInt64Array;
      case "uint64":
        return BigUint64Array;
      default:
        throw new Error(`unsupported type: ${a}`);
    }
  }, Ot = (a) => {
    switch (a) {
      case "verbose":
        return 0;
      case "info":
        return 1;
      case "warning":
        return 2;
      case "error":
        return 3;
      case "fatal":
        return 4;
      default:
        throw new Error(`unsupported logging level: ${a}`);
    }
  }, sr = (a) => a === "float32" || a === "float16" || a === "int32" || a === "int64" || a === "uint32" || a === "uint8" || a === "bool" || a === "uint4" || a === "int4", ir = (a) => a === "float32" || a === "float16" || a === "int32" || a === "int64" || a === "uint32" || a === "uint64" || a === "int8" || a === "uint8" || a === "bool" || a === "uint4" || a === "int4", an = (a) => {
    switch (a) {
      case "none":
        return 0;
      case "cpu":
        return 1;
      case "cpu-pinned":
        return 2;
      case "texture":
        return 3;
      case "gpu-buffer":
        return 4;
      case "ml-tensor":
        return 5;
      default:
        throw new Error(`unsupported data location: ${a}`);
    }
  };
});
var Mt;
var sn = k(() => {
  "use strict";
  qt();
  Mt = async (a) => {
    if (typeof a == "string") if (false) try {
      let { readFile: r } = qr("node:fs/promises");
      return new Uint8Array(await r(a));
    } catch (r) {
      if (r.code === "ERR_FS_FILE_TOO_LARGE") {
        let { createReadStream: s } = qr("node:fs"), f = s(a), i = [];
        for await (let d of f) i.push(d);
        return new Uint8Array(Buffer.concat(i));
      }
      throw r;
    }
    else {
      let r = await fetch(a);
      if (!r.ok) throw new Error(`failed to load external data file: ${a}`);
      let s = r.headers.get("Content-Length"), f = s ? parseInt(s, 10) : 0;
      if (f < 1073741824) return new Uint8Array(await r.arrayBuffer());
      {
        if (!r.body) throw new Error(`failed to load external data file: ${a}, no response body.`);
        let i = r.body.getReader(), d;
        try {
          d = new ArrayBuffer(f);
        } catch (m) {
          if (m instanceof RangeError) {
            let y = Math.ceil(f / 65536);
            d = new WebAssembly.Memory({ initial: y, maximum: y }).buffer;
          } else throw m;
        }
        let l = 0;
        for (; ; ) {
          let { done: m, value: y } = await i.read();
          if (m) break;
          let w = y.byteLength;
          new Uint8Array(d, l, w).set(y), l += w;
        }
        return new Uint8Array(d, 0, f);
      }
    }
    else return a instanceof Blob ? new Uint8Array(await a.arrayBuffer()) : a instanceof Uint8Array ? a : new Uint8Array(a);
  };
});
var ys;
var bs = k(() => {
  "use strict";
  st();
  ys = (a, r) => new (at(r))(a);
});
var dc;
var lc;
var ws;
var gs;
var Ts;
var pc;
var pe;
var un = k(() => {
  "use strict";
  st();
  dc = ["V", "I", "W", "E", "F"], lc = (a, r) => {
    console.log(`[${dc[a]},${(/* @__PURE__ */ new Date()).toISOString()}]${r}`);
  }, Ts = (a, r) => {
    ws = a, gs = r;
  }, pc = (a, r) => {
    let s = Ot(a), f = Ot(ws);
    s >= f && lc(s, typeof r == "function" ? r() : r);
  }, pe = (...a) => {
    gs && pc(...a);
  };
});
var Es;
var cn;
var Ss;
var mc;
var vs;
var hc;
var As;
var ur;
var fr;
var fn;
var Is;
var xs = k(() => {
  "use strict";
  st();
  un();
  Es = /* @__PURE__ */ new Map([["float32", 32], ["float16", 16], ["int32", 32], ["uint32", 32], ["int64", 64], ["uint64", 64], ["int8", 8], ["uint8", 8], ["int4", 4], ["uint4", 4]]), cn = (a, r) => {
    if (r === "int32") return a;
    let s = Es.get(r);
    if (!s) throw new Error(`WebNN backend does not support data type: ${r}`);
    let f = s / 8;
    if (a.byteLength % f !== 0) throw new Error(`Invalid Uint8Array length - must be a multiple of ${f}.`);
    let i = a.byteLength / f, d = new (at(r))(a.buffer, a.byteOffset, i);
    switch (r) {
      case "int64":
      case "uint64": {
        let l = new Int32Array(i);
        for (let m = 0; m < i; m++) {
          let y = d[m];
          if (y > 2147483647n || y < -2147483648n) throw new Error("Can not convert int64 data to int32 - value out of range.");
          l[m] = Number(y);
        }
        return new Uint8Array(l.buffer);
      }
      case "int8":
      case "uint8":
      case "uint32": {
        if (r === "uint32" && d.some((m) => m > 2147483647)) throw new Error("Can not convert uint32 data to int32 - value out of range.");
        let l = Int32Array.from(d, Number);
        return new Uint8Array(l.buffer);
      }
      default:
        throw new Error(`Unsupported data conversion from ${r} to 'int32'`);
    }
  }, Ss = (a, r) => {
    if (r === "int32") return a;
    if (a.byteLength % 4 !== 0) throw new Error("Invalid Uint8Array length - must be a multiple of 4 (int32).");
    let s = a.byteLength / 4, f = new Int32Array(a.buffer, a.byteOffset, s);
    switch (r) {
      case "int64": {
        let i = BigInt64Array.from(f, BigInt);
        return new Uint8Array(i.buffer);
      }
      case "uint64": {
        if (f.some((d) => d < 0)) throw new Error("Can not convert int32 data to uin64 - negative value found.");
        let i = BigUint64Array.from(f, BigInt);
        return new Uint8Array(i.buffer);
      }
      case "int8": {
        if (f.some((d) => d < -128 || d > 127)) throw new Error("Can not convert int32 data to int8 - value out of range.");
        let i = Int8Array.from(f, Number);
        return new Uint8Array(i.buffer);
      }
      case "uint8": {
        if (f.some((i) => i < 0 || i > 255)) throw new Error("Can not convert int32 data to uint8 - value out of range.");
        return Uint8Array.from(f, Number);
      }
      case "uint32": {
        if (f.some((d) => d < 0)) throw new Error("Can not convert int32 data to uint32 - negative value found.");
        let i = Uint32Array.from(f, Number);
        return new Uint8Array(i.buffer);
      }
      default:
        throw new Error(`Unsupported data conversion from 'int32' to ${r}`);
    }
  }, mc = 1, vs = () => mc++, hc = /* @__PURE__ */ new Map([["int8", "int32"], ["uint8", "int32"], ["uint32", "int32"], ["int64", "int32"]]), As = (a, r) => {
    let s = Es.get(a);
    if (!s) throw new Error(`WebNN backend does not support data type: ${a}`);
    return r.length > 0 ? Math.ceil(r.reduce((f, i) => f * i) * s / 8) : 0;
  }, ur = class {
    constructor(r) {
      this.isDataConverted = false;
      let { sessionId: s, context: f, tensor: i, dataType: d, shape: l, fallbackDataType: m } = r;
      this.sessionId = s, this.mlContext = f, this.mlTensor = i, this.dataType = d, this.tensorShape = l, this.fallbackDataType = m;
    }
    get tensor() {
      return this.mlTensor;
    }
    get type() {
      return this.dataType;
    }
    get fallbackType() {
      return this.fallbackDataType;
    }
    get shape() {
      return this.tensorShape;
    }
    get byteLength() {
      return As(this.dataType, this.tensorShape);
    }
    destroy() {
      pe("verbose", () => "[WebNN] TensorWrapper.destroy"), this.mlTensor.destroy();
    }
    write(r) {
      this.mlContext.writeTensor(this.mlTensor, r);
    }
    async read(r) {
      if (this.fallbackDataType) {
        let s = await this.mlContext.readTensor(this.mlTensor), f = Ss(new Uint8Array(s), this.dataType);
        if (r) {
          (r instanceof ArrayBuffer ? new Uint8Array(r) : new Uint8Array(r.buffer, r.byteOffset, r.byteLength)).set(f);
          return;
        } else return new Uint8Array(f).buffer;
      } else return r ? this.mlContext.readTensor(this.mlTensor, r) : this.mlContext.readTensor(this.mlTensor);
    }
    canReuseTensor(r, s, f) {
      return this.mlContext === r && this.dataType === s && this.tensorShape.length === f.length && this.tensorShape.every((i, d) => i === f[d]);
    }
    setIsDataConverted(r) {
      this.isDataConverted = r;
    }
  }, fr = class {
    constructor(r, s) {
      this.tensorManager = r;
      this.wrapper = s;
    }
    get tensorWrapper() {
      return this.wrapper;
    }
    releaseTensor() {
      this.tensorWrapper && (this.tensorManager.releaseTensor(this.tensorWrapper), this.wrapper = void 0);
    }
    async ensureTensor(r, s, f, i) {
      let d = this.tensorManager.getMLContext(r), l = this.tensorManager.getMLOpSupportLimits(r), m;
      if (!l?.input.dataTypes.includes(s)) {
        if (m = hc.get(s), !m || l?.input.dataTypes.includes(m)) throw new Error(`WebNN backend does not support data type: ${s}`);
        pe("verbose", () => `[WebNN] TensorIdTracker.ensureTensor: fallback dataType from ${s} to ${m}`);
      }
      if (this.wrapper) {
        if (this.wrapper.canReuseTensor(d, s, f)) return this.wrapper.tensor;
        if (i) {
          if (this.wrapper.byteLength !== As(s, f)) throw new Error("Unable to copy data to tensor with different size.");
          this.activeUpload = new Uint8Array(await this.wrapper.read());
        }
        this.tensorManager.releaseTensor(this.wrapper);
      }
      let y = typeof MLTensorUsage > "u" ? void 0 : MLTensorUsage.READ | MLTensorUsage.WRITE;
      return this.wrapper = await this.tensorManager.getCachedTensor(r, s, f, y, true, true, m), i && this.activeUpload && (this.wrapper.write(this.activeUpload), this.activeUpload = void 0), this.wrapper.tensor;
    }
    upload(r) {
      let s = r;
      if (this.wrapper) {
        if (this.wrapper.fallbackType) if (this.wrapper.fallbackType === "int32") s = cn(r, this.wrapper.type), this.wrapper.setIsDataConverted(true);
        else throw new Error(`Unsupported fallback data type: ${this.wrapper.fallbackType}`);
        if (r.byteLength === this.wrapper.byteLength) {
          this.wrapper.write(s);
          return;
        } else pe("verbose", () => "Data size does not match tensor size. Releasing tensor."), this.releaseTensor();
      }
      this.activeUpload ? this.activeUpload.set(s) : this.activeUpload = new Uint8Array(s);
    }
    async download(r) {
      if (this.activeUpload) {
        let s = this.wrapper?.isDataConverted ? Ss(this.activeUpload, this.wrapper?.type) : this.activeUpload;
        if (r) {
          r instanceof ArrayBuffer ? new Uint8Array(r).set(s) : new Uint8Array(r.buffer, r.byteOffset, r.byteLength).set(s);
          return;
        } else return s.buffer;
      }
      if (!this.wrapper) throw new Error("Tensor has not been created.");
      return r ? this.wrapper.read(r) : this.wrapper.read();
    }
  }, fn = class {
    constructor(r) {
      this.backend = r;
      this.tensorTrackersById = /* @__PURE__ */ new Map();
      this.freeTensors = [];
      this.externalTensors = /* @__PURE__ */ new Set();
    }
    getMLContext(r) {
      let s = this.backend.getMLContext(r);
      if (!s) throw new Error("MLContext not found for session.");
      return s;
    }
    getMLOpSupportLimits(r) {
      return this.backend.getMLOpSupportLimits(r);
    }
    reserveTensorId() {
      let r = vs();
      return this.tensorTrackersById.set(r, new fr(this)), r;
    }
    releaseTensorId(r) {
      let s = this.tensorTrackersById.get(r);
      s && (this.tensorTrackersById.delete(r), s.tensorWrapper && this.releaseTensor(s.tensorWrapper));
    }
    async ensureTensor(r, s, f, i, d) {
      pe("verbose", () => `[WebNN] TensorManager.ensureTensor {tensorId: ${s}, dataType: ${f}, shape: ${i}, copyOld: ${d}}`);
      let l = this.tensorTrackersById.get(s);
      if (!l) throw new Error("Tensor not found.");
      return l.ensureTensor(r, f, i, d);
    }
    upload(r, s) {
      let f = this.tensorTrackersById.get(r);
      if (!f) throw new Error("Tensor not found.");
      f.upload(s);
    }
    async download(r, s) {
      pe("verbose", () => `[WebNN] TensorManager.download {tensorId: ${r}, dstBuffer: ${s?.byteLength}}`);
      let f = this.tensorTrackersById.get(r);
      if (!f) throw new Error("Tensor not found.");
      return f.download(s);
    }
    releaseTensorsForSession(r) {
      for (let s of this.freeTensors) s.sessionId === r && s.destroy();
      this.freeTensors = this.freeTensors.filter((s) => s.sessionId !== r);
    }
    registerTensor(r, s, f, i) {
      let d = this.getMLContext(r), l = vs(), m = new ur({ sessionId: r, context: d, tensor: s, dataType: f, shape: i });
      return this.tensorTrackersById.set(l, new fr(this, m)), this.externalTensors.add(m), l;
    }
    async getCachedTensor(r, s, f, i, d, l, m) {
      let y = this.getMLContext(r);
      for (let [T, g] of this.freeTensors.entries()) if (g.canReuseTensor(y, s, f)) {
        pe("verbose", () => `[WebNN] Reusing tensor {dataType: ${s}, ${m ? `fallbackDataType: ${m},` : ""} shape: ${f}`);
        let v = this.freeTensors.splice(T, 1)[0];
        return v.sessionId = r, v;
      }
      pe("verbose", () => `[WebNN] MLContext.createTensor {dataType: ${s}, ${m ? `fallbackDataType: ${m},` : ""} shape: ${f}}`);
      let w = await y.createTensor({ dataType: m ?? s, shape: f, dimensions: f, usage: i, writable: d, readable: l });
      return new ur({ sessionId: r, context: y, tensor: w, dataType: s, shape: f, fallbackDataType: m });
    }
    releaseTensor(r) {
      this.externalTensors.has(r) && this.externalTensors.delete(r), this.freeTensors.push(r);
    }
  }, Is = (...a) => new fn(...a);
});
var Ls = {};
At(Ls, { WebNNBackend: () => dn });
var cr;
var yc;
var dn;
var Bs = k(() => {
  "use strict";
  st();
  je();
  bs();
  xs();
  un();
  cr = /* @__PURE__ */ new Map([[1, "float32"], [10, "float16"], [6, "int32"], [12, "uint32"], [7, "int64"], [13, "uint64"], [22, "int4"], [21, "uint4"], [3, "int8"], [2, "uint8"], [9, "uint8"]]), yc = (a, r) => {
    if (a === r) return true;
    if (a === void 0 || r === void 0) return false;
    let s = Object.keys(a).sort(), f = Object.keys(r).sort();
    return s.length === f.length && s.every((i, d) => i === f[d] && a[i] === r[i]);
  }, dn = class {
    constructor(r) {
      this.tensorManager = Is(this);
      this.mlContextBySessionId = /* @__PURE__ */ new Map();
      this.sessionIdsByMLContext = /* @__PURE__ */ new Map();
      this.mlContextCache = [];
      this.sessionGraphInputs = /* @__PURE__ */ new Map();
      this.sessionGraphOutputs = /* @__PURE__ */ new Map();
      this.temporaryGraphInputs = [];
      this.temporaryGraphOutputs = [];
      this.temporarySessionTensorIds = /* @__PURE__ */ new Map();
      this.mlOpSupportLimitsBySessionId = /* @__PURE__ */ new Map();
      Ts(r.logLevel, !!r.debug);
    }
    get currentSessionId() {
      if (this.activeSessionId === void 0) throw new Error("No active session");
      return this.activeSessionId;
    }
    onRunStart(r) {
      pe("verbose", () => `[WebNN] onRunStart {sessionId: ${r}}`), this.activeSessionId = r;
    }
    onRunEnd(r) {
      pe("verbose", () => `[WebNN] onRunEnd {sessionId: ${r}}`);
      let s = this.temporarySessionTensorIds.get(r);
      if (s) {
        for (let f of s) pe("verbose", () => `[WebNN] releasing temporary tensor {tensorId: ${f}}`), this.tensorManager.releaseTensorId(f);
        this.temporarySessionTensorIds.delete(r), this.activeSessionId = void 0;
      }
    }
    async createMLContext(r) {
      if (r instanceof GPUDevice) {
        let f = this.mlContextCache.findIndex((i) => i.gpuDevice === r);
        if (f !== -1) return this.mlContextCache[f].mlContext;
        {
          let i = await navigator.ml.createContext(r);
          return this.mlContextCache.push({ gpuDevice: r, mlContext: i }), i;
        }
      } else if (r === void 0) {
        let f = this.mlContextCache.findIndex((i) => i.options === void 0 && i.gpuDevice === void 0);
        if (f !== -1) return this.mlContextCache[f].mlContext;
        {
          let i = await navigator.ml.createContext();
          return this.mlContextCache.push({ mlContext: i }), i;
        }
      }
      let s = this.mlContextCache.findIndex((f) => yc(f.options, r));
      if (s !== -1) return this.mlContextCache[s].mlContext;
      {
        let f = await navigator.ml.createContext(r);
        return this.mlContextCache.push({ options: r, mlContext: f }), f;
      }
    }
    registerMLContext(r, s) {
      this.mlContextBySessionId.set(r, s);
      let f = this.sessionIdsByMLContext.get(s);
      f || (f = /* @__PURE__ */ new Set(), this.sessionIdsByMLContext.set(s, f)), f.add(r), this.mlOpSupportLimitsBySessionId.has(r) || this.mlOpSupportLimitsBySessionId.set(r, s.opSupportLimits()), this.temporaryGraphInputs.length > 0 && (this.sessionGraphInputs.set(r, this.temporaryGraphInputs), this.temporaryGraphInputs = []), this.temporaryGraphOutputs.length > 0 && (this.sessionGraphOutputs.set(r, this.temporaryGraphOutputs), this.temporaryGraphOutputs = []);
    }
    onReleaseSession(r) {
      this.sessionGraphInputs.delete(r), this.sessionGraphOutputs.delete(r);
      let s = this.mlContextBySessionId.get(r);
      if (!s) return;
      this.tensorManager.releaseTensorsForSession(r), this.mlContextBySessionId.delete(r), this.mlOpSupportLimitsBySessionId.delete(r);
      let f = this.sessionIdsByMLContext.get(s);
      if (f.delete(r), f.size === 0) {
        this.sessionIdsByMLContext.delete(s);
        let i = this.mlContextCache.findIndex((d) => d.mlContext === s);
        i !== -1 && this.mlContextCache.splice(i, 1);
      }
    }
    getMLContext(r) {
      return this.mlContextBySessionId.get(r);
    }
    getMLOpSupportLimits(r) {
      return this.mlOpSupportLimitsBySessionId.get(r);
    }
    reserveTensorId() {
      return this.tensorManager.reserveTensorId();
    }
    releaseTensorId(r) {
      pe("verbose", () => `[WebNN] releaseTensorId {tensorId: ${r}}`), this.tensorManager.releaseTensorId(r);
    }
    async ensureTensor(r, s, f, i, d) {
      let l = cr.get(f);
      if (!l) throw new Error(`Unsupported ONNX data type: ${f}`);
      return this.tensorManager.ensureTensor(r ?? this.currentSessionId, s, l, i, d);
    }
    async createTemporaryTensor(r, s, f) {
      pe("verbose", () => `[WebNN] createTemporaryTensor {onnxDataType: ${s}, shape: ${f}}`);
      let i = cr.get(s);
      if (!i) throw new Error(`Unsupported ONNX data type: ${s}`);
      let d = this.tensorManager.reserveTensorId();
      await this.tensorManager.ensureTensor(r, d, i, f, false);
      let l = this.temporarySessionTensorIds.get(r);
      return l ? l.push(d) : this.temporarySessionTensorIds.set(r, [d]), d;
    }
    uploadTensor(r, s) {
      if (!z().shouldTransferToMLTensor) throw new Error("Trying to upload to a MLTensor while shouldTransferToMLTensor is false");
      pe("verbose", () => `[WebNN] uploadTensor {tensorId: ${r}, data: ${s.byteLength}}`), this.tensorManager.upload(r, s);
    }
    async downloadTensor(r, s) {
      return this.tensorManager.download(r, s);
    }
    createMLTensorDownloader(r, s) {
      return async () => {
        let f = await this.tensorManager.download(r);
        return ys(f, s);
      };
    }
    registerMLTensor(r, s, f, i) {
      let d = cr.get(f);
      if (!d) throw new Error(`Unsupported ONNX data type: ${f}`);
      let l = this.tensorManager.registerTensor(r, s, d, i);
      return pe("verbose", () => `[WebNN] registerMLTensor {tensor: ${s}, dataType: ${d}, dimensions: ${i}} -> {tensorId: ${l}}`), l;
    }
    registerMLConstant(r, s, f, i, d, l, m = false) {
      if (!l) throw new Error("External mounted files are not available.");
      let y = r;
      r.startsWith("./") && (y = r.substring(2));
      let w = l.get(y);
      if (!w) throw new Error(`File with name ${y} not found in preloaded files.`);
      if (s + f > w.byteLength) throw new Error("Out of bounds: data offset and length exceed the external file data size.");
      let T = w.slice(s, s + f).buffer, g;
      switch (d.dataType) {
        case "float32":
          g = new Float32Array(T);
          break;
        case "float16":
          g = typeof Float16Array < "u" ? new Float16Array(T) : new Uint16Array(T);
          break;
        case "int32":
          g = new Int32Array(T);
          break;
        case "uint32":
          g = new Uint32Array(T);
          break;
        case "int64":
          if (m) {
            let v = cn(new Uint8Array(T), "int64");
            g = new Int32Array(v.buffer), d.dataType = "int32";
          } else g = new BigInt64Array(T);
          break;
        case "uint64":
          g = new BigUint64Array(T);
          break;
        case "int8":
          g = new Int8Array(T);
          break;
        case "int4":
        case "uint4":
        case "uint8":
          g = new Uint8Array(T);
          break;
        default:
          throw new Error(`Unsupported data type: ${d.dataType} in creating WebNN Constant from external data.`);
      }
      return pe("verbose", () => `[WebNN] registerMLConstant {dataType: ${d.dataType}, shape: ${d.shape}}} ${m ? "(Note: it was int64 data type and registered to int32 as workaround)" : ""}`), i.constant(d, g);
    }
    registerGraphInput(r) {
      this.temporaryGraphInputs.push(r);
    }
    registerGraphOutput(r) {
      this.temporaryGraphOutputs.push(r);
    }
    isGraphInput(r, s) {
      let f = this.sessionGraphInputs.get(r);
      return f ? f.includes(s) : false;
    }
    isGraphOutput(r, s) {
      let f = this.sessionGraphOutputs.get(r);
      return f ? f.includes(s) : false;
    }
    isGraphInputOutputTypeSupported(r, s, f = true) {
      let i = cr.get(He(s)), d = this.mlOpSupportLimitsBySessionId.get(r);
      return typeof i > "u" ? false : f ? !!d?.input.dataTypes.includes(i) : !!d?.output.dataTypes.includes(i);
    }
    flush() {
    }
  };
});
var bc;
var Xt;
var Zt;
var it;
var wc;
var Os;
var xt;
var Kt;
var Qt;
var Ms;
var er;
var tr;
var rr;
var en = k(() => {
  "use strict";
  Ve();
  ps();
  hs();
  st();
  je();
  or();
  sn();
  bc = (a, r) => {
    z()._OrtInit(a, r) !== 0 && $("Can't initialize onnxruntime.");
  }, Xt = async (a) => {
    bc(a.wasm.numThreads, Ot(a.logLevel));
  }, Zt = async (a, r) => {
    z().asyncInit?.();
    let s = a.webgpu.adapter;
    if (r === "webgpu") {
      if (typeof navigator > "u" || !navigator.gpu) throw new Error("WebGPU is not supported in current environment");
      if (s) {
        if (typeof s.limits != "object" || typeof s.features != "object" || typeof s.requestDevice != "function") throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.");
      } else {
        let f = a.webgpu.powerPreference;
        if (f !== void 0 && f !== "low-power" && f !== "high-performance") throw new Error(`Invalid powerPreference setting: "${f}"`);
        let i = a.webgpu.forceFallbackAdapter;
        if (i !== void 0 && typeof i != "boolean") throw new Error(`Invalid forceFallbackAdapter setting: "${i}"`);
        if (s = await navigator.gpu.requestAdapter({ powerPreference: f, forceFallbackAdapter: i }), !s) throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.');
      }
    }
    if (r === "webnn" && (typeof navigator > "u" || !navigator.ml)) throw new Error("WebNN is not supported in current environment");
    if (r === "webgpu" && z().webgpuInit((f) => {
      a.webgpu.device = f;
    }), r === "webnn") {
      let f = new (Bs(), zt(Ls)).WebNNBackend(a);
      z().webnnInit([f, () => f.reserveTensorId(), (i) => f.releaseTensorId(i), async (i, d, l, m, y) => f.ensureTensor(i, d, l, m, y), (i, d) => {
        f.uploadTensor(i, d);
      }, async (i, d) => f.downloadTensor(i, d), (i, d) => f.registerMLContext(i, d), !!a.trace]);
    }
  }, it = /* @__PURE__ */ new Map(), wc = (a) => {
    let r = z(), s = r.stackSave();
    try {
      let f = r.PTR_SIZE, i = r.stackAlloc(2 * f);
      r._OrtGetInputOutputCount(a, i, i + f) !== 0 && $("Can't get session input/output count.");
      let l = f === 4 ? "i32" : "i64";
      return [Number(r.getValue(i, l)), Number(r.getValue(i + f, l))];
    } finally {
      r.stackRestore(s);
    }
  }, Os = (a, r) => {
    let s = z(), f = s.stackSave(), i = 0;
    try {
      let d = s.PTR_SIZE, l = s.stackAlloc(2 * d);
      s._OrtGetInputOutputMetadata(a, r, l, l + d) !== 0 && $("Can't get session input/output metadata.");
      let y = Number(s.getValue(l, "*"));
      i = Number(s.getValue(l + d, "*"));
      let w = s.HEAP32[i / 4];
      if (w === 0) return [y, 0];
      let T = s.HEAPU32[i / 4 + 1], g = [];
      for (let v = 0; v < T; v++) {
        let S = Number(s.getValue(i + 8 + v * d, "*"));
        g.push(S !== 0 ? s.UTF8ToString(S) : Number(s.getValue(i + 8 + (v + T) * d, "*")));
      }
      return [y, w, g];
    } finally {
      s.stackRestore(f), i !== 0 && s._OrtFree(i);
    }
  }, xt = (a) => {
    let r = z(), s = r._malloc(a.byteLength);
    if (s === 0) throw new Error(`Can't create a session. failed to allocate a buffer of size ${a.byteLength}.`);
    return r.HEAPU8.set(a, s), [s, a.byteLength];
  }, Kt = async (a, r) => {
    let s, f, i = z();
    Array.isArray(a) ? [s, f] = a : a.buffer === i.HEAPU8.buffer ? [s, f] = [a.byteOffset, a.byteLength] : [s, f] = xt(a);
    let d = 0, l = 0, m = 0, y = [], w = [], T = [];
    try {
      if ([l, y] = await ms(r), r?.externalData && i.mountExternalData) {
        let B = [];
        for (let W of r.externalData) {
          let oe = typeof W == "string" ? W : W.path;
          B.push(Mt(typeof W == "string" ? W : W.data).then((p) => {
            i.mountExternalData(oe, p);
          }));
        }
        await Promise.all(B);
      }
      for (let B of r?.executionProviders ?? []) if ((typeof B == "string" ? B : B.name) === "webnn") {
        if (i.shouldTransferToMLTensor = false, typeof B != "string") {
          let oe = B, p = oe?.context, ne = oe?.gpuDevice, X = oe?.deviceType, J = oe?.powerPreference;
          p ? i.currentContext = p : ne ? i.currentContext = await i.webnnCreateMLContext(ne) : i.currentContext = await i.webnnCreateMLContext({ deviceType: X, powerPreference: J });
        } else i.currentContext = await i.webnnCreateMLContext();
        break;
      }
      d = await i._OrtCreateSession(s, f, l), i.webgpuOnCreateSession?.(d), d === 0 && $("Can't create a session."), i.jsepOnCreateSession?.(), i.currentContext && (i.webnnRegisterMLContext(d, i.currentContext), i.currentContext = void 0, i.shouldTransferToMLTensor = true);
      let [g, v] = wc(d), S = !!r?.enableGraphCapture, U = [], R = [], H = [], C = [], M = [];
      for (let B = 0; B < g; B++) {
        let [W, oe, p] = Os(d, B);
        W === 0 && $("Can't get an input name."), w.push(W);
        let ne = i.UTF8ToString(W);
        U.push(ne), H.push(oe === 0 ? { name: ne, isTensor: false } : { name: ne, isTensor: true, type: ar(oe), shape: p });
      }
      for (let B = 0; B < v; B++) {
        let [W, oe, p] = Os(d, B + g);
        W === 0 && $("Can't get an output name."), T.push(W);
        let ne = i.UTF8ToString(W);
        R.push(ne), C.push(oe === 0 ? { name: ne, isTensor: false } : { name: ne, isTensor: true, type: ar(oe), shape: p });
        {
          if (S && r?.preferredOutputLocation === void 0) {
            M.push("gpu-buffer");
            continue;
          }
          let X = typeof r?.preferredOutputLocation == "string" ? r.preferredOutputLocation : r?.preferredOutputLocation?.[ne] ?? "cpu", J = i.webnnIsGraphOutput;
          if (X === "cpu" && J && J(d, ne)) {
            M.push("ml-tensor-cpu-output");
            continue;
          }
          if (X !== "cpu" && X !== "cpu-pinned" && X !== "gpu-buffer" && X !== "ml-tensor") throw new Error(`Not supported preferred output location: ${X}.`);
          if (S && X !== "gpu-buffer") throw new Error(`Not supported preferred output location: ${X}. Only 'gpu-buffer' location is supported when enableGraphCapture is true.`);
          M.push(X);
        }
      }
      let q = null;
      return M.some((B) => B === "gpu-buffer" || B === "ml-tensor" || B === "ml-tensor-cpu-output") && (m = i._OrtCreateBinding(d), m === 0 && $("Can't create IO binding."), q = { handle: m, outputPreferredLocations: M, outputPreferredLocationsEncoded: M.map((B) => B === "ml-tensor-cpu-output" ? "ml-tensor" : B).map((B) => an(B)) }), it.set(d, [d, w, T, q, S, false]), [d, U, R, H, C];
    } catch (g) {
      throw w.forEach((v) => i._OrtFree(v)), T.forEach((v) => i._OrtFree(v)), m !== 0 && i._OrtReleaseBinding(m) !== 0 && $("Can't release IO binding."), d !== 0 && i._OrtReleaseSession(d) !== 0 && $("Can't release session."), g;
    } finally {
      i._free(s), l !== 0 && i._OrtReleaseSessionOptions(l) !== 0 && $("Can't release session options."), y.forEach((g) => i._free(g)), i.unmountExternalData?.();
    }
  }, Qt = (a) => {
    let r = z(), s = it.get(a);
    if (!s) throw new Error(`cannot release session. invalid session id: ${a}`);
    let [f, i, d, l, m] = s;
    l && (m && r._OrtClearBoundOutputs(l.handle) !== 0 && $("Can't clear bound outputs."), r._OrtReleaseBinding(l.handle) !== 0 && $("Can't release IO binding.")), r.jsepOnReleaseSession?.(a), r.webnnOnReleaseSession?.(a), r.webgpuOnReleaseSession?.(a), i.forEach((y) => r._OrtFree(y)), d.forEach((y) => r._OrtFree(y)), r._OrtReleaseSession(f) !== 0 && $("Can't release session."), it.delete(a);
  }, Ms = async (a, r, s, f, i, d, l = false) => {
    if (!a) {
      r.push(0);
      return;
    }
    let m = z(), y = m.PTR_SIZE, w = a[0], T = a[1], g = a[3], v = g, S, U;
    if (w === "string" && (g === "gpu-buffer" || g === "ml-tensor")) throw new Error("String tensor is not supported on GPU.");
    if (l && g !== "gpu-buffer") throw new Error(`External buffer must be provided for input/output index ${d} when enableGraphCapture is true.`);
    if (g === "gpu-buffer") {
      let C = a[2].gpuBuffer;
      U = mt(He(w), T);
      {
        let M = m.webgpuRegisterBuffer;
        if (!M) throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');
        S = M(C, f);
      }
    } else if (g === "ml-tensor") {
      let C = a[2].mlTensor;
      U = mt(He(w), T);
      let M = m.webnnRegisterMLTensor;
      if (!M) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
      S = M(f, C, He(w), T);
    } else {
      let C = a[2];
      if (Array.isArray(C)) {
        U = y * C.length, S = m._malloc(U), s.push(S);
        for (let M = 0; M < C.length; M++) {
          if (typeof C[M] != "string") throw new TypeError(`tensor data at index ${M} is not a string`);
          m.setValue(S + M * y, be(C[M], s), "*");
        }
      } else {
        let M = m.webnnIsGraphInput, q = m.webnnIsGraphOutput;
        if (w !== "string" && M && q) {
          let B = m.UTF8ToString(i);
          if (M(f, B) || q(f, B)) {
            let W = He(w);
            U = mt(W, T), v = "ml-tensor";
            let oe = m.webnnCreateTemporaryTensor, p = m.webnnUploadTensor;
            if (!oe || !p) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
            let ne = await oe(f, W, T);
            p(ne, new Uint8Array(C.buffer, C.byteOffset, C.byteLength)), S = ne;
          } else U = C.byteLength, S = m._malloc(U), s.push(S), m.HEAPU8.set(new Uint8Array(C.buffer, C.byteOffset, U), S);
        } else U = C.byteLength, S = m._malloc(U), s.push(S), m.HEAPU8.set(new Uint8Array(C.buffer, C.byteOffset, U), S);
      }
    }
    let R = m.stackSave(), H = m.stackAlloc(4 * T.length);
    try {
      T.forEach((M, q) => m.setValue(H + q * y, M, y === 4 ? "i32" : "i64"));
      let C = m._OrtCreateTensor(He(w), S, U, H, T.length, an(v));
      C === 0 && $(`Can't create tensor for input/output. session=${f}, index=${d}.`), r.push(C);
    } finally {
      m.stackRestore(R);
    }
  }, er = async (a, r, s, f, i, d) => {
    let l = z(), m = l.PTR_SIZE, y = it.get(a);
    if (!y) throw new Error(`cannot run inference. invalid session id: ${a}`);
    let w = y[0], T = y[1], g = y[2], v = y[3], S = y[4], U = y[5], R = r.length, H = f.length, C = 0, M = [], q = [], B = [], W = [], oe = [], p = l.stackSave(), ne = l.stackAlloc(R * m), X = l.stackAlloc(R * m), J = l.stackAlloc(H * m), Ce = l.stackAlloc(H * m);
    try {
      [C, M] = ls(d), $e("wasm prepareInputOutputTensor");
      for (let _ = 0; _ < R; _++) await Ms(s[_], q, W, a, T[r[_]], r[_], S);
      for (let _ = 0; _ < H; _++) await Ms(i[_], B, W, a, g[f[_]], R + f[_], S);
      ze("wasm prepareInputOutputTensor");
      for (let _ = 0; _ < R; _++) l.setValue(ne + _ * m, q[_], "*"), l.setValue(X + _ * m, T[r[_]], "*");
      for (let _ = 0; _ < H; _++) l.setValue(J + _ * m, B[_], "*"), l.setValue(Ce + _ * m, g[f[_]], "*");
      if (v && !U) {
        let { handle: _, outputPreferredLocations: ae, outputPreferredLocationsEncoded: me } = v;
        if (T.length !== R) throw new Error(`input count from feeds (${R}) is expected to be always equal to model's input count (${T.length}).`);
        $e("wasm bindInputsOutputs");
        for (let Y = 0; Y < R; Y++) {
          let we = r[Y];
          await l._OrtBindInput(_, T[we], q[Y]) !== 0 && $(`Can't bind input[${Y}] for session=${a}.`);
        }
        for (let Y = 0; Y < H; Y++) {
          let we = f[Y];
          i[Y]?.[3] ? (oe.push(B[Y]), l._OrtBindOutput(_, g[we], B[Y], 0) !== 0 && $(`Can't bind pre-allocated output[${Y}] for session=${a}.`)) : l._OrtBindOutput(_, g[we], 0, me[we]) !== 0 && $(`Can't bind output[${Y}] to ${ae[Y]} for session=${a}.`);
        }
        ze("wasm bindInputsOutputs"), it.set(a, [w, T, g, v, S, true]);
      }
      l.jsepOnRunStart?.(w), l.webnnOnRunStart?.(w);
      let Z;
      v ? Z = await l._OrtRunWithBinding(w, v.handle, H, J, C) : Z = await l._OrtRun(w, X, ne, R, Ce, H, J, C), Z !== 0 && $("failed to call OrtRun().");
      let x = [], A = [];
      $e("wasm ProcessOutputTensor");
      for (let _ = 0; _ < H; _++) {
        let ae = Number(l.getValue(J + _ * m, "*"));
        if (ae === B[_] || oe.includes(B[_])) {
          x.push(i[_]), ae !== B[_] && l._OrtReleaseTensor(ae) !== 0 && $("Can't release tensor.");
          continue;
        }
        let me = l.stackSave(), Y = l.stackAlloc(4 * m), we = false, re, se = 0;
        try {
          l._OrtGetTensorData(ae, Y, Y + m, Y + 2 * m, Y + 3 * m) !== 0 && $(`Can't access output tensor data on index ${_}.`);
          let Te = m === 4 ? "i32" : "i64", qe = Number(l.getValue(Y, Te));
          se = l.getValue(Y + m, "*");
          let bt = l.getValue(Y + m * 2, "*"), wt = Number(l.getValue(Y + m * 3, Te)), Se = [];
          for (let ee = 0; ee < wt; ee++) Se.push(Number(l.getValue(bt + ee * m, Te)));
          l._OrtFree(bt) !== 0 && $("Can't free memory for tensor dims.");
          let Ae = Se.reduce((ee, K) => ee * K, 1);
          re = ar(qe);
          let Be = v?.outputPreferredLocations[f[_]];
          if (re === "string") {
            if (Be === "gpu-buffer" || Be === "ml-tensor") throw new Error("String tensor is not supported on GPU.");
            let ee = [];
            for (let K = 0; K < Ae; K++) {
              let G = l.getValue(se + K * m, "*"), V = l.getValue(se + (K + 1) * m, "*"), Ye = K === Ae - 1 ? void 0 : V - G;
              ee.push(l.UTF8ToString(G, Ye));
            }
            x.push([re, Se, ee, "cpu"]);
          } else if (Be === "gpu-buffer" && Ae > 0) {
            let ee = l.webgpuGetBuffer;
            if (!ee) throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');
            let K = ee(se), G = mt(qe, Ae);
            if (G === void 0 || !sr(re)) throw new Error(`Unsupported data type: ${re}`);
            we = true;
            {
              l.webgpuRegisterBuffer(K, a, se);
              let V = l.webgpuCreateDownloader(K, G, a);
              x.push([re, Se, { gpuBuffer: K, download: async () => {
                let Ye = await V();
                return new (at(re))(Ye);
              }, dispose: () => {
                l._OrtReleaseTensor(ae) !== 0 && $("Can't release tensor.");
              } }, "gpu-buffer"]);
            }
          } else if (Be === "ml-tensor" && Ae > 0) {
            let ee = l.webnnEnsureTensor, K = l.webnnIsGraphInputOutputTypeSupported;
            if (!ee || !K) throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');
            if (mt(qe, Ae) === void 0 || !ir(re)) throw new Error(`Unsupported data type: ${re}`);
            if (!K(a, re, false)) throw new Error(`preferredLocation "ml-tensor" for ${re} output is not supported by current WebNN Context.`);
            let V = await ee(a, se, qe, Se, false);
            we = true, x.push([re, Se, { mlTensor: V, download: l.webnnCreateMLTensorDownloader(se, re), dispose: () => {
              l.webnnReleaseTensorId(se), l._OrtReleaseTensor(ae);
            } }, "ml-tensor"]);
          } else if (Be === "ml-tensor-cpu-output" && Ae > 0) {
            let ee = l.webnnCreateMLTensorDownloader(se, re)(), K = x.length;
            we = true, A.push((async () => {
              let G = [K, await ee];
              return l.webnnReleaseTensorId(se), l._OrtReleaseTensor(ae), G;
            })()), x.push([re, Se, [], "cpu"]);
          } else {
            let ee = at(re), K = new ee(Ae);
            new Uint8Array(K.buffer, K.byteOffset, K.byteLength).set(l.HEAPU8.subarray(se, se + K.byteLength)), x.push([re, Se, K, "cpu"]);
          }
        } finally {
          l.stackRestore(me), re === "string" && se && l._free(se), we || l._OrtReleaseTensor(ae);
        }
      }
      v && !S && (l._OrtClearBoundOutputs(v.handle) !== 0 && $("Can't clear bound outputs."), it.set(a, [w, T, g, v, S, false]));
      for (let [_, ae] of await Promise.all(A)) x[_][2] = ae;
      return ze("wasm ProcessOutputTensor"), x;
    } finally {
      l.webnnOnRunEnd?.(w), l.stackRestore(p), s.forEach((Z) => {
        Z && Z[3] === "gpu-buffer" && l.webgpuUnregisterBuffer(Z[2].gpuBuffer);
      }), i.forEach((Z) => {
        Z && Z[3] === "gpu-buffer" && l.webgpuUnregisterBuffer(Z[2].gpuBuffer);
      }), q.forEach((Z) => l._OrtReleaseTensor(Z)), B.forEach((Z) => l._OrtReleaseTensor(Z)), W.forEach((Z) => l._free(Z)), C !== 0 && l._OrtReleaseRunOptions(C), M.forEach((Z) => l._free(Z));
    }
  }, tr = (a) => {
    let r = z(), s = it.get(a);
    if (!s) throw new Error("invalid session id");
    let f = s[0], i = r._OrtEndProfiling(f);
    i === 0 && $("Can't get an profile file name."), r._OrtFree(i);
  }, rr = (a) => {
    let r = [];
    for (let s of a) {
      let f = s[2];
      !Array.isArray(f) && "buffer" in f && r.push(f.buffer);
    }
    return r;
  };
});
var ut;
var Ee;
var Ut;
var lr;
var pr;
var dr;
var ln;
var pn;
var ht;
var yt;
var Tc;
var Us;
var Cs;
var Ds;
var Ps;
var _s;
var Rs;
var Ns;
var mn = k(() => {
  "use strict";
  Ve();
  en();
  je();
  Yt();
  ut = () => !!Q.wasm.proxy && typeof document < "u", Ut = false, lr = false, pr = false, pn = /* @__PURE__ */ new Map(), ht = (a, r) => {
    let s = pn.get(a);
    s ? s.push(r) : pn.set(a, [r]);
  }, yt = () => {
    if (Ut || !lr || pr || !Ee) throw new Error("worker not ready");
  }, Tc = (a) => {
    switch (a.data.type) {
      case "init-wasm":
        Ut = false, a.data.err ? (pr = true, ln[1](a.data.err)) : (lr = true, ln[0]()), dr && (URL.revokeObjectURL(dr), dr = void 0);
        break;
      case "init-ep":
      case "copy-from":
      case "create":
      case "release":
      case "run":
      case "end-profiling": {
        let r = pn.get(a.data.type);
        a.data.err ? r.shift()[1](a.data.err) : r.shift()[0](a.data.out);
        break;
      }
      default:
    }
  }, Us = async () => {
    if (!lr) {
      if (Ut) throw new Error("multiple calls to 'initWasm()' detected.");
      if (pr) throw new Error("previous call to 'initWasm()' failed.");
      if (Ut = true, ut()) return new Promise((a, r) => {
        Ee?.terminate(), fs().then(([s, f]) => {
          try {
            Ee = f, Ee.onerror = (d) => r(d), Ee.onmessage = Tc, ln = [a, r];
            let i = { type: "init-wasm", in: Q };
            !i.in.wasm.wasmPaths && (s || rn) && (i.in.wasm.wasmPaths = { wasm: new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href }), Ee.postMessage(i), dr = s;
          } catch (i) {
            r(i);
          }
        }, r);
      });
      try {
        await Jt(Q.wasm), await Xt(Q), lr = true;
      } catch (a) {
        throw pr = true, a;
      } finally {
        Ut = false;
      }
    }
  }, Cs = async (a) => {
    if (ut()) return yt(), new Promise((r, s) => {
      ht("init-ep", [r, s]);
      let f = { type: "init-ep", in: { epName: a, env: Q } };
      Ee.postMessage(f);
    });
    await Zt(Q, a);
  }, Ds = async (a) => ut() ? (yt(), new Promise((r, s) => {
    ht("copy-from", [r, s]);
    let f = { type: "copy-from", in: { buffer: a } };
    Ee.postMessage(f, [a.buffer]);
  })) : xt(a), Ps = async (a, r) => {
    if (ut()) {
      if (r?.preferredOutputLocation) throw new Error('session option "preferredOutputLocation" is not supported for proxy.');
      return yt(), new Promise((s, f) => {
        ht("create", [s, f]);
        let i = { type: "create", in: { model: a, options: { ...r } } }, d = [];
        a instanceof Uint8Array && d.push(a.buffer), Ee.postMessage(i, d);
      });
    } else return Kt(a, r);
  }, _s = async (a) => {
    if (ut()) return yt(), new Promise((r, s) => {
      ht("release", [r, s]);
      let f = { type: "release", in: a };
      Ee.postMessage(f);
    });
    Qt(a);
  }, Rs = async (a, r, s, f, i, d) => {
    if (ut()) {
      if (s.some((l) => l[3] !== "cpu")) throw new Error("input tensor on GPU is not supported for proxy.");
      if (i.some((l) => l)) throw new Error("pre-allocated output tensor is not supported for proxy.");
      return yt(), new Promise((l, m) => {
        ht("run", [l, m]);
        let y = s, w = { type: "run", in: { sessionId: a, inputIndices: r, inputs: y, outputIndices: f, options: d } };
        Ee.postMessage(w, rr(y));
      });
    } else return er(a, r, s, f, i, d);
  }, Ns = async (a) => {
    if (ut()) return yt(), new Promise((r, s) => {
      ht("end-profiling", [r, s]);
      let f = { type: "end-profiling", in: a };
      Ee.postMessage(f);
    });
    tr(a);
  };
});
var ks;
var vc;
var mr;
var Ws = k(() => {
  "use strict";
  Ve();
  mn();
  st();
  qt();
  sn();
  ks = (a, r) => {
    switch (a.location) {
      case "cpu":
        return [a.type, a.dims, a.data, "cpu"];
      case "gpu-buffer":
        return [a.type, a.dims, { gpuBuffer: a.gpuBuffer }, "gpu-buffer"];
      case "ml-tensor":
        return [a.type, a.dims, { mlTensor: a.mlTensor }, "ml-tensor"];
      default:
        throw new Error(`invalid data location: ${a.location} for ${r()}`);
    }
  }, vc = (a) => {
    switch (a[3]) {
      case "cpu":
        return new Le(a[0], a[2], a[1]);
      case "gpu-buffer": {
        let r = a[0];
        if (!sr(r)) throw new Error(`not supported data type: ${r} for deserializing GPU tensor`);
        let { gpuBuffer: s, download: f, dispose: i } = a[2];
        return Le.fromGpuBuffer(s, { dataType: r, dims: a[1], download: f, dispose: i });
      }
      case "ml-tensor": {
        let r = a[0];
        if (!ir(r)) throw new Error(`not supported data type: ${r} for deserializing MLTensor tensor`);
        let { mlTensor: s, download: f, dispose: i } = a[2];
        return Le.fromMLTensor(s, { dataType: r, dims: a[1], download: f, dispose: i });
      }
      default:
        throw new Error(`invalid data location: ${a[3]}`);
    }
  }, mr = class {
    async fetchModelAndCopyToWasmMemory(r) {
      return Ds(await Mt(r));
    }
    async loadModel(r, s) {
      tt();
      let f;
      typeof r == "string" ? f = await this.fetchModelAndCopyToWasmMemory(r) : f = r, [this.sessionId, this.inputNames, this.outputNames, this.inputMetadata, this.outputMetadata] = await Ps(f, s), rt();
    }
    async dispose() {
      return _s(this.sessionId);
    }
    async run(r, s, f) {
      tt();
      let i = [], d = [];
      Object.entries(r).forEach((v) => {
        let S = v[0], U = v[1], R = this.inputNames.indexOf(S);
        if (R === -1) throw new Error(`invalid input '${S}'`);
        i.push(U), d.push(R);
      });
      let l = [], m = [];
      Object.entries(s).forEach((v) => {
        let S = v[0], U = v[1], R = this.outputNames.indexOf(S);
        if (R === -1) throw new Error(`invalid output '${S}'`);
        l.push(U), m.push(R);
      });
      let y = i.map((v, S) => ks(v, () => `input "${this.inputNames[d[S]]}"`)), w = l.map((v, S) => v ? ks(v, () => `output "${this.outputNames[m[S]]}"`) : null), T = await Rs(this.sessionId, d, y, m, w, f), g = {};
      for (let v = 0; v < T.length; v++) g[this.outputNames[m[v]]] = l[v] ?? vc(T[v]);
      return rt(), g;
    }
    startProfiling() {
    }
    endProfiling() {
      Ns(this.sessionId);
    }
  };
});
var Gs = {};
At(Gs, { OnnxruntimeWebAssemblyBackend: () => hr, initializeFlags: () => Fs, wasmBackend: () => Ec });
var Fs;
var hr;
var Ec;
var $s = k(() => {
  "use strict";
  Ve();
  mn();
  Ws();
  Fs = () => {
    (typeof Q.wasm.initTimeout != "number" || Q.wasm.initTimeout < 0) && (Q.wasm.initTimeout = 0);
    let a = Q.wasm.simd;
    if (typeof a != "boolean" && a !== void 0 && a !== "fixed" && a !== "relaxed" && (console.warn(`Property "env.wasm.simd" is set to unknown value "${a}". Reset it to \`false\` and ignore SIMD feature checking.`), Q.wasm.simd = false), typeof Q.wasm.proxy != "boolean" && (Q.wasm.proxy = false), typeof Q.wasm.trace != "boolean" && (Q.wasm.trace = false), typeof Q.wasm.numThreads != "number" || !Number.isInteger(Q.wasm.numThreads) || Q.wasm.numThreads <= 0) if (typeof self < "u" && !self.crossOriginIsolated) Q.wasm.numThreads = 1;
    else {
      let r = typeof navigator > "u" ? qr("node:os").cpus().length : navigator.hardwareConcurrency;
      Q.wasm.numThreads = Math.min(4, Math.ceil((r || 1) / 2));
    }
  }, hr = class {
    async init(r) {
      Fs(), await Us(), await Cs(r);
    }
    async createInferenceSessionHandler(r, s) {
      let f = new mr();
      return await f.loadModel(r, s), f;
    }
  }, Ec = new hr();
});
Ve();
Ve();
Ve();
var Xa = "1.27.0";
var vl = Qr;
{
  let a = ($s(), zt(Gs)).wasmBackend;
  Qe("webgpu", a, 5), Qe("webnn", a, 5), Qe("cpu", a, 10), Qe("wasm", a, 10);
}
Object.defineProperty(Q.versions, "web", { value: Xa, enumerable: true });

// src/runtime/manifest.ts
var MODEL_FILES_FORMAT = "ardy-browser-model-files";
var MODEL_FILES_SCHEMA_VERSION = 1;
var MODEL_MANIFEST_FILE = "model.json.gz";
var MIXED_PRECISION_FORMAT = "mixed-fp16";
var FP32_PRECISION_FORMAT = "fp32";
var MIXED_PRECISION_POLICY_VERSION = 3;
var MIXED_PRECISION_PUBLIC_IO_DTYPE = "float32";
var REQUIRED_WEBGPU_FEATURE = "shader-f16";
var GRAPH_PRECISION_CONTRACT = {
  text_encoder: {
    policy_id: "text-continuation-fp32-v3",
    conversion_mode: "fp32-identity"
  },
  denoiser: {
    policy_id: "denoiser-continuation-fp32-v3",
    conversion_mode: "fp32-identity"
  },
  decoder: {
    policy_id: "decoder-qk-norm-io-geometry-v3",
    conversion_mode: "mixed-fp16"
  }
};
var ManifestValidationError = class extends Error {
  constructor(message) {
    super(`Invalid ARDY browser model manifest: ${message}`);
    this.name = "ManifestValidationError";
  }
};
var SHA256_RE = /^[0-9a-f]{64}$/;
var SAFE_MODEL_PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var EXPECTED_GRAPH_NAMES = [
  "text_encoder",
  "denoiser",
  "decoder"
];
var FRACTION_TOLERANCE = 1e-9;
function fail(message) {
  throw new ManifestValidationError(message);
}
function objectAt(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value;
}
function stringAt(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}
function finiteAt(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}
function positiveAt(value, path) {
  const number = finiteAt(value, path);
  if (!(number > 0)) {
    fail(`${path} must be positive`);
  }
  return number;
}
function positiveIntegerAt(value, path) {
  const number = positiveAt(value, path);
  if (!Number.isSafeInteger(number)) {
    fail(`${path} must be a positive safe integer`);
  }
  return number;
}
function nonNegativeIntegerAt(value, path) {
  const number = finiteAt(value, path);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return number;
}
function fractionAt(value, path) {
  const number = finiteAt(value, path);
  if (number < 0 || number > 1) {
    fail(`${path} must be between 0 and 1`);
  }
  return number;
}
function validateFraction(actual, numerator, denominator, path) {
  const expected = numerator / denominator;
  if (Math.abs(actual - expected) > FRACTION_TOLERANCE) {
    fail(`${path} does not match the declared byte reduction`);
  }
}
function validateRequiredWebGpuFeatures(value, path, expected) {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const [index, rawFeature] of value.entries()) {
    const feature = stringAt(rawFeature, `${path}[${index}]`);
    if (seen.has(feature)) {
      fail(`${path} must not contain duplicate feature ${JSON.stringify(feature)}`);
    }
    seen.add(feature);
    if (feature !== REQUIRED_WEBGPU_FEATURE) {
      fail(`${path} contains unknown WebGPU feature ${JSON.stringify(feature)}`);
    }
  }
  if (value.length !== expected.length || expected.some((feature, index) => value[index] !== feature)) {
    fail(`${path} must equal ${JSON.stringify(expected)}`);
  }
  return value;
}
function rejectLegacyFields(record, path, fields) {
  for (const field of fields) {
    if (Object.hasOwn(record, field)) {
      fail(`${path}.${field} is not supported by the current text-only contract`);
    }
  }
}
function numberArrayAt(value, path, length) {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${path} must contain exactly ${length} numbers`);
  }
  return value.map((item, index) => finiteAt(item, `${path}[${index}]`));
}
function integerArrayAt(value, path, length) {
  return numberArrayAt(value, path, length).map((item, index) => {
    if (!Number.isSafeInteger(item)) {
      fail(`${path}[${index}] must be a safe integer`);
    }
    return item;
  });
}
function normalizeModelPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/");
  if (normalized.length === 0 || normalized.startsWith("/") || normalized.endsWith("/") || segments.some(
    (part) => part === "" || part === "." || part === ".." || !SAFE_MODEL_PATH_SEGMENT_RE.test(part)
  )) {
    fail(`unsafe relative asset path ${JSON.stringify(path)}`);
  }
  return normalized;
}
function validateNameMap(value, path, requiredKeys) {
  const record = objectAt(value, path);
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== requiredKeys.length || requiredKeys.some((key) => !Object.hasOwn(record, key))) {
    fail(`${path} must contain exactly ${requiredKeys.join(", ")}`);
  }
  const names = requiredKeys.map(
    (key) => stringAt(record[key], `${path}.${key}`)
  );
  if (new Set(names).size !== names.length) {
    fail(`${path} must not map multiple semantic fields to the same ONNX name`);
  }
  return record;
}
function validateGraph(value, path, files, requiredInputs, requiredOutputs) {
  const graph = objectAt(value, path);
  const model = normalizeModelPath(stringAt(graph.model, `${path}.model`));
  if (!files.has(model)) {
    fail(`${path}.model references undeclared file ${JSON.stringify(model)}`);
  }
  const referencedFiles = /* @__PURE__ */ new Set([model]);
  validateNameMap(graph.inputs, `${path}.inputs`, requiredInputs);
  validateNameMap(graph.outputs, `${path}.outputs`, requiredOutputs);
  if (graph.external_data !== void 0) {
    if (!Array.isArray(graph.external_data)) {
      fail(`${path}.external_data must be an array`);
    }
    const embeddedPaths = /* @__PURE__ */ new Set();
    for (const [index, rawExternal] of graph.external_data.entries()) {
      const external = objectAt(rawExternal, `${path}.external_data[${index}]`);
      const embeddedPath = stringAt(
        external.path,
        `${path}.external_data[${index}].path`
      );
      if (embeddedPaths.has(embeddedPath)) {
        fail(`${path}.external_data contains duplicate ONNX path ${embeddedPath}`);
      }
      embeddedPaths.add(embeddedPath);
      const file = normalizeModelPath(
        stringAt(external.file, `${path}.external_data[${index}].file`)
      );
      if (!files.has(file)) {
        fail(`${path}.external_data references undeclared file ${JSON.stringify(file)}`);
      }
      referencedFiles.add(file);
    }
  }
  return referencedFiles;
}
function validateManifestFiles(value) {
  const files = objectAt(value, "files");
  const normalizedPaths = /* @__PURE__ */ new Set();
  const transportPaths = /* @__PURE__ */ new Set();
  if (Object.keys(files).length === 0) {
    fail("files must not be empty");
  }
  for (const [rawPath, rawDescription] of Object.entries(files)) {
    const path = normalizeModelPath(rawPath);
    if (path !== rawPath) {
      fail(`files key ${JSON.stringify(rawPath)} is not in canonical form`);
    }
    if (path === MODEL_MANIFEST_FILE) {
      fail(`${MODEL_MANIFEST_FILE} must not declare itself as a model file`);
    }
    if (normalizedPaths.has(path)) {
      fail(`files contains duplicate normalized path ${JSON.stringify(path)}`);
    }
    normalizedPaths.add(path);
    const description = objectAt(rawDescription, `files.${path}`);
    const sha256 = stringAt(description.sha256, `files.${path}.sha256`);
    if (!SHA256_RE.test(sha256)) {
      fail(`files.${path}.sha256 must be a lowercase SHA-256 hex digest`);
    }
    nonNegativeIntegerAt(description.size_bytes, `files.${path}.size_bytes`);
    if (description.media_type !== void 0) {
      stringAt(description.media_type, `files.${path}.media_type`);
    }
    const transport = objectAt(
      description.transport,
      `files.${path}.transport`
    );
    const transportPath = normalizeModelPath(
      stringAt(transport.path, `files.${path}.transport.path`)
    );
    if (transportPath !== transport.path) {
      fail(`files.${path}.transport.path is not in canonical form`);
    }
    if (transportPath === MODEL_MANIFEST_FILE) {
      fail(`files.${path}.transport.path must not be ${MODEL_MANIFEST_FILE}`);
    }
    if (transportPaths.has(transportPath)) {
      fail(
        `files contains duplicate transport path ${JSON.stringify(transportPath)}`
      );
    }
    transportPaths.add(transportPath);
    if (transport.compression !== "gzip") {
      fail(`files.${path}.transport.compression must be "gzip"`);
    }
    const transportSha256 = stringAt(
      transport.sha256,
      `files.${path}.transport.sha256`
    );
    if (!SHA256_RE.test(transportSha256)) {
      fail(
        `files.${path}.transport.sha256 must be a lowercase SHA-256 hex digest`
      );
    }
    positiveIntegerAt(
      transport.size_bytes,
      `files.${path}.transport.size_bytes`
    );
  }
  return normalizedPaths;
}
function validateSha256(value, path) {
  const sha256 = stringAt(value, path);
  if (!SHA256_RE.test(sha256)) {
    fail(`${path} must be a lowercase SHA-256 hex digest`);
  }
  return sha256;
}
function validateInitializerPrecisionStats(value, path) {
  const stats = objectAt(value, path);
  const countByDtype = objectAt(
    stats.count_by_dtype,
    `${path}.count_by_dtype`
  );
  const bytesByDtype = objectAt(
    stats.bytes_by_dtype,
    `${path}.bytes_by_dtype`
  );
  const countDtypes = Object.keys(countByDtype);
  const byteDtypes = Object.keys(bytesByDtype);
  if (countDtypes.length !== byteDtypes.length || countDtypes.some((dtype) => !Object.hasOwn(bytesByDtype, dtype))) {
    fail(`${path} dtype keys must match between count_by_dtype and bytes_by_dtype`);
  }
  let initializerCount = 0;
  let initializerBytes = 0;
  for (const dtype of countDtypes) {
    if (dtype.trim().length === 0) {
      fail(`${path}.count_by_dtype must not contain an empty dtype`);
    }
    initializerCount += positiveIntegerAt(
      countByDtype[dtype],
      `${path}.count_by_dtype.${dtype}`
    );
    initializerBytes += nonNegativeIntegerAt(
      bytesByDtype[dtype],
      `${path}.bytes_by_dtype.${dtype}`
    );
    if (!Number.isSafeInteger(initializerCount) || !Number.isSafeInteger(initializerBytes)) {
      fail(`${path} totals must be safe integers`);
    }
  }
  const totalCount = nonNegativeIntegerAt(
    stats.total_count,
    `${path}.total_count`
  );
  const totalBytes = nonNegativeIntegerAt(
    stats.total_bytes,
    `${path}.total_bytes`
  );
  if (initializerCount !== totalCount) {
    fail(`${path}.total_count must equal the sum of count_by_dtype`);
  }
  if (initializerBytes !== totalBytes) {
    fail(`${path}.total_bytes must equal the sum of bytes_by_dtype`);
  }
  return stats;
}
function rejectInitializerDtype(stats, dtype, path) {
  if ((stats.count_by_dtype[dtype] ?? 0) !== 0 || (stats.bytes_by_dtype[dtype] ?? 0) !== 0) {
    fail(`${path} must not contain ${dtype} initializers`);
  }
}
function initializerStatsEqual(left, right) {
  if (left.total_count !== right.total_count || left.total_bytes !== right.total_bytes) {
    return false;
  }
  for (const field of ["count_by_dtype", "bytes_by_dtype"]) {
    const leftEntries = Object.entries(left[field]).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    const rightEntries = Object.entries(right[field]).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    if (leftEntries.length !== rightEntries.length || leftEntries.some(
      ([dtype, amount], index) => dtype !== rightEntries[index]?.[0] || amount !== rightEntries[index]?.[1]
    )) {
      return false;
    }
  }
  return true;
}
function validateMixedPrecision(value, graphsValue, filesValue) {
  const precision = objectAt(value, "precision");
  if (precision.format !== MIXED_PRECISION_FORMAT) {
    fail(`precision.format must be ${JSON.stringify(MIXED_PRECISION_FORMAT)}`);
  }
  if (precision.policy_version !== MIXED_PRECISION_POLICY_VERSION) {
    fail(`precision.policy_version must be ${MIXED_PRECISION_POLICY_VERSION}`);
  }
  if (precision.public_io_dtype !== MIXED_PRECISION_PUBLIC_IO_DTYPE) {
    fail(
      `precision.public_io_dtype must be ${JSON.stringify(MIXED_PRECISION_PUBLIC_IO_DTYPE)}`
    );
  }
  validateRequiredWebGpuFeatures(
    precision.required_webgpu_features,
    "precision.required_webgpu_features",
    [REQUIRED_WEBGPU_FEATURE]
  );
  const toolchain = objectAt(precision.toolchain, "precision.toolchain");
  for (const name of ["torch", "onnx", "onnxruntime"]) {
    stringAt(toolchain[name], `precision.toolchain.${name}`);
  }
  const sourceBytes = positiveIntegerAt(
    precision.source_onnx_bytes,
    "precision.source_onnx_bytes"
  );
  const mixedBytes = positiveIntegerAt(
    precision.mixed_onnx_bytes,
    "precision.mixed_onnx_bytes"
  );
  const savedBytes = nonNegativeIntegerAt(
    precision.saved_onnx_bytes,
    "precision.saved_onnx_bytes"
  );
  if (sourceBytes - mixedBytes !== savedBytes) {
    fail(
      "precision.saved_onnx_bytes must equal source_onnx_bytes - mixed_onnx_bytes"
    );
  }
  const savedFraction = fractionAt(
    precision.saved_onnx_fraction,
    "precision.saved_onnx_fraction"
  );
  validateFraction(
    savedFraction,
    savedBytes,
    sourceBytes,
    "precision.saved_onnx_fraction"
  );
  const summaries = objectAt(precision.graphs, "precision.graphs");
  const actualGraphNames = Object.keys(summaries);
  if (actualGraphNames.length !== EXPECTED_GRAPH_NAMES.length || EXPECTED_GRAPH_NAMES.some((name) => !Object.hasOwn(summaries, name))) {
    fail(`precision.graphs must contain exactly ${EXPECTED_GRAPH_NAMES.join(", ")}`);
  }
  const graphs = objectAt(graphsValue, "graphs");
  const files = objectAt(filesValue, "files");
  let graphSourceBytes = 0;
  let graphMixedBytes = 0;
  let graphSavedBytes = 0;
  for (const graphName of EXPECTED_GRAPH_NAMES) {
    const path = `precision.graphs.${graphName}`;
    const summary = objectAt(summaries[graphName], path);
    if (summary.schema_version !== 1) {
      fail(`${path}.schema_version must be 1`);
    }
    if (summary.graph_name !== graphName) {
      fail(`${path}.graph_name must be ${JSON.stringify(graphName)}`);
    }
    const contract = GRAPH_PRECISION_CONTRACT[graphName];
    if (summary.policy_id !== contract.policy_id) {
      fail(`${path}.policy_id must be ${JSON.stringify(contract.policy_id)}`);
    }
    if (summary.conversion_mode !== contract.conversion_mode) {
      fail(
        `${path}.conversion_mode must be ${JSON.stringify(contract.conversion_mode)}`
      );
    }
    const sourceSha256 = validateSha256(
      summary.source_sha256,
      `${path}.source_sha256`
    );
    const outputSha256 = validateSha256(
      summary.output_sha256,
      `${path}.output_sha256`
    );
    const sourceInitializers = validateInitializerPrecisionStats(
      summary.source_initializers,
      `${path}.source_initializers`
    );
    const outputInitializers = validateInitializerPrecisionStats(
      summary.output_initializers,
      `${path}.output_initializers`
    );
    rejectInitializerDtype(
      sourceInitializers,
      "float16",
      `${path}.source_initializers`
    );
    rejectInitializerDtype(
      sourceInitializers,
      "bfloat16",
      `${path}.source_initializers`
    );
    rejectInitializerDtype(
      outputInitializers,
      "bfloat16",
      `${path}.output_initializers`
    );
    const sourceSize = positiveIntegerAt(
      summary.source_size_bytes,
      `${path}.source_size_bytes`
    );
    const outputSize = positiveIntegerAt(
      summary.output_size_bytes,
      `${path}.output_size_bytes`
    );
    const reductionSize = nonNegativeIntegerAt(
      summary.size_reduction_bytes,
      `${path}.size_reduction_bytes`
    );
    if (sourceSize - outputSize !== reductionSize) {
      fail(
        `${path}.size_reduction_bytes must equal source_size_bytes - output_size_bytes`
      );
    }
    const reductionFraction = fractionAt(
      summary.size_reduction_fraction,
      `${path}.size_reduction_fraction`
    );
    validateFraction(
      reductionFraction,
      reductionSize,
      sourceSize,
      `${path}.size_reduction_fraction`
    );
    if (contract.conversion_mode === "fp32-identity") {
      if (sourceSize !== outputSize || reductionSize !== 0 || reductionFraction !== 0) {
        fail(`${path} fp32-identity conversion must have zero byte reduction`);
      }
      if (sourceSha256 !== outputSha256) {
        fail(`${path} fp32-identity source_sha256 must equal output_sha256`);
      }
      rejectInitializerDtype(
        outputInitializers,
        "float16",
        `${path}.output_initializers`
      );
      if (!initializerStatsEqual(sourceInitializers, outputInitializers)) {
        fail(
          `${path} fp32-identity source and output initializer statistics must match`
        );
      }
    } else {
      if (reductionSize === 0) {
        fail(`${path} mixed-fp16 conversion must reduce the ONNX byte size`);
      }
      if ((outputInitializers.count_by_dtype.float16 ?? 0) === 0) {
        fail(`${path}.output_initializers must contain float16 initializers`);
      }
    }
    const graph = objectAt(graphs[graphName], `graphs.${graphName}`);
    const modelPath = normalizeModelPath(
      stringAt(graph.model, `graphs.${graphName}.model`)
    );
    const file = objectAt(files[modelPath], `files.${modelPath}`);
    const declaredSize = nonNegativeIntegerAt(
      file.size_bytes,
      `files.${modelPath}.size_bytes`
    );
    if (outputSize !== declaredSize) {
      fail(`${path}.output_size_bytes must match files.${modelPath}.size_bytes`);
    }
    const declaredSha256 = validateSha256(
      file.sha256,
      `files.${modelPath}.sha256`
    );
    if (outputSha256 !== declaredSha256) {
      fail(`${path}.output_sha256 must match files.${modelPath}.sha256`);
    }
    graphSourceBytes += sourceSize;
    graphMixedBytes += outputSize;
    graphSavedBytes += reductionSize;
    if (!Number.isSafeInteger(graphSourceBytes) || !Number.isSafeInteger(graphMixedBytes) || !Number.isSafeInteger(graphSavedBytes)) {
      fail("precision graph byte totals must be safe integers");
    }
  }
  if (graphSourceBytes !== sourceBytes) {
    fail("precision.source_onnx_bytes must equal the precision graph source total");
  }
  if (graphMixedBytes !== mixedBytes) {
    fail("precision.mixed_onnx_bytes must equal the precision graph output total");
  }
  if (graphSavedBytes !== savedBytes) {
    fail("precision.saved_onnx_bytes must equal the precision graph reduction total");
  }
  return precision;
}
function validateFp32Precision(value, graphsValue, filesValue) {
  const precision = objectAt(value, "precision");
  if (precision.format !== FP32_PRECISION_FORMAT) {
    fail(`precision.format must be ${JSON.stringify(FP32_PRECISION_FORMAT)}`);
  }
  if (precision.public_io_dtype !== MIXED_PRECISION_PUBLIC_IO_DTYPE) {
    fail(
      `precision.public_io_dtype must be ${JSON.stringify(MIXED_PRECISION_PUBLIC_IO_DTYPE)}`
    );
  }
  validateRequiredWebGpuFeatures(
    precision.required_webgpu_features,
    "precision.required_webgpu_features",
    []
  );
  const toolchain = objectAt(precision.toolchain, "precision.toolchain");
  for (const name of ["torch", "onnx", "onnxruntime"]) {
    stringAt(toolchain[name], `precision.toolchain.${name}`);
  }
  const declaredTotal = positiveIntegerAt(
    precision.onnx_bytes,
    "precision.onnx_bytes"
  );
  const summaries = objectAt(precision.graphs, "precision.graphs");
  const actualGraphNames = Object.keys(summaries);
  if (actualGraphNames.length !== EXPECTED_GRAPH_NAMES.length || EXPECTED_GRAPH_NAMES.some((name) => !Object.hasOwn(summaries, name))) {
    fail(`precision.graphs must contain exactly ${EXPECTED_GRAPH_NAMES.join(", ")}`);
  }
  const graphs = objectAt(graphsValue, "graphs");
  const files = objectAt(filesValue, "files");
  let graphTotal = 0;
  for (const graphName of EXPECTED_GRAPH_NAMES) {
    const path = `precision.graphs.${graphName}`;
    const summary = objectAt(summaries[graphName], path);
    const modelPath = normalizeModelPath(
      stringAt(summary.model, `${path}.model`)
    );
    const graph = objectAt(graphs[graphName], `graphs.${graphName}`);
    const declaredGraphPath = normalizeModelPath(
      stringAt(graph.model, `graphs.${graphName}.model`)
    );
    if (modelPath !== declaredGraphPath) {
      fail(`${path}.model must match graphs.${graphName}.model`);
    }
    const file = objectAt(files[modelPath], `files.${modelPath}`);
    const sizeBytes = positiveIntegerAt(summary.size_bytes, `${path}.size_bytes`);
    if (sizeBytes !== nonNegativeIntegerAt(file.size_bytes, `files.${modelPath}.size_bytes`)) {
      fail(`${path}.size_bytes must match files.${modelPath}.size_bytes`);
    }
    const sha256 = validateSha256(summary.sha256, `${path}.sha256`);
    if (sha256 !== validateSha256(file.sha256, `files.${modelPath}.sha256`)) {
      fail(`${path}.sha256 must match files.${modelPath}.sha256`);
    }
    graphTotal += sizeBytes;
    if (!Number.isSafeInteger(graphTotal)) {
      fail("precision graph byte total must be a safe integer");
    }
  }
  if (graphTotal !== declaredTotal) {
    fail("precision.onnx_bytes must equal the precision graph total");
  }
  return precision;
}
function validatePrecision(value, graphsValue, filesValue) {
  const precision = objectAt(value, "precision");
  if (precision.format === MIXED_PRECISION_FORMAT) {
    return validateMixedPrecision(value, graphsValue, filesValue);
  }
  if (precision.format === FP32_PRECISION_FORMAT) {
    return validateFp32Precision(value, graphsValue, filesValue);
  }
  fail(
    `precision.format must be ${JSON.stringify(MIXED_PRECISION_FORMAT)} or ${JSON.stringify(FP32_PRECISION_FORMAT)}`
  );
}
function validateDimensions(value) {
  const dimensions = objectAt(value, "dimensions");
  rejectLegacyFields(dimensions, "dimensions", [
    "constraint_max_tokens",
    "constraint_max_frames"
  ]);
  const result = {};
  for (const key of [
    "fps",
    "num_frames_per_token",
    "max_tokens",
    "max_frames",
    "generation_tokens",
    "generation_frames",
    "history_tokens",
    "history_frames",
    "root_features_per_frame",
    "nframe_root_dim",
    "latent_dim",
    "hybrid_dim",
    "motion_dim",
    "body_dim",
    "text_condition_dim",
    "num_joints"
  ]) {
    result[key] = positiveIntegerAt(dimensions[key], `dimensions.${key}`);
  }
  if (result.max_frames !== result.max_tokens * result.num_frames_per_token) {
    fail("dimensions.max_frames must equal max_tokens * num_frames_per_token");
  }
  if (result.generation_frames !== result.generation_tokens * result.num_frames_per_token) {
    fail(
      "dimensions.generation_frames must equal generation_tokens * num_frames_per_token"
    );
  }
  if (result.history_frames !== result.history_tokens * result.num_frames_per_token) {
    fail("dimensions.history_frames must equal history_tokens * num_frames_per_token");
  }
  if (result.history_tokens + result.generation_tokens > result.max_tokens) {
    fail("history_tokens + generation_tokens exceeds max_tokens");
  }
  if (result.nframe_root_dim !== result.root_features_per_frame * result.num_frames_per_token) {
    fail(
      "dimensions.nframe_root_dim must equal root_features_per_frame * num_frames_per_token"
    );
  }
  if (result.hybrid_dim !== result.nframe_root_dim + result.latent_dim) {
    fail("dimensions.hybrid_dim must equal nframe_root_dim + latent_dim");
  }
  const core40Contract = {
    fps: 20,
    num_frames_per_token: 4,
    max_tokens: 20,
    max_frames: 80,
    generation_tokens: 10,
    generation_frames: 40,
    history_tokens: 10,
    history_frames: 40,
    root_features_per_frame: 5,
    nframe_root_dim: 20,
    latent_dim: 128,
    hybrid_dim: 148,
    motion_dim: 330,
    body_dim: 325,
    text_condition_dim: 2048,
    num_joints: 27
  };
  for (const key of Object.keys(core40Contract)) {
    if (result[key] !== core40Contract[key]) {
      fail(
        `dimensions.${key} must be ${core40Contract[key]} for the browser Core40 runtime`
      );
    }
  }
  return result;
}
function validateDiffusion(value, steps) {
  const diffusion = objectAt(value, "diffusion");
  const timesteps = integerArrayAt(diffusion.timesteps, "diffusion.timesteps", steps);
  const alphas = numberArrayAt(
    diffusion.alphas_cumprod,
    "diffusion.alphas_cumprod",
    steps
  );
  const previous = numberArrayAt(
    diffusion.alphas_cumprod_prev,
    "diffusion.alphas_cumprod_prev",
    steps
  );
  const seenTimesteps = /* @__PURE__ */ new Set();
  for (let index = 0; index < steps; index += 1) {
    const timestep = timesteps[index];
    if (timestep < 0 || timestep >= steps || seenTimesteps.has(timestep)) {
      fail(`diffusion.timesteps must be a permutation of 0 through ${steps - 1}`);
    }
    seenTimesteps.add(timestep);
    if (index > 0 && timestep >= timesteps[index - 1]) {
      fail("diffusion.timesteps must be in strictly decreasing inference order");
    }
    if (!(alphas[index] > 0 && alphas[index] <= 1)) {
      fail(`diffusion.alphas_cumprod[${index}] must be in (0, 1]`);
    }
    if (index > 0 && alphas[index] > alphas[index - 1]) {
      fail("diffusion.alphas_cumprod must be monotonically non-increasing");
    }
    if (!(previous[index] > 0 && previous[index] <= 1)) {
      fail(`diffusion.alphas_cumprod_prev[${index}] must be in (0, 1]`);
    }
    const expected = index === 0 ? 1 : alphas[index - 1];
    if (Math.abs(previous[index] - expected) > 1e-6) {
      fail(`diffusion.alphas_cumprod_prev[${index}] does not match the prior alpha`);
    }
  }
}
function validateModelManifest(value) {
  const manifest = objectAt(value, "manifest");
  if (manifest.format !== MODEL_FILES_FORMAT) {
    fail(`format must be ${JSON.stringify(MODEL_FILES_FORMAT)}`);
  }
  if (manifest.schema_version !== MODEL_FILES_SCHEMA_VERSION) {
    fail(`schema_version must be ${MODEL_FILES_SCHEMA_VERSION}`);
  }
  const model = objectAt(manifest.model, "model");
  stringAt(model.id, "model.id");
  stringAt(model.variant, "model.variant");
  stringAt(model.revision, "model.revision");
  const files = validateManifestFiles(manifest.files);
  const tokenizer = objectAt(manifest.tokenizer, "tokenizer");
  const tokenizerDirectory = normalizeModelPath(
    stringAt(tokenizer.directory, "tokenizer.directory")
  );
  positiveIntegerAt(tokenizer.max_length, "tokenizer.max_length");
  if (tokenizer.model_id !== void 0) {
    stringAt(tokenizer.model_id, "tokenizer.model_id");
  }
  for (const requiredName of ["tokenizer.json", "tokenizer_config.json"]) {
    const requiredPath = `${tokenizerDirectory}/${requiredName}`;
    if (!files.has(requiredPath)) {
      fail(`tokenizer requires declared file ${JSON.stringify(requiredPath)}`);
    }
  }
  const graphs = objectAt(manifest.graphs, "graphs");
  const actualGraphNames = Object.keys(graphs);
  if (actualGraphNames.length !== EXPECTED_GRAPH_NAMES.length || EXPECTED_GRAPH_NAMES.some((name) => !Object.hasOwn(graphs, name))) {
    fail(
      `graphs must contain exactly ${EXPECTED_GRAPH_NAMES.join(", ")}`
    );
  }
  const referencedFiles = /* @__PURE__ */ new Set([
    `${tokenizerDirectory}/tokenizer.json`,
    `${tokenizerDirectory}/tokenizer_config.json`
  ]);
  const collectGraphFiles = (graphFiles) => {
    for (const file of graphFiles) referencedFiles.add(file);
  };
  collectGraphFiles(validateGraph(
    graphs.text_encoder,
    "graphs.text_encoder",
    files,
    ["inputIds", "attentionMask", "tokenTypeIds"],
    ["textConditions"]
  ));
  collectGraphFiles(validateGraph(
    graphs.denoiser,
    "graphs.denoiser",
    files,
    [
      "cfgWeight",
      "x",
      "historyLength",
      "generationLength",
      "historyMask",
      "generationMask",
      "historyTokenMask",
      "generationTokenMask",
      "textConditions",
      "timestep",
      "firstHeadingAngle"
    ],
    ["predX0"]
  ));
  collectGraphFiles(validateGraph(
    graphs.decoder,
    "graphs.decoder",
    files,
    ["hybridTokens", "motionPadMask", "globalTranslation"],
    [
      "normalizedMotion",
      "posedJoints",
      "localRotations",
      "globalRotations",
      "rootPositions",
      "footContacts",
      "globalRootHeading"
    ]
  ));
  for (const file of files) {
    if (!referencedFiles.has(file)) {
      fail(`files contains unreferenced asset ${JSON.stringify(file)}`);
    }
  }
  const precision = validatePrecision(
    manifest.precision,
    manifest.graphs,
    manifest.files
  );
  const dimensions = validateDimensions(manifest.dimensions);
  const generation = objectAt(manifest.generation, "generation");
  rejectLegacyFields(generation, "generation", [
    "default_text_cfg_weight",
    "default_constraint_cfg_weight"
  ]);
  const minFrames = positiveIntegerAt(generation.min_frames, "generation.min_frames");
  const maxFrames = positiveIntegerAt(generation.max_frames, "generation.max_frames");
  if (minFrames !== dimensions.generation_frames) {
    fail("generation.min_frames must equal one generation window");
  }
  if (maxFrames !== 10 * dimensions.fps) {
    fail("generation.max_frames must equal the browser 10-second limit");
  }
  positiveAt(generation.default_cfg_weight, "generation.default_cfg_weight");
  if (generation.window_policy !== void 0) {
    stringAt(generation.window_policy, "generation.window_policy");
  }
  const denoisingSteps = positiveIntegerAt(
    generation.denoising_steps,
    "generation.denoising_steps"
  );
  if (denoisingSteps !== 10) {
    fail("generation.denoising_steps must be 10 for the browser Core40 runtime");
  }
  validateDiffusion(manifest.diffusion, denoisingSteps);
  const recenter = objectAt(manifest.recenter, "recenter");
  const rootSize = dimensions.root_features_per_frame;
  const rootMean = numberArrayAt(recenter.root_mean, "recenter.root_mean", rootSize);
  const rootStd = numberArrayAt(recenter.root_std, "recenter.root_std", rootSize);
  rootStd.forEach((std, index) => {
    if (!(std > 0)) {
      fail(`recenter.root_std[${index}] must be positive`);
    }
  });
  const positions = integerArrayAt(
    recenter.position_indices,
    "recenter.position_indices",
    3
  );
  const headings = integerArrayAt(
    recenter.heading_indices,
    "recenter.heading_indices",
    2
  );
  if ((/* @__PURE__ */ new Set([...positions, ...headings])).size !== 5 || [...positions, ...headings].some((index) => index < 0 || index >= rootSize)) {
    fail("recenter position/heading indices must be distinct valid root feature indices");
  }
  if (rootMean.length !== rootSize) {
    fail("recenter root statistics are inconsistent");
  }
  const quantization = objectAt(manifest.latent_quantization, "latent_quantization");
  const latentSize = dimensions.latent_dim;
  const levels = integerArrayAt(
    quantization.levels,
    "latent_quantization.levels",
    latentSize
  );
  levels.forEach((level, index) => {
    if (level < 2) {
      fail(`latent_quantization.levels[${index}] must be at least 2`);
    }
  });
  numberArrayAt(quantization.mean, "latent_quantization.mean", latentSize);
  const latentStd = numberArrayAt(
    quantization.std,
    "latent_quantization.std",
    latentSize
  );
  latentStd.forEach((std, index) => {
    if (!(std > 0)) {
      fail(`latent_quantization.std[${index}] must be positive`);
    }
  });
  const validateLicenseNotices = (value2, path) => {
    if (!Array.isArray(value2)) {
      fail(`${path} must be an array`);
    }
    value2.forEach((rawNotice, index) => {
      const notice = objectAt(rawNotice, `${path}[${index}]`);
      stringAt(notice.component, `${path}[${index}].component`);
      stringAt(notice.license, `${path}[${index}].license`);
      stringAt(notice.notice, `${path}[${index}].notice`);
    });
  };
  if (manifest.notices !== void 0) {
    if (!Array.isArray(manifest.notices)) {
      fail("notices must be an array");
    }
    manifest.notices.forEach((rawNotice, index) => {
      if (typeof rawNotice === "string") {
        stringAt(rawNotice, `notices[${index}]`);
        return;
      }
      const notice = objectAt(rawNotice, `notices[${index}]`);
      stringAt(notice.component, `notices[${index}].component`);
      stringAt(notice.license, `notices[${index}].license`);
      stringAt(notice.notice, `notices[${index}].notice`);
    });
  }
  if (manifest.license_notices !== void 0) {
    validateLicenseNotices(manifest.license_notices, "license_notices");
  }
  if (manifest.skeleton !== void 0) {
    const skeleton = objectAt(manifest.skeleton, "skeleton");
    stringAt(skeleton.name, "skeleton.name");
    const rootIndex = nonNegativeIntegerAt(
      skeleton.root_index,
      "skeleton.root_index"
    );
    const parents = integerArrayAt(
      skeleton.parents,
      "skeleton.parents",
      dimensions.num_joints
    );
    if (rootIndex >= dimensions.num_joints || parents[rootIndex] !== -1 || parents.filter((parent) => parent === -1).length !== 1) {
      fail("skeleton must contain one valid root");
    }
    parents.forEach((parent, index) => {
      if (index !== rootIndex && (parent < 0 || parent >= index)) {
        fail(`skeleton.parents[${index}] must reference an earlier joint`);
      }
    });
    if (!Array.isArray(skeleton.joint_names) || skeleton.joint_names.length !== dimensions.num_joints) {
      fail(`skeleton.joint_names must contain ${dimensions.num_joints} names`);
    }
    skeleton.joint_names.forEach(
      (name, index) => stringAt(name, `skeleton.joint_names[${index}]`)
    );
    if (!Array.isArray(skeleton.neutral_joints) || skeleton.neutral_joints.length !== dimensions.num_joints) {
      fail(
        `skeleton.neutral_joints must contain ${dimensions.num_joints} joints`
      );
    }
    skeleton.neutral_joints.forEach(
      (joint, index) => numberArrayAt(joint, `skeleton.neutral_joints[${index}]`, 3)
    );
  }
  if (manifest.stats !== void 0) {
    const stats = objectAt(manifest.stats, "stats");
    for (const key of [
      "motion",
      "global_root",
      "local_root",
      "body",
      "post_quantization"
    ]) {
      const payload = objectAt(stats[key], `stats.${key}`);
      if (!Array.isArray(payload.mean) || !Array.isArray(payload.std) || !Array.isArray(payload.normalization_denominator) || payload.mean.length === 0 || payload.mean.length !== payload.std.length || payload.mean.length !== payload.normalization_denominator.length) {
        fail(`stats.${key} arrays must have the same non-zero length`);
      }
      numberArrayAt(payload.mean, `stats.${key}.mean`, payload.mean.length);
      numberArrayAt(payload.std, `stats.${key}.std`, payload.mean.length);
      const denominators = numberArrayAt(
        payload.normalization_denominator,
        `stats.${key}.normalization_denominator`,
        payload.mean.length
      );
      if (denominators.some((value2) => !(value2 > 0))) {
        fail(`stats.${key}.normalization_denominator must be positive`);
      }
    }
  }
  if (manifest.motion_layout !== void 0) {
    const layout = objectAt(manifest.motion_layout, "motion_layout");
    for (const [name, value2] of Object.entries(layout)) {
      const [start, stop] = integerArrayAt(
        value2,
        `motion_layout.${name}`,
        2
      );
      if (start < 0 || stop <= start || stop > dimensions.motion_dim) {
        fail(`motion_layout.${name} must be a valid motion feature slice`);
      }
    }
  }
  const runtime2 = objectAt(manifest.runtime, "runtime");
  rejectLegacyFields(runtime2, "runtime", [
    "constraints_supported",
    "separated_cfg",
    "future_constraints_supported"
  ]);
  if (runtime2.onnx_opset !== void 0) {
    positiveIntegerAt(runtime2.onnx_opset, "runtime.onnx_opset");
  }
  if (runtime2.contract_revision !== 3) {
    fail("runtime.contract_revision must be 3");
  }
  if (runtime2.text_only !== true) {
    fail("runtime.text_only must be true");
  }
  validateRequiredWebGpuFeatures(
    runtime2.required_webgpu_features,
    "runtime.required_webgpu_features",
    precision.required_webgpu_features
  );
  for (const key of [
    "detailed_motion_outputs",
    "motion_correction_included",
    "global_translation_y_must_be_zero"
  ]) {
    if (runtime2[key] !== void 0 && typeof runtime2[key] !== "boolean") {
      fail(`runtime.${key} must be a boolean`);
    }
  }
  if (runtime2.batch_size !== void 0) {
    positiveIntegerAt(runtime2.batch_size, "runtime.batch_size");
  }
  if (manifest.capabilities !== void 0) {
    const capabilities = objectAt(manifest.capabilities, "capabilities");
    rejectLegacyFields(capabilities, "capabilities", [
      "kinematic_constraints",
      "future_constraints",
      "separated_classifier_free_guidance"
    ]);
    for (const [key, enabled] of Object.entries(capabilities)) {
      if (typeof enabled !== "boolean") {
        fail(`capabilities.${key} must be a boolean`);
      }
    }
  }
  return manifest;
}

// src/runtime/sessions.ts
var webGpuAdapter;
function configureOrtAdapter(adapter) {
  if (Q.webgpu.adapter !== adapter) {
    Q.webgpu.adapter = adapter;
  }
}
async function resolveWebGpuAdapter() {
  let adapter = webGpuAdapter;
  if (adapter !== void 0) {
    return adapter;
  }
  if (globalThis.isSecureContext === false) {
    throw new Error(
      "WebGPU requires HTTPS or localhost. Open this demo in a secure context and try again."
    );
  }
  const navigatorWithGpu = globalThis.navigator;
  if (!navigatorWithGpu?.gpu) {
    throw new Error(
      "WebGPU is required. Use a WebGPU-capable browser and device."
    );
  }
  let requestedAdapter;
  try {
    requestedAdapter = await navigatorWithGpu.gpu.requestAdapter();
  } catch (error) {
    throw new Error("WebGPU adapter initialization failed.", { cause: error });
  }
  if (requestedAdapter === null) {
    throw new Error(
      "WebGPU is required, but no compatible GPU adapter is available."
    );
  }
  adapter = requestedAdapter;
  webGpuAdapter = adapter;
  return adapter;
}
async function getWebGpuCapabilities() {
  const adapter = await resolveWebGpuAdapter();
  return {
    shaderF16: adapter.features.has(REQUIRED_WEBGPU_FEATURE)
  };
}
// ── 兼容补丁（上游假设 Chrome ≥ 128）───────────────────────────────────────
// ORT 的 WebGPU EP 在 ort-wasm-simd-threaded.asyncify.mjs 里做的是：
//     "adapterInfo" in device || (device.adapterInfo = adapter.info)
// 随后 wasm 侧读 adapterInfo.subgroupMinSize / .vendor / .device / .description。
// 但 Chromium < 128 的 GPUAdapter **没有 .info**（那是 Chrome 128 才加的同步属性，
// 老版本只有异步 requestAdapterInfo()），而这份 ORT 里**完全没有** requestAdapterInfo 兜底
// → device.adapterInfo === undefined → wasm 里炸：
//     TypeError: Cannot read properties of undefined (reading 'subgroupMinSize')
// 修法：包一层 requestAdapter，给拿到的 adapter 补上 .info（能问就问，问不到用稳妥默认值）。
// 放在模块顶层 → worker 一启动就装好，早于任何一次适配器/会话创建。
(function installGpuAdapterInfoPolyfill() {
  try {
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : null;
    if (!gpu || typeof gpu.requestAdapter !== "function" || gpu.__ardyInfoPatched) return;
    const original = gpu.requestAdapter.bind(gpu);
    const withInfo = async (adapter) => {
      if (!adapter || adapter.info) return adapter;   // 已支持（Chrome ≥128）直接放行
      let raw = null;
      try {
        if (typeof adapter.requestAdapterInfo === "function") raw = await adapter.requestAdapterInfo();
      } catch (e) { /* 拿不到就退回默认值 */ }
      const info = Object.assign({
        vendor: "", architecture: "", device: "", description: "",
        subgroupMinSize: 32, subgroupMaxSize: 32, isFallbackAdapter: false
      }, raw || {});
      if (typeof info.subgroupMinSize !== "number") info.subgroupMinSize = 32;
      if (typeof info.subgroupMaxSize !== "number") info.subgroupMaxSize = 32;
      try {
        Object.defineProperty(adapter, "info", { value: info, configurable: true, enumerable: true, writable: true });
      } catch (e) {
        try { adapter.info = info; } catch (e2) { /* 实在不行只能作罢 */ }
      }
      globalThis.__ardyAdapterInfoPatched = true;
      return adapter;
    };
    const patched = function (...args) {
      return Promise.resolve(original(...args)).then(withInfo, (e) => { throw e; });
    };
    gpu.requestAdapter = patched;
    gpu.__ardyInfoPatched = true;
    globalThis.__ardyAdapterInfoPatched = true;
  } catch (e) { /* 补丁失败不阻塞主流程 */ }
})();
async function assertWebGpuAvailable(requiredFeatures = []) {
  const adapter = await resolveWebGpuAdapter();
  for (const feature of requiredFeatures) {
    if (!adapter.features.has(feature)) {
      throw new Error(
        `The selected model requires the WebGPU feature ${feature}, but the selected GPU adapter does not provide it.`
      );
    }
  }
  configureOrtAdapter(adapter);
}
function runtimeAssetBaseUrl() {
  if (typeof globalThis.location === "undefined") return "/ort/";
  return new URL("../ort/", globalThis.location.href).href;
}
function configureOrt() {
  Q.logLevel = "error";
  Q.wasm.proxy = false;
  Q.wasm.numThreads = globalThis.crossOriginIsolated ? 0 : 1;
  Q.wasm.wasmPaths = runtimeAssetBaseUrl();
}
async function createSession(assets, graph) {
  try {
    const [model, externalData] = await Promise.all([
      assets.read(graph.model),
      Promise.all(
        (graph.external_data ?? []).map(async (spec) => ({
          path: spec.path,
          data: await assets.read(spec.file)
        }))
      )
    ]);
    return await Xf.create(model, {
      executionProviders: ["webgpu"],
      logSeverityLevel: 3,
      ...externalData.length === 0 ? {} : { externalData }
    });
  } finally {
    assets.release(graph.model);
    for (const external of graph.external_data ?? []) {
      assets.release(external.file);
    }
  }
}
async function releaseSessions(sessions) {
  await Promise.allSettled(sessions.map((session) => session.release()));
}
async function createAll(assets, graphs, onProgress) {
  const created = [];
  const total = 3;
  try {
    const decoder = await createSession(assets, graphs.decoder);
    created.push(decoder);
    onProgress?.(1, total, "decoder.onnx");
    const textEncoder = await createSession(assets, graphs.text_encoder);
    created.push(textEncoder);
    onProgress?.(2, total, "text_encoder.onnx");
    const denoiser = await createSession(assets, graphs.denoiser);
    created.push(denoiser);
    onProgress?.(total, total, "denoiser.onnx");
    return {
      textEncoder,
      denoiser,
      decoder
    };
  } catch (error) {
    await releaseSessions(created);
    throw error;
  }
}
async function createRuntimeSessions(assets, onProgress) {
  await assertWebGpuAvailable(
    assets.manifest.runtime.required_webgpu_features
  );
  configureOrt();
  return createAll(assets, assets.manifest.graphs, onProgress);
}
async function disposeRuntimeSessions(sessions) {
  await releaseSessions([
    sessions.textEncoder,
    sessions.denoiser,
    sessions.decoder
  ]);
}

// node_modules/@huggingface/tokenizers/dist/tokenizers.mjs
var DictionarySplitter = class {
  /**
   * @param dictionary The dictionary of words to use for splitting.
   */
  constructor(dictionary) {
    this.trie = this._build_trie(dictionary);
  }
  /**
   * Builds a trie from the given dictionary.
   * @param dictionary The dictionary of words to build the trie from.
   * @returns The root node of the trie.
   * @private
   */
  _build_trie(dictionary) {
    const trie = /* @__PURE__ */ Object.create(null);
    for (const word of dictionary) {
      let node = trie;
      for (let i = 0; i < word.length; ++i) {
        const char = word[i];
        node = node[char] ??= /* @__PURE__ */ Object.create(null);
      }
      node.end = word;
    }
    return trie;
  }
  /**
   * Splits the input text into tokens based on the dictionary.
   * @param text The input text to split.
   * @returns An array of tokens.
   */
  split(text) {
    const result = [];
    const n = text.length;
    let start = 0;
    let i = 0;
    while (i < n) {
      let node = this.trie;
      let match = null;
      let j = i;
      while (j < n && (node = node[text[j]])) {
        if (node.end) {
          match = node.end;
        }
        ++j;
      }
      if (match) {
        if (i > start) {
          result.push(text.slice(start, i));
        }
        result.push(match);
        i += match.length;
        start = i;
      } else {
        ++i;
      }
    }
    if (start < n) {
      result.push(text.slice(start));
    }
    return result;
  }
};
var DictionarySplitter_default = DictionarySplitter;
var AddedToken = class {
  /**
   * Creates a new instance of AddedToken.
   * @param config Added token configuration object.
   */
  constructor(config) {
    this.content = config.content;
    this.id = config.id;
    this.single_word = config.single_word ?? false;
    this.lstrip = config.lstrip ?? false;
    this.rstrip = config.rstrip ?? false;
    this.special = config.special ?? false;
    this.normalized = config.normalized ?? !this.special;
  }
};
var AddedToken_default = AddedToken;
var BYTES_TO_UNICODE = (() => {
  const bs2 = [
    ...Array.from(
      { length: "~".charCodeAt(0) - "!".charCodeAt(0) + 1 },
      (_, i) => i + "!".charCodeAt(0)
    ),
    ...Array.from(
      { length: "\xAC".charCodeAt(0) - "\xA1".charCodeAt(0) + 1 },
      (_, i) => i + "\xA1".charCodeAt(0)
    ),
    ...Array.from(
      { length: "\xFF".charCodeAt(0) - "\xAE".charCodeAt(0) + 1 },
      (_, i) => i + "\xAE".charCodeAt(0)
    )
  ];
  const cs2 = bs2.slice();
  let n = 0;
  for (let b = 0; b < 256; ++b) {
    if (!bs2.includes(b)) {
      bs2.push(b);
      cs2.push(256 + n);
      n += 1;
    }
  }
  const ccs = cs2.map((n2) => String.fromCharCode(n2));
  return Object.fromEntries(bs2.map((b, i) => [b, ccs[i]]));
})();
var reverse_dictionary = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [value, key]));
var UNICODE_TO_BYTES = reverse_dictionary(BYTES_TO_UNICODE);
var BLOOM_SPLIT_CHARS = ".,!?\u2026\u3002\uFF0C\u3001\u0964\u06D4\u060C";
var PROBLEMATIC_REGEX_MAP = /* @__PURE__ */ new Map([
  // These uses the case insensitive group modifier, which is not supported in JavaScript.
  // When parsing the regex, an "Invalid group" error is thrown.
  [
    "(?i:'s|'t|'re|'ve|'m|'ll|'d)",
    "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))"
  ],
  [
    "(?i:[sdmt]|ll|ve|re)",
    "(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])"
  ],
  // JS doesn't support possessive quantifiers (these are used in recent OpenAI tokenizers).
  ["[^\\r\\n\\p{L}\\p{N}]?+", "[^\\r\\n\\p{L}\\p{N}]?"],
  ["[^\\s\\p{L}\\p{N}]++", "[^\\s\\p{L}\\p{N}]+"],
  // JS doesn't support atomic groups (these are used in AFMoE tokenizers).
  ["(?>\\p{Nd}{510})", "(?:\\p{Nd}{510})"],
  // JS doesn't support stacking quantifiers.
  // Uncaught SyntaxError: Invalid regular expression: /\p{Nd}{3}+/u: Nothing to repeat
  ["\\p{Nd}{3}+", "(?:\\p{Nd}{3})+"],
  // \G is an invalid escape in JS, and in most cases is just used as an optimization.
  // So, we can safely remove it.
  ["\\G", ""],
  // Used to override the default (invalid) regex of the bloom pretokenizer.
  // For more information, see https://github.com/huggingface/transformers.js/issues/94
  [` ?[^(\\s|[${BLOOM_SPLIT_CHARS}])]+`, ` ?[^\\s${BLOOM_SPLIT_CHARS}]+`]
]);
var PUNCTUATION_REGEX = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E";
var clean_up_tokenization = (text) => text.replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ \!/g, "!").replace(/ ,/g, ",").replace(/ \' /g, "'").replace(/ n't/g, "n't").replace(/ 'm/g, "'m").replace(/ 's/g, "'s").replace(/ 've/g, "'ve").replace(/ 're/g, "'re");
var create_pattern = (pattern, invert = true) => {
  if (pattern.Regex !== void 0) {
    let regex = pattern.Regex.replace(/\\([#&~])/g, "$1");
    regex = regex.replace(/\\A/g, "^").replace(/\\z/g, "$").replace(/\\Z/g, "(?=\\r?\\n?$)");
    for (const [key, value] of PROBLEMATIC_REGEX_MAP) {
      regex = regex.replaceAll(key, value);
    }
    try {
      return new RegExp(regex, "gu");
    } catch (error) {
      if (!(error instanceof SyntaxError) || !error.message.toLowerCase().includes("invalid property name"))
        throw error;
      let changed = false;
      const fixed = regex.replace(/(\\[pP])\{([^}=]+)\}/g, (_, p, n) => {
        try {
          new RegExp(`\\p{${n}}`, "u");
          return `${p}{${n}}`;
        } catch {
          changed = true;
          return `${p}{Script=${n}}`;
        }
      });
      if (!changed) throw error;
      try {
        return new RegExp(fixed, "gu");
      } catch (e) {
        throw error;
      }
    }
  } else if (pattern.String !== void 0) {
    const escaped = escape_reg_exp(pattern.String);
    return new RegExp(invert ? escaped : `(${escaped})`, "gu");
  } else {
    console.warn("Unknown pattern type:", pattern);
    return null;
  }
};
var escape_reg_exp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var fuse_unk = (arr, tokens_to_ids, unk_token_id) => {
  const fused = [];
  let i = 0;
  while (i < arr.length) {
    fused.push(arr[i]);
    const token_id = tokens_to_ids.get(arr[i]) ?? unk_token_id;
    if (token_id !== unk_token_id) {
      ++i;
      continue;
    }
    while (++i < arr.length && (tokens_to_ids.get(arr[i]) ?? unk_token_id) === unk_token_id) {
      if (tokens_to_ids.get(fused.at(-1)) !== unk_token_id) {
        fused[fused.length - 1] += arr[i];
      }
    }
  }
  return fused;
};
var is_chinese_char = (cp) => cp >= 19968 && cp <= 40959 || cp >= 13312 && cp <= 19903 || cp >= 131072 && cp <= 173791 || cp >= 173824 && cp <= 177983 || cp >= 177984 && cp <= 178207 || cp >= 178208 && cp <= 183983 || cp >= 63744 && cp <= 64255 || cp >= 194560 && cp <= 195103;
var is_integral_number = (x) => Number.isInteger(x) || typeof x === "bigint";
var len = (s) => {
  let length = 0;
  for (const c of s) ++length;
  return length;
};
var lowercase_and_remove_accents = (text) => remove_accents(text.toLowerCase());
var merge_arrays = (...arrs) => Array.prototype.concat.apply([], arrs);
var object_to_map = (obj) => new Map(Object.entries(obj));
var regex_split = (text, regex) => {
  const result = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const full_match = match[0];
    if (prev < match.index) {
      result.push(text.slice(prev, match.index));
    }
    if (full_match.length > 0) {
      result.push(full_match);
    }
    prev = match.index + full_match.length;
  }
  if (prev < text.length) {
    result.push(text.slice(prev));
  }
  return result;
};
var remove_accents = (text) => text.replace(new RegExp("\\p{M}", "gu"), "");
var validate_object = (obj, name, required_keys = []) => {
  if (!obj || Array.isArray(obj) || typeof obj !== "object") {
    return `${name} must be a valid object`;
  }
  for (const key of required_keys) {
    if (!(key in obj)) {
      return `${name} must contain a "${key}" property`;
    }
  }
  return null;
};
var whitespace_split = (text) => text.match(/\S+/g) || [];
var Callable = class {
  /**
   * Creates a new instance of the Callable class.
   */
  constructor() {
    const closure = function(...args) {
      return closure._call(...args);
    };
    return Object.setPrototypeOf(closure, new.target.prototype);
  }
};
var Callable_default = Callable;
var Normalizer = class extends Callable_default {
  /**
   * @param config The configuration object for the normalizer.
   */
  constructor(config) {
    super();
    this.config = config;
  }
  /**
   * Alias for {@link Normalizer#normalize}.
   * @param text The text to normalize.
   * @returns The normalized text.
   */
  _call(text) {
    return this.normalize(text);
  }
};
var Normalizer_default = Normalizer;
var BertNormalizer = class extends Normalizer_default {
  /**
   * Adds whitespace around any CJK (Chinese, Japanese, or Korean) character in the input text.
   *
   * @param text The input text to tokenize.
   * @returns The tokenized text with whitespace added around CJK characters.
   */
  tokenize_chinese_chars(text) {
    const output = [];
    for (let i = 0; i < text.length; ++i) {
      const char = text[i];
      const cp = char.charCodeAt(0);
      if (is_chinese_char(cp)) {
        output.push(" ");
        output.push(char);
        output.push(" ");
      } else {
        output.push(char);
      }
    }
    return output.join("");
  }
  /**
   * Strips accents from the given text.
   * @param text The text to strip accents from.
   * @returns The text with accents removed.
   */
  strip_accents(text) {
    return text.normalize("NFD").replace(new RegExp("\\p{Mn}", "gu"), "");
  }
  /**
   * Checks whether `char` is a control character.
   * @param char The character to check.
   * @returns Whether `char` is a control character.
   */
  is_control(char) {
    switch (char) {
      case "	":
      case "\n":
      case "\r":
        return false;
      default:
        return new RegExp("^\\p{Cc}|\\p{Cf}|\\p{Co}|\\p{Cs}$", "u").test(char);
    }
  }
  /**
   * Performs invalid character removal and whitespace cleanup on text.
   * @param text The text to clean.
   * @returns The cleaned text.
   */
  clean_text(text) {
    const output = [];
    for (const char of text) {
      const cp = char.charCodeAt(0);
      if (cp === 0 || cp === 65533 || this.is_control(char)) {
        continue;
      }
      if (/^\s$/.test(char)) {
        output.push(" ");
      } else {
        output.push(char);
      }
    }
    return output.join("");
  }
  /**
   * Normalizes the given text based on the configuration.
   * @param text The text to normalize.
   * @returns The normalized text.
   */
  normalize(text) {
    if (this.config.clean_text) {
      text = this.clean_text(text);
    }
    if (this.config.handle_chinese_chars) {
      text = this.tokenize_chinese_chars(text);
    }
    if (this.config.lowercase) {
      text = text.toLowerCase();
      if (this.config.strip_accents !== false) {
        text = this.strip_accents(text);
      }
    } else if (this.config.strip_accents) {
      text = this.strip_accents(text);
    }
    return text;
  }
};
var BertNormalizer_default = BertNormalizer;
var Precompiled = class extends Normalizer_default {
  /**
   * Create a new instance of Precompiled normalizer.
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.charsmap = config.precompiled_charsmap ?? null;
  }
  /**
   * Normalizes the given text by applying the precompiled charsmap.
   * @param text The text to normalize.
   * @returns The normalized text.
   */
  normalize(text) {
    text = text.replace(
      /[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm,
      ""
    );
    text = text.replace(
      /[\u0009\u000A\u000C\u000D\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u2581\u3000\uFEFF\uFFFD]/gm,
      " "
    );
    if (text.includes("\uFF5E")) {
      const parts = text.split("\uFF5E");
      text = parts.map((part) => part.normalize("NFKC")).join("\uFF5E");
    } else {
      text = text.normalize("NFKC");
    }
    return text;
  }
};
var Precompiled_default = Precompiled;
var Sequence = class extends Normalizer_default {
  /**
   * Create a new instance of NormalizerSequence.
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.normalizers = (config.normalizers ?? []).map(
      (x) => create_normalizer_default(x)
    );
  }
  /**
   * Apply a sequence of Normalizers to the input text.
   * @param text The text to normalize.
   * @returns The normalized text.
   */
  normalize(text) {
    return this.normalizers.reduce((t, normalizer) => {
      return normalizer ? normalizer.normalize(t) : t;
    }, text);
  }
};
var Sequence_default = Sequence;
var Replace = class extends Normalizer_default {
  /**
   * Normalize the input text by replacing the pattern with the content.
   * @param text The input text to be normalized.
   * @returns The normalized text after replacing the pattern with the content.
   */
  normalize(text) {
    const pattern = create_pattern(this.config.pattern ?? {});
    return pattern === null ? text : text.replaceAll(pattern, this.config.content ?? "");
  }
};
var Replace_default = Replace;
var UnicodeNormalizer = class extends Normalizer_default {
  constructor() {
    super(...arguments);
    this.form = "NFC";
  }
  /**
   * Normalize the input text by applying Unicode normalization.
   * @param text The input text to be normalized.
   * @returns The normalized text.
   */
  normalize(text) {
    text = text.normalize(this.form);
    return text;
  }
};
var UnicodeNormalizer_default = UnicodeNormalizer;
var NFC = class extends UnicodeNormalizer_default {
  constructor() {
    super(...arguments);
    this.form = "NFC";
  }
};
var NFC_default = NFC;
var NFD = class extends UnicodeNormalizer_default {
  constructor() {
    super(...arguments);
    this.form = "NFD";
  }
};
var NFD_default = NFD;
var NFKC = class extends UnicodeNormalizer_default {
  constructor() {
    super(...arguments);
    this.form = "NFKC";
  }
};
var NFKC_default = NFKC;
var NFKD = class extends UnicodeNormalizer_default {
  constructor() {
    super(...arguments);
    this.form = "NFKD";
  }
};
var NFKD_default = NFKD;
var Strip = class extends Normalizer_default {
  /**
   * Strip leading and/or trailing whitespace from the input text.
   * @param text The input text.
   * @returns The normalized text.
   */
  normalize(text) {
    if (this.config.strip_left && this.config.strip_right) {
      text = text.trim();
    } else {
      if (this.config.strip_left) {
        text = text.trimStart();
      }
      if (this.config.strip_right) {
        text = text.trimEnd();
      }
    }
    return text;
  }
};
var Strip_default = Strip;
var StripAccents = class extends Normalizer_default {
  /**
   * Remove all accents from the text.
   * @param text The input text.
   * @returns The normalized text without accents.
   */
  normalize(text) {
    return remove_accents(text);
  }
};
var StripAccents_default = StripAccents;
var Lowercase = class extends Normalizer_default {
  /**
   * Lowercases the input string.
   * @param {string} text The text to normalize.
   * @returns {string} The normalized text.
   */
  normalize(text) {
    return text.toLowerCase();
  }
};
var Lowercase_default = Lowercase;
var Prepend = class extends Normalizer_default {
  /**
   * Prepends the input string.
   * @param text The text to normalize.
   * @returns The normalized text.
   */
  normalize(text) {
    text = this.config.prepend + text;
    return text;
  }
};
var Prepend_default = Prepend;
function create_normalizer(config) {
  if (config === null) return null;
  switch (config.type) {
    case "BertNormalizer":
      return new BertNormalizer_default(config);
    case "Precompiled":
      return new Precompiled_default(config);
    case "Sequence":
      return new Sequence_default(config);
    case "Replace":
      return new Replace_default(config);
    case "NFC":
      return new NFC_default(config);
    case "NFD":
      return new NFD_default(config);
    case "NFKC":
      return new NFKC_default(config);
    case "NFKD":
      return new NFKD_default(config);
    case "Strip":
      return new Strip_default(config);
    case "StripAccents":
      return new StripAccents_default(config);
    case "Lowercase":
      return new Lowercase_default(config);
    case "Prepend":
      return new Prepend_default(config);
    default:
      throw new Error(`Unknown Normalizer type: ${config.type}`);
  }
}
var create_normalizer_default = create_normalizer;
var PreTokenizer = class extends Callable_default {
  /**
   * Tokenizes the given text into pre-tokens.
   * @param text The text or array of texts to pre-tokenize.
   * @param options Additional options for the pre-tokenization logic.
   * @returns An array of pre-tokens.
   */
  pre_tokenize(text, options) {
    return (Array.isArray(text) ? text.map((x) => this.pre_tokenize_text(x, options)) : this.pre_tokenize_text(text, options)).flat();
  }
  /**
   * Alias for {@link PreTokenizer#pre_tokenize}.
   * @param text The text or array of texts to pre-tokenize.
   * @param options Additional options for the pre-tokenization logic.
   * @returns An array of pre-tokens.
   */
  _call(text, options) {
    return this.pre_tokenize(text, options);
  }
};
var PreTokenizer_default = PreTokenizer;
var ByteLevel = class extends PreTokenizer_default {
  /**
   * Creates a new instance of the `ByteLevelPreTokenizer` class.
   * @param config The configuration object.
   */
  constructor(config) {
    super();
    this.config = config;
    this.add_prefix_space = this.config.add_prefix_space ?? false;
    this.trim_offsets = this.config.trim_offsets ?? false;
    this.use_regex = this.config.use_regex ?? true;
    this.pattern = new RegExp("'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+", "gu");
    this.byte_encoder = BYTES_TO_UNICODE;
    this.text_encoder = new TextEncoder();
  }
  /**
   * Tokenizes a single piece of text using byte-level tokenization.
   * @param text The text to tokenize.
   * @param options Additional options for the pre-tokenization logic.
   * @returns An array of tokens.
   */
  pre_tokenize_text(text, options) {
    if (this.add_prefix_space && !text.startsWith(" ")) {
      text = " " + text;
    }
    const tokens = this.use_regex ? text.match(this.pattern) || [] : [text];
    return tokens.map(
      (token) => Array.from(
        this.text_encoder.encode(token),
        (byte) => this.byte_encoder[byte]
      ).join("")
    );
  }
};
var ByteLevel_default = ByteLevel;
var Whitespace = class extends PreTokenizer_default {
  /**
   * Pre-tokenizes the input text by splitting it on word boundaries.
   * @param text The text to be pre-tokenized.
   * @param options Additional options for the pre-tokenization logic.
   * @returns An array of tokens produced by splitting the input text on whitespace.
   */
  pre_tokenize_text(text, options) {
    return text.match(/\w+|[^\w\s]+/g) || [];
  }
};
var Whitespace_default = Whitespace;
var Metaspace = class extends PreTokenizer_default {
  /**
   * @param config The configuration object for the MetaspacePreTokenizer.
   */
  constructor(config) {
    super();
    this.replacement = config.replacement ?? "\u2581";
    this.str_rep = config.str_rep || this.replacement;
    this.prepend_scheme = config.prepend_scheme ?? "always";
  }
  /**
   * This method takes a string, replaces spaces with the replacement character,
   * adds a prefix space if requested, and returns a new list of tokens.
   * @param text The text to pre-tokenize.
   * @param options The options for the pre-tokenization.
   * @returns A new list of pre-tokenized tokens.
   */
  pre_tokenize_text(text, options) {
    const { section_index = void 0 } = options ?? {};
    let normalized = text.replaceAll(" ", this.str_rep);
    if (
      // We add a prefix space if:
      //  (1) The normalized token does not already start with the replacement character.
      !normalized.startsWith(this.replacement) && // and (2) either:
      //  (a) prepend_scheme is 'always'
      //  (b) prepend_scheme is 'first' and this is the first section
      (this.prepend_scheme === "always" || this.prepend_scheme === "first" && section_index === 0)
    ) {
      normalized = this.str_rep + normalized;
    }
    return [normalized];
  }
};
var Metaspace_default = Metaspace;
var Split = class extends PreTokenizer_default {
  /**
   * @param config The configuration options for the pre-tokenizer.
   */
  constructor(config) {
    super();
    this.config = config;
    this.pattern = create_pattern(
      this.config.pattern ?? {},
      this.config.invert ?? true
    );
  }
  /**
   * Tokenizes text by splitting it using the given pattern.
   * @param text The text to tokenize.
   * @returns An array of tokens.
   */
  pre_tokenize_text(text) {
    if (this.pattern === null) {
      return [];
    }
    if (this.config.invert) {
      return text.match(this.pattern) || [];
    } else if (this.config.behavior?.toLowerCase() === "removed") {
      return text.split(this.pattern).filter((x) => x);
    } else {
      return regex_split(text, this.pattern);
    }
  }
};
var Split_default = Split;
var Punctuation = class extends PreTokenizer_default {
  /**
   * @param config The configuration options for the pre-tokenizer.
   */
  constructor(config) {
    super();
    this.config = config;
    this.pattern = new RegExp(
      `[^${PUNCTUATION_REGEX}]+|[${PUNCTUATION_REGEX}]+`,
      "gu"
    );
  }
  /**
   * Tokenizes text by splitting it using the given pattern.
   * @param text The text to tokenize.
   * @returns An array of tokens.
   */
  pre_tokenize_text(text) {
    return text.match(this.pattern) || [];
  }
};
var Punctuation_default = Punctuation;
var Digits = class extends PreTokenizer_default {
  /**
   * @param config The configuration options for the pre-tokenizer.
   */
  constructor(config) {
    super();
    this.config = config;
    const digit_pattern = `[^\\d]+|\\d${this.config.individual_digits ? "" : "+"}`;
    this.pattern = new RegExp(digit_pattern, "gu");
  }
  /**
   * Tokenizes text by splitting it using the given pattern.
   * @param text The text to tokenize.
   * @returns An array of tokens.
   */
  pre_tokenize_text(text) {
    return text.match(this.pattern) || [];
  }
};
var Digits_default = Digits;
var BertPreTokenizer = class extends PreTokenizer_default {
  /**
   * A PreTokenizer that splits text into wordpieces using a basic tokenization scheme
   * similar to that used in the original implementation of BERT.
   */
  constructor() {
    super();
    this.pattern = new RegExp(
      `[^\\s${PUNCTUATION_REGEX}]+|[${PUNCTUATION_REGEX}]`,
      "gu"
    );
  }
  /**
   * Tokenizes a single text using the BERT pre-tokenization scheme.
   *
   * @param text The text to tokenize.
   * @param options Additional options for the pre-tokenization logic.
   * @returns An array of tokens.
   */
  pre_tokenize_text(text, options) {
    return text.trim().match(this.pattern) || [];
  }
};
var BertPreTokenizer_default = BertPreTokenizer;
var Replace2 = class extends PreTokenizer_default {
  /**
   * @param config The configuration options for the pre-tokenizer.
   */
  constructor(config) {
    super();
    this.config = config;
    this.pattern = create_pattern(this.config.pattern ?? {});
    this.content = this.config.content ?? "";
  }
  /**
   * Pre-tokenizes the input text by replacing certain characters.
   * @param text The text to be pre-tokenized.
   * @returns An array of tokens produced by replacing certain characters.
   */
  pre_tokenize_text(text) {
    if (this.pattern === null) {
      return [text];
    }
    return [text.replaceAll(this.pattern, this.config.content ?? "")];
  }
};
var Replace_default2 = Replace2;
var Sequence2 = class extends PreTokenizer_default {
  /**
   * Creates an instance of PreTokenizerSequence.
   * @param config The configuration object for the pre-tokenizer sequence.
   */
  constructor(config) {
    super();
    this.tokenizers = (config.pretokenizers ?? []).map(
      (x) => create_pre_tokenizer_default(x)
    );
  }
  /**
   * Applies each pre-tokenizer in the sequence to the input text in turn.
   * @param text The text to pre-tokenize.
   * @param options Additional options for the pre-tokenization logic.
   * @returns The pre-tokenized text.
   */
  pre_tokenize_text(text, options) {
    return this.tokenizers.reduce(
      (pre_tokenized_text, tokenizer) => {
        return tokenizer ? tokenizer.pre_tokenize(pre_tokenized_text, options) : pre_tokenized_text;
      },
      [text]
    );
  }
};
var Sequence_default2 = Sequence2;
var WhitespaceSplit = class extends PreTokenizer_default {
  /**
   * Pre-tokenizes the input text by splitting it on whitespace characters.
   * @param text The text to be pre-tokenized.
   * @returns An array of tokens produced by splitting the input text on whitespace.
   */
  pre_tokenize_text(text) {
    return whitespace_split(text);
  }
};
var WhitespaceSplit_default = WhitespaceSplit;
var FixedLength = class extends PreTokenizer_default {
  /**
   * @param config The configuration options for the pre-tokenizer.
   */
  constructor(config) {
    super();
    this.config = config;
    this._length = config.length;
  }
  /**
   * Pre-tokenizes the input text by splitting it into fixed-length tokens.
   * @param text The text to be pre-tokenized.
   * @returns An array of tokens produced by splitting the input text into fixed-length tokens.
   */
  pre_tokenize_text(text) {
    const tokens = [];
    for (let i = 0; i < text.length; i += this._length) {
      tokens.push(text.slice(i, i + this._length));
    }
    return tokens;
  }
};
var FixedLength_default = FixedLength;
function create_pre_tokenizer(config) {
  if (config === null) return null;
  switch (config.type) {
    case "BertPreTokenizer":
      return new BertPreTokenizer_default();
    case "Sequence":
      return new Sequence_default2(config);
    case "Whitespace":
      return new Whitespace_default();
    case "WhitespaceSplit":
      return new WhitespaceSplit_default();
    case "Metaspace":
      return new Metaspace_default(config);
    case "ByteLevel":
      return new ByteLevel_default(config);
    case "Split":
      return new Split_default(config);
    case "Punctuation":
      return new Punctuation_default(config);
    case "Digits":
      return new Digits_default(config);
    case "Replace":
      return new Replace_default2(config);
    case "FixedLength":
      return new FixedLength_default(config);
    default:
      throw new Error(`Unknown PreTokenizer type: ${config.type}`);
  }
}
var create_pre_tokenizer_default = create_pre_tokenizer;
var TokenizerModel = class extends Callable_default {
  /**
   * Creates a new instance of TokenizerModel.
   * @param config The configuration object for the TokenizerModel.
   */
  constructor(config) {
    super();
    this.config = config;
    this.vocab = [];
    this.tokens_to_ids = /* @__PURE__ */ new Map();
    this.unk_token_id = void 0;
    this.unk_token = void 0;
    this.end_of_word_suffix = void 0;
    this.fuse_unk = this.config.fuse_unk ?? false;
  }
  /**
   * Internal function to call the TokenizerModel instance.
   * @param tokens The tokens to encode.
   * @returns The encoded tokens.
   */
  _call(tokens) {
    let result = this.encode(tokens);
    if (this.fuse_unk) {
      result = fuse_unk(result, this.tokens_to_ids, this.unk_token_id);
    }
    return result;
  }
};
var TokenizerModel_default = TokenizerModel;
var WordPieceTokenizer = class extends TokenizerModel_default {
  /**
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.max_input_chars_per_word = 100;
    this.tokens_to_ids = object_to_map(config.vocab);
    this.unk_token_id = this.tokens_to_ids.get(config.unk_token);
    this.unk_token = config.unk_token;
    this.max_input_chars_per_word = config.max_input_chars_per_word ?? 100;
    this.vocab = new Array(this.tokens_to_ids.size);
    for (const [key, value] of this.tokens_to_ids) {
      this.vocab[value] = key;
    }
  }
  /**
   * Encodes an array of tokens using WordPiece encoding.
   * @param tokens The tokens to encode.
   * @returns An array of encoded tokens.
   */
  encode(tokens) {
    const output_tokens = [];
    for (const token of tokens) {
      const chars = [...token];
      if (chars.length > this.max_input_chars_per_word) {
        output_tokens.push(this.unk_token);
        continue;
      }
      let is_unknown = false;
      let start = 0;
      const sub_tokens = [];
      while (start < chars.length) {
        let end = chars.length;
        let current_substring = null;
        while (start < end) {
          let substr = chars.slice(start, end).join("");
          if (start > 0) {
            substr = this.config.continuing_subword_prefix + substr;
          }
          if (this.tokens_to_ids.has(substr)) {
            current_substring = substr;
            break;
          }
          --end;
        }
        if (current_substring === null) {
          is_unknown = true;
          break;
        }
        sub_tokens.push(current_substring);
        start = end;
      }
      if (is_unknown) {
        output_tokens.push(this.unk_token);
      } else {
        output_tokens.push(...sub_tokens);
      }
    }
    return output_tokens;
  }
};
var WordPiece_default = WordPieceTokenizer;
var CharTrieNode = class _CharTrieNode {
  /**
   * Create a new CharTrieNode.
   * @param is_leaf Whether the node is a leaf node or not.
   * @param children A map containing the node's children, where the key is a character and the value is a `CharTrieNode`.
   */
  constructor(is_leaf, children) {
    this.is_leaf = is_leaf;
    this.children = children;
  }
  /**
   * Returns a new `CharTrieNode` instance with default values.
   * @returns A new `CharTrieNode` instance with `is_leaf` set to `false` and an empty `children` map.
   */
  static default() {
    return new _CharTrieNode(false, /* @__PURE__ */ new Map());
  }
};
var CharTrie = class {
  constructor() {
    this.root = CharTrieNode.default();
  }
  /**
   * Adds one or more `texts` to the trie.
   * @param texts The strings to add to the trie.
   */
  extend(texts) {
    for (const text of texts) {
      this.push(text);
    }
  }
  /**
   * Adds text to the trie.
   * @param text The string to add to the trie.
   */
  push(text) {
    let node = this.root;
    for (const ch of text) {
      let child = node.children.get(ch);
      if (child === void 0) {
        child = CharTrieNode.default();
        node.children.set(ch, child);
      }
      node = child;
    }
    node.is_leaf = true;
  }
  /**
   * Searches the trie for all strings with a common prefix of `text`.
   * @param text The common prefix to search for.
   * @yields Each string in the trie that has `text` as a prefix.
   */
  *common_prefix_search(text) {
    let node = this.root;
    if (node === void 0) return;
    let prefix = "";
    for (const ch of text) {
      prefix += ch;
      node = node.children.get(ch);
      if (node === void 0) return;
      if (node.is_leaf) {
        yield prefix;
      }
    }
  }
};
var CharTrie_default = CharTrie;
var TokenLatticeNode = class _TokenLatticeNode {
  /**
   * Represents a node in a token lattice for a given sentence.
   * @param token_id The ID of the token associated with this node.
   * @param node_id The ID of this node.
   * @param pos The starting position of the token in the sentence.
   * @param length The length of the token.
   * @param score The score associated with the token.
   */
  constructor(token_id, node_id, pos, length, score) {
    this.token_id = token_id;
    this.node_id = node_id;
    this.pos = pos;
    this.length = length;
    this.score = score;
    this.prev = null;
    this.backtrace_score = 0;
  }
  /**
   * Returns a clone of this node.
   * @returns A clone of this node.
   */
  clone() {
    const n = new _TokenLatticeNode(
      this.token_id,
      this.node_id,
      this.pos,
      this.length,
      this.score
    );
    n.prev = this.prev;
    n.backtrace_score = this.backtrace_score;
    return n;
  }
};
var TokenLattice = class {
  /**
   * Creates a new TokenLattice instance.
   *
   * @param sentence The input sentence to be tokenized.
   * @param bos_token_id The beginning-of-sequence token ID.
   * @param eos_token_id The end-of-sequence token ID.
   */
  constructor(sentence, bos_token_id, eos_token_id) {
    this.chars = Array.from(sentence);
    this.len = this.chars.length;
    this.bos_token_id = bos_token_id;
    this.eos_token_id = eos_token_id;
    this.nodes = [];
    this.begin_nodes = Array.from(
      { length: this.len + 1 },
      () => []
    );
    this.end_nodes = Array.from({ length: this.len + 1 }, () => []);
    const bos = new TokenLatticeNode(this.bos_token_id ?? 0, 0, 0, 0, 0);
    const eos = new TokenLatticeNode(
      this.eos_token_id ?? 0,
      1,
      this.len,
      0,
      0
    );
    this.nodes.push(bos.clone());
    this.nodes.push(eos.clone());
    this.begin_nodes[this.len].push(eos);
    this.end_nodes[0].push(bos);
  }
  /**
   * Inserts a new token node into the token lattice.
   *
   * @param pos The starting position of the token.
   * @param length The length of the token.
   * @param score The score of the token.
   * @param token_id The token ID of the token.
   */
  insert(pos, length, score, token_id) {
    const node_id = this.nodes.length;
    const node = new TokenLatticeNode(token_id, node_id, pos, length, score);
    this.begin_nodes[pos].push(node);
    this.end_nodes[pos + length].push(node);
    this.nodes.push(node);
  }
  /**
   * Implements the Viterbi algorithm to compute the most likely sequence of tokens.
   *
   * @returns The most likely sequence of tokens.
   */
  viterbi() {
    const len2 = this.len;
    let pos = 0;
    while (pos <= len2) {
      if (this.begin_nodes[pos].length == 0) {
        return [];
      }
      for (let rnode of this.begin_nodes[pos]) {
        rnode.prev = null;
        let best_score = 0;
        let best_node = null;
        for (let lnode of this.end_nodes[pos]) {
          const score = lnode.backtrace_score + rnode.score;
          if (best_node === null || score > best_score) {
            best_node = lnode.clone();
            best_score = score;
          }
        }
        if (best_node !== null) {
          rnode.prev = best_node;
          rnode.backtrace_score = best_score;
        } else {
          return [];
        }
      }
      ++pos;
    }
    const results = [];
    const root = this.begin_nodes[len2][0];
    const prev = root.prev;
    if (prev === null) {
      return [];
    }
    let node = prev.clone();
    while (node.prev !== null) {
      results.push(node.clone());
      const n = node.clone();
      node = n.prev.clone();
    }
    results.reverse();
    return results;
  }
  /**
   * Get the text piece for a given node.
   * @param node The node to get the piece for.
   * @returns The array of nodes representing the most likely sequence of tokens.
   */
  piece(node) {
    return this.chars.slice(node.pos, node.pos + node.length).join("");
  }
  /**
   * @returns The most likely sequence of tokens.
   */
  tokens() {
    const nodes = this.viterbi();
    return nodes.map((x) => this.piece(x));
  }
  /**
   * @returns The most likely sequence of token ids.
   */
  token_ids() {
    const nodes = this.viterbi();
    return nodes.map((x) => x.token_id);
  }
};
var TokenLattice_default = TokenLattice;
function min(arr) {
  if (arr.length === 0) throw new Error("Array must not be empty");
  let min_value = arr[0];
  let index_of_min = 0;
  for (let i = 1; i < arr.length; ++i) {
    if (arr[i] < min_value) {
      min_value = arr[i];
      index_of_min = i;
    }
  }
  return [min_value, index_of_min];
}
var Unigram = class extends TokenizerModel_default {
  /**
   * Create a new Unigram tokenizer model.
   * @param config The configuration object for the Unigram model.
   * @param eos_token
   */
  constructor(config, eos_token) {
    super(config);
    const vocab_size = config.vocab.length;
    this.vocab = new Array(vocab_size);
    this.scores = new Array(vocab_size);
    for (let i = 0; i < vocab_size; ++i) {
      [this.vocab[i], this.scores[i]] = config.vocab[i];
    }
    this.unk_token_id = config.unk_id;
    this.unk_token = this.vocab[config.unk_id];
    this.tokens_to_ids = new Map(this.vocab.map((x, i) => [x, i]));
    this.bos_token = " ";
    this.bos_token_id = this.tokens_to_ids.get(this.bos_token);
    this.eos_token = eos_token;
    this.eos_token_id = this.tokens_to_ids.get(this.eos_token);
    this.unk_token = this.vocab[this.unk_token_id];
    this.min_score = min(this.scores)[0];
    this.unk_score = this.min_score - 10;
    this.scores[this.unk_token_id] = this.unk_score;
    this.trie = new CharTrie_default();
    this.trie.extend(this.vocab);
    this.fuse_unk = true;
  }
  /**
   * Populates lattice nodes.
   * @param lattice The token lattice to populate with nodes.
   */
  populate_nodes(lattice) {
    const chars = lattice.chars;
    const mblen = 1;
    let begin_pos = 0;
    while (begin_pos < chars.length) {
      let has_single_node = false;
      const tokens = [];
      const sliced = chars.slice(begin_pos).join("");
      const prefixed_tokens = this.trie.common_prefix_search(sliced);
      for (const token of prefixed_tokens) {
        tokens.push(token);
        const token_id = this.tokens_to_ids.get(token);
        const token_score = this.scores[token_id];
        const n = len(token);
        lattice.insert(begin_pos, n, token_score, token_id);
        if (!has_single_node && n === mblen) {
          has_single_node = true;
        }
      }
      if (!has_single_node) {
        lattice.insert(begin_pos, mblen, this.unk_score, this.unk_token_id);
      }
      begin_pos += mblen;
    }
  }
  /**
   * Encodes an array of tokens into an array of subtokens using the unigram model.
   *
   * @param normalized The normalized string.
   * @returns An array of subtokens obtained by encoding the input tokens using the unigram model.
   */
  tokenize(normalized) {
    const lattice = new TokenLattice_default(
      normalized,
      this.bos_token_id,
      this.eos_token_id
    );
    this.populate_nodes(lattice);
    return lattice.tokens();
  }
  /**
   * Encodes an array of tokens using Unigram encoding.
   * @param tokens The tokens to encode.
   * @returns An array of encoded tokens.
   */
  encode(tokens) {
    const to_return = [];
    for (const token of tokens) {
      const tokenized = this.tokenize(token);
      to_return.push(...tokenized);
    }
    return to_return;
  }
};
var Unigram_default = Unigram;
var PriorityQueue = class {
  /**
   * Create a new PriorityQueue.
   * @param comparator Comparator function to determine priority. Defaults to a MaxHeap.
   * @param max_size Maximum size of the queue. Defaults to Infinity.
   */
  constructor(comparator = (a, b) => a > b, max_size = Infinity) {
    this._heap = [];
    this._comparator = comparator;
    this._max_size = max_size;
  }
  /**
   * The size of the queue
   */
  get size() {
    return this._heap.length;
  }
  /**
   * Check if the queue is empty.
   * @returns `true` if the queue is empty, `false` otherwise.
   */
  is_empty() {
    return this.size === 0;
  }
  /**
   * Return the element with the highest priority in the queue.
   * @returns The highest priority element in the queue.
   */
  peek() {
    return this._heap[0];
  }
  /**
   * Add one or more elements to the queue.
   * @param values The values to push into the queue.
   * @returns The new size of the queue.
   */
  push(...values) {
    return this.extend(values);
  }
  /**
   * Add multiple elements to the queue.
   * @param values The values to push into the queue.
   * @returns The new size of the queue.
   */
  extend(values) {
    for (const value of values) {
      if (this.size < this._max_size) {
        this._heap.push(value);
        this._sift_up();
      } else {
        const smallest = this._smallest();
        if (this._comparator(value, this._heap[smallest])) {
          this._heap[smallest] = value;
          this._sift_up_from(smallest);
        }
      }
    }
    return this.size;
  }
  /**
   * Remove and return the element with the highest priority in the queue.
   * @returns The element with the highest priority in the queue.
   */
  pop() {
    const popped_value = this.peek();
    const bottom = this.size - 1;
    if (bottom > 0) {
      this._swap(0, bottom);
    }
    this._heap.pop();
    this._sift_down();
    return popped_value;
  }
  /**
   * Replace the element with the highest priority in the queue with a new value.
   * @param value The new value.
   * @returns The replaced value.
   */
  replace(value) {
    const replaced_value = this.peek();
    this._heap[0] = value;
    this._sift_down();
    return replaced_value;
  }
  /**
   * Compute the index for the parent of the node at index `i`.
   * @param i The index of the node to get the parent of.
   * @returns The index of the parent node.
   * @private
   */
  _parent(i) {
    return (i + 1 >>> 1) - 1;
  }
  /**
   * Compute the index for the left child of the node at index `i`.
   * @param i The index of the node to get the left child of.
   * @returns The index of the left child.
   * @private
   */
  _left(i) {
    return (i << 1) + 1;
  }
  /**
   * Compute the index for the right child of the node at index `i`.
   * @param i The index of the node to get the right child of.
   * @returns The index of the right child.
   * @private
   */
  _right(i) {
    return i + 1 << 1;
  }
  /**
   * Check if the element at index `i` is greater than the element at index `j`.
   * @param i The index of the first element to compare.
   * @param j The index of the second element to compare.
   * @returns `true` if the element at index `i` is greater than the element at index `j`, `false` otherwise.
   * @private
   */
  _greater(i, j) {
    return this._comparator(this._heap[i], this._heap[j]);
  }
  /**
   * Swap the elements at indices `i` and `j`.
   * @param i The index of the first element to swap.
   * @param j The index of the second element to swap.
   * @private
   */
  _swap(i, j) {
    const temp = this._heap[i];
    this._heap[i] = this._heap[j];
    this._heap[j] = temp;
  }
  /**
   * Maintain the heap property by updating positions in the heap,
   * starting at the last element and moving up the heap.
   * @private
   */
  _sift_up() {
    this._sift_up_from(this.size - 1);
  }
  /**
   * Helper function to sift up from a given node.
   * @param node The index of the node to start sifting up from.
   */
  _sift_up_from(node) {
    while (node > 0 && this._greater(node, this._parent(node))) {
      this._swap(node, this._parent(node));
      node = this._parent(node);
    }
  }
  /**
   * Maintain the heap property by updating positions in the heap,
   * starting at the first element and moving down the heap.
   * @private
   */
  _sift_down() {
    let node = 0;
    while (this._left(node) < this.size && this._greater(this._left(node), node) || this._right(node) < this.size && this._greater(this._right(node), node)) {
      const max_child = this._right(node) < this.size && this._greater(this._right(node), this._left(node)) ? this._right(node) : this._left(node);
      this._swap(node, max_child);
      node = max_child;
    }
  }
  /**
   * Get the index of the smallest element in the heap. Since we use an array-based heap,
   * the index can be computed without needing to traverse the heap.
   * @private
   */
  _smallest() {
    return 2 ** Math.floor(Math.log2(this.size)) - 1;
  }
};
var PriorityQueue_default = PriorityQueue;
var LRUCache = class {
  /**
   * Creates an LRUCache instance.
   * @param capacity The maximum number of items the cache can hold.
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = /* @__PURE__ */ new Map();
  }
  /**
   * Retrieves the value associated with the given key and marks the key as recently used.
   * @param key The key to retrieve.
   * @returns The value associated with the key, or undefined if the key does not exist.
   */
  get(key) {
    if (!this.cache.has(key)) return void 0;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  /**
   * Inserts or updates the key-value pair in the cache.
   * If the key already exists, it is updated and marked as recently used.
   * If the cache exceeds its capacity, the least recently used item is evicted.
   * @param key The key to add or update.
   * @param value The value to associate with the key.
   */
  put(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }
  /**
   * Clears the cache.
   */
  clear() {
    this.cache.clear();
  }
};
var LRUCache_default = LRUCache;
var BPE = class extends TokenizerModel_default {
  /**
   * Create a BPE instance.
   * @param config The configuration object for BPE.
   */
  constructor(config) {
    super(config);
    this.tokens_to_ids = object_to_map(config.vocab);
    this.unk_token_id = this.tokens_to_ids.get(config.unk_token);
    this.unk_token = config.unk_token;
    this.vocab = new Array(this.tokens_to_ids.size);
    for (const [key, value] of this.tokens_to_ids) {
      this.vocab[value] = key;
    }
    const use_new_merge_format = Array.isArray(config.merges[0]);
    this.merges = use_new_merge_format ? config.merges : config.merges.map(
      (x) => x.split(" ", 2)
    );
    this.bpe_ranks = new Map(this.merges.map((x, i) => [JSON.stringify(x), i]));
    this.end_of_word_suffix = config.end_of_word_suffix;
    this.continuing_subword_suffix = config.continuing_subword_suffix ?? null;
    this.byte_fallback = this.config.byte_fallback ?? false;
    if (this.byte_fallback) {
      this.text_encoder = new TextEncoder();
    }
    this.ignore_merges = this.config.ignore_merges ?? false;
    this.max_length_to_cache = 256;
    this.cache_capacity = 1e4;
    this.cache = new LRUCache_default(this.cache_capacity);
  }
  /**
   * Clears the cache.
   */
  clear_cache() {
    this.cache.clear();
  }
  /**
   * Apply Byte-Pair-Encoding (BPE) to a given token. Efficient heap-based priority
   * queue implementation adapted from https://github.com/belladoreai/llama-tokenizer-js.
   * @param token The token to encode.
   * @returns The BPE encoded tokens.
   */
  bpe(token) {
    if (token.length === 0) {
      return [];
    }
    const cached = this.cache.get(token);
    if (cached !== void 0) {
      return cached;
    }
    const word = Array.from(token);
    if (this.end_of_word_suffix) {
      word[word.length - 1] += this.end_of_word_suffix;
    }
    let result = [];
    if (word.length > 1) {
      const queue = new PriorityQueue_default((a, b) => a.score < b.score);
      let starting_node = {
        token: word[0],
        bias: 0,
        prev: null,
        next: null
      };
      let previous_node = starting_node;
      for (let i = 1; i < word.length; ++i) {
        const current_node = {
          bias: i / word.length,
          // Add fractional component to break ties
          token: word[i],
          prev: previous_node,
          next: null
        };
        previous_node.next = current_node;
        this.add_node(queue, previous_node);
        previous_node = current_node;
      }
      while (!queue.is_empty()) {
        const node = queue.pop();
        if (node.deleted || !node.next || node.next.deleted) continue;
        node.deleted = true;
        node.next.deleted = true;
        if (node.prev) {
          const new_previous_node = { ...node.prev };
          node.prev.deleted = true;
          node.prev = new_previous_node;
          if (new_previous_node.prev) {
            new_previous_node.prev.next = new_previous_node;
          } else {
            starting_node = new_previous_node;
          }
        }
        const merged = {
          token: node.token + node.next.token,
          bias: node.bias,
          prev: node.prev,
          next: node.next.next
        };
        if (merged.prev) {
          merged.prev.next = merged;
          this.add_node(queue, merged.prev);
        } else {
          starting_node = merged;
        }
        if (merged.next) {
          merged.next.prev = merged;
          this.add_node(queue, merged);
        }
      }
      for (let current_node = starting_node; current_node !== null; current_node = current_node.next) {
        result.push(current_node.token);
      }
    } else {
      result = word;
    }
    if (this.continuing_subword_suffix) {
      for (let i = 0; i < result.length - 1; ++i) {
        result[i] += this.continuing_subword_suffix;
      }
    }
    if (token.length < this.max_length_to_cache) {
      this.cache.put(token, result);
    }
    return result;
  }
  /**
   * Helper function to add a node to the priority queue.
   * @param queue
   * @param node
   */
  add_node(queue, node) {
    const rank = this.bpe_ranks.get(
      JSON.stringify([node.token, node.next.token])
    );
    if (rank !== void 0) {
      node.score = rank + node.bias;
      queue.push(node);
    }
  }
  /**
   * Encodes the input sequence of tokens using the BPE algorithm and returns the resulting subword tokens.
   * @param tokens The input sequence of tokens to encode.
   * @returns The resulting subword tokens after applying the BPE algorithm to the input sequence of tokens.
   */
  encode(tokens) {
    const output_tokens = [];
    for (const token of tokens) {
      if (this.ignore_merges && this.tokens_to_ids.has(token)) {
        output_tokens.push(token);
        continue;
      }
      const bpe_token_list = this.bpe(token);
      for (const t of bpe_token_list) {
        if (this.tokens_to_ids.has(t)) {
          output_tokens.push(t);
        } else if (this.byte_fallback) {
          const byte_tokens = Array.from(this.text_encoder.encode(t)).map(
            (x) => `<0x${x.toString(16).toUpperCase().padStart(2, "0")}>`
          );
          if (byte_tokens.every((x) => this.tokens_to_ids.has(x))) {
            output_tokens.push(...byte_tokens);
          } else if (this.unk_token != null) {
            output_tokens.push(this.unk_token);
          }
        } else if (this.unk_token != null) {
          output_tokens.push(this.unk_token);
        }
      }
    }
    return output_tokens;
  }
};
var BPE_default = BPE;
var Legacy = class extends TokenizerModel_default {
  /**
   * Create a Legacy tokenizer model instance.
   * @param config The configuration object for Legacy tokenizer model.
   * @param more_config Additional configuration object for the Legacy tokenizer model.
   */
  constructor(config, more_config) {
    super(config);
    const vocab = config.vocab;
    this.tokens_to_ids = object_to_map(
      more_config.target_lang ? vocab[more_config.target_lang] : vocab
    );
    this.bos_token = more_config.bos_token;
    this.bos_token_id = this.tokens_to_ids.get(this.bos_token);
    this.eos_token = more_config.eos_token;
    this.eos_token_id = this.tokens_to_ids.get(this.eos_token);
    this.pad_token = more_config.pad_token;
    this.pad_token_id = this.tokens_to_ids.get(this.pad_token);
    this.unk_token = more_config.unk_token;
    this.unk_token_id = this.tokens_to_ids.get(this.unk_token);
    this.vocab = new Array(this.tokens_to_ids.size);
    for (const [key, value] of this.tokens_to_ids) {
      this.vocab[value] = key;
    }
  }
  encode(tokens) {
    return tokens;
  }
};
var Legacy_default = Legacy;
function create_tokenizer_model(model_config, config) {
  switch (model_config.type) {
    case "WordPiece":
      return new WordPiece_default(model_config);
    case "Unigram":
      return new Unigram_default(model_config, config.eos_token);
    case "BPE":
      return new BPE_default(model_config);
    default:
      if (model_config.vocab) {
        if (Array.isArray(model_config.vocab)) {
          return new Unigram_default(model_config, config.eos_token);
        } else if (Object.hasOwn(model_config, "continuing_subword_prefix") && Object.hasOwn(model_config, "unk_token")) {
          if (Object.hasOwn(model_config, "merges")) {
            return new BPE_default(model_config);
          } else {
            return new WordPiece_default(model_config);
          }
        } else {
          return new Legacy_default(model_config, {
            target_lang: config.target_lang,
            bos_token: config.bos_token,
            eos_token: config.eos_token,
            pad_token: config.pad_token,
            unk_token: config.unk_token
          });
        }
      }
      throw new Error(
        `Unknown TokenizerModel type: ${model_config?.type}`
      );
  }
}
var create_tokenizer_model_default = create_tokenizer_model;
var PostProcessor = class extends Callable_default {
  /**
   * @param config The configuration for the post-processor.
   */
  constructor(config) {
    super();
    this.config = config;
  }
  /**
   * Alias for {@link PostProcessor#post_process}.
   * @param tokens The text or array of texts to post-process.
   * @param args Additional arguments required by the post-processing logic.
   * @returns The post-processed tokens.
   */
  _call(tokens, ...args) {
    return this.post_process(tokens, ...args);
  }
};
var PostProcessor_default = PostProcessor;
var TemplateProcessing = class extends PostProcessor_default {
  /**
   * Replaces special tokens in the template with actual tokens.
   * @param tokens The list of tokens for the first sequence.
   * @param tokens_pair The list of tokens for the second sequence (optional).
   * @param add_special_tokens Whether to add the special tokens to the beginning and end of the input.
   * @returns An object containing the list of tokens with the special tokens replaced with actual tokens.
   */
  post_process(tokens, tokens_pair = null, add_special_tokens = true) {
    const type = tokens_pair === null ? this.config.single : this.config.pair;
    let processed_tokens = [];
    let types = [];
    for (const item of type) {
      if ("SpecialToken" in item) {
        if (add_special_tokens) {
          processed_tokens.push(item.SpecialToken.id);
          types.push(item.SpecialToken.type_id);
        }
      } else if ("Sequence" in item) {
        if (item.Sequence.id === "A") {
          processed_tokens = merge_arrays(processed_tokens, tokens);
          types = merge_arrays(
            types,
            new Array(tokens.length).fill(item.Sequence.type_id)
          );
        } else if (item.Sequence.id === "B") {
          processed_tokens = merge_arrays(processed_tokens, tokens_pair);
          types = merge_arrays(
            types,
            new Array(tokens_pair.length).fill(item.Sequence.type_id)
          );
        }
      }
    }
    return { tokens: processed_tokens, token_type_ids: types };
  }
};
var TemplateProcessing_default = TemplateProcessing;
var ByteLevel2 = class extends PostProcessor_default {
  /**
   * Post process the given tokens.
   * @param tokens The list of tokens for the first sequence.
   * @param tokens_pair The list of tokens for the second sequence (optional).
   * @returns An object containing the post-processed tokens.
   */
  post_process(tokens, tokens_pair = null) {
    return { tokens, tokens_pair };
  }
};
var ByteLevel_default2 = ByteLevel2;
var BertProcessing = class extends PostProcessor_default {
  /**
   * @param config The configuration for the post-processor.
   * @param config.cls The special tokens to add to the beginning of the input.
   * @param config.sep The special tokens to add to the end of the input.
   */
  constructor(config) {
    super(config);
    this.sep = config.sep;
    this.cls = config.cls;
  }
  /**
   * Adds the special tokens to the beginning and end of the input.
   * @param tokens The input tokens.
   * @param tokens_pair An optional second set of input tokens.
   * @param add_special_tokens Whether to add the special tokens to the beginning and end of the input.
   * @returns The post-processed tokens with the special tokens added to the beginning and end.
   */
  post_process(tokens, tokens_pair = null, add_special_tokens = true) {
    if (add_special_tokens) {
      tokens = merge_arrays([this.cls[0]], tokens, [this.sep[0]]);
    }
    let token_type_ids = new Array(tokens.length).fill(0);
    if (tokens_pair) {
      const middle = [];
      const after = add_special_tokens ? [this.sep[0]] : [];
      tokens = merge_arrays(tokens, middle, tokens_pair, after);
      token_type_ids = merge_arrays(
        token_type_ids,
        new Array(tokens_pair.length + middle.length + after.length).fill(1)
      );
    }
    return { tokens, token_type_ids };
  }
};
var BertProcessing_default = BertProcessing;
var RobertaProcessing = class extends PostProcessor_default {
  /**
   * @param config The configuration for the post-processor.
   * @param config.cls The special tokens to add to the beginning of the input.
   * @param config.sep The special tokens to add to the end of the input.
   */
  constructor(config) {
    super(config);
    this.sep = config.sep;
    this.cls = config.cls;
  }
  /**
   * Adds the special tokens to the beginning and end of the input.
   * @param tokens The input tokens.
   * @param tokens_pair An optional second set of input tokens.
   * @param add_special_tokens Whether to add the special tokens to the beginning and end of the input.
   * @returns The post-processed tokens with the special tokens added to the beginning and end.
   */
  post_process(tokens, tokens_pair, add_special_tokens = true) {
    if (add_special_tokens) {
      tokens = merge_arrays([this.cls[0]], tokens, [this.sep[0]]);
    }
    let token_type_ids = new Array(tokens.length).fill(0);
    if (tokens_pair) {
      const middle = add_special_tokens ? [this.sep[0]] : [];
      const after = add_special_tokens ? [this.sep[0]] : [];
      tokens = merge_arrays(tokens, middle, tokens_pair, after);
      token_type_ids = merge_arrays(
        token_type_ids,
        new Array(tokens_pair.length + middle.length + after.length).fill(1)
      );
    }
    return { tokens, token_type_ids };
  }
};
var RobertaProcessing_default = RobertaProcessing;
var Sequence3 = class extends PostProcessor_default {
  /**
   * Creates a new instance of Sequence post-processor.
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.processors = (config.processors ?? []).map((x) => create_post_processor_default(x));
  }
  /**
   * Post process the given tokens.
   * @param tokens The list of tokens for the first sequence.
   * @param tokens_pair The list of tokens for the second sequence (optional).
   * @param add_special_tokens Whether to add the special tokens to the beginning and end of the input.
   * @returns An object containing the post-processed tokens.
   */
  post_process(tokens, tokens_pair = null, add_special_tokens = true) {
    let processed_tokens = { tokens, tokens_pair };
    for (const processor of this.processors) {
      processed_tokens = processor.post_process(
        processed_tokens.tokens,
        processed_tokens.tokens_pair,
        add_special_tokens
      );
    }
    return processed_tokens;
  }
};
var Sequence_default3 = Sequence3;
function create_post_processor(config) {
  if (config === null) return null;
  switch (config.type) {
    case "TemplateProcessing":
      return new TemplateProcessing_default(config);
    case "ByteLevel":
      return new ByteLevel_default2(config);
    case "BertProcessing":
      return new BertProcessing_default(config);
    case "RobertaProcessing":
      return new RobertaProcessing_default(config);
    case "Sequence":
      return new Sequence_default3(config);
    default:
      throw new Error(`Unknown PostProcessor type: ${config.type}`);
  }
}
var create_post_processor_default = create_post_processor;
var Decoder = class extends Callable_default {
  /**
   * Creates an instance of `Decoder`.
   * @param config The configuration object.
   **/
  constructor(config) {
    super();
    this.config = config;
    this.added_tokens = [];
    this.end_of_word_suffix = null;
    this.trim_offsets = "trim_offsets" in config ? config.trim_offsets : false;
  }
  /**
   * Calls the `decode` method.
   *
   * @param tokens The list of tokens.
   * @returns The decoded string.
   */
  _call(tokens) {
    return this.decode(tokens);
  }
  /**
   * Decodes a list of tokens.
   * @param tokens The list of tokens.
   * @returns The decoded string.
   */
  decode(tokens) {
    return this.decode_chain(tokens).join("");
  }
};
var Decoder_default = Decoder;
var ByteLevel3 = class extends Decoder_default {
  /**
   * Create a `ByteLevelDecoder` object.
   */
  constructor(config) {
    super(config);
    this.byte_decoder = UNICODE_TO_BYTES;
    this.text_decoder = new TextDecoder("utf-8", {
      fatal: false,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ignoreBOM: true
    });
    this.end_of_word_suffix = null;
  }
  /**
   * Convert an array of tokens to string by decoding each byte.
   * @param tokens Array of tokens to be decoded.
   * @returns The decoded string.
   */
  convert_tokens_to_string(tokens) {
    const text = tokens.join("");
    const byte_array = new Uint8Array(
      [...text].map((c) => this.byte_decoder[c])
    );
    return this.text_decoder.decode(byte_array);
  }
  decode_chain(tokens) {
    const sub_texts = [];
    let current_sub_text = [];
    for (const token of tokens) {
      if (this.added_tokens.find((x) => x.content === token) !== void 0) {
        if (current_sub_text.length > 0) {
          sub_texts.push(this.convert_tokens_to_string(current_sub_text));
          current_sub_text = [];
        }
        sub_texts.push(token);
      } else {
        current_sub_text.push(token);
      }
    }
    if (current_sub_text.length > 0) {
      sub_texts.push(this.convert_tokens_to_string(current_sub_text));
    }
    return sub_texts;
  }
};
var ByteLevel_default3 = ByteLevel3;
var WordPiece = class extends Decoder_default {
  /**
   * Creates a new instance of WordPieceDecoder.
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.cleanup = config.cleanup;
  }
  decode_chain(tokens) {
    return tokens.map((token, i) => {
      if (i !== 0) {
        const prefix = this.config.prefix;
        if (prefix && token.startsWith(prefix)) {
          token = token.replace(prefix, "");
        } else {
          token = " " + token;
        }
      }
      if (this.cleanup) {
        token = clean_up_tokenization(token);
      }
      return token;
    });
  }
};
var WordPiece_default2 = WordPiece;
var Metaspace2 = class extends Decoder_default {
  /**
   * Constructs a new MetaspaceDecoder object.
   * @param config The configuration object for the MetaspaceDecoder.
   */
  constructor(config) {
    super(config);
    this.replacement = config.replacement ?? "\u2581";
  }
  decode_chain(tokens) {
    const result = [];
    for (let i = 0; i < tokens.length; ++i) {
      let normalized = tokens[i].replaceAll(this.replacement, " ");
      if (i == 0 && normalized.startsWith(" ")) {
        normalized = normalized.substring(1);
      }
      result.push(normalized);
    }
    return result;
  }
};
var Metaspace_default2 = Metaspace2;
var BPE2 = class extends Decoder_default {
  constructor(config) {
    super(config);
    this.suffix = config.suffix ?? "";
  }
  decode_chain(tokens) {
    return tokens.map((token, i) => {
      return token.replaceAll(this.suffix, i === tokens.length - 1 ? "" : " ");
    });
  }
};
var BPE_default2 = BPE2;
var CTC = class extends Decoder_default {
  constructor(config) {
    super(config);
    this.pad_token = config.pad_token ?? "";
    this.word_delimiter_token = config.word_delimiter_token ?? "";
    this.cleanup = config.cleanup;
  }
  /**
   * Converts a connectionist-temporal-classification (CTC) output tokens into a single string.
   * @param tokens Array of tokens to be decoded.
   * @returns The decoded string.
   */
  convert_tokens_to_string(tokens) {
    if (tokens.length === 0) return "";
    const grouped_tokens = [tokens[0]];
    for (let i = 1; i < tokens.length; ++i) {
      if (tokens[i] !== grouped_tokens.at(-1)) {
        grouped_tokens.push(tokens[i]);
      }
    }
    const filtered_tokens = grouped_tokens.filter(
      (token) => token !== this.pad_token
    );
    let text = filtered_tokens.join("");
    if (this.cleanup) {
      text = clean_up_tokenization(text).replaceAll(this.word_delimiter_token, " ").trim();
    }
    return text;
  }
  decode_chain(tokens) {
    return [this.convert_tokens_to_string(tokens)];
  }
};
var CTC_default = CTC;
var Sequence4 = class extends Decoder_default {
  /**
   * Creates a new instance of DecoderSequence.
   * @param config The configuration object.
   */
  constructor(config) {
    super(config);
    this.decoders = (config.decoders ?? []).map((x) => create_decoder_default(x));
  }
  decode_chain(tokens) {
    return this.decoders.reduce((toks, decoder) => {
      return decoder.decode_chain(toks);
    }, tokens);
  }
};
var Sequence_default4 = Sequence4;
var Replace3 = class extends Decoder_default {
  decode_chain(tokens) {
    const pattern = create_pattern(this.config.pattern);
    const content = this.config.content ?? "";
    return pattern === null ? tokens : tokens.map((token) => token.replaceAll(pattern, content));
  }
};
var Replace_default3 = Replace3;
var Fuse = class extends Decoder_default {
  decode_chain(tokens) {
    return [tokens.join("")];
  }
};
var Fuse_default = Fuse;
var Strip2 = class extends Decoder_default {
  constructor(config) {
    super(config);
    this.content = config.content ?? "";
    this.start = config.start ?? 0;
    this.stop = config.stop ?? 0;
  }
  decode_chain(tokens) {
    return tokens.map((token) => {
      let start_cut = 0;
      for (let i = 0; i < this.start; ++i) {
        if (token[i] === this.content) {
          start_cut = i + 1;
          continue;
        } else {
          break;
        }
      }
      let stop_cut = token.length;
      for (let i = 0; i < this.stop; ++i) {
        const index = token.length - i - 1;
        if (token[index] === this.content) {
          stop_cut = index;
          continue;
        } else {
          break;
        }
      }
      return token.slice(start_cut, stop_cut);
    });
  }
};
var Strip_default2 = Strip2;
var ByteFallback = class extends Decoder_default {
  constructor(config) {
    super(config);
    this.text_decoder = new TextDecoder();
  }
  decode_chain(tokens) {
    const new_tokens = [];
    let previous_byte_tokens = [];
    for (const token of tokens) {
      let bytes = null;
      if (token.length === 6 && token.startsWith("<0x") && token.endsWith(">")) {
        const byte = parseInt(token.slice(3, 5), 16);
        if (!isNaN(byte)) {
          bytes = byte;
        }
      }
      if (bytes !== null) {
        previous_byte_tokens.push(bytes);
      } else {
        if (previous_byte_tokens.length > 0) {
          const string = this.text_decoder.decode(
            Uint8Array.from(previous_byte_tokens)
          );
          new_tokens.push(string);
          previous_byte_tokens = [];
        }
        new_tokens.push(token);
      }
    }
    if (previous_byte_tokens.length > 0) {
      const string = this.text_decoder.decode(
        Uint8Array.from(previous_byte_tokens)
      );
      new_tokens.push(string);
      previous_byte_tokens = [];
    }
    return new_tokens;
  }
};
var ByteFallback_default = ByteFallback;
function create_decoder(config) {
  if (config === null) return null;
  switch (config.type) {
    case "ByteLevel":
      return new ByteLevel_default3(config);
    case "WordPiece":
      return new WordPiece_default2(config);
    case "Metaspace":
      return new Metaspace_default2(config);
    case "BPEDecoder":
      return new BPE_default2(config);
    case "CTC":
      return new CTC_default(config);
    case "Sequence":
      return new Sequence_default4(config);
    case "Replace":
      return new Replace_default3(config);
    case "Fuse":
      return new Fuse_default(config);
    case "Strip":
      return new Strip_default2(config);
    case "ByteFallback":
      return new ByteFallback_default(config);
    default:
      throw new Error(`Unknown Decoder type: ${config.type}`);
  }
}
var create_decoder_default = create_decoder;
var Tokenizer = class {
  constructor(tokenizer, config) {
    const tokenizer_error = validate_object(tokenizer, "Tokenizer", [
      "model",
      "decoder",
      "post_processor",
      "pre_tokenizer",
      "normalizer"
    ]);
    if (tokenizer_error) {
      throw new Error(tokenizer_error);
    }
    const config_error = validate_object(config, "Config");
    if (config_error) {
      throw new Error(config_error);
    }
    this.tokenizer = tokenizer;
    this.config = config;
    this.normalizer = create_normalizer_default(this.tokenizer.normalizer);
    this.pre_tokenizer = create_pre_tokenizer_default(this.tokenizer.pre_tokenizer);
    this.model = create_tokenizer_model_default(this.tokenizer.model, this.config);
    this.post_processor = create_post_processor_default(this.tokenizer.post_processor);
    this.decoder = create_decoder_default(this.tokenizer.decoder);
    this.special_tokens = [];
    this.all_special_ids = [];
    this.added_tokens = [];
    const unnormalized_contents = [];
    const normalized_contents = [];
    this.added_tokens_map = /* @__PURE__ */ new Map();
    for (const added_token of this.tokenizer.added_tokens) {
      const token = new AddedToken_default(added_token);
      this.added_tokens.push(token);
      this.model.tokens_to_ids.set(token.content, token.id);
      this.model.vocab[token.id] = token.content;
      if (token.special) {
        this.special_tokens.push(token.content);
        this.all_special_ids.push(token.id);
      }
      this.added_tokens_map.set(token.content, token);
      if (token.normalized && this.normalizer !== null) {
        const normalized_content = this.normalizer(token.content);
        normalized_contents.push(normalized_content);
        this.added_tokens_map.set(normalized_content, token);
      } else {
        unnormalized_contents.push(token.content);
      }
    }
    (this.config.additional_special_tokens ?? []).forEach((token) => {
      if (!this.special_tokens.includes(token)) this.special_tokens.push(token);
    });
    if (this.decoder) {
      this.decoder.added_tokens = this.added_tokens;
      this.decoder.end_of_word_suffix = this.model.end_of_word_suffix;
    }
    this.splitter_unnormalized = new DictionarySplitter_default(unnormalized_contents);
    this.splitter_normalized = new DictionarySplitter_default(normalized_contents);
    this.remove_space = this.config.remove_space;
    this.clean_up_tokenization_spaces = this.config.clean_up_tokenization_spaces ?? true;
    this.do_lowercase_and_remove_accent = this.config.do_lowercase_and_remove_accent ?? false;
  }
  // Implementation
  encode(text, {
    text_pair = null,
    add_special_tokens = true,
    return_token_type_ids = null
  } = {}) {
    const { tokens, token_type_ids } = this.tokenize_helper(text, {
      text_pair,
      add_special_tokens
    });
    const input_ids = tokens.map(
      (t) => this.added_tokens_map.get(t)?.id ?? this.model.tokens_to_ids.get(t) ?? this.model.unk_token_id
    );
    const result = {
      ids: input_ids,
      tokens,
      attention_mask: new Array(input_ids.length).fill(1)
    };
    if (return_token_type_ids && token_type_ids) {
      result.token_type_ids = token_type_ids;
    }
    return result;
  }
  decode(token_ids, options = {}) {
    if (!Array.isArray(token_ids) || token_ids.length === 0 || !is_integral_number(token_ids[0])) {
      throw Error("token_ids must be a non-empty array of integers.");
    }
    let tokens = token_ids.map(
      (i) => this.model.vocab[Number(i)] ?? this.model.unk_token
    );
    if (options.skip_special_tokens) {
      tokens = tokens.filter((x) => !this.special_tokens.includes(x));
    }
    let decoded = this.decoder ? this.decoder(tokens) : tokens.join(" ");
    if (this.decoder && this.decoder.end_of_word_suffix) {
      decoded = decoded.replaceAll(this.decoder.end_of_word_suffix, " ");
      if (options.skip_special_tokens) {
        decoded = decoded.trim();
      }
    }
    if (options.clean_up_tokenization_spaces ?? this.clean_up_tokenization_spaces) {
      decoded = clean_up_tokenization(decoded);
    }
    return decoded;
  }
  /**
   * Converts a string into a sequence of tokens.
   * @param text The sequence to be encoded.
   * @param options An optional object containing the following properties:
   * @returns The list of tokens.
   */
  tokenize(text, { text_pair = null, add_special_tokens = false } = {}) {
    return this.tokenize_helper(text, { text_pair, add_special_tokens }).tokens;
  }
  encode_text(text) {
    if (text === null) {
      return null;
    }
    const sections = this.splitter_unnormalized.split(text);
    sections.forEach((section, i) => {
      const added_token = this.added_tokens_map.get(section);
      if (added_token) {
        if (added_token.lstrip && i > 0) {
          sections[i - 1] = sections[i - 1].trimEnd();
        }
        if (added_token.rstrip && i < sections.length - 1) {
          sections[i + 1] = sections[i + 1].trimStart();
        }
      }
    });
    return sections.flatMap((processed_text, section_index) => {
      if (processed_text.length === 0) {
        return [];
      }
      if (this.added_tokens_map.has(processed_text)) {
        return [processed_text];
      }
      if (this.remove_space === true) {
        processed_text = processed_text.trim().split(/\s+/).join(" ");
      }
      if (this.do_lowercase_and_remove_accent) {
        processed_text = lowercase_and_remove_accents(processed_text);
      }
      if (this.normalizer !== null) {
        processed_text = this.normalizer(processed_text);
      }
      if (processed_text.length === 0) {
        return [];
      }
      const subsections = this.splitter_normalized.split(processed_text);
      subsections.forEach((subsection, j) => {
        const added_token = this.added_tokens_map.get(subsection);
        if (added_token) {
          if (added_token.lstrip && j > 0) {
            subsections[j - 1] = subsections[j - 1].trimEnd();
          }
          if (added_token.rstrip && j < subsections.length - 1) {
            subsections[j + 1] = subsections[j + 1].trimStart();
          }
        }
      });
      return subsections.flatMap((subsection) => {
        if (subsection.length === 0) {
          return [];
        }
        if (this.added_tokens_map.has(subsection)) {
          return [subsection];
        }
        const section_tokens = this.pre_tokenizer !== null ? this.pre_tokenizer(subsection, {
          section_index
        }) : [subsection];
        return this.model(section_tokens);
      });
    });
  }
  tokenize_helper(text, { text_pair = null, add_special_tokens = true }) {
    const tokens1 = this.encode_text(text);
    const tokens2 = this.encode_text(text_pair || null);
    return this.post_processor ? this.post_processor(tokens1, tokens2, add_special_tokens) : { tokens: merge_arrays(tokens1 ?? [], tokens2 ?? []) };
  }
  /**
   * Converts a token string to its corresponding token ID.
   * @param token The token string to convert.
   * @returns The token ID, or undefined if the token is not in the vocabulary.
   */
  token_to_id(token) {
    return this.model.tokens_to_ids.get(token);
  }
  /**
   * Converts a token ID to its corresponding token string.
   * @param id The token ID to convert.
   * @returns The token string, or undefined if the ID is not in the vocabulary.
   */
  id_to_token(id) {
    return this.model.vocab[id];
  }
  /**
   * Returns a mapping of token IDs to AddedToken objects for all added tokens.
   * @returns A Map where keys are token IDs and values are AddedToken objects.
   */
  get_added_tokens_decoder() {
    const decoder = /* @__PURE__ */ new Map();
    for (const token of this.added_tokens) {
      decoder.set(token.id, token);
    }
    return decoder;
  }
  /**
   * Get the underlying vocabulary
   * @param with_added_tokens Whether to include the added tokens
   * @returns The vocabulary
   */
  get_vocab(with_added_tokens = true) {
    const vocab = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.model.vocab.length; ++i) {
      const token = this.model.vocab[i];
      if (with_added_tokens || !this.added_tokens_map.has(token)) {
        vocab.set(token, i);
      }
    }
    return vocab;
  }
};
var Tokenizer_default = Tokenizer;

// src/runtime/tokenizer.ts
function parseJson(bytes, path) {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("root must be an object");
    }
    return value;
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function toBigInt(values) {
  const result = new BigInt64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = BigInt(values[index]);
  }
  return result;
}
function truncateWithFinalSpecialToken(values, maxLength) {
  if (values.length <= maxLength) {
    return [...values];
  }
  if (maxLength === 1) {
    return [values[values.length - 1]];
  }
  return [...values.slice(0, maxLength - 1), values[values.length - 1]];
}
var LocalTokenizer = class _LocalTokenizer {
  #tokenizer;
  #maxLength;
  constructor(tokenizer, maxLength) {
    this.#tokenizer = tokenizer;
    this.#maxLength = maxLength;
  }
  static async create(assets) {
    const { directory, max_length: maxLength } = assets.manifest.tokenizer;
    const tokenizerJsonPath = `${directory}/tokenizer.json`;
    const tokenizerConfigPath = `${directory}/tokenizer_config.json`;
    try {
      const [tokenizerJson, tokenizerConfig] = await Promise.all([
        assets.read(tokenizerJsonPath),
        assets.read(tokenizerConfigPath)
      ]);
      return new _LocalTokenizer(
        new Tokenizer_default(
          parseJson(tokenizerJson, tokenizerJsonPath),
          parseJson(tokenizerConfig, tokenizerConfigPath)
        ),
        maxLength
      );
    } finally {
      for (const path of Object.keys(assets.manifest.files)) {
        if (path.startsWith(`${directory}/`)) {
          assets.release(path);
        }
      }
    }
  }
  async encode(prompt) {
    const encoded = this.#tokenizer.encode(prompt, {
      add_special_tokens: true,
      return_token_type_ids: true
    });
    const inputIds = truncateWithFinalSpecialToken(
      encoded.ids,
      this.#maxLength
    );
    const attentionMask = truncateWithFinalSpecialToken(
      encoded.attention_mask,
      this.#maxLength
    );
    const tokenTypeIds = truncateWithFinalSpecialToken(
      encoded.token_type_ids ?? new Array(encoded.ids.length).fill(0),
      this.#maxLength
    );
    if (inputIds.length === 0 || inputIds.length > this.#maxLength || attentionMask.length !== inputIds.length || tokenTypeIds.length !== inputIds.length) {
      throw new RangeError("Tokenizer produced invalid sequence dimensions");
    }
    return {
      inputIds: toBigInt(inputIds),
      attentionMask: toBigInt(attentionMask),
      tokenTypeIds: toBigInt(tokenTypeIds),
      sequenceLength: inputIds.length
    };
  }
  async dispose() {
  }
};

// src/runtime/windows.ts
function assertHistory(history, dimensions) {
  if (history === void 0) {
    return 0;
  }
  if (history.length % dimensions.hybrid_dim !== 0) {
    throw new RangeError("History length is not divisible by hybrid_dim");
  }
  const tokens = history.length / dimensions.hybrid_dim;
  if (tokens > dimensions.history_tokens) {
    throw new RangeError(
      `Continuation history cannot exceed ${dimensions.history_tokens} tokens`
    );
  }
  return tokens;
}
function createArWindow(dimensions, random, history) {
  const historyTokens = assertHistory(history, dimensions);
  const historyFrames = historyTokens * dimensions.num_frames_per_token;
  const generationTokens = dimensions.generation_tokens;
  const generationFrames = dimensions.generation_frames;
  const generationTokenOffset = historyTokens;
  if (generationTokenOffset + generationTokens > dimensions.max_tokens) {
    throw new RangeError("History and generation do not fit in the AR window");
  }
  const x = new Float32Array(dimensions.max_tokens * dimensions.hybrid_dim);
  if (history !== void 0) {
    x.set(history);
  }
  const noiseStart = generationTokenOffset * dimensions.hybrid_dim;
  const noiseEnd = (generationTokenOffset + generationTokens) * dimensions.hybrid_dim;
  random.fillNormal(x, noiseStart, noiseEnd);
  const historyMask = new Float32Array(dimensions.max_frames);
  const generationMask = new Float32Array(dimensions.max_frames);
  const historyTokenMask = new Float32Array(dimensions.max_tokens);
  const generationTokenMask = new Float32Array(dimensions.max_tokens);
  historyMask.fill(1, 0, historyFrames);
  generationMask.fill(1, historyFrames, historyFrames + generationFrames);
  historyTokenMask.fill(1, 0, historyTokens);
  generationTokenMask.fill(
    1,
    generationTokenOffset,
    generationTokenOffset + generationTokens
  );
  return {
    x,
    historyMask,
    generationMask,
    historyTokenMask,
    generationTokenMask,
    historyFrames,
    generationFrames,
    historyTokens,
    generationTokens,
    generationTokenOffset
  };
}
function createMotionPadMask(dimensions, validTokens) {
  if (!Number.isSafeInteger(validTokens) || validTokens <= 0 || validTokens > dimensions.max_tokens) {
    throw new RangeError("Invalid valid-token count");
  }
  const result = new Float32Array(dimensions.max_frames);
  result.fill(1, 0, validTokens * dimensions.num_frames_per_token);
  return result;
}
function roundTiesToEven(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) {
    return floor;
  }
  if (fraction > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}
function recenterAndRequantize(hybrid, validTokens, dimensions, recenter, quantization, globalTranslation, nextHistoryStartToken) {
  if (hybrid.length !== dimensions.max_tokens * dimensions.hybrid_dim) {
    throw new RangeError("Hybrid window has the wrong element count");
  }
  if (!Number.isSafeInteger(validTokens) || validTokens <= 0 || validTokens > dimensions.max_tokens || !Number.isSafeInteger(nextHistoryStartToken) || nextHistoryStartToken < 0 || nextHistoryStartToken >= validTokens) {
    throw new RangeError("Invalid recenter window bounds");
  }
  if (globalTranslation.length !== 3) {
    throw new RangeError("Global translation must contain three values");
  }
  const {
    hybrid_dim: hybridDim,
    nframe_root_dim: rootTokenDim,
    root_features_per_frame: rootFrameDim,
    num_frames_per_token: framesPerToken
  } = dimensions;
  const validFrames = validTokens * framesPerToken;
  const [positionX, positionY, positionZ] = recenter.position_indices;
  const [headingCos, headingSin] = recenter.heading_indices;
  const rootOffset = (frame, feature) => {
    const token = Math.floor(frame / framesPerToken);
    const frameInToken = frame % framesPerToken;
    return token * hybridDim + frameInToken * rootFrameDim + feature;
  };
  const rawRoot = (frame, feature) => {
    const normalized = hybrid[rootOffset(frame, feature)];
    return normalized * recenter.root_std[feature] + recenter.root_mean[feature];
  };
  const centerFrame = validFrames - 1;
  const center = new Float32Array([
    rawRoot(centerFrame, positionX),
    0,
    rawRoot(centerFrame, positionZ)
  ]);
  for (let frame = 0; frame < validFrames; frame += 1) {
    for (const [feature, centerValue] of [
      [positionX, center[0]],
      [positionZ, center[2]]
    ]) {
      const translated = rawRoot(frame, feature) - centerValue;
      hybrid[rootOffset(frame, feature)] = Math.fround(
        (translated - recenter.root_mean[feature]) / recenter.root_std[feature]
      );
    }
  }
  const latentOffset = rootTokenDim;
  for (let token = 0; token < validTokens; token += 1) {
    const tokenOffset = token * hybridDim;
    for (let feature = 0; feature < dimensions.latent_dim; feature += 1) {
      const index = tokenOffset + latentOffset + feature;
      const raw = hybrid[index] * quantization.std[feature] + quantization.mean[feature];
      const halfWidth = Math.floor(quantization.levels[feature] / 2);
      const clamped = Math.max(-1, Math.min(1, raw));
      const discrete = roundTiesToEven(clamped * halfWidth) / halfWidth;
      hybrid[index] = Math.fround(
        (discrete - quantization.mean[feature]) / quantization.std[feature]
      );
    }
  }
  const firstHistoryFrame = nextHistoryStartToken * framesPerToken;
  const rawCos = rawRoot(firstHistoryFrame, headingCos);
  const rawSin = rawRoot(firstHistoryFrame, headingSin);
  return {
    globalTranslation: new Float32Array([
      Math.fround(globalTranslation[0] + center[0]),
      Math.fround(globalTranslation[1] + center[1]),
      Math.fround(globalTranslation[2] + center[2])
    ]),
    firstHeadingAngle: Math.atan2(rawSin, rawCos)
  };
}

// src/runtime/engine.ts
var RuntimeCancelledError = class extends Error {
  constructor(message = "Generation cancelled") {
    super(message);
    this.name = "AbortError";
  }
};
function now() {
  return globalThis.performance?.now() ?? Date.now();
}
function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw new RuntimeCancelledError();
  }
}
function tensorFrom(outputs, name, expectedLength) {
  const value = outputs[name];
  if (!(value instanceof ort_webgpu_bundle_min_exports.Tensor)) {
    throw new TypeError(`ONNX graph did not return tensor ${JSON.stringify(name)}`);
  }
  if (expectedLength !== void 0 && value.size !== expectedLength) {
    throw new RangeError(
      `ONNX output ${name} has ${value.size} elements; expected ${expectedLength}`
    );
  }
  return value;
}
function floatData(tensor, name) {
  if (!(tensor.data instanceof Float32Array)) {
    throw new TypeError(`ONNX output ${name} must have float32 data`);
  }
  return tensor.data;
}
function boolData(tensor, name) {
  const data = tensor.data;
  if (!ArrayBuffer.isView(data) && !Array.isArray(data)) {
    throw new TypeError(`ONNX output ${name} must contain boolean data`);
  }
  const values = data;
  const result = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = values[index] ? 1 : 0;
  }
  return result;
}
function int64Scalar(value) {
  return new ort_webgpu_bundle_min_exports.Tensor("int64", BigInt64Array.of(BigInt(value)), [1]);
}
function floatScalar(value) {
  return new ort_webgpu_bundle_min_exports.Tensor("float32", Float32Array.of(Math.fround(value)), [1]);
}
function finiteCfgWeight(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 100) {
    throw new RangeError(`${name} must be finite and between 0 and 100`);
  }
  return resolved;
}
function finiteTransform(translation, heading) {
  const resolved = translation ?? [0, 0, 0];
  if (resolved.length !== 3 || resolved.some((value) => !Number.isFinite(value)) || heading !== void 0 && !Number.isFinite(heading)) {
    throw new TypeError("Initial root transform must contain finite values");
  }
  const roundedTranslation = [
    Math.fround(resolved[0]),
    Math.fround(resolved[1]),
    Math.fround(resolved[2])
  ];
  if (roundedTranslation.some((value) => !Number.isFinite(value))) {
    throw new RangeError(
      "Initial root translation must be representable as float32"
    );
  }
  const normalizedHeading = heading === void 0 ? 0 : Math.atan2(Math.sin(heading), Math.cos(heading));
  return {
    translation: roundedTranslation,
    heading: normalizedHeading
  };
}
function resolveFrameCount(manifest, options) {
  const hasFrames = options.durationFrames !== void 0;
  const hasSeconds = options.durationSeconds !== void 0;
  if (hasFrames === hasSeconds) {
    throw new TypeError("Exactly one of durationFrames or durationSeconds is required");
  }
  const frames = hasFrames ? options.durationFrames : Math.round(options.durationSeconds * manifest.dimensions.fps);
  if (!Number.isSafeInteger(frames) || frames < manifest.generation.min_frames || frames > manifest.generation.max_frames) {
    throw new RangeError(
      `Requested duration must be ${manifest.generation.min_frames}\u2013${manifest.generation.max_frames} frames`
    );
  }
  return frames;
}
function sliceFrames(source, sourceFrame, frameCount, stride) {
  return source.slice(sourceFrame * stride, (sourceFrame + frameCount) * stride);
}
function sliceBoolFrames(source, sourceFrame, frameCount, stride) {
  return source.slice(sourceFrame * stride, (sourceFrame + frameCount) * stride);
}
function concatFloat(chunks) {
  const result = new Float32Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function concatBytes(chunks) {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function optionalFloatOutput(outputs, name, expectedLength) {
  return name === void 0 ? void 0 : floatData(tensorFrom(outputs, name, expectedLength), name);
}
function optionalBoolOutput(outputs, name, expectedLength) {
  if (name === void 0) {
    return void 0;
  }
  const tensor = tensorFrom(outputs, name, expectedLength);
  return boolData(tensor, name);
}
function buildGlobalHybridTokens(decodedMotion, decoderHybrid, generatedFrameOffset, generationTokenOffset, tokenCount, dimensions) {
  const result = new Float32Array(tokenCount * dimensions.hybrid_dim);
  for (let token = 0; token < tokenCount; token += 1) {
    const destinationToken = token * dimensions.hybrid_dim;
    const sourceToken = (generationTokenOffset + token) * dimensions.hybrid_dim;
    for (let frameInToken = 0; frameInToken < dimensions.num_frames_per_token; frameInToken += 1) {
      const sourceFrame = generatedFrameOffset + token * dimensions.num_frames_per_token + frameInToken;
      const destinationRoot = destinationToken + frameInToken * dimensions.root_features_per_frame;
      const sourceMotion = sourceFrame * dimensions.motion_dim;
      result.set(
        decodedMotion.subarray(
          sourceMotion,
          sourceMotion + dimensions.root_features_per_frame
        ),
        destinationRoot
      );
    }
    result.set(
      decoderHybrid.subarray(
        sourceToken + dimensions.nframe_root_dim,
        sourceToken + dimensions.hybrid_dim
      ),
      destinationToken + dimensions.nframe_root_dim
    );
  }
  return result;
}
var BrowserArdyGenerationSession = class {
  manifest;
  #tokenizer;
  #sessions;
  #random;
  #globalHybrid = new Float32Array();
  #frameCount = 0;
  #initialTranslation;
  #initialHeading;
  constructor(manifest, tokenizer, sessions, options) {
    const transform = finiteTransform(
      options.initialTranslation,
      options.initialHeading
    );
    this.manifest = manifest;
    this.#tokenizer = tokenizer;
    this.#sessions = sessions;
    this.#random = new PortableRandom(options.seed);
    this.#initialTranslation = transform.translation;
    this.#initialHeading = transform.heading;
  }
  get frameCount() {
    return this.#frameCount;
  }
  get seed() {
    return this.#random.seed;
  }
  reset(options) {
    const transform = finiteTransform(
      options.initialTranslation,
      options.initialHeading
    );
    this.#random = new PortableRandom(options.seed);
    this.#globalHybrid = new Float32Array();
    this.#frameCount = 0;
    this.#initialTranslation = transform.translation;
    this.#initialHeading = transform.heading;
  }
  /**
   * Crop to the nearest complete four-frame token at or before `frame`.
   * The returned value is the actual branch frame and is safe for continuation.
   */
  branch(frame) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.#frameCount) {
      throw new RangeError("Branch frame is outside the generated session");
    }
    const { num_frames_per_token: framesPerToken, hybrid_dim: hybridDim } = this.manifest.dimensions;
    const tokenCount = Math.floor(frame / framesPerToken);
    this.#globalHybrid = this.#globalHybrid.slice(0, tokenCount * hybridDim);
    this.#frameCount = tokenCount * framesPerToken;
    return this.#frameCount;
  }
  continuation() {
    return {
      frameCount: this.#frameCount,
      hybridTokens: this.#globalHybrid.slice(),
      hybridDim: this.manifest.dimensions.hybrid_dim,
      random: this.#random.snapshot(),
      initialTranslation: [...this.#initialTranslation],
      initialHeading: this.#initialHeading
    };
  }
  restore(state) {
    const { dimensions } = this.manifest;
    const transform = finiteTransform(
      state.initialTranslation,
      state.initialHeading
    );
    const tokenCount = state.hybridTokens.length / dimensions.hybrid_dim;
    const expectedTokenCount = Math.ceil(
      state.frameCount / dimensions.num_frames_per_token
    );
    if (state.hybridDim !== dimensions.hybrid_dim || state.hybridTokens.length % dimensions.hybrid_dim !== 0 || !Number.isSafeInteger(state.frameCount) || state.frameCount < 0 || tokenCount !== expectedTokenCount) {
      throw new RangeError("Continuation state does not match this model");
    }
    for (const value of state.hybridTokens) {
      if (!Number.isFinite(value)) {
        throw new TypeError("Continuation contains non-finite hybrid tokens");
      }
    }
    this.#random = new PortableRandom(state.random.seed);
    this.#random.restore(state.random);
    this.#globalHybrid = state.hybridTokens.slice();
    this.#frameCount = state.frameCount;
    this.#initialTranslation = transform.translation;
    this.#initialHeading = transform.heading;
  }
  #prepareHistory(requestedFrames) {
    const { dimensions, recenter } = this.manifest;
    const framesPerToken = dimensions.num_frames_per_token;
    const availableTokens = Math.min(
      Math.floor(this.#frameCount / framesPerToken),
      this.#globalHybrid.length / dimensions.hybrid_dim
    );
    const requestedTokens = Math.min(
      dimensions.history_tokens,
      Math.floor(requestedFrames / framesPerToken),
      availableTokens
    );
    if (requestedTokens === 0) {
      if (availableTokens > 0) {
        const lastFrame2 = availableTokens * framesPerToken - 1;
        const token = Math.floor(lastFrame2 / framesPerToken);
        const frameInToken = lastFrame2 % framesPerToken;
        const offset = token * dimensions.hybrid_dim + frameInToken * dimensions.root_features_per_frame;
        const rawRoot2 = (feature) => this.#globalHybrid[offset + feature] * recenter.root_std[feature] + recenter.root_mean[feature];
        const [positionX2, , positionZ2] = recenter.position_indices;
        const [headingCos2, headingSin2] = recenter.heading_indices;
        return {
          historyTokens: 0,
          historyFrames: 0,
          windowStartFrame: this.#frameCount,
          globalTranslation: new Float32Array([
            rawRoot2(positionX2),
            this.#initialTranslation[1],
            rawRoot2(positionZ2)
          ]),
          firstHeadingAngle: Math.atan2(
            rawRoot2(headingSin2),
            rawRoot2(headingCos2)
          )
        };
      }
      return {
        historyTokens: 0,
        historyFrames: 0,
        windowStartFrame: this.#frameCount,
        globalTranslation: new Float32Array(this.#initialTranslation),
        firstHeadingAngle: this.#initialHeading
      };
    }
    const firstToken = availableTokens - requestedTokens;
    const history = this.#globalHybrid.slice(
      firstToken * dimensions.hybrid_dim,
      availableTokens * dimensions.hybrid_dim
    );
    const rootOffset = (frame, feature) => {
      const token = Math.floor(frame / framesPerToken);
      const frameInToken = frame % framesPerToken;
      return token * dimensions.hybrid_dim + frameInToken * dimensions.root_features_per_frame + feature;
    };
    const rawRoot = (frame, feature) => history[rootOffset(frame, feature)] * recenter.root_std[feature] + recenter.root_mean[feature];
    const historyFrames = requestedTokens * framesPerToken;
    const lastFrame = historyFrames - 1;
    const [positionX, positionY, positionZ] = recenter.position_indices;
    const [headingCos, headingSin] = recenter.heading_indices;
    const centerX = rawRoot(lastFrame, positionX);
    const centerZ = rawRoot(lastFrame, positionZ);
    const firstCos = rawRoot(0, headingCos);
    const firstSin = rawRoot(0, headingSin);
    for (let frame = 0; frame < historyFrames; frame += 1) {
      for (const [feature, center] of [
        [positionX, centerX],
        // ARDY's native recentering only removes x/z because its external
        // translation is constrained to y=0. The browser contract permits an
        // external y offset, so remove that offset from stored world-space
        // history before feeding the model. The decoder adds it back once.
        [positionY, this.#initialTranslation[1]],
        [positionZ, centerZ]
      ]) {
        const translated = rawRoot(frame, feature) - center;
        history[rootOffset(frame, feature)] = Math.fround(
          (translated - recenter.root_mean[feature]) / recenter.root_std[feature]
        );
      }
    }
    return {
      history,
      historyTokens: requestedTokens,
      historyFrames,
      windowStartFrame: this.#frameCount - historyFrames,
      // The decoder applies this world transform after model-local history has
      // been reconstructed above.
      globalTranslation: new Float32Array([
        centerX,
        this.#initialTranslation[1],
        centerZ
      ]),
      firstHeadingAngle: Math.atan2(firstSin, firstCos)
    };
  }
  async #encodeText(prompt, signal, onProgress) {
    throwIfCancelled(signal);
    onProgress?.({ stage: "encoding-text", completed: 0, total: 1 });
    const started = now();
    const encoded = await this.#tokenizer.encode(prompt);
    throwIfCancelled(signal);
    const inputs = this.manifest.graphs.text_encoder.inputs;
    const outputs = await this.#sessions.textEncoder.run({
      [inputs.inputIds]: new ort_webgpu_bundle_min_exports.Tensor(
        "int64",
        encoded.inputIds,
        [1, encoded.sequenceLength]
      ),
      [inputs.attentionMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "int64",
        encoded.attentionMask,
        [1, encoded.sequenceLength]
      ),
      [inputs.tokenTypeIds]: new ort_webgpu_bundle_min_exports.Tensor(
        "int64",
        encoded.tokenTypeIds,
        [1, encoded.sequenceLength]
      )
    });
    throwIfCancelled(signal);
    const name = this.manifest.graphs.text_encoder.outputs.textConditions;
    const tensor = tensorFrom(
      outputs,
      name,
      this.manifest.dimensions.text_condition_dim
    );
    onProgress?.({ stage: "encoding-text", completed: 1, total: 1 });
    return { tensor, elapsed: now() - started };
  }
  async #denoise(window, textConditions, prepared, cfgWeight2, signal, onProgress, progressOffset, progressTotal) {
    const { dimensions, diffusion, graphs } = this.manifest;
    const generationStart = window.generationTokenOffset * dimensions.hybrid_dim;
    const generationEnd = (window.generationTokenOffset + window.generationTokens) * dimensions.hybrid_dim;
    const timestepData = BigInt64Array.of(0n);
    const inputs = graphs.denoiser.inputs;
    const feeds = {
      [inputs.cfgWeight]: floatScalar(cfgWeight2),
      [inputs.x]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        window.x,
        [1, dimensions.max_tokens, dimensions.hybrid_dim]
      ),
      [inputs.historyLength]: int64Scalar(window.historyFrames),
      [inputs.generationLength]: int64Scalar(window.generationFrames),
      [inputs.historyMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        window.historyMask,
        [1, dimensions.max_frames]
      ),
      [inputs.generationMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        window.generationMask,
        [1, dimensions.max_frames]
      ),
      [inputs.historyTokenMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        window.historyTokenMask,
        [1, dimensions.max_tokens]
      ),
      [inputs.generationTokenMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        window.generationTokenMask,
        [1, dimensions.max_tokens]
      ),
      [inputs.textConditions]: textConditions,
      [inputs.timestep]: new ort_webgpu_bundle_min_exports.Tensor("int64", timestepData, [1]),
      [inputs.firstHeadingAngle]: floatScalar(prepared.firstHeadingAngle)
    };
    const predictionName = graphs.denoiser.outputs.predX0;
    let elapsed = 0;
    for (let inferenceIndex = 0; inferenceIndex < diffusion.timesteps.length; inferenceIndex += 1) {
      throwIfCancelled(signal);
      const step = ddimStepForIndex(
        diffusion.timesteps,
        diffusion.alphas_cumprod,
        diffusion.alphas_cumprod_prev,
        inferenceIndex
      );
      timestepData[0] = BigInt(step.timestep);
      const started = now();
      const outputs = await this.#sessions.denoiser.run(feeds);
      throwIfCancelled(signal);
      const prediction = floatData(
        tensorFrom(outputs, predictionName, window.x.length),
        predictionName
      );
      applyDdimStepInPlace(
        window.x,
        prediction,
        step,
        generationStart,
        generationEnd
      );
      elapsed += now() - started;
      onProgress?.({
        stage: "denoising",
        completed: progressOffset + inferenceIndex + 1,
        total: progressTotal,
        message: "text window"
      });
    }
    return elapsed;
  }
  async #decode(decoderHybrid, validTokens, globalTranslation, signal) {
    const { dimensions, graphs } = this.manifest;
    const inputs = graphs.decoder.inputs;
    const outputs = await this.#sessions.decoder.run({
      [inputs.hybridTokens]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        decoderHybrid,
        [1, dimensions.max_tokens, dimensions.hybrid_dim]
      ),
      [inputs.motionPadMask]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        createMotionPadMask(dimensions, validTokens),
        [1, dimensions.max_frames]
      ),
      [inputs.globalTranslation]: new ort_webgpu_bundle_min_exports.Tensor(
        "float32",
        globalTranslation,
        [1, 3]
      )
    });
    throwIfCancelled(signal);
    const names = graphs.decoder.outputs;
    const frameCount = dimensions.max_frames;
    const jointCount = dimensions.num_joints;
    return {
      motion: floatData(
        tensorFrom(
          outputs,
          names.normalizedMotion,
          frameCount * dimensions.motion_dim
        ),
        names.normalizedMotion
      ),
      joints: floatData(
        tensorFrom(
          outputs,
          names.posedJoints,
          frameCount * jointCount * 3
        ),
        names.posedJoints
      ),
      localRotations: optionalFloatOutput(
        outputs,
        names.localRotations,
        frameCount * jointCount * 9
      ),
      globalRotations: optionalFloatOutput(
        outputs,
        names.globalRotations,
        frameCount * jointCount * 9
      ),
      rootPositions: optionalFloatOutput(
        outputs,
        names.rootPositions,
        frameCount * 3
      ),
      footContacts: optionalBoolOutput(
        outputs,
        names.footContacts,
        frameCount * 4
      ),
      globalRootHeading: optionalFloatOutput(
        outputs,
        names.globalRootHeading,
        frameCount * 2
      )
    };
  }
  async generate(options) {
    if (options.prompt.trim().length === 0) {
      throw new TypeError("Prompt must not be empty");
    }
    const { dimensions, generation } = this.manifest;
    if (!Number.isSafeInteger(options.durationFrames) || options.durationFrames <= 0 || options.durationFrames > generation.max_frames) {
      throw new RangeError(
        `Session generation must be 1\u2013${generation.max_frames} frames`
      );
    }
    const cfgWeight2 = finiteCfgWeight(
      options.cfgWeight,
      generation.default_cfg_weight,
      "CFG weight"
    );
    const requestedHistoryFrames = options.historyFrames ?? dimensions.history_frames;
    if (!Number.isSafeInteger(requestedHistoryFrames) || requestedHistoryFrames < 0 || requestedHistoryFrames > dimensions.history_frames) {
      throw new RangeError("History frame count is invalid");
    }
    if (this.#frameCount % dimensions.num_frames_per_token !== 0) {
      this.branch(this.#frameCount);
    }
    const totalStart = now();
    const startFrame = this.#frameCount;
    const windowCount = Math.ceil(
      options.durationFrames / dimensions.generation_frames
    );
    const encoded = await this.#encodeText(
      options.prompt,
      options.signal,
      options.onProgress
    );
    const chunks = [];
    let writtenFrames = 0;
    let denoisingMs = 0;
    let decodingMs = 0;
    for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
      throwIfCancelled(options.signal);
      const prepared = this.#prepareHistory(requestedHistoryFrames);
      const window = createArWindow(
        dimensions,
        this.#random,
        prepared.history
      );
      denoisingMs += await this.#denoise(
        window,
        encoded.tensor,
        prepared,
        cfgWeight2,
        options.signal,
        options.onProgress,
        windowIndex * this.manifest.diffusion.timesteps.length,
        windowCount * this.manifest.diffusion.timesteps.length
      );
      const validTokens = window.historyTokens + window.generationTokens;
      const decoderHybrid = new Float32Array(
        dimensions.max_tokens * dimensions.hybrid_dim
      );
      decoderHybrid.set(
        window.x.subarray(0, validTokens * dimensions.hybrid_dim)
      );
      const nextHistoryStart = Math.max(
        0,
        validTokens - dimensions.history_tokens
      );
      const recentered = recenterAndRequantize(
        decoderHybrid,
        validTokens,
        dimensions,
        this.manifest.recenter,
        this.manifest.latent_quantization,
        prepared.globalTranslation,
        nextHistoryStart
      );
      const decodeStart = now();
      const decoded = await this.#decode(
        decoderHybrid,
        validTokens,
        recentered.globalTranslation,
        options.signal
      );
      const thisDecodingMs = now() - decodeStart;
      decodingMs += thisDecodingMs;
      const framesToCopy = Math.min(
        dimensions.generation_frames,
        options.durationFrames - writtenFrames
      );
      const generatedFrameOffset = window.historyFrames;
      const generatedTokens = Math.ceil(
        framesToCopy / dimensions.num_frames_per_token
      );
      const hybridTokens = buildGlobalHybridTokens(
        decoded.motion,
        decoderHybrid,
        generatedFrameOffset,
        window.generationTokenOffset,
        generatedTokens,
        dimensions
      );
      const oldLength = this.#globalHybrid.length;
      const combined = new Float32Array(oldLength + hybridTokens.length);
      combined.set(this.#globalHybrid);
      combined.set(hybridTokens, oldLength);
      this.#globalHybrid = combined;
      const jointStride = dimensions.num_joints * 3;
      const rotationStride = dimensions.num_joints * 9;
      const chunkStartFrame = this.#frameCount;
      const chunk = {
        seed: this.#random.seed,
        prompt: options.prompt,
        fps: dimensions.fps,
        startFrame: chunkStartFrame,
        frameCount: framesToCopy,
        motion: sliceFrames(
          decoded.motion,
          generatedFrameOffset,
          framesToCopy,
          dimensions.motion_dim
        ),
        motionShape: [1, framesToCopy, dimensions.motion_dim],
        joints: sliceFrames(
          decoded.joints,
          generatedFrameOffset,
          framesToCopy,
          jointStride
        ),
        jointsShape: [1, framesToCopy, dimensions.num_joints, 3],
        hybridTokens: hybridTokens.slice(),
        hybridShape: [generatedTokens, dimensions.hybrid_dim],
        timingsMs: {
          total: 0,
          text: windowIndex === 0 ? encoded.elapsed : 0,
          denoising: denoisingMs,
          decoding: thisDecodingMs
        }
      };
      if (decoded.localRotations !== void 0) {
        chunk.localRotations = sliceFrames(
          decoded.localRotations,
          generatedFrameOffset,
          framesToCopy,
          rotationStride
        );
        chunk.localRotationsShape = [
          1,
          framesToCopy,
          dimensions.num_joints,
          3,
          3
        ];
      }
      if (decoded.globalRotations !== void 0) {
        chunk.globalRotations = sliceFrames(
          decoded.globalRotations,
          generatedFrameOffset,
          framesToCopy,
          rotationStride
        );
        chunk.globalRotationsShape = [
          1,
          framesToCopy,
          dimensions.num_joints,
          3,
          3
        ];
      }
      if (decoded.rootPositions !== void 0) {
        chunk.rootPositions = sliceFrames(
          decoded.rootPositions,
          generatedFrameOffset,
          framesToCopy,
          3
        );
        chunk.rootPositionsShape = [1, framesToCopy, 3];
      }
      if (decoded.footContacts !== void 0) {
        chunk.footContacts = sliceBoolFrames(
          decoded.footContacts,
          generatedFrameOffset,
          framesToCopy,
          4
        );
        chunk.footContactsShape = [1, framesToCopy, 4];
      }
      if (decoded.globalRootHeading !== void 0) {
        chunk.globalRootHeading = sliceFrames(
          decoded.globalRootHeading,
          generatedFrameOffset,
          framesToCopy,
          2
        );
        chunk.globalRootHeadingShape = [1, framesToCopy, 2];
      }
      this.#frameCount += framesToCopy;
      writtenFrames += framesToCopy;
      chunk.timingsMs.total = now() - totalStart;
      chunks.push(chunk);
      await options.onChunk?.(chunk);
      options.onProgress?.({
        stage: "decoding",
        completed: windowIndex + 1,
        total: windowCount,
        message: `${this.#frameCount} frames`
      });
    }
    const motion = concatFloat(chunks.map((chunk) => chunk.motion));
    const joints = concatFloat(chunks.map((chunk) => chunk.joints));
    const localRotationChunks = chunks.flatMap(
      (chunk) => chunk.localRotations === void 0 ? [] : [chunk.localRotations]
    );
    const globalRotationChunks = chunks.flatMap(
      (chunk) => chunk.globalRotations === void 0 ? [] : [chunk.globalRotations]
    );
    const rootChunks = chunks.flatMap(
      (chunk) => chunk.rootPositions === void 0 ? [] : [chunk.rootPositions]
    );
    const contactChunks = chunks.flatMap(
      (chunk) => chunk.footContacts === void 0 ? [] : [chunk.footContacts]
    );
    const headingChunks = chunks.flatMap(
      (chunk) => chunk.globalRootHeading === void 0 ? [] : [chunk.globalRootHeading]
    );
    const result = {
      seed: this.#random.seed,
      prompt: options.prompt,
      fps: dimensions.fps,
      startFrame,
      frameCount: writtenFrames,
      chunks: chunks.length,
      motion,
      motionShape: [1, writtenFrames, dimensions.motion_dim],
      joints,
      jointsShape: [1, writtenFrames, dimensions.num_joints, 3],
      continuation: this.continuation(),
      timingsMs: {
        total: now() - totalStart,
        text: encoded.elapsed,
        denoising: denoisingMs,
        decoding: decodingMs
      }
    };
    if (localRotationChunks.length === chunks.length) {
      result.localRotations = concatFloat(localRotationChunks);
      result.localRotationsShape = [
        1,
        writtenFrames,
        dimensions.num_joints,
        3,
        3
      ];
    }
    if (globalRotationChunks.length === chunks.length) {
      result.globalRotations = concatFloat(globalRotationChunks);
      result.globalRotationsShape = [
        1,
        writtenFrames,
        dimensions.num_joints,
        3,
        3
      ];
    }
    if (rootChunks.length === chunks.length) {
      result.rootPositions = concatFloat(rootChunks);
      result.rootPositionsShape = [1, writtenFrames, 3];
    }
    if (contactChunks.length === chunks.length) {
      result.footContacts = concatBytes(contactChunks);
      result.footContactsShape = [1, writtenFrames, 4];
    }
    if (headingChunks.length === chunks.length) {
      result.globalRootHeading = concatFloat(headingChunks);
      result.globalRootHeadingShape = [1, writtenFrames, 2];
    }
    return result;
  }
};
var BrowserArdyRuntime = class _BrowserArdyRuntime {
  manifest;
  #tokenizer;
  #sessions;
  #disposed = false;
  constructor(manifest, tokenizer, sessions) {
    this.manifest = manifest;
    this.#tokenizer = tokenizer;
    this.#sessions = sessions;
  }
  static async create(assets, options = {}) {
    throwIfCancelled(options.signal);
    options.onProgress?.({
      stage: "loading-tokenizer",
      completed: 0,
      total: 1
    });
    const tokenizer = await LocalTokenizer.create(assets);
    throwIfCancelled(options.signal);
    options.onProgress?.({
      stage: "loading-tokenizer",
      completed: 1,
      total: 1
    });
    try {
      const sessions = await createRuntimeSessions(
        assets,
        (completed, total, message) => {
          throwIfCancelled(options.signal);
          options.onProgress?.({
            stage: "loading-sessions",
            completed,
            total,
            message
          });
        }
      );
      if (options.signal?.aborted) {
        await disposeRuntimeSessions(sessions);
        throw new RuntimeCancelledError("Model loading cancelled");
      }
      return new _BrowserArdyRuntime(assets.manifest, tokenizer, sessions);
    } catch (error) {
      await tokenizer.dispose();
      throw error;
    }
  }
  createGenerationSession(options) {
    if (this.#disposed) {
      throw new Error("Runtime has been disposed");
    }
    return new BrowserArdyGenerationSession(
      this.manifest,
      this.#tokenizer,
      this.#sessions,
      options
    );
  }
  async generate(options) {
    const frameCount = resolveFrameCount(this.manifest, options);
    const session = this.createGenerationSession({
      seed: options.seed,
      initialTranslation: options.initialTranslation,
      initialHeading: options.initialHeading
    });
    return session.generate({
      prompt: options.prompt,
      durationFrames: frameCount,
      cfgWeight: options.cfgWeight,
      historyFrames: options.historyFrames,
      signal: options.signal,
      onProgress: options.onProgress,
      onChunk: options.onChunk
    });
  }
  async dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    await Promise.all([
      this.#tokenizer.dispose(),
      disposeRuntimeSessions(this.#sessions)
    ]);
  }
};

// src/runtime/hash.ts
function exactBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === void 0) {
    throw new Error("SHA-256 validation requires Web Crypto");
  }
  const digest = await subtle.digest("SHA-256", exactBuffer(bytes));
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, "0")
  ).join("");
}

// src/runtime/resumable-transport.ts
var RESUMABLE_TRANSPORT_BLOCK_BYTES = 8 * 1024 * 1024;
var PARTIAL_MARKER_SCHEMA_VERSION = 2;
var PARTIAL_KIND_QUERY = "ardy-model-partial";
var PARTIAL_OFFSET_QUERY = "ardy-model-offset";
var PARTIAL_SHA256_QUERY = "ardy-model-sha256";
var PARTIAL_MARKER_KIND = "marker";
var PARTIAL_BLOCK_KIND = "block";
var MAX_MARKER_BYTES = 512 * 1024;
var SHA256_RE2 = /^[0-9a-f]{64}$/;
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Operation cancelled", "AbortError");
}
function canonicalTransportUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.searchParams.has(PARTIAL_KIND_QUERY) || url.searchParams.has(PARTIAL_OFFSET_QUERY) || url.searchParams.has(PARTIAL_SHA256_QUERY)) {
    throw new TypeError(
      "Transport URL must be an HTTP(S) URL without credentials, fragment, or reserved partial-cache parameters"
    );
  }
  return url.href;
}
function partialMarkerUrl(transportUrl) {
  const url = new URL(transportUrl);
  url.searchParams.set(PARTIAL_KIND_QUERY, PARTIAL_MARKER_KIND);
  return url.href;
}
function partialBlockUrl(transportUrl, block) {
  const url = new URL(transportUrl);
  url.searchParams.set(PARTIAL_KIND_QUERY, PARTIAL_BLOCK_KIND);
  url.searchParams.set(PARTIAL_OFFSET_QUERY, String(block.offset));
  url.searchParams.set(PARTIAL_SHA256_QUERY, block.sha256);
  return url.href;
}
function isPartialEntryFor(candidateValue, transportUrl) {
  let candidate;
  try {
    candidate = new URL(candidateValue);
  } catch {
    return false;
  }
  const kind = candidate.searchParams.get(PARTIAL_KIND_QUERY);
  if (kind !== PARTIAL_MARKER_KIND && kind !== PARTIAL_BLOCK_KIND) {
    return false;
  }
  candidate.searchParams.delete(PARTIAL_KIND_QUERY);
  candidate.searchParams.delete(PARTIAL_OFFSET_QUERY);
  candidate.searchParams.delete(PARTIAL_SHA256_QUERY);
  return candidate.href === transportUrl;
}
function exactArrayBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
function cachedResponse(bytes, mediaType) {
  return new Response(exactArrayBuffer(bytes), {
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": mediaType
    }
  });
}
async function readBoundedResponse(response, maximumBytes, label) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new Error(`${label} declares an invalid Content-Length`);
  }
  if (response.body === null) {
    throw new Error(`${label} has no response body`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let completed = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      completed += result.value.byteLength;
      if (completed > maximumBytes) {
        throw new Error(`${label} exceeds ${maximumBytes} bytes`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  }
  const output = new Uint8Array(completed);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function readExactResponse(response, expectedBytes, label, signal) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes)) {
    throw new Error(
      `${label} Content-Length does not match the expected ${expectedBytes} bytes`
    );
  }
  if (response.body === null) {
    if (expectedBytes === 0) return new Uint8Array();
    throw new Error(`${label} has no response body`);
  }
  const output = new Uint8Array(expectedBytes);
  const reader = response.body.getReader();
  let completed = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      throwIfAborted(signal);
      if (result.done) break;
      if (completed + result.value.byteLength > expectedBytes) {
        throw new Error(`${label} exceeds ${expectedBytes} bytes`);
      }
      output.set(result.value, completed);
      completed += result.value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  }
  if (completed !== expectedBytes) {
    throw new Error(
      `${label} size mismatch: expected ${expectedBytes}, got ${completed}`
    );
  }
  return output;
}
function finiteWholeNumber(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function validateMarker(value, transportUrl, description) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value;
  if (candidate.schema_version !== PARTIAL_MARKER_SCHEMA_VERSION || candidate.transport_url !== transportUrl || candidate.transport_size_bytes !== description.transport.size_bytes || candidate.transport_sha256 !== description.transport.sha256 || candidate.block_size_bytes !== RESUMABLE_TRANSPORT_BLOCK_BYTES || typeof candidate.transport_sha256_verified !== "boolean" || !Array.isArray(candidate.blocks)) {
    return null;
  }
  const maximumBlocks = Math.ceil(
    description.transport.size_bytes / RESUMABLE_TRANSPORT_BLOCK_BYTES
  );
  if (candidate.blocks.length === 0 || candidate.blocks.length > maximumBlocks) {
    return null;
  }
  const blocks = [];
  let completed = 0;
  for (let index = 0; index < candidate.blocks.length; index += 1) {
    const rawBlock = candidate.blocks[index];
    if (typeof rawBlock !== "object" || rawBlock === null || Array.isArray(rawBlock)) {
      return null;
    }
    const block = rawBlock;
    const offset = finiteWholeNumber(block.offset);
    const sizeBytes = finiteWholeNumber(block.size_bytes);
    if (offset === null || sizeBytes === null || offset !== completed || sizeBytes <= 0 || sizeBytes > RESUMABLE_TRANSPORT_BLOCK_BYTES || typeof block.sha256 !== "string" || !SHA256_RE2.test(block.sha256) || completed + sizeBytes > description.transport.size_bytes || index < candidate.blocks.length - 1 && sizeBytes !== RESUMABLE_TRANSPORT_BLOCK_BYTES) {
      return null;
    }
    blocks.push({
      offset,
      size_bytes: sizeBytes,
      sha256: block.sha256
    });
    completed += sizeBytes;
  }
  if (candidate.transport_sha256_verified && completed !== description.transport.size_bytes) {
    return null;
  }
  return {
    schema_version: PARTIAL_MARKER_SCHEMA_VERSION,
    transport_url: transportUrl,
    transport_size_bytes: description.transport.size_bytes,
    transport_sha256: description.transport.sha256,
    block_size_bytes: RESUMABLE_TRANSPORT_BLOCK_BYTES,
    transport_sha256_verified: candidate.transport_sha256_verified,
    blocks
  };
}
async function readMarker(cache, transportUrl, description) {
  const response = await cache.match(partialMarkerUrl(transportUrl));
  if (response === void 0) return null;
  try {
    const bytes = await readBoundedResponse(
      response,
      MAX_MARKER_BYTES,
      "Partial transport marker"
    );
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    return validateMarker(value, transportUrl, description);
  } catch {
    return null;
  }
}
async function writeMarker(cache, transportUrl, marker) {
  const bytes = new TextEncoder().encode(JSON.stringify(marker));
  if (bytes.byteLength > MAX_MARKER_BYTES) {
    throw new Error("Partial transport marker is too large");
  }
  await cache.put(
    partialMarkerUrl(transportUrl),
    cachedResponse(bytes, "application/json")
  );
}
async function referencedBlocksExist(cache, transportUrl, marker) {
  const responses = await Promise.all(
    marker.blocks.map(
      (block) => cache.match(partialBlockUrl(transportUrl, block))
    )
  );
  return responses.every((response, index) => {
    if (response === void 0) return false;
    const declaredLength = response.headers.get("content-length");
    return declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) === marker.blocks[index].size_bytes;
  });
}
async function removeOrphanBlocks(cache, transportUrl, marker) {
  const retained = /* @__PURE__ */ new Set([
    partialMarkerUrl(transportUrl),
    ...marker.blocks.map(
      (block) => partialBlockUrl(transportUrl, block)
    )
  ]);
  const deletions = [];
  for (const request of await cache.keys()) {
    if (isPartialEntryFor(request.url, transportUrl) && !retained.has(request.url)) {
      deletions.push(cache.delete(request));
    }
  }
  await Promise.all(deletions);
}
async function clearResumableTransport(cache, transportUrlValue) {
  const transportUrl = canonicalTransportUrl(transportUrlValue);
  const deletions = [];
  for (const request of await cache.keys()) {
    if (isPartialEntryFor(request.url, transportUrl)) {
      deletions.push(cache.delete(request));
    }
  }
  await Promise.all(deletions);
}
async function inspectResumableTransportCache(cache, transportUrlValue, description) {
  const transportUrl = canonicalTransportUrl(transportUrlValue);
  const marker = await readMarker(cache, transportUrl, description);
  if (marker === null || !await referencedBlocksExist(cache, transportUrl, marker)) {
    await clearResumableTransport(cache, transportUrl);
    return { sizeBytes: 0, complete: false };
  }
  await removeOrphanBlocks(cache, transportUrl, marker);
  const sizeBytes = markerCompleted(marker);
  return {
    sizeBytes,
    complete: marker.transport_sha256_verified && sizeBytes === description.transport.size_bytes
  };
}
async function restorePartialTransport(cache, transportUrl, description, output, signal) {
  const marker = await readMarker(cache, transportUrl, description);
  if (marker === null) {
    await clearResumableTransport(cache, transportUrl);
    return null;
  }
  try {
    let completed = 0;
    for (const block of marker.blocks) {
      throwIfAborted(signal);
      const response = await cache.match(
        partialBlockUrl(transportUrl, block)
      );
      if (response === void 0) {
        throw new Error("Partial transport block is missing");
      }
      const bytes = await readExactResponse(
        response,
        block.size_bytes,
        "Partial transport block",
        signal
      );
      if (await sha256Hex(bytes) !== block.sha256) {
        throw new Error("Partial transport block SHA-256 mismatch");
      }
      throwIfAborted(signal);
      output.set(bytes, block.offset);
      completed += bytes.byteLength;
    }
    await removeOrphanBlocks(cache, transportUrl, marker);
    return { marker, completed };
  } catch (error) {
    if (signal?.aborted) throw error;
    await clearResumableTransport(cache, transportUrl);
    return null;
  }
}
async function readCachedResumableTransport(options) {
  const transportUrl = canonicalTransportUrl(options.transportUrl);
  const expectedBytes = options.description.transport.size_bytes;
  const output = new Uint8Array(expectedBytes);
  const restored = await restorePartialTransport(
    options.cache,
    transportUrl,
    options.description,
    output,
    options.signal
  );
  if (restored?.completed !== expectedBytes) return null;
  if (!restored.marker.transport_sha256_verified) return null;
  try {
    await verifyTransport(
      output,
      options.description,
      options.label ?? `${transportUrl} gzip transport`
    );
    throwIfAborted(options.signal);
    return output;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    await clearResumableTransport(options.cache, transportUrl);
    return null;
  }
}
function emptyMarker(transportUrl, description) {
  return {
    schema_version: PARTIAL_MARKER_SCHEMA_VERSION,
    transport_url: transportUrl,
    transport_size_bytes: description.transport.size_bytes,
    transport_sha256: description.transport.sha256,
    block_size_bytes: RESUMABLE_TRANSPORT_BLOCK_BYTES,
    transport_sha256_verified: false,
    blocks: []
  };
}
async function persistBlock(cache, transportUrl, marker, offset, bytes) {
  if (bytes.byteLength <= 0 || bytes.byteLength > RESUMABLE_TRANSPORT_BLOCK_BYTES) {
    throw new Error("Partial transport block has an invalid size");
  }
  const sha256 = await sha256Hex(bytes);
  const block = {
    offset,
    size_bytes: bytes.byteLength,
    sha256
  };
  const existingIndex = marker.blocks.findIndex(
    (candidate) => candidate.offset === offset
  );
  if (existingIndex !== -1 && existingIndex !== marker.blocks.length - 1) {
    throw new Error("Only the partial transport tail may be replaced");
  }
  const previous = existingIndex === -1 ? void 0 : marker.blocks[existingIndex];
  const blocks = existingIndex === -1 ? [...marker.blocks, block] : marker.blocks.map(
    (candidate, index) => index === existingIndex ? block : candidate
  );
  const nextMarker = {
    ...marker,
    transport_sha256_verified: false,
    blocks
  };
  const nextBlockUrl = partialBlockUrl(transportUrl, block);
  await cache.put(
    nextBlockUrl,
    cachedResponse(bytes, "application/octet-stream")
  );
  try {
    await writeMarker(cache, transportUrl, nextMarker);
  } catch (error) {
    await cache.delete(nextBlockUrl).catch(() => false);
    throw error;
  }
  if (previous !== void 0) {
    const previousUrl = partialBlockUrl(transportUrl, previous);
    if (previousUrl !== nextBlockUrl) {
      await cache.delete(previousUrl);
    }
  }
  return nextMarker;
}
function markerCompleted(marker) {
  return marker.blocks.reduce(
    (total, block) => total + block.size_bytes,
    0
  );
}
function currentBlockStart(marker) {
  const last = marker.blocks.at(-1);
  if (last !== void 0 && last.size_bytes < RESUMABLE_TRANSPORT_BLOCK_BYTES) {
    return last.offset;
  }
  return markerCompleted(marker);
}
async function readNetworkResponse(options) {
  const declaredLength = options.response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== options.expectedBytes)) {
    throw new Error(
      `${options.label} Content-Length does not match the expected ${options.expectedBytes} bytes`
    );
  }
  if (options.response.body === null) {
    throw new Error(`${options.label} has no response body`);
  }
  const reader = options.response.body.getReader();
  let marker = options.marker;
  let completed = options.start;
  const end = options.start + options.expectedBytes;
  let blockStart = currentBlockStart(marker);
  let receivedNewBytes = false;
  const persistTail = async () => {
    if (!receivedNewBytes || completed <= blockStart) return;
    marker = await persistBlock(
      options.cache,
      options.transportUrl,
      marker,
      blockStart,
      options.output.slice(blockStart, completed)
    );
    blockStart = currentBlockStart(marker);
    receivedNewBytes = false;
  };
  try {
    while (true) {
      throwIfAborted(options.signal);
      const result = await reader.read();
      throwIfAborted(options.signal);
      if (result.done) break;
      if (completed + result.value.byteLength > end) {
        throw new Error(`${options.label} exceeds its declared size`);
      }
      options.output.set(result.value, completed);
      completed += result.value.byteLength;
      receivedNewBytes = true;
      while (blockStart + RESUMABLE_TRANSPORT_BLOCK_BYTES <= completed) {
        const blockEnd = blockStart + RESUMABLE_TRANSPORT_BLOCK_BYTES;
        marker = await persistBlock(
          options.cache,
          options.transportUrl,
          marker,
          blockStart,
          options.output.slice(blockStart, blockEnd)
        );
        blockStart = currentBlockStart(marker);
        receivedNewBytes = completed > markerCompleted(marker);
      }
      options.onProgress?.(completed);
      throwIfAborted(options.signal);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    await persistTail();
    throw error;
  }
  if (completed !== end) {
    const error = new Error(
      `${options.label} size mismatch: expected ${options.expectedBytes}, got ${completed - options.start}`
    );
    await persistTail();
    throw error;
  }
  await persistTail();
  return marker;
}
function parseContentRange(response, expectedStart, expectedTotal) {
  const value = response.headers.get("content-range");
  if (value === null) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start !== expectedStart || end !== expectedTotal - 1 || total !== expectedTotal || end < start) {
    return null;
  }
  const rangeBytes = end - start + 1;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== rangeBytes)) {
    return null;
  }
  return rangeBytes;
}
async function discardResponse(response) {
  await response.body?.cancel().catch(() => {
  });
}
async function verifyTransport(bytes, description, label) {
  if (bytes.byteLength !== description.transport.size_bytes) {
    throw new Error(
      `Compressed size mismatch for ${label}: expected ${description.transport.size_bytes}, got ${bytes.byteLength}`
    );
  }
  const actual = await sha256Hex(bytes);
  if (actual !== description.transport.sha256) {
    throw new Error(
      `Compressed SHA-256 mismatch for ${label}: expected ${description.transport.sha256}, got ${actual}`
    );
  }
}
async function promoteTransport(cache, transportUrl, bytes) {
  if (bytes.byteLength > RESUMABLE_TRANSPORT_BLOCK_BYTES) return false;
  try {
    await cache.put(
      transportUrl,
      cachedResponse(bytes, "application/gzip")
    );
  } catch {
    return false;
  }
  await clearResumableTransport(cache, transportUrl);
  return true;
}
async function finalizeTransport(cache, transportUrl, marker, bytes) {
  if (await promoteTransport(cache, transportUrl, bytes)) return;
  await writeMarker(cache, transportUrl, {
    ...marker,
    transport_sha256_verified: true
  });
}
async function fetchCleanFullTransport(options, transportUrl, output, label) {
  throwIfAborted(options.signal);
  const response = await options.fetchRange(0, options.signal);
  throwIfAborted(options.signal);
  if (response.status !== 200) {
    throw new Error(
      `${label} clean download failed with HTTP ${response.status}`
    );
  }
  let marker = emptyMarker(transportUrl, options.description);
  marker = await readNetworkResponse({
    response,
    output,
    start: 0,
    expectedBytes: output.byteLength,
    cache: options.cache,
    transportUrl,
    marker,
    signal: options.signal,
    onProgress: options.onProgress,
    label
  });
  try {
    await verifyTransport(output, options.description, label);
  } catch (error) {
    await clearResumableTransport(options.cache, transportUrl);
    throw error;
  }
  throwIfAborted(options.signal);
  await finalizeTransport(
    options.cache,
    transportUrl,
    marker,
    output
  );
  throwIfAborted(options.signal);
  return output;
}
async function loadResumableTransport(options) {
  const transportUrl = canonicalTransportUrl(options.transportUrl);
  const expectedBytes = options.description.transport.size_bytes;
  const label = options.label ?? `${transportUrl} gzip transport`;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new RangeError(`${label} declares an invalid byte length`);
  }
  throwIfAborted(options.signal);
  let reportedBytes = 0;
  const reportProgress = (completed2) => {
    const bounded = Math.max(0, Math.min(expectedBytes, completed2));
    if (bounded <= reportedBytes) return;
    reportedBytes = bounded;
    options.onProgress?.(bounded);
  };
  const reportStreamingProgress = (completed2) => {
    reportProgress(Math.min(completed2, expectedBytes - 1));
  };
  const operationOptions = {
    ...options,
    onProgress: reportStreamingProgress
  };
  const cleanFullTransport = async () => {
    const bytes = await fetchCleanFullTransport(
      operationOptions,
      transportUrl,
      new Uint8Array(expectedBytes),
      label
    );
    reportProgress(expectedBytes);
    return bytes;
  };
  const output = new Uint8Array(expectedBytes);
  const restored = await restorePartialTransport(
    options.cache,
    transportUrl,
    options.description,
    output,
    options.signal
  );
  let marker = restored?.marker ?? emptyMarker(transportUrl, options.description);
  let completed = restored?.completed ?? 0;
  if (completed > 0) reportStreamingProgress(completed);
  throwIfAborted(options.signal);
  if (completed === expectedBytes) {
    try {
      await verifyTransport(output, options.description, label);
    } catch {
      await clearResumableTransport(options.cache, transportUrl);
      return cleanFullTransport();
    }
    throwIfAborted(options.signal);
    await finalizeTransport(
      options.cache,
      transportUrl,
      marker,
      output
    );
    throwIfAborted(options.signal);
    reportProgress(expectedBytes);
    return output;
  }
  const response = await options.fetchRange(completed, options.signal);
  throwIfAborted(options.signal);
  let joinedPartial = completed > 0;
  if (completed > 0 && response.status === 200) {
    await clearResumableTransport(options.cache, transportUrl);
    marker = emptyMarker(transportUrl, options.description);
    completed = 0;
    joinedPartial = false;
  } else if (completed > 0 && response.status === 206) {
    const rangeBytes = parseContentRange(
      response,
      completed,
      expectedBytes
    );
    if (rangeBytes === null) {
      await discardResponse(response);
      await clearResumableTransport(options.cache, transportUrl);
      return cleanFullTransport();
    }
  } else if (completed > 0) {
    await discardResponse(response);
    await clearResumableTransport(options.cache, transportUrl);
    return cleanFullTransport();
  } else if (response.status !== 200) {
    throw new Error(`${label} download failed with HTTP ${response.status}`);
  }
  const responseBytes2 = response.status === 206 ? expectedBytes - completed : expectedBytes;
  marker = await readNetworkResponse({
    response,
    output,
    start: completed,
    expectedBytes: responseBytes2,
    cache: options.cache,
    transportUrl,
    marker,
    signal: options.signal,
    onProgress: reportStreamingProgress,
    label
  });
  try {
    await verifyTransport(output, options.description, label);
  } catch (error) {
    await clearResumableTransport(options.cache, transportUrl);
    if (joinedPartial) {
      return cleanFullTransport();
    }
    throw error;
  }
  throwIfAborted(options.signal);
  await finalizeTransport(
    options.cache,
    transportUrl,
    marker,
    output
  );
  throwIfAborted(options.signal);
  reportProgress(expectedBytes);
  return output;
}

// src/runtime/model-assets.ts
var MODEL_CACHE_PREFIX = "ardy-mini-model-files-v1-";
var MODEL_CACHE_MARKER_QUERY = "ardy-model-cache-complete";
var MODEL_CACHE_MARKER_VERSION = 1;
var MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
var MAX_CACHE_MARKER_BYTES = 64 * 1024;
var MAX_MODEL_BYTES = 8 * 1024 * 1024 * 1024;
var MAX_MODEL_FILES = 1e4;
var SHA256_RE3 = /^[0-9a-f]{64}$/;
function throwIfAborted2(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Operation cancelled", "AbortError");
  }
}
function locationHref() {
  return typeof globalThis.location === "undefined" ? void 0 : globalThis.location.href;
}
function normalizeModelBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Model base URL must be a non-empty string");
  }
  let url;
  try {
    url = new URL(value, locationHref());
  } catch (error) {
    throw new TypeError("Model base URL must be a valid HTTP(S) URL", {
      cause: error
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new TypeError(
      "Model base URL must be an HTTP(S) URL without credentials, query, or fragment"
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.href;
}
function manifestUrl(baseUrl) {
  return new URL(MODEL_MANIFEST_FILE, baseUrl).href;
}
function cacheMarkerUrl(baseUrl) {
  const url = new URL(MODEL_MANIFEST_FILE, baseUrl);
  url.searchParams.set(MODEL_CACHE_MARKER_QUERY, "1");
  return url.href;
}
function cacheStorage() {
  return typeof globalThis.caches === "undefined" ? null : globalThis.caches;
}
function exactArrayBuffer2(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
function finiteSafeTotal(values, label) {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total) || total > MAX_MODEL_BYTES) {
      throw new RangeError(`${label} exceeds ${MAX_MODEL_BYTES} bytes`);
    }
  }
  return total;
}
function modelTransportSize(manifest) {
  return finiteSafeTotal(
    Object.values(manifest.files).map(
      (description) => description.transport.size_bytes
    ),
    "Compressed model"
  );
}
function modelRawSize(manifest) {
  return finiteSafeTotal(
    Object.values(manifest.files).map(
      (description) => description.size_bytes
    ),
    "Decompressed model"
  );
}
function decodeJson(bytes, path) {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function readKnownLength(stream, expectedBytes, label, options = {}) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > MAX_MODEL_BYTES) {
    throw new RangeError(`${label} declares an invalid byte length`);
  }
  const output = new Uint8Array(expectedBytes);
  const reader = stream.getReader();
  let completed = 0;
  try {
    while (true) {
      throwIfAborted2(options.signal);
      const result = await reader.read();
      throwIfAborted2(options.signal);
      if (result.done) break;
      if (completed + result.value.byteLength > expectedBytes) {
        throw new Error(
          `${label} exceeds its declared size of ${expectedBytes} bytes`
        );
      }
      output.set(result.value, completed);
      completed += result.value.byteLength;
      options.onChunk?.(completed);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  }
  if (completed !== expectedBytes) {
    throw new Error(
      `${label} size mismatch: expected ${expectedBytes}, got ${completed}`
    );
  }
  return output;
}
async function responseBytes(response, expectedBytes, label, options = {}) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes)) {
    throw new Error(
      `${label} Content-Length does not match the expected ${expectedBytes} bytes`
    );
  }
  if (response.body === null) {
    if (expectedBytes !== 0) {
      throw new Error(`${label} has no response body`);
    }
    return new Uint8Array();
  }
  return readKnownLength(response.body, expectedBytes, label, options);
}
async function readBounded(stream, maximumBytes, label, signal) {
  const reader = stream.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      throwIfAborted2(signal);
      const result = await reader.read();
      throwIfAborted2(signal);
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maximumBytes) {
        throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function gzipDecompressionStream(bytes, label) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support gzip decompression");
  }
  try {
    const decompressor = new DecompressionStream("gzip");
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
    return input.pipeThrough(
      decompressor
    );
  } catch (error) {
    throw new Error(`Could not initialize gzip decompression for ${label}`, {
      cause: error
    });
  }
}
async function decompressManifest(transport, signal) {
  try {
    return await readBounded(
      gzipDecompressionStream(transport, MODEL_MANIFEST_FILE),
      MAX_MANIFEST_BYTES,
      `Decompressed ${MODEL_MANIFEST_FILE}`,
      signal
    );
  } catch (error) {
    throw new Error(
      `Could not decompress ${MODEL_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
async function fetchResponse(url, signal) {
  throwIfAborted2(signal);
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "omit",
    mode: "cors",
    redirect: "follow",
    signal
  });
  throwIfAborted2(signal);
  if (!response.ok) {
    throw new Error(
      `Could not download ${url}: HTTP ${response.status} ${response.statusText}`.trim()
    );
  }
  return response;
}
async function fetchTransportRangeResponse(url, offset, signal) {
  throwIfAborted2(signal);
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "omit",
    headers: offset > 0 ? {
      Range: `bytes=${offset}-`
    } : void 0,
    mode: "cors",
    redirect: "follow",
    signal
  });
  throwIfAborted2(signal);
  return response;
}
function markerFor(source) {
  return {
    schema_version: MODEL_CACHE_MARKER_VERSION,
    base_url: source.baseUrl,
    manifest_sha256: source.manifestSha256,
    manifest_transport_sha256: source.manifestTransportSha256,
    manifest_transport_size_bytes: source.manifestTransportBytes.byteLength,
    model_id: source.manifest.model.id,
    revision: source.manifest.model.revision,
    file_count: Object.keys(source.manifest.files).length,
    transport_size_bytes: modelTransportSize(source.manifest),
    raw_size_bytes: modelRawSize(source.manifest),
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function validateMarker2(value, source) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const marker = value;
  return marker.schema_version === MODEL_CACHE_MARKER_VERSION && marker.base_url === source.baseUrl && marker.manifest_sha256 === source.manifestSha256 && marker.manifest_transport_sha256 === source.manifestTransportSha256 && marker.manifest_transport_size_bytes === source.manifestTransportBytes.byteLength && marker.model_id === source.manifest.model.id && marker.revision === source.manifest.model.revision && marker.file_count === Object.keys(source.manifest.files).length && marker.transport_size_bytes === modelTransportSize(source.manifest) && marker.raw_size_bytes === modelRawSize(source.manifest) && typeof marker.completed_at === "string" && marker.completed_at.length > 0;
}
function markerManifestTransport(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const marker = value;
  if (marker.schema_version !== MODEL_CACHE_MARKER_VERSION || typeof marker.manifest_transport_sha256 !== "string" || !SHA256_RE3.test(marker.manifest_transport_sha256) || typeof marker.manifest_transport_size_bytes !== "number" || !Number.isSafeInteger(marker.manifest_transport_size_bytes) || marker.manifest_transport_size_bytes <= 0 || marker.manifest_transport_size_bytes > MAX_MANIFEST_BYTES) {
    return null;
  }
  return {
    sha256: marker.manifest_transport_sha256,
    sizeBytes: marker.manifest_transport_size_bytes
  };
}
async function cacheNameFor(baseUrl, manifest, manifestSha256) {
  const identity = new TextEncoder().encode(
    `${baseUrl}\0${manifest.model.id}\0${manifest.model.revision}`
  );
  const identityHash = await sha256Hex(identity);
  return `${MODEL_CACHE_PREFIX}${identityHash.slice(0, 20)}-` + manifestSha256;
}
async function sourceFromBytes(baseUrl, rawBytes, transportBytes) {
  const manifest = validateModelManifest(
    decodeJson(rawBytes, MODEL_MANIFEST_FILE)
  );
  const fileCount = Object.keys(manifest.files).length;
  if (fileCount === 0 || fileCount > MAX_MODEL_FILES) {
    throw new RangeError(
      `${MODEL_MANIFEST_FILE} must declare 1\u2013${MAX_MODEL_FILES} files`
    );
  }
  modelTransportSize(manifest);
  modelRawSize(manifest);
  const manifestSha256 = await sha256Hex(rawBytes);
  return {
    baseUrl,
    manifestUrl: manifestUrl(baseUrl),
    manifest,
    manifestSha256,
    cacheName: await cacheNameFor(baseUrl, manifest, manifestSha256),
    manifestBytes: rawBytes,
    manifestTransportBytes: transportBytes,
    manifestTransportSha256: await sha256Hex(transportBytes)
  };
}
async function cachedSourceForBaseUrl(baseUrl) {
  const storage = cacheStorage();
  if (storage === null) return null;
  const names = (await storage.keys()).filter((name) => name.startsWith(MODEL_CACHE_PREFIX)).sort().reverse();
  for (const name of names) {
    const cache = await storage.open(name);
    const markerResponse = await cache.match(cacheMarkerUrl(baseUrl));
    const manifestResponse = await cache.match(manifestUrl(baseUrl));
    if (markerResponse === void 0 || manifestResponse === void 0) {
      continue;
    }
    try {
      if (markerResponse.body === null) continue;
      const markerBytes = await readBounded(
        markerResponse.body,
        MAX_CACHE_MARKER_BYTES,
        "model cache completion marker"
      );
      const marker = decodeJson(
        markerBytes,
        "model cache completion marker"
      );
      const transportIdentity = markerManifestTransport(marker);
      if (transportIdentity === null) continue;
      const transportBytes = await responseBytes(
        manifestResponse,
        transportIdentity.sizeBytes,
        MODEL_MANIFEST_FILE
      );
      if (await sha256Hex(transportBytes) !== transportIdentity.sha256) {
        continue;
      }
      const rawBytes = await decompressManifest(transportBytes);
      const source = await sourceFromBytes(
        baseUrl,
        rawBytes,
        transportBytes
      );
      if (source.cacheName !== name || !validateMarker2(marker, source)) {
        continue;
      }
      return source;
    } catch {
    }
  }
  return null;
}
async function fetchModelManifest(value, options = {}) {
  const baseUrl = normalizeModelBaseUrl(value);
  const url = manifestUrl(baseUrl);
  try {
    const response = await fetchResponse(url, options.signal);
    const declaredLength = response.headers.get("content-length");
    const size = declaredLength === null ? -1 : Number.parseInt(declaredLength, 10);
    let transportBytes;
    if (declaredLength === null) {
      if (response.body === null) {
        throw new Error(`${MODEL_MANIFEST_FILE} has no response body`);
      }
      transportBytes = await readBounded(
        response.body,
        MAX_MANIFEST_BYTES,
        MODEL_MANIFEST_FILE,
        options.signal
      );
    } else {
      if (size <= 0 || !Number.isSafeInteger(size) || size > MAX_MANIFEST_BYTES) {
        throw new RangeError(
          `${MODEL_MANIFEST_FILE} exceeds ${MAX_MANIFEST_BYTES} bytes`
        );
      }
      transportBytes = await responseBytes(
        response,
        size,
        MODEL_MANIFEST_FILE,
        { signal: options.signal }
      );
    }
    const rawBytes = await decompressManifest(
      transportBytes,
      options.signal
    );
    return sourceFromBytes(baseUrl, rawBytes, transportBytes);
  } catch (networkError) {
    throwIfAborted2(options.signal);
    const cached = await cachedSourceForBaseUrl(baseUrl);
    if (cached !== null) return cached;
    throw networkError;
  }
}
function emptyCacheStatus(source, supported) {
  return {
    supported,
    cached: false,
    complete: false,
    cacheName: source.cacheName,
    modelId: source.manifest.model.id,
    revision: source.manifest.model.revision,
    manifestSha256: source.manifestSha256,
    fileCount: Object.keys(source.manifest.files).length,
    cachedFileCount: 0,
    transportSizeBytes: modelTransportSize(source.manifest),
    cachedTransportSizeBytes: 0,
    rawSizeBytes: modelRawSize(source.manifest)
  };
}
async function cachedInventory(cache, source) {
  let cachedFileCount = 0;
  let cachedTransportSizeBytes = 0;
  const descriptions = Object.values(source.manifest.files);
  const inventory = await Promise.all(
    descriptions.map(async (description) => {
      const transportUrl = new URL(
        description.transport.path,
        source.baseUrl
      ).href;
      const response = await cache.match(transportUrl);
      if (response !== void 0) {
        return {
          complete: true,
          sizeBytes: description.transport.size_bytes
        };
      }
      const resumable = await inspectResumableTransportCache(
        cache,
        transportUrl,
        description
      );
      return {
        complete: resumable.complete,
        sizeBytes: resumable.sizeBytes
      };
    })
  );
  for (const entry of inventory) {
    if (entry.complete) cachedFileCount += 1;
    cachedTransportSizeBytes += entry.sizeBytes;
  }
  return { cachedFileCount, cachedTransportSizeBytes };
}
async function inspectModelCache(source) {
  const storage = cacheStorage();
  if (storage === null) return emptyCacheStatus(source, false);
  if (!await storage.has(source.cacheName)) {
    return emptyCacheStatus(source, true);
  }
  const cache = await storage.open(source.cacheName);
  const [inventory, markerResponse, manifestResponse] = await Promise.all([
    cachedInventory(cache, source),
    cache.match(cacheMarkerUrl(source.baseUrl)),
    cache.match(source.manifestUrl)
  ]);
  if (markerResponse === void 0 || manifestResponse === void 0) {
    return {
      ...emptyCacheStatus(source, true),
      cached: true,
      ...inventory
    };
  }
  try {
    if (markerResponse.body === null) {
      throw new Error("Model cache completion marker has no body");
    }
    const marker = decodeJson(
      await readBounded(
        markerResponse.body,
        MAX_CACHE_MARKER_BYTES,
        "model cache completion marker"
      ),
      "model cache completion marker"
    );
    if (!validateMarker2(marker, source)) {
      return {
        ...emptyCacheStatus(source, true),
        cached: true,
        ...inventory
      };
    }
    const cachedManifestTransport = await responseBytes(
      manifestResponse,
      source.manifestTransportBytes.byteLength,
      MODEL_MANIFEST_FILE
    );
    if (await sha256Hex(cachedManifestTransport) !== source.manifestTransportSha256) {
      return {
        ...emptyCacheStatus(source, true),
        cached: true,
        ...inventory
      };
    }
    const cachedManifest = await decompressManifest(
      cachedManifestTransport
    );
    if (cachedManifest.byteLength !== source.manifestBytes.byteLength || await sha256Hex(cachedManifest) !== source.manifestSha256) {
      return {
        ...emptyCacheStatus(source, true),
        cached: true,
        ...inventory
      };
    }
    if (inventory.cachedFileCount !== Object.keys(source.manifest.files).length) {
      return {
        ...emptyCacheStatus(source, true),
        cached: true,
        ...inventory
      };
    }
    return {
      ...emptyCacheStatus(source, true),
      cached: true,
      complete: true,
      ...inventory
    };
  } catch {
    return {
      ...emptyCacheStatus(source, true),
      cached: true,
      ...inventory
    };
  }
}
function cachedResponse2(bytes, mediaType) {
  return new Response(exactArrayBuffer2(bytes), {
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": mediaType
    }
  });
}
async function verifyTransport2(bytes, description, path) {
  if (bytes.byteLength !== description.transport.size_bytes) {
    throw new Error(
      `Compressed size mismatch for ${path}: expected ${description.transport.size_bytes}, got ${bytes.byteLength}`
    );
  }
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== description.transport.sha256) {
    throw new Error(
      `Compressed SHA-256 mismatch for ${path}: expected ${description.transport.sha256}, got ${actualHash}`
    );
  }
}
async function decompressAndVerify(bytes, description, path, signal) {
  throwIfAborted2(signal);
  let raw;
  try {
    raw = await readKnownLength(
      gzipDecompressionStream(bytes, path),
      description.size_bytes,
      path,
      { signal }
    );
  } catch (error) {
    throw new Error(
      `Could not decompress ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const actualHash = await sha256Hex(raw);
  throwIfAborted2(signal);
  if (actualHash !== description.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${path}: expected ${description.sha256}, got ${actualHash}`
    );
  }
  return raw;
}
async function readTransportResponse(response, description, path, signal, onChunk) {
  const bytes = await responseBytes(
    response,
    description.transport.size_bytes,
    `${path} gzip transport`,
    { signal, onChunk }
  );
  await verifyTransport2(bytes, description, path);
  throwIfAborted2(signal);
  return bytes;
}
async function removeOlderSourceCaches(source) {
  const storage = cacheStorage();
  if (storage === null) return;
  const sourceRevisionPrefix = source.cacheName.slice(
    0,
    source.cacheName.length - source.manifestSha256.length
  );
  const removals = [];
  for (const name of await storage.keys()) {
    if (name === source.cacheName || !name.startsWith(sourceRevisionPrefix)) {
      continue;
    }
    removals.push(storage.delete(name));
  }
  await Promise.all(removals);
}
var ModelAssets = class {
  manifest;
  source;
  #cache;
  #memoryTransports;
  #loaded = /* @__PURE__ */ new Map();
  #inFlight = /* @__PURE__ */ new Map();
  #verifiedTransports;
  #signal;
  #onProgress;
  #verifiedRawFiles = /* @__PURE__ */ new Set();
  constructor(source, options = {}) {
    this.source = source;
    this.manifest = source.manifest;
    this.#cache = options.cache ?? null;
    this.#memoryTransports = new Map(options.memoryTransports);
    this.#verifiedTransports = new Set(options.verifiedTransports);
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
  }
  has(path) {
    return Object.hasOwn(this.manifest.files, normalizeModelPath(path));
  }
  async #load(path) {
    throwIfAborted2(this.#signal);
    const description = this.manifest.files[path];
    if (description === void 0) {
      throw new Error(`Model does not contain ${JSON.stringify(path)}`);
    }
    const transportUrl = new URL(
      description.transport.path,
      this.source.baseUrl
    ).href;
    let transport = this.#memoryTransports.get(path);
    let transportVerified = transport !== void 0 && this.#verifiedTransports.has(path);
    if (transport === void 0 && this.#cache !== null) {
      const response = await this.#cache.match(transportUrl);
      if (response === void 0) {
        transport = await readCachedResumableTransport({
          cache: this.#cache,
          transportUrl,
          description,
          signal: this.#signal,
          label: path
        }) ?? void 0;
        transportVerified = transport !== void 0;
      } else {
        if (this.#verifiedTransports.has(path)) {
          transport = await responseBytes(
            response,
            description.transport.size_bytes,
            `${path} gzip transport`,
            { signal: this.#signal }
          );
          transportVerified = true;
        } else {
          transport = await readTransportResponse(
            response,
            description,
            path,
            this.#signal
          );
          transportVerified = true;
        }
      }
    }
    if (transport === void 0) {
      throw new Error(`Model file is unavailable ${JSON.stringify(path)}`);
    }
    if (!transportVerified) {
      await verifyTransport2(transport, description, path);
    }
    const raw = await decompressAndVerify(
      transport,
      description,
      path,
      this.#signal
    );
    this.#verifiedRawFiles.add(path);
    this.#onProgress?.({
      stage: "verifying-model",
      completed: this.#verifiedRawFiles.size,
      total: Object.keys(this.manifest.files).length,
      message: path
    });
    this.#loaded.set(path, raw);
    return raw;
  }
  async read(path) {
    const canonicalPath = normalizeModelPath(path);
    const loaded = this.#loaded.get(canonicalPath);
    if (loaded !== void 0) return loaded;
    const inFlight = this.#inFlight.get(canonicalPath);
    if (inFlight !== void 0) return inFlight;
    const promise = this.#load(canonicalPath).finally(() => {
      this.#inFlight.delete(canonicalPath);
    });
    this.#inFlight.set(canonicalPath, promise);
    return promise;
  }
  /**
   * Drop decompressed and memory-only transport bytes once their consumer has
   * initialized. Persistent Cache Storage data remains available for reloads.
   */
  release(path) {
    const canonicalPath = normalizeModelPath(path);
    this.#loaded.delete(canonicalPath);
    this.#memoryTransports.delete(canonicalPath);
  }
  hasVerifiedAllFiles() {
    return this.#verifiedRawFiles.size === Object.keys(this.manifest.files).length;
  }
};
async function loadModelAssets(baseUrl, onProgress, signal) {
  const source = await fetchModelManifest(baseUrl, { signal });
  throwIfAborted2(signal);
  const status2 = await inspectModelCache(source);
  const storage = cacheStorage();
  if (status2.complete && storage !== null) {
    onProgress?.({
      stage: "downloading-model",
      completed: status2.transportSizeBytes,
      total: status2.transportSizeBytes,
      message: "Cached model"
    });
    return new ModelAssets(source, {
      cache: await storage.open(source.cacheName),
      signal,
      onProgress
    });
  }
  const entries = Object.entries(source.manifest.files);
  const totalBytes = modelTransportSize(source.manifest);
  const memoryTransports = /* @__PURE__ */ new Map();
  let cache = null;
  let completedBytes = 0;
  const verifiedTransports = /* @__PURE__ */ new Set();
  if (storage !== null) {
    cache = await storage.open(source.cacheName);
    await cache.put(
      source.manifestUrl,
      cachedResponse2(
        source.manifestTransportBytes,
        "application/gzip"
      )
    );
  }
  for (const [path, description] of entries) {
    throwIfAborted2(signal);
    const transportUrl = new URL(
      description.transport.path,
      source.baseUrl
    ).href;
    let transport;
    if (cache !== null) {
      const cached = await cache.match(transportUrl);
      if (cached !== void 0) {
        try {
          transport = await readTransportResponse(
            cached,
            description,
            path,
            signal
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          await cache.delete(transportUrl);
        }
      }
    }
    if (transport === void 0) {
      const fileStart = completedBytes;
      const reportFileProgress = (fileBytes) => onProgress?.({
        stage: "downloading-model",
        completed: fileStart + fileBytes,
        total: totalBytes,
        message: path
      });
      if (cache === null) {
        const response = await fetchResponse(transportUrl, signal);
        transport = await readTransportResponse(
          response,
          description,
          path,
          signal,
          reportFileProgress
        );
      } else {
        transport = await loadResumableTransport({
          cache,
          transportUrl,
          description,
          fetchRange: (offset, rangeSignal) => fetchTransportRangeResponse(
            transportUrl,
            offset,
            rangeSignal ?? signal
          ),
          signal,
          onProgress: reportFileProgress,
          label: path
        });
      }
    } else {
      onProgress?.({
        stage: "downloading-model",
        completed: completedBytes + transport.byteLength,
        total: totalBytes,
        message: path
      });
    }
    completedBytes += transport.byteLength;
    verifiedTransports.add(path);
    if (cache === null) {
      memoryTransports.set(path, transport);
    }
  }
  return new ModelAssets(source, {
    cache,
    memoryTransports,
    verifiedTransports,
    signal,
    onProgress
  });
}
async function markModelCacheComplete(assets) {
  const source = assets.source;
  const storage = cacheStorage();
  if (storage === null) return;
  if (!assets.hasVerifiedAllFiles()) {
    throw new Error(
      "Cannot complete model cache before every model file is verified"
    );
  }
  const status2 = await inspectModelCache(source);
  if (status2.complete) return;
  const cache = await storage.open(source.cacheName);
  if (status2.cachedFileCount !== Object.keys(source.manifest.files).length) {
    throw new Error(
      "Cannot complete model cache with missing model transports"
    );
  }
  const marker = new TextEncoder().encode(
    JSON.stringify(markerFor(source))
  );
  await cache.put(
    cacheMarkerUrl(source.baseUrl),
    cachedResponse2(marker, "application/json")
  );
  await removeOlderSourceCaches(source);
}

// src/runtime/progress-coalescer.ts
var DOWNLOAD_PROGRESS_INTERVAL_MS = 100;
function createRuntimeProgressCoalescer(emit, now2 = () => performance.now(), intervalMs = DOWNLOAD_PROGRESS_INTERVAL_MS) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError("Progress interval must be a non-negative number");
  }
  let pendingDownload;
  let lastDownloadEmission;
  const emitPendingDownload = (emittedAt) => {
    if (pendingDownload === void 0) return;
    const progress = pendingDownload;
    pendingDownload = void 0;
    lastDownloadEmission = emittedAt;
    emit(progress);
  };
  return (progress) => {
    const currentTime = now2();
    if (progress.stage !== "downloading-model") {
      emitPendingDownload(currentTime);
      emit(progress);
      return;
    }
    pendingDownload = progress;
    if (lastDownloadEmission === void 0 || currentTime - lastDownloadEmission >= intervalMs) {
      emitPendingDownload(currentTime);
    }
  };
}

// src/runtime/protocol.ts
var WORKER_PROTOCOL_VERSION = 6;
var MAX_WORKER_REQUEST_ID_LENGTH = 256;
var MAX_WORKER_PROMPT_LENGTH = 4096;
var MAX_WORKER_SEED_LENGTH = 512;
var MAX_WORKER_MODEL_BASE_URL_LENGTH = 4096;
var MAX_WORKER_FRAME_COUNT = 1e6;
var MAX_WORKER_HYBRID_DIM = 65536;
var MAX_WORKER_CONTINUATION_VALUES = 1e8;
var MAX_CFG_WEIGHT = 100;
var MAX_DURATION_SECONDS = 3600;
var UINT32_RANGE2 = 4294967296;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value, label, maximumLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${maximumLength} characters`
    );
  }
  return value;
}
function requestId(value) {
  return boundedString(
    value,
    "Worker command requestId",
    MAX_WORKER_REQUEST_ID_LENGTH
  );
}
function seed(value, label) {
  if (typeof value === "string") {
    return boundedString(value, label, MAX_WORKER_SEED_LENGTH);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number or non-empty string`);
  }
  return value;
}
function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}
function boundedInteger(value, label, minimum, maximum = MAX_WORKER_FRAME_COUNT) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer in the range ${minimum}\u2013${maximum}`
    );
  }
  return value;
}
function optionalFrameCount(value, label) {
  return value === void 0 ? void 0 : boundedInteger(value, label, 0);
}
function cfgWeight(value, label) {
  if (value === void 0) {
    return void 0;
  }
  const weight = finiteNumber(value, label);
  if (weight < 0 || weight > MAX_CFG_WEIGHT) {
    throw new RangeError(`${label} must be between 0 and ${MAX_CFG_WEIGHT}`);
  }
  return weight;
}
function initialTranslation(value, label) {
  if (value === void 0) {
    return void 0;
  }
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`${label} must contain exactly three finite numbers`);
  }
  const components = Array.from(value);
  if (components.length !== 3) {
    throw new RangeError(`${label} must contain exactly three finite numbers`);
  }
  return Float32Array.of(
    finiteNumber(components[0], `${label}[0]`),
    finiteNumber(components[1], `${label}[1]`),
    finiteNumber(components[2], `${label}[2]`)
  );
}
function finiteFloat32Array(value, label, maximumLength, allowEmpty = false) {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${label} must be a Float32Array`);
  }
  if (!allowEmpty && value.length === 0 || value.length > maximumLength) {
    throw new RangeError(
      `${label} must contain ${allowEmpty ? "at most" : "1\u2013"} ${maximumLength} values`
    );
  }
  const result = new Float32Array(value);
  for (let index = 0; index < result.length; index += 1) {
    if (!Number.isFinite(result[index])) {
      throw new RangeError(`${label}[${index}] must be finite`);
    }
  }
  return result;
}
function uint32(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= UINT32_RANGE2) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
  return value;
}
function randomState(value) {
  if (!isRecord(value)) {
    throw new TypeError("continuation.random must be an object");
  }
  const spareNormal = value.spareNormal === void 0 ? void 0 : finiteNumber(value.spareNormal, "continuation.random.spareNormal");
  return {
    seed: uint32(value.seed, "continuation.random.seed"),
    state: uint32(value.state, "continuation.random.state"),
    ...spareNormal === void 0 ? {} : { spareNormal }
  };
}
function continuation(value) {
  if (!isRecord(value)) {
    throw new TypeError("restoreContinuation.continuation must be an object");
  }
  const hybridDim = boundedInteger(
    value.hybridDim,
    "continuation.hybridDim",
    1,
    MAX_WORKER_HYBRID_DIM
  );
  const hybridTokens = finiteFloat32Array(
    value.hybridTokens,
    "continuation.hybridTokens",
    MAX_WORKER_CONTINUATION_VALUES,
    true
  );
  if (hybridTokens.length % hybridDim !== 0) {
    throw new RangeError(
      "continuation.hybridTokens length must be divisible by hybridDim"
    );
  }
  const transform = initialTranslation(
    value.initialTranslation,
    "continuation.initialTranslation"
  );
  if (transform === void 0) {
    throw new TypeError(
      "continuation.initialTranslation must contain exactly three finite numbers"
    );
  }
  return {
    frameCount: boundedInteger(
      value.frameCount,
      "continuation.frameCount",
      0
    ),
    hybridTokens,
    hybridDim,
    random: randomState(value.random),
    initialTranslation: [transform[0], transform[1], transform[2]],
    initialHeading: finiteNumber(
      value.initialHeading,
      "continuation.initialHeading"
    )
  };
}
function parseGenerate(value, id) {
  const prompt = boundedString(
    value.prompt,
    "generate.prompt",
    MAX_WORKER_PROMPT_LENGTH
  );
  const parsedSeed = seed(value.seed, "generate.seed");
  const frames = value.durationFrames;
  const seconds = value.durationSeconds;
  if (frames === void 0 === (seconds === void 0)) {
    throw new TypeError(
      "generate requires exactly one of durationFrames or durationSeconds"
    );
  }
  const durationFrames = frames === void 0 ? void 0 : boundedInteger(
    frames,
    "generate.durationFrames",
    1,
    MAX_WORKER_FRAME_COUNT
  );
  let durationSeconds;
  if (seconds !== void 0) {
    durationSeconds = finiteNumber(seconds, "generate.durationSeconds");
    if (durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
      throw new RangeError(
        `generate.durationSeconds must be in the range 0\u2013${MAX_DURATION_SECONDS}`
      );
    }
  }
  let mode;
  if (value.mode !== void 0) {
    if (value.mode !== "replace" && value.mode !== "append" && value.mode !== "branch") {
      throw new TypeError(
        "generate.mode must be 'replace', 'append', or 'branch'"
      );
    }
    mode = value.mode;
  }
  const effectiveMode = mode ?? "replace";
  let branchFrame;
  if (effectiveMode === "branch") {
    branchFrame = boundedInteger(
      value.branchFrame,
      "generate.branchFrame",
      0
    );
  } else if (value.branchFrame !== void 0) {
    throw new TypeError("generate.branchFrame is only valid in branch mode");
  }
  const parsedCfgWeight = cfgWeight(
    value.cfgWeight,
    "generate.cfgWeight"
  );
  const parsedTranslation = initialTranslation(
    value.initialTranslation,
    "generate.initialTranslation"
  );
  const parsedHeading = value.initialHeading === void 0 ? void 0 : finiteNumber(value.initialHeading, "generate.initialHeading");
  if (effectiveMode !== "replace" && (parsedTranslation !== void 0 || parsedHeading !== void 0)) {
    throw new TypeError(
      "generate initial transform is only valid in replace mode"
    );
  }
  return {
    type: "generate",
    requestId: id,
    ...mode === void 0 ? {} : { mode },
    ...branchFrame === void 0 ? {} : { branchFrame },
    prompt,
    seed: parsedSeed,
    ...durationFrames === void 0 ? {} : { durationFrames },
    ...durationSeconds === void 0 ? {} : { durationSeconds },
    ...parsedCfgWeight === void 0 ? {} : { cfgWeight: parsedCfgWeight },
    ...value.historyFrames === void 0 ? {} : {
      historyFrames: optionalFrameCount(
        value.historyFrames,
        "generate.historyFrames"
      )
    },
    ...parsedTranslation === void 0 ? {} : { initialTranslation: parsedTranslation },
    ...parsedHeading === void 0 ? {} : { initialHeading: parsedHeading }
  };
}
function parseWorkerCommand(value) {
  if (!isRecord(value)) {
    throw new TypeError("Worker command must be an object");
  }
  const id = requestId(value.requestId);
  switch (value.type) {
    case "loadModel": {
      const allowedFields = /* @__PURE__ */ new Set(["type", "requestId", "baseUrl"]);
      if (Object.keys(value).some((field) => !allowedFields.has(field))) {
        throw new TypeError(
          "loadModel accepts only type, requestId, and baseUrl."
        );
      }
      const rawBaseUrl = boundedString(
        value.baseUrl,
        "loadModel.baseUrl",
        MAX_WORKER_MODEL_BASE_URL_LENGTH
      );
      return {
        type: "loadModel",
        requestId: id,
        baseUrl: normalizeModelBaseUrl(rawBaseUrl)
      };
    }
    case "generate":
      return parseGenerate(value, id);
    case "resetSession": {
      const parsedTranslation = initialTranslation(
        value.initialTranslation,
        "resetSession.initialTranslation"
      );
      return {
        type: "resetSession",
        requestId: id,
        seed: seed(value.seed, "resetSession.seed"),
        ...parsedTranslation === void 0 ? {} : { initialTranslation: parsedTranslation },
        ...value.initialHeading === void 0 ? {} : {
          initialHeading: finiteNumber(
            value.initialHeading,
            "resetSession.initialHeading"
          )
        }
      };
    }
    case "restoreContinuation":
      return {
        type: "restoreContinuation",
        requestId: id,
        continuation: continuation(value.continuation)
      };
    case "cancel":
      return {
        type: "cancel",
        requestId: id,
        targetRequestId: requestId(value.targetRequestId)
      };
    case "dispose":
      return { type: "dispose", requestId: id };
    case "getStatus":
      return { type: "getStatus", requestId: id };
    case "getWebGpuCapabilities":
      return { type: "getWebGpuCapabilities", requestId: id };
    default:
      throw new TypeError(`Unknown worker command type ${String(value.type)}`);
  }
}
function serializeWorkerError(requestIdValue, error) {
  if (error instanceof Error) {
    return {
      type: "error",
      requestId: requestIdValue,
      error: {
        name: error.name,
        message: error.message,
        ...error.stack === void 0 ? {} : { stack: error.stack }
      }
    };
  }
  return {
    type: "error",
    requestId: requestIdValue,
    error: {
      name: "Error",
      message: String(error)
    }
  };
}

// src/inference.worker.ts
var port = self;
var runtime = null;
var generationSession = null;
var active = null;
function post(event, transfer) {
  port.postMessage(event, transfer);
}
function requestIdFrom(value) {
  if (typeof value === "object" && value !== null && "requestId" in value && typeof value.requestId === "string") {
    return value.requestId;
  }
  return "unknown";
}
function postProgress(requestId2, progress) {
  post({
    type: "progress",
    requestId: requestId2,
    ...progress
  });
}
function isCancellation(error, signal) {
  return signal.aborted || error instanceof RuntimeCancelledError || error instanceof DOMException && error.name === "AbortError";
}
function postCancelled(operation) {
  if (operation.cancelRequestId !== void 0) {
    post({
      type: "cancelled",
      requestId: operation.cancelRequestId,
      targetRequestId: operation.requestId
    });
  }
}
function startOperation(requestId2, kind, task) {
  if (active !== null) {
    post(
      serializeWorkerError(
        requestId2,
        new Error(`Worker is already ${active.kind}`)
      )
    );
    return;
  }
  const controller = new AbortController();
  const operation = {
    requestId: requestId2,
    kind,
    controller,
    promise: Promise.resolve()
  };
  active = operation;
  operation.promise = task(operation).catch((error) => {
    if (isCancellation(error, controller.signal)) {
      postCancelled(operation);
    } else {
      post(serializeWorkerError(requestId2, error));
    }
  }).finally(() => {
    if (active === operation) {
      active = null;
    }
  });
}
function capabilitiesFor(selectedRuntime) {
  const manifest = selectedRuntime.manifest;
  const decoderOutputs = manifest.graphs.decoder.outputs;
  const richMotionOutputs = decoderOutputs.localRotations !== void 0 && decoderOutputs.globalRotations !== void 0 && decoderOutputs.rootPositions !== void 0 && decoderOutputs.footContacts !== void 0 && decoderOutputs.globalRootHeading !== void 0;
  return {
    streamingChunks: true,
    sessionContinuation: true,
    branching: true,
    richMotionOutputs,
    // The UI applies a deterministic browser-native correction pass after
    // each completed decode request. This is distinct from ARDY's optional native C++
    // correction library, which is intentionally not embedded in the model files.
    motionCorrection: true
  };
}
function translationTuple(value) {
  return value === void 0 ? void 0 : [value[0], value[1], value[2]];
}
function cloneContinuation(state) {
  return {
    frameCount: state.frameCount,
    hybridTokens: new Float32Array(state.hybridTokens),
    hybridDim: state.hybridDim,
    random: { ...state.random },
    initialTranslation: [...state.initialTranslation],
    initialHeading: state.initialHeading
  };
}
function cloneChunk(chunk) {
  return {
    ...chunk,
    motion: new Float32Array(chunk.motion),
    joints: new Float32Array(chunk.joints),
    hybridTokens: new Float32Array(chunk.hybridTokens),
    ...chunk.localRotations === void 0 ? {} : { localRotations: new Float32Array(chunk.localRotations) },
    ...chunk.globalRotations === void 0 ? {} : { globalRotations: new Float32Array(chunk.globalRotations) },
    ...chunk.rootPositions === void 0 ? {} : { rootPositions: new Float32Array(chunk.rootPositions) },
    ...chunk.footContacts === void 0 ? {} : { footContacts: new Uint8Array(chunk.footContacts) },
    ...chunk.globalRootHeading === void 0 ? {} : { globalRootHeading: new Float32Array(chunk.globalRootHeading) },
    timingsMs: { ...chunk.timingsMs }
  };
}
function cloneResult(result) {
  return {
    ...result,
    motion: new Float32Array(result.motion),
    joints: new Float32Array(result.joints),
    continuation: cloneContinuation(result.continuation),
    ...result.localRotations === void 0 ? {} : { localRotations: new Float32Array(result.localRotations) },
    ...result.globalRotations === void 0 ? {} : { globalRotations: new Float32Array(result.globalRotations) },
    ...result.rootPositions === void 0 ? {} : { rootPositions: new Float32Array(result.rootPositions) },
    ...result.footContacts === void 0 ? {} : { footContacts: new Uint8Array(result.footContacts) },
    ...result.globalRootHeading === void 0 ? {} : { globalRootHeading: new Float32Array(result.globalRootHeading) },
    timingsMs: { ...result.timingsMs }
  };
}
function motionTransfers(payload) {
  const buffers = /* @__PURE__ */ new Set();
  const add = (value) => {
    if (value !== void 0) {
      buffers.add(value.buffer);
    }
  };
  add(payload.motion);
  add(payload.joints);
  add(payload.localRotations);
  add(payload.globalRotations);
  add(payload.rootPositions);
  add(payload.footContacts);
  add(payload.globalRootHeading);
  if ("hybridTokens" in payload) {
    add(payload.hybridTokens);
  }
  if ("continuation" in payload) {
    add(payload.continuation.hybridTokens);
  }
  return [...buffers];
}
function load(command) {
  startOperation(command.requestId, "loading", async (operation) => {
    await assertWebGpuAvailable();
    const reportProgress = createRuntimeProgressCoalescer(
      (progress) => postProgress(command.requestId, progress)
    );
    const assets = await loadModelAssets(
      command.baseUrl,
      reportProgress,
      operation.controller.signal
    );
    if (runtime !== null) {
      await runtime.dispose();
      runtime = null;
      generationSession = null;
    }
    const loaded = await BrowserArdyRuntime.create(assets, {
      signal: operation.controller.signal,
      onProgress: reportProgress
    });
    try {
      if (operation.controller.signal.aborted) {
        throw new RuntimeCancelledError();
      }
      await markModelCacheComplete(assets);
      if (operation.controller.signal.aborted) {
        throw new RuntimeCancelledError();
      }
    } catch (error) {
      await loaded.dispose();
      throw error;
    }
    runtime = loaded;
    const capabilities = capabilitiesFor(loaded);
    post({
      type: "modelLoaded",
      requestId: command.requestId,
      model: {
        id: loaded.manifest.model.id,
        variant: loaded.manifest.model.variant,
        revision: loaded.manifest.model.revision,
        fps: loaded.manifest.dimensions.fps,
        minFrames: loaded.manifest.generation.min_frames,
        maxFrames: loaded.manifest.generation.max_frames,
        generationFrames: loaded.manifest.dimensions.generation_frames,
        capabilities,
        manifest: loaded.manifest
      }
    });
  });
}
function frameCountFor(selectedRuntime, command) {
  return command.durationFrames ?? Math.round(
    command.durationSeconds * selectedRuntime.manifest.dimensions.fps
  );
}
function prepareGenerationSession(selectedRuntime, command, mode) {
  if (mode === "replace") {
    const options = {
      seed: command.seed,
      initialTranslation: translationTuple(command.initialTranslation),
      initialHeading: command.initialHeading
    };
    if (generationSession === null) {
      generationSession = selectedRuntime.createGenerationSession(options);
    } else {
      generationSession.reset(options);
    }
    return generationSession;
  }
  if (generationSession === null) {
    throw new Error(
      `${mode} generation requires an existing or restored session`
    );
  }
  if (mode === "branch") {
    generationSession.branch(command.branchFrame);
  }
  return generationSession;
}
function generate(command) {
  if (runtime === null) {
    post(
      serializeWorkerError(
        command.requestId,
        new Error("Load the model before generating motion")
      )
    );
    return;
  }
  const selectedRuntime = runtime;
  startOperation(command.requestId, "generating", async (operation) => {
    const mode = command.mode ?? "replace";
    const session = prepareGenerationSession(selectedRuntime, command, mode);
    const result = await session.generate({
      prompt: command.prompt,
      durationFrames: frameCountFor(selectedRuntime, command),
      cfgWeight: command.cfgWeight,
      historyFrames: command.historyFrames,
      signal: operation.controller.signal,
      onProgress: (progress) => postProgress(command.requestId, progress),
      onChunk: (chunk) => {
        const snapshot = cloneChunk(chunk);
        post(
          {
            type: "generationChunk",
            requestId: command.requestId,
            mode,
            chunk: snapshot
          },
          motionTransfers(snapshot)
        );
      }
    });
    const completionResult = command.mode === void 0 ? cloneResult(result) : result;
    post(
      {
        type: "generationComplete",
        requestId: command.requestId,
        mode,
        generatedFrameCount: result.frameCount,
        sessionFrameCount: session.frameCount,
        result: completionResult
      },
      motionTransfers(completionResult)
    );
    if (command.mode === void 0) {
      post(
        {
          type: "generationResult",
          requestId: command.requestId,
          result
        },
        motionTransfers(result)
      );
    }
  });
}
function resetSession(command) {
  if (active !== null) {
    throw new Error(`Worker is already ${active.kind}`);
  }
  if (runtime === null) {
    throw new Error("Load the model before resetting the generation session");
  }
  const options = {
    seed: command.seed,
    initialTranslation: translationTuple(command.initialTranslation),
    initialHeading: command.initialHeading
  };
  if (generationSession === null) {
    generationSession = runtime.createGenerationSession(options);
  } else {
    generationSession.reset(options);
  }
  post({
    type: "sessionReset",
    requestId: command.requestId,
    seed: generationSession.seed,
    frameCount: 0
  });
}
function restoreContinuation(command) {
  if (active !== null) {
    throw new Error(`Worker is already ${active.kind}`);
  }
  if (runtime === null) {
    throw new Error("Load the model before restoring a continuation");
  }
  if (generationSession === null) {
    generationSession = runtime.createGenerationSession({
      seed: command.continuation.random.seed,
      initialTranslation: command.continuation.initialTranslation,
      initialHeading: command.continuation.initialHeading
    });
  }
  generationSession.restore(command.continuation);
  post({
    type: "continuationRestored",
    requestId: command.requestId,
    frameCount: generationSession.frameCount
  });
}
function cancel(command) {
  if (active?.requestId === command.targetRequestId) {
    active.cancelRequestId = command.requestId;
    active.controller.abort(new RuntimeCancelledError());
    return;
  }
  post({
    type: "cancelled",
    requestId: command.requestId,
    targetRequestId: command.targetRequestId
  });
}
async function dispose(command) {
  const current = active;
  if (current !== null) {
    current.controller.abort(new RuntimeCancelledError("Runtime disposed"));
    await current.promise;
  }
  generationSession = null;
  if (runtime !== null) {
    await runtime.dispose();
    runtime = null;
  }
  post({ type: "disposed", requestId: command.requestId });
}
function status(command) {
  if (active?.kind === "loading") {
    post({
      type: "status",
      requestId: command.requestId,
      status: { state: "loading", activeRequestId: active.requestId }
    });
  } else if (runtime === null) {
    post({
      type: "status",
      requestId: command.requestId,
      status: { state: "empty" }
    });
  } else {
    post({
      type: "status",
      requestId: command.requestId,
      status: {
        state: active?.kind === "generating" ? "generating" : "ready",
        ...active === null ? {} : { activeRequestId: active.requestId },
        modelId: runtime.manifest.model.id,
        generatedFrameCount: generationSession?.frameCount ?? 0,
        capabilities: capabilitiesFor(runtime)
      }
    });
  }
}
async function webGpuCapabilities(command) {
  try {
    const capabilities = await getWebGpuCapabilities();
    post({
      type: "webGpuCapabilities",
      requestId: command.requestId,
      shaderF16: capabilities.shaderF16
    });
  } catch (error) {
    post(serializeWorkerError(command.requestId, error));
  }
}
function runSynchronous(requestId2, task) {
  try {
    task();
  } catch (error) {
    post(serializeWorkerError(requestId2, error));
  }
}
port.addEventListener("message", (message) => {
  let command;
  try {
    command = parseWorkerCommand(message.data);
  } catch (error) {
    post(serializeWorkerError(requestIdFrom(message.data), error));
    return;
  }
  switch (command.type) {
    case "loadModel":
      load(command);
      break;
    case "generate":
      generate(command);
      break;
    case "resetSession":
      runSynchronous(command.requestId, () => resetSession(command));
      break;
    case "restoreContinuation":
      runSynchronous(
        command.requestId,
        () => restoreContinuation(command)
      );
      break;
    case "cancel":
      cancel(command);
      break;
    case "dispose":
      void dispose(command).catch(
        (error) => post(serializeWorkerError(command.requestId, error))
      );
      break;
    case "getStatus":
      status(command);
      break;
    case "getWebGpuCapabilities":
      void webGpuCapabilities(command);
      break;
  }
});
post({
  type: "workerReady",
  protocolVersion: WORKER_PROTOCOL_VERSION
});
/*! Bundled license information:

onnxruntime-web/dist/ort.webgpu.bundle.min.mjs:
  (*!
   * ONNX Runtime Web v1.27.0
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Licensed under the MIT License.
   *)
*/
