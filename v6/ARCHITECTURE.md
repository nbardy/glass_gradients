# WebGPU Glass Gradients Architecture

Yes. The fastest **WebGPU** version is **not** a straight Shadertoy port. The right split is:

* **advanced atmosphere** as **precomputed / low-rate compute**
* **advanced glass** as **precomputed transport + full-rate composite**
* **final presentation** as a tiny fullscreen render pass, not compute-direct-to-canvas by default

That lines up with WebGPU's strengths: compute pipelines, storage textures, optional `shader-f16`, `subgroups`, and `timestamp-query`, with feature selection done through `GPUAdapter.features` and `requestDevice({ requiredFeatures })`. It also avoids awkward canvas-path portability issues like `bgra8unorm-storage`, while letting you keep the canvas on the preferred display format to avoid extra overhead. ([MDN Web Docs][1])

For the atmosphere side, Bruneton is still the right "serious PBR" anchor: his newer implementation adds ozone and custom density profiles, and explicitly supports a precompute path that gives results "almost the same" as full spectral rendering at a fraction of the cost. That is exactly the kind of trade you want on the **background radiance** side. ([Ebruneton][2])

## The WebGPU architecture I'd actually ship

```text
Init / resize / glass param change
    1. atmosphere LUT precompute        (compute, dirty only)
    2. sky-view + clouds panorama       (compute, dirty or low-rate)
    3. sky mip pyramid                  (compute)
    4. glass transport precompute       (compute, dirty only)

Per frame
    5. composite into HDR offscreen     (compute)
    6. tone map + present               (tiny render pass)
```

The key speed trick is this:

**Do not solve the slab every frame.**
Solve the glass once into **transport maps**:

* mean shift `μ`
* path length `ℓ`
* Fresnel `F`
* TIR propensity `t`
* ellipse orientation `axis`
* ellipse widths `σmajor, σminor`
* halo weight `wh`

Then the runtime pass is just:

[
O_c(\mathbf{u}) =
F_c R_c + (1-F_c),e^{-\sigma_{a,c}\ell(\mathbf{u})}
\int K_{\mathbf{u},c}(\Delta),B_c(\mathbf{u}+\Delta),d\Delta
]

where the expensive atmosphere has already become a mipmapped HDR sky/background map (B).

---

## Why this is fast

The slow things are:

1. **Atmosphere / cloud scattering**
2. **Solving refractive transport through the slab**
3. **Wide filtered background lookups**
4. **Memory bandwidth**
5. **JS / main-thread submission overhead**

The fixes are:

* precompute atmosphere LUTs and sky-view maps
* precompute glass transport maps
* use an HDR mip pyramid for filtered background access
* keep hot data in `f16` / packed formats where possible
* run orchestration in a Worker with `OffscreenCanvas`
* use `timestamp-query`, not vibes, for profiling

WebGPU compute workgroups share `workgroup` memory, but barriers have uniformity requirements and you have to avoid data races; that matters for your blur, mip, and reduction passes. Also, read-only / read-write storage textures require the WGSL `readonly_and_readwrite_storage_textures` extension, so for portability I would default to **ping-pong textures** instead of in-place read/write. WGSL also exposes packing builtins like `pack2x16float` and `pack4x8unorm`, which are perfect for transport-map compression. ([gpuweb.github.io][3])

---

## Pass graph and data layout

### Atmosphere data

Use Bruneton-style LUTs:

* `transmittanceLUT`
* `multiScatterLUT`
* `skyViewHDR`
* `skyViewMipChain`

### Glass data

Use a static or dirty-on-change precompute:

* `transport0`: `shift.xy, pathLen, fresnel`
* `transport1`: `axis.xy, sigmaMajor, sigmaMinor`
* `transport2`: `tir, haloWeight, roughness, spare`

### Frame data

Per frame:

* `hdrComposite`
* `canvasPresent`

If `texture-formats-tier1` is available, you can shrink some transport textures to `rg16float` / `r16float`; otherwise `rgba16float` is the safe, simple core path. Optional features like `shader-f16`, `subgroups`, `timestamp-query`, `texture-formats-tier1/2`, and `bgra8unorm-storage` must be probed on the adapter and explicitly requested on device creation. ([MDN Web Docs][4])

---

## Host-side WebGPU skeleton

```ts
// webgpu-renderer.ts
type Feature = GPUFeatureName;

const OPTIONAL_FEATURES: Feature[] = [
  "shader-f16",
  "subgroups",
  "timestamp-query",
  "bgra8unorm-storage",
  "texture-formats-tier1",
  "texture-formats-tier2",
];

type Renderer = ReturnType<typeof createRenderer>;

export async function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if (!navigator.gpu) throw new Error("WebGPU unavailable");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");

  const requiredFeatures = OPTIONAL_FEATURES.filter(f => adapter.features.has(f));

  const device = await adapter.requestDevice({
    requiredFeatures,
  });

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "opaque",
    colorSpace: "display-p3",
    toneMapping: { mode: "standard" }, // switch to "extended" for HDR-capable displays
  });

  const size = getCanvasSize(canvas);

  // ---- resources ----------------------------------------------------------

  const texUsageSampledStorage =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.COPY_DST;

  const texUsageSampledRender =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.RENDER_ATTACHMENT |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.COPY_DST;

  const transmittanceLUT = device.createTexture({
    size: [256, 64],
    format: "rgba16float",
    usage: texUsageSampledStorage,
  });

  const multiScatterLUT = device.createTexture({
    size: [64, 64],
    format: "rgba16float",
    usage: texUsageSampledStorage,
  });

  const skyViewHDR = device.createTexture({
    size: [1024, 512],
    format: "rgba16float",
    mipLevelCount: 11,
    usage: texUsageSampledStorage | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const transport0 = device.createTexture({
    size: [size.width, size.height],
    format: "rgba16float",
    usage: texUsageSampledStorage,
  });

  const transport1 = device.createTexture({
    size: [size.width, size.height],
    format: "rgba16float",
    usage: texUsageSampledStorage,
  });

  const transport2 = device.createTexture({
    size: [size.width, size.height],
    format: "rgba16float",
    usage: texUsageSampledStorage,
  });

  const hdrComposite = device.createTexture({
    size: [size.width, size.height],
    format: "rgba16float",
    usage: texUsageSampledStorage | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const nearestSampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
  });

  // Uniforms
  const atmosphereUBO = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const glassUBO = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const frameUBO = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Optional profiling
  const hasTimestamp = device.features.has("timestamp-query");
  const querySet = hasTimestamp
    ? device.createQuerySet({ type: "timestamp", count: 16 })
    : null;

  const queryResolve = hasTimestamp
    ? device.createBuffer({
        size: 16 * 8,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
    : null;

  // ---- shader modules -----------------------------------------------------

  const atmosphereModule = device.createShaderModule({
    label: "skyview.wgsl",
    code: SKYVIEW_WGSL,
  });

  const glassModule = device.createShaderModule({
    label: "glass-precompute.wgsl",
    code: GLASS_PRECOMPUTE_WGSL,
  });

  const compositeModule = device.createShaderModule({
    label: "composite.wgsl",
    code: COMPOSITE_WGSL,
  });

  const presentModule = device.createShaderModule({
    label: "present.wgsl",
    code: PRESENT_WGSL,
  });

  // ---- pipelines ----------------------------------------------------------

  const skyViewPipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: atmosphereModule, entryPoint: "main" },
  });

  const glassPrecomputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: glassModule, entryPoint: "main" },
  });

  const compositePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: compositeModule, entryPoint: "main" },
  });

  const presentPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: presentModule, entryPoint: "vsMain" },
    fragment: {
      module: presentModule,
      entryPoint: "fsMain",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  // ---- bind groups --------------------------------------------------------

  const skyViewBG = device.createBindGroup({
    layout: skyViewPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: transmittanceLUT.createView() },
      { binding: 2, resource: multiScatterLUT.createView() },
      { binding: 3, resource: skyViewHDR.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      { binding: 4, resource: { buffer: atmosphereUBO } },
    ],
  });

  const glassBG = device.createBindGroup({
    layout: glassPrecomputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: transport0.createView() },
      { binding: 1, resource: transport1.createView() },
      { binding: 2, resource: transport2.createView() },
      { binding: 3, resource: { buffer: glassUBO } },
    ],
  });

  const compositeBG = device.createBindGroup({
    layout: compositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: skyViewHDR.createView() },
      { binding: 2, resource: transport0.createView() },
      { binding: 3, resource: transport1.createView() },
      { binding: 4, resource: transport2.createView() },
      { binding: 5, resource: hdrComposite.createView() },
      { binding: 6, resource: { buffer: frameUBO } },
    ],
  });

  const presentBG = device.createBindGroup({
    layout: presentPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: hdrComposite.createView() },
    ],
  });

  // ---- dirty flags --------------------------------------------------------

  let skyDirty = true;
  let glassDirty = true;
  let frameIndex = 0;

  function markSkyDirty() { skyDirty = true; }
  function markGlassDirty() { glassDirty = true; }

  function resize(width: number, height: number) {
    // Recreate size-dependent textures; omitted for brevity.
    markGlassDirty();
  }

  function frame() {
    const encoder = device.createCommandEncoder({ label: "frame-encoder" });

    if (skyDirty) {
      const pass = encoder.beginComputePass(
        hasTimestamp ? {
          timestampWrites: {
            querySet: querySet!,
            beginningOfPassWriteIndex: 0,
            endOfPassWriteIndex: 1,
          },
        } : undefined
      );
      pass.pushDebugGroup("sky-view");
      pass.setPipeline(skyViewPipeline);
      pass.setBindGroup(0, skyViewBG);
      pass.dispatchWorkgroups(Math.ceil(1024 / 8), Math.ceil(512 / 8));
      pass.popDebugGroup();
      pass.end();

      // Mip chain generation pass would go here.
      skyDirty = false;
    }

    if (glassDirty) {
      const pass = encoder.beginComputePass(
        hasTimestamp ? {
          timestampWrites: {
            querySet: querySet!,
            beginningOfPassWriteIndex: 2,
            endOfPassWriteIndex: 3,
          },
        } : undefined
      );
      pass.pushDebugGroup("glass-precompute");
      pass.setPipeline(glassPrecomputePipeline);
      pass.setBindGroup(0, glassBG);
      pass.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8));
      pass.popDebugGroup();
      pass.end();

      glassDirty = false;
    }

    {
      const pass = encoder.beginComputePass(
        hasTimestamp ? {
          timestampWrites: {
            querySet: querySet!,
            beginningOfPassWriteIndex: 4,
            endOfPassWriteIndex: 5,
          },
        } : undefined
      );
      pass.pushDebugGroup("composite");
      pass.setPipeline(compositePipeline);
      pass.setBindGroup(0, compositeBG);
      pass.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8));
      pass.popDebugGroup();
      pass.end();
    }

    {
      const colorView = context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(presentPipeline);
      pass.setBindGroup(0, presentBG);
      pass.draw(3, 1, 0, 0);
      pass.end();
    }

    if (hasTimestamp) {
      encoder.resolveQuerySet(querySet!, 0, 6, queryResolve!, 0);
    }

    device.queue.submit([encoder.finish()]);
    frameIndex++;
  }

  return {
    device,
    context,
    frame,
    resize,
    markSkyDirty,
    markGlassDirty,
  };
}

function getCanvasSize(canvas: HTMLCanvasElement | OffscreenCanvas) {
  return { width: canvas.width, height: canvas.height };
}
```

Use `createComputePipelineAsync()` at startup, not synchronous pipeline creation on the hot path. Offload all of this to a Worker if possible; WebGPU contexts on `OffscreenCanvas` and WebGPU methods like `requestDevice()` / canvas context access are available in workers, which is exactly what you want to keep the main thread free. Timestamp queries are optional and feature-gated. ([MDN Web Docs][5])

---

## `skyview.wgsl`

This is where the **advanced atmosphere** lives. In practice, I would port Bruneton's published LUT samplers into `evalBrunetonSky()` and keep clouds / skyline / horizon in this pass.

```wgsl
// skyview.wgsl
alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct AtmosphereParams {
  sunDir      : vec4f,
  skySize     : vec2<u32>,
  time        : f32,
  horizonLift : f32,
  cloudCovA   : f32,
  cloudCovB   : f32,
  cloudSpeedA : vec2f,
  cloudSpeedB : vec2f,
  citySeed    : f32,
  pad0        : f32,
};

@group(0) @binding(0) var linearSampler : sampler;
@group(0) @binding(1) var transmittanceLUT : texture_2d<f32>;
@group(0) @binding(2) var multiScatterLUT : texture_2d<f32>;
@group(0) @binding(3) var outSky : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> P : AtmosphereParams;

fn hash12(p: vec2f) -> f32 {
  let q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  let d = dot(q, q.yzx + 33.33);
  return fract((q.x + q.y + d) * q.z);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash12(i + vec2f(0.0, 0.0));
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = mat2x2<f32>(0.82, -0.57, 0.57, 0.82) * p * 2.03 + 7.13;
    a *= 0.5;
  }
  return v;
}

fn dirFromSkyUV(uv: vec2f) -> vec3f {
  let phi = (uv.x * 2.0 - 1.0) * 3.14159265;
  let y   = 1.0 - uv.y * 2.0;
  let r   = sqrt(max(1.0 - y * y, 0.0));
  return normalize(vec3f(sin(phi) * r, y, cos(phi) * r));
}

fn skylineHeight(phi: f32, seed: f32) -> f32 {
  let seg = floor((phi + 3.14159265) * 18.0 + seed * 13.0);
  let h0 = 0.015 + 0.090 * hash12(vec2f(seg, 17.0));
  let h1 = 0.030 * hash12(vec2f(seg * 1.31, 9.0));
  return floor((h0 + h1) * 12.0) / 12.0 - 0.01;
}

// Slot Bruneton LUT samplers in here.
// This function should sample transmittance + multi-scattering LUTs and return HDR sky radiance.
fn evalBrunetonSky(rd: vec3f, sunDir: vec3f) -> vec3f {
  // Placeholder shape: port Bruneton's LUT sampling helpers here.
  let mu = clamp(dot(rd, sunDir), -1.0, 1.0);
  let uv = vec2f(0.5 + 0.5 * mu, clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  let T  = textureSampleLevel(transmittanceLUT, linearSampler, uv, 0.0).rgb;
  let M  = textureSampleLevel(multiScatterLUT, linearSampler, uv, 0.0).rgb;
  return T + M;
}

fn sunDisk(rd: vec3f, sunDir: vec3f) -> vec3f {
  let mu = dot(rd, sunDir);
  let core = smoothstep(cos(0.010), cos(0.0048), mu);
  let glow = exp(-70.0 * (1.0 - mu));
  return vec3f(18.0, 14.0, 9.0) * (5.0 * core + 0.05 * glow);
}

fn cloudMask(rd: vec3f) -> f32 {
  let phi = atan2(rd.x, rd.z) / (2.0 * 3.14159265) + 0.5;
  let v   = acos(clamp(rd.y, -1.0, 1.0)) / 3.14159265;

  let pA = vec2f(phi * 1.6, v * 2.4) + P.cloudSpeedA * P.time * 0.01;
  let pB = vec2f(phi * 2.8, v * 3.6) + P.cloudSpeedB * P.time * 0.01;

  let a = smoothstep(P.cloudCovA, P.cloudCovA + 0.12, fbm(pA));
  let b = smoothstep(P.cloudCovB, P.cloudCovB + 0.10, fbm(pB + 11.7));
  return clamp(0.65 * a + 0.35 * b, 0.0, 1.0);
}

fn cityShade(rd: vec3f, sunDir: vec3f) -> vec3f {
  let az = atan2(rd.x, rd.z);
  let saz = atan2(sunDir.x, sunDir.z);
  let facing = 0.5 + 0.5 * cos(az - saz);
  let rim = pow(facing, 4.0) * smoothstep(-0.08, 0.10, sunDir.y + 0.02);
  return vec3f(0.03, 0.035, 0.045) + vec3f(0.12, 0.07, 0.04) * rim;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.skySize.x || gid.y >= P.skySize.y) { return; }

  let uv = (vec2f(vec2<u32>(gid.xy)) + 0.5) / vec2f(P.skySize);
  let rd = dirFromSkyUV(uv);
  let sunDir = normalize(P.sunDir.xyz);

  let phi  = atan2(rd.x, rd.z);
  let elev = asin(clamp(rd.y, -1.0, 1.0));
  let hSky = skylineHeight(phi, P.citySeed) + P.horizonLift;

  var L = vec3f(0.0);

  if (elev < hSky) {
    L = cityShade(rd, sunDir);
  } else {
    let sky = evalBrunetonSky(rd, sunDir);
    let c   = cloudMask(rd);
    let mu  = dot(rd, sunDir);

    let cloudGlow = c * vec3f(0.22, 0.11, 0.06) * exp(-8.0 * (1.0 - mu));
    let cloudOccl = mix(1.0, 0.35, c);

    L = sky * cloudOccl + cloudGlow + sunDisk(rd, sunDir) * mix(1.0, 0.55, c);
  }

  textureStore(outSky, vec2<i32>(gid.xy), vec4f(L, 1.0));
}
```

This pass is where you keep the **good sunsets**. The reason it's still fast is that it runs in **sky space**, not full screen, and it can be updated only when the sun/weather changes meaningfully. Bruneton's own implementation is already organized around precomputed atmosphere textures and GPU shader code, which is exactly why it ports well into this slot. ([Ebruneton][2])

---

## `glass-precompute.wgsl`

This is the heart of the fast version. It does the optics once, not every frame.

```wgsl
// glass-precompute.wgsl
alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct GlassParams {
  outSize      : vec2<u32>,
  invOutSize   : vec2f,
  aspect       : f32,
  cameraDist   : f32,
  thickness    : f32,
  frontLfAmp   : f32,
  frontHfAmp   : f32,
  backLfAmp    : f32,
  backHfAmp    : f32,
  etaGlass     : f32,
  pad0         : vec3f,
};

@group(0) @binding(0) var outTransport0 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var outTransport1 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var outTransport2 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> P : GlassParams;

fn hash12(p: vec2f) -> f32 {
  let q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  let d = dot(q, q.yzx + 33.33);
  return fract((q.x + q.y + d) * q.z);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i + vec2f(0.0, 0.0));
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(mut p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = mat2x2<f32>(0.82, -0.57, 0.57, 0.82) * p * 2.03 + 7.13;
    a *= 0.5;
  }
  return v;
}

fn voronoiF1(x: vec2f) -> f32 {
  let n = floor(x);
  let f = fract(x);
  var md = 1e9;

  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = vec2f(hash12(n + g), hash12(n + g + 17.0));
      let r = g + o - f;
      md = min(md, dot(r, r));
    }
  }
  return sqrt(md);
}

fn pebbleMaster(u: vec2f) -> f32 {
  let d1 = voronoiF1(u * 2.40);
  let d2 = voronoiF1(u * 4.10 + vec2f(4.1, -1.7));

  let a = exp(-7.0 * d1 * d1);
  let b = exp(-8.5 * d2 * d2);
  let h = 0.75 * a + 0.30 * b + 0.18 * fbm(u * 3.0 + 1.3);

  return smoothstep(0.18, 1.00, h);
}

fn frontLF(u: vec2f) -> f32 {
  let h = pebbleMaster(u * 1.05 + vec2f(0.03, -0.01));
  return P.frontLfAmp * (h - 0.50);
}

fn frontHF(u: vec2f) -> f32 {
  let h = 0.60 * (fbm(u * 18.0 + 3.7) - 0.5) +
          0.40 * (fbm(u * 34.0 - 8.2) - 0.5);
  return P.frontHfAmp * h;
}

fn backLF(u: vec2f) -> f32 {
  let h = pebbleMaster(u * 1.02 + vec2f(-0.018, 0.027));
  let c = frontLF(u * 0.99 + vec2f(0.01, -0.01)) / max(P.frontLfAmp, 1e-5);
  let mixh = mix(h - 0.5, c, 0.70);
  return P.thickness + P.backLfAmp * mixh;
}

fn backHF(u: vec2f) -> f32 {
  let h = 0.70 * (fbm(u * 16.0 + 14.3) - 0.5) +
          0.30 * (fbm(u * 28.0 +  2.1) - 0.5);
  return P.backHfAmp * h;
}

fn gradFrontLF(u: vec2f) -> vec2f {
  let e = 0.0025;
  return vec2f(
    frontLF(u + vec2f(e, 0.0)) - frontLF(u - vec2f(e, 0.0)),
    frontLF(u + vec2f(0.0, e)) - frontLF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradBackLF(u: vec2f) -> vec2f {
  let e = 0.0025;
  return vec2f(
    backLF(u + vec2f(e, 0.0)) - backLF(u - vec2f(e, 0.0)),
    backLF(u + vec2f(0.0, e)) - backLF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradFrontHF(u: vec2f) -> vec2f {
  let e = 0.0015;
  return vec2f(
    frontHF(u + vec2f(e, 0.0)) - frontHF(u - vec2f(e, 0.0)),
    frontHF(u + vec2f(0.0, e)) - frontHF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn gradBackHF(u: vec2f) -> vec2f {
  let e = 0.0015;
  return vec2f(
    backHF(u + vec2f(e, 0.0)) - backHF(u - vec2f(e, 0.0)),
    backHF(u + vec2f(0.0, e)) - backHF(u - vec2f(0.0, e))
  ) / (2.0 * e);
}

fn normalFromGrad(g: vec2f) -> vec3f {
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

fn fresnelDielectric(cosi: f32, etaI: f32, etaT: f32) -> f32 {
  let e = etaI / etaT;
  let sint2 = e * e * max(0.0, 1.0 - cosi * cosi);
  if (sint2 >= 1.0) { return 1.0; }
  let cost = sqrt(max(0.0, 1.0 - sint2));
  let Rs = (etaI * cosi - etaT * cost) / (etaI * cosi + etaT * cost);
  let Rp = (etaT * cosi - etaI * cost) / (etaT * cosi + etaI * cost);
  return 0.5 * (Rs * Rs + Rp * Rp);
}

fn refractDielectric(I: vec3f, Nin: vec3f, etaI: f32, etaT: f32) -> vec4f {
  var N = Nin;
  var cosi = dot(-I, N);
  if (cosi < 0.0) {
    N = -N;
    cosi = -cosi;
  }

  let F = fresnelDielectric(clamp(cosi, 0.0, 1.0), etaI, etaT);
  let eta = etaI / etaT;
  let k = 1.0 - eta * eta * (1.0 - cosi * cosi);

  if (k < 0.0) {
    return vec4f(0.0, 0.0, 0.0, -1.0); // TIR
  }

  let T = normalize(eta * I + (eta * cosi - sqrt(k)) * N);
  return vec4f(T, F);
}

fn surfaceZ(backSide: bool, xy: vec2f) -> f32 {
  return select(frontLF(xy), backLF(xy), backSide);
}

fn surfaceEval(backSide: bool, ro: vec3f, rd: vec3f, t: f32) -> f32 {
  let p = ro + rd * t;
  return p.z - surfaceZ(backSide, p.xy);
}

fn solveSurface(backSide: bool, ro: vec3f, rd: vec3f, tMaxInit: f32) -> vec2f {
  var a = 1e-4;
  var b = max(tMaxInit, 0.02);
  var fa = surfaceEval(backSide, ro, rd, a);
  var fb = surfaceEval(backSide, ro, rd, b);

  for (var i = 0; i < 6; i++) {
    if (fa * fb <= 0.0) { break; }
    b *= 1.6;
    fb = surfaceEval(backSide, ro, rd, b);
  }

  if (fa * fb > 0.0) {
    return vec2f(-1.0, 0.0);
  }

  for (var i = 0; i < 10; i++) {
    var m = 0.5 * (a + b);
    let denom = fb - fa;
    if (abs(denom) > 1e-7) {
      m = clamp((a * fb - b * fa) / denom, a + 1e-4, b - 1e-4);
    }
    let fm = surfaceEval(backSide, ro, rd, m);
    if (fa * fm <= 0.0) {
      b = m;
      fb = fm;
    } else {
      a = m;
      fa = fm;
    }
  }

  return vec2f(0.5 * (a + b), 1.0);
}

fn buildEllipse(u: vec2f) -> vec4f {
  let gf = gradFrontHF(u);
  let gb = gradBackHF(u);
  let rough = sqrt(dot(gf, gf) + dot(gb, gb));

  let axis = normalize(select(vec2f(1.0, 0.0), gf, dot(gf, gf) > 1e-8));
  let sigmaMajor = 0.006 + 0.05 * rough;
  let sigmaMinor = 0.004 + 0.02 * rough;

  return vec4f(axis, sigmaMajor, sigmaMinor);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.outSize.x || gid.y >= P.outSize.y) { return; }

  let pix = vec2f(vec2<u32>(gid.xy)) + 0.5;
  var u = pix * P.invOutSize * 2.0 - 1.0;
  u.x *= P.aspect;

  let cam = vec3f(0.0, 0.0, -P.cameraDist);
  let ray = normalize(vec3f(u, P.cameraDist));

  // Front hit
  let frontHit = solveSurface(false, cam, ray, P.cameraDist + 0.2);
  if (frontHit.y < 0.5) {
    textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(0.0, 0.0, P.thickness, 0.04));
    textureStore(outTransport1, vec2<i32>(gid.xy), vec4f(1.0, 0.0, 0.01, 0.01));
    textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(0.0, 0.05, 0.0, 0.0));
    return;
  }

  let pFront = cam + ray * frontHit.x;
  let nFront = normalFromGrad(gradFrontLF(pFront.xy));

  let enter = refractDielectric(ray, -nFront, 1.0, P.etaGlass);
  let F = max(enter.w, 0.0);

  if (enter.w < 0.0) {
    textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(outTransport1, vec2<i32>(gid.xy), vec4f(1.0, 0.0, 0.0, 0.0));
    textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(1.0, 1.0, 1.0, 0.0));
    return;
  }

  var p = pFront + enter.xyz * 1e-4;
  var d = enter.xyz;
  var pathLen = 0.0;
  var tir = 0.0;
  var transmitted = false;
  var outDir = ray;

  for (var bounce = 0; bounce < 4; bounce++) {
    let towardBack = d.z > 0.0;
    let hit = solveSurface(towardBack, p, d, P.thickness / max(abs(d.z), 1e-3) + 0.04);
    if (hit.y < 0.5) { break; }

    pathLen += hit.x;
    p = p + d * hit.x;

    let nGeom = select(normalFromGrad(gradFrontLF(p.xy)), normalFromGrad(gradBackLF(p.xy)), towardBack);
    let Nincident = select(nGeom, -nGeom, towardBack);
    let ext = refractDielectric(d, Nincident, P.etaGlass, 1.0);

    if (ext.w >= 0.0 && towardBack) {
      transmitted = true;
      outDir = ext.xyz;
      break;
    }

    if (ext.w < 0.0) {
      // TIR
      d = reflect(d, nGeom);
      p = p + d * 1e-4;
      tir += 1.0;
    } else {
      // escaped toward camera side; stop
      break;
    }
  }

  let baseTan = ray.xy / max(ray.z, 1e-4);
  let outTan = outDir.xy / max(outDir.z, 1e-4);
  let shift = select(vec2f(0.0), P.cameraDist * (outTan - baseTan), transmitted);

  let ell = buildEllipse(u);
  let rough = sqrt(dot(gradFrontHF(u), gradFrontHF(u)) + dot(gradBackHF(u), gradBackHF(u)));
  let halo = clamp(0.05 + 0.55 * (tir / 4.0) + 2.8 * rough + 0.10 * F, 0.0, 1.0);

  textureStore(outTransport0, vec2<i32>(gid.xy), vec4f(shift, pathLen, F));
  textureStore(outTransport1, vec2<i32>(gid.xy), ell);
  textureStore(outTransport2, vec2<i32>(gid.xy), vec4f(tir / 4.0, halo, rough, select(0.0, 1.0, transmitted)));
}
```

That is the expensive glass math, but it only runs on **dirty events**: resize, glass-pattern change, or major camera change. For the "bathroom window gradient maker" use case, that means almost all of the slab cost disappears from the steady-state frame time.

---

## `composite.wgsl`

This is the hot pass every frame.

```wgsl
// composite.wgsl
alias vec2f = vec2<f32>;
alias vec3f = vec3<f32>;
alias vec4f = vec4<f32>;

struct FrameParams {
  outSize          : vec2<u32>,
  invOutSize       : vec2f,
  skySize          : vec2<u32>,
  frameIndex       : u32,
  dispersionScale  : f32,
  sigmaToLod       : f32,
  maxLod           : f32,
  absorptionR      : f32,
  absorptionG      : f32,
  absorptionB      : f32,
  sunHint          : vec2f,
  pad0             : vec2f,
};

@group(0) @binding(0) var linearSampler : sampler;
@group(0) @binding(1) var skyTex : texture_2d<f32>;
@group(0) @binding(2) var transport0 : texture_2d<f32>;
@group(0) @binding(3) var transport1 : texture_2d<f32>;
@group(0) @binding(4) var transport2 : texture_2d<f32>;
@group(0) @binding(5) var outHdr : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> P : FrameParams;

fn vogel(i: i32, n: i32, phi: f32) -> vec2f {
  let r = sqrt((f32(i) + 0.5) / f32(n));
  let a = f32(i) * 2.39996323 + phi;
  return r * vec2f(cos(a), sin(a));
}

fn interiorReflection(u: vec2f) -> vec3f {
  let ceiling = exp(-2.0 * max(-u.y, 0.0));
  let lamp    = exp(-120.0 * dot(u - vec2f(0.18, -0.42), u - vec2f(0.18, -0.42)));
  return vec3f(0.012, 0.014, 0.016) +
         vec3f(0.040, 0.036, 0.032) * ceiling +
         vec3f(0.10, 0.085, 0.055) * lamp;
}

fn sampleSky(uv: vec2f, axis: vec2f, sigma: vec2f, taps: i32, phi: f32, lodBias: f32) -> vec3f {
  let axis1 = vec2f(-axis.y, axis.x);
  let lod = clamp(log2(max(max(sigma.x, sigma.y), 1e-4) * P.sigmaToLod) + lodBias, 0.0, P.maxLod);

  var acc = vec3f(0.0);
  var wsum = 0.0;

  for (var i = 0; i < 12; i++) {
    if (i >= taps) { break; }
    let d = vogel(i, taps, phi);
    let off = axis * (d.x * sigma.x) + axis1 * (d.y * sigma.y);
    let w = exp(-2.0 * dot(d, d));
    let c = textureSampleLevel(skyTex, linearSampler, uv + off, lod).rgb;
    acc += w * c;
    wsum += w;
  }

  return acc / max(wsum, 1e-5);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= P.outSize.x || gid.y >= P.outSize.y) { return; }

  let pix = vec2f(vec2<u32>(gid.xy)) + 0.5;
  let uv = pix * P.invOutSize;

  let t0 = textureLoad(transport0, vec2<i32>(gid.xy), 0);
  let t1 = textureLoad(transport1, vec2<i32>(gid.xy), 0);
  let t2 = textureLoad(transport2, vec2<i32>(gid.xy), 0);

  let shift = t0.xy;
  let pathLen = t0.z;
  let F = clamp(t0.w, 0.0, 1.0);

  let axis = normalize(select(vec2f(1.0, 0.0), t1.xy, dot(t1.xy, t1.xy) > 1e-6));
  let sigmaMain = max(t1.zw, vec2f(0.003, 0.003));

  let tir = t2.x;
  let haloWeight = t2.y;
  let rough = t2.z;
  let transmitted = t2.w;

  // adaptive taps
  let importance = max(sigmaMain.x, sigmaMain.y) + 0.25 * rough + 0.25 * tir;
  let tapsMain = select(4, select(8, 12, importance > 0.03), importance > 0.015);
  let tapsHalo = select(4, 8, importance > 0.02);

  let phi = fract(sin(dot(uv + vec2f(f32(P.frameIndex) * 0.017), vec2f(12.9898, 78.233))) * 43758.5453)
          * 6.2831853;

  let skyUV = uv + shift * 0.5;
  let sigmaHalo = 1.7 * sigmaMain + vec2f(0.008 + 0.012 * tir);

  let reflection = interiorReflection((uv * 2.0 - 1.0));

  var color = vec3f(0.0);

  // Lightweight RGB dispersion
  let disp = axis * P.dispersionScale * (0.7 + 8.0 * max(sigmaMain.x, sigmaMain.y));

  let mainR = sampleSky(skyUV - disp, axis, sigmaMain, tapsMain, phi, 0.0).r;
  let mainG = sampleSky(skyUV,       axis, sigmaMain, tapsMain, phi, 0.0).g;
  let mainB = sampleSky(skyUV + disp, axis, sigmaMain, tapsMain, phi, 0.0).b;

  let haloR = sampleSky(skyUV - disp, axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).r;
  let haloG = sampleSky(skyUV,        axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).g;
  let haloB = sampleSky(skyUV + disp, axis, sigmaHalo, tapsHalo, phi + 1.1, 0.5).b;

  let Tmain = vec3f(mainR, mainG, mainB);
  let Thalo = vec3f(haloR, haloG, haloB);
  let T = mix(Tmain, Thalo, haloWeight);

  let absorb = vec3f(
    exp(-P.absorptionR * pathLen),
    exp(-P.absorptionG * pathLen),
    exp(-P.absorptionB * pathLen)
  );

  color = F * reflection + (1.0 - F) * absorb * T * transmitted;

  textureStore(outHdr, vec2<i32>(gid.xy), vec4f(color, 1.0));
}
```

This pass is where the frame time lives, so the rule is simple:

* no raymarching here
* no secant solves here
* no cloud scattering here
* just filtered HDR background lookups through a precomputed glass operator

---

## `present.wgsl`

```wgsl
// present.wgsl
alias vec2f = vec2<f32>;
alias vec4f = vec4<f32>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@group(0) @binding(0) var linearSampler : sampler;
@group(0) @binding(1) var hdrTex : texture_2d<f32>;

@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> VSOut {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0,  1.0),
    vec2f( 3.0,  1.0)
  );

  var out : VSOut;
  let p = pos[vid];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = 0.5 * vec2f(p.x + 1.0, 1.0 - p.y);
  return out;
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4f {
  var c = textureSampleLevel(hdrTex, linearSampler, in.uv, 0.0).rgb;
  c *= 1.10;
  c = aces(c);
  c = pow(c, vec3<f32>(1.0 / 2.2));
  return vec4f(c, 1.0);
}
```

I'd keep the present step as a tiny render pass because it plays nicely with `getPreferredCanvasFormat()` and avoids making the canvas itself your main storage target. If you really want compute-direct presentation, gate it behind `bgra8unorm-storage` and the actual configured canvas format. ([MDN Web Docs][6])

---

## Bottlenecks and how to crush each one

### 1. Atmosphere LUT cost

**Bottleneck:** precomputing transmittance / multi-scattering / sky-view can get expensive if you run it every frame.

**Fix:** treat atmosphere as **dirty-on-change**. Recompute the heavy LUTs only when:

* sun angle crosses a threshold
* turbidity / aerosol / ozone changes
* cloud coverage changes enough to matter

Everything else just samples the current LUTs. Bruneton's whole value proposition is exactly this: precompute once, sample cheaply many times. ([Ebruneton][2])

### 2. Cloud cost

**Bottleneck:** full volumetric cloud marching per screen pixel behind diffuser glass is wasted work.

**Fix:** do clouds in the **sky-view / panorama pass**, not the final full-res pass. If you want "hero mode," classify tiles near the sun and horizon and only refine those tiles. WebGPU supports indirect compute dispatch via `dispatchWorkgroupsIndirect()`, and indirect argument buffers use `GPUBufferUsage.INDIRECT`. ([MDN Web Docs][7])

A good error metric is:

[
E = \lambda_1 |\nabla B| + \lambda_2 \sqrt{\operatorname{tr}(\Sigma)} + \lambda_3 \max(0,\omega\cdot\omega_\odot)^p
]

Only tiles with (E > \tau) get the expensive refine pass.

### 3. Glass transport cost

**Bottleneck:** reduced slab solves, TIR, and Jacobian-ish spread estimation are too expensive every frame.

**Fix:** bake the glass into transport maps. If the window is screen-fixed, those maps change only on resize / pattern change / view change. That turns "expensive optics" into "cheap lookup."

### 4. Composite bandwidth

**Bottleneck:** the composite pass is mostly **memory bandwidth**:

* transport map fetches
* multiple HDR sky fetches
* output write

**Fixes:**

* use `f16` where available (`shader-f16`)
* store transport in narrower formats when `texture-formats-tier1` exists
* or pack transport data with `pack2x16float` / `pack4x8unorm`
* reduce taps adaptively: flat regions use 4 taps, wide/sun-adjacent regions use 8–12 taps

The packing builtins exist specifically to reduce memory bandwidth pressure. ([MDN Web Docs][4])

A packed-buffer version of the glass map would look like:

```wgsl
let packedShift = pack2x16float(shift);
let packedSig   = pack2x16float(vec2f(sigmaMajor, sigmaMinor));
let packedMisc  = pack4x8unorm(vec4f(fresnel, tir, haloWeight, roughness));
```

### 5. Workgroup-local operations

**Bottleneck:** blur and mip passes get hammered by repeated global-memory traffic.

**Fix:** for separable blur, sky mip downsample, and tile classification, use `var<workgroup>` staging buffers and `workgroupBarrier()`. WGSL explicitly gives compute invocations in the same workgroup shared `workgroup` memory, but you must keep synchronization in uniform control flow. ([gpuweb.github.io][3])

### 6. In-place compute feedback

**Bottleneck:** trying to read and write the same storage texture in blur / mip / temporal passes is a portability trap.

**Fix:** ping-pong textures by default. Read-only and read-write storage texture modes depend on the WGSL `readonly_and_readwrite_storage_textures` extension, so I would not make them the baseline architecture. ([MDN Web Docs][8])

### 7. CPU / JS overhead

**Bottleneck:** pipeline creation, main-thread jank, and per-frame object churn.

**Fixes:**

* use `createComputePipelineAsync()` at startup
* run the renderer in a Worker with `OffscreenCanvas`
* reuse bind groups
* update uniform buffers with `queue.writeBuffer`, not map/unmap churn
* keep one command encoder per frame, not dozens

WebGPU and canvas WebGPU contexts are available in workers, which is exactly where this renderer belongs. ([MDN Web Docs][5])

### 8. Measuring the wrong thing

**Bottleneck:** optimizing by feel.

**Fix:** wrap each compute pass with timestamp queries if `timestamp-query` is available, and label passes with debug groups / markers. WebGPU exposes timestamp queries and debug groups specifically for this. ([MDN Web Docs][9])

---

## The smartest fast path

For a gorgeous-but-fast shipping build on WebGPU, I would do exactly this:

```text
Atmosphere:
  Bruneton LUTs
  sky-view map at 1024x512
  broad layered clouds in sky-space
  mip pyramid

Glass:
  precompute reduced slab once
  TIR + halo estimate once
  transport textures once

Frame:
  one composite compute pass
  one present pass
```

And then add two optional upgrades:

```text
Upgrade A:
  tile classification + indirect refine pass near sun/horizon

Upgrade B:
  packed transport buffers + f16 everywhere + subgroups for reductions
```

That gets you:

* advanced atmosphere
* advanced glass
* very strong sunsets
* stable pebbled diffusion
* good chromatic split
* WebGPU-friendly performance

The only intentionally skeletal piece above is the body of `evalBrunetonSky()`: that is where I would port Bruneton's published LUT sampling helpers more or less 1:1 into WGSL, rather than reinvent the atmosphere math from scratch.

[1]: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API?utm_source=chatgpt.com "WebGPU API - Web APIs | MDN - Mozilla"
[2]: https://ebruneton.github.io/precomputed_atmospheric_scattering/ "https://ebruneton.github.io/precomputed_atmospheric_scattering/"
[3]: https://gpuweb.github.io/gpuweb/wgsl/?utm_source=chatgpt.com "WebGPU Shading Language"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures?utm_source=chatgpt.com "GPUSupportedFeatures - Web APIs - MDN"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createComputePipelineAsync?utm_source=chatgpt.com "GPUDevice: createComputePipelineAsync() method - Web APIs"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/GPU/getPreferredCanvasFormat?utm_source=chatgpt.com "GPU: getPreferredCanvasFormat() method - Web APIs - MDN"
[7]: https://developer.mozilla.org/en-US/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroupsIndirect "https://developer.mozilla.org/en-US/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroupsIndirect"
[8]: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createBindGroupLayout?utm_source=chatgpt.com "GPUDevice: createBindGroupLayout() method - Web APIs"
[9]: https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/writeTimestamp?utm_source=chatgpt.com "GPUCommandEncoder: writeTimestamp() method - Web APIs"
