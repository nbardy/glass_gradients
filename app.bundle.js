// lib/dense-controls/dense-controls.js
var DenseControls = class _DenseControls {
  /** @type {HTMLElement} */
  #root;
  /** @type {Map<string, HTMLInputElement | HTMLSelectElement>} */
  #inputs = /* @__PURE__ */ new Map();
  /** @type {Map<string, { bar: HTMLElement, input: HTMLInputElement }>} */
  #bars = /* @__PURE__ */ new Map();
  /** @type {Map<string, number>} */
  #digits = /* @__PURE__ */ new Map();
  /** @type {((key: string, value: number | boolean) => void)[]} */
  #listeners = [];
  /** @type {AbortController} */
  #ac = new AbortController();
  /**
   * @param {HTMLElement} container
   * @param {{ digits?: Record<string, number>, keyAttr?: string }} opts
   *   digits: decimal places per key for bar value display (default: auto from step)
   *   keyAttr: data attribute name used to identify settings (default: "setting")
   */
  static init(container, opts = {}) {
    return new _DenseControls(container, opts);
  }
  constructor(root, opts) {
    this.#root = root;
    root.classList.add("dense-controls");
    const keyAttr = opts.keyAttr ?? "setting";
    const digitOverrides = opts.digits ?? {};
    root.querySelectorAll(`[data-${keyAttr}]`).forEach((input) => {
      const key = input.dataset[keyAttr];
      this.#inputs.set(key, input);
      if (digitOverrides[key] != null) {
        this.#digits.set(key, digitOverrides[key]);
      }
    });
    for (const [key, input] of this.#inputs) {
      const label = input.closest("label");
      if (input.type === "range") {
        this.#transformRange(key, input, label);
      } else if (input.type === "checkbox") {
        this.#transformCheckbox(key, input, label);
      } else if (input.tagName === "SELECT") {
        this.#transformSelect(key, input, label);
      }
    }
    this.#syncAllBars();
  }
  // -- Public API --
  /** Read the current value of a control by key. */
  get(key) {
    const input = this.#inputs.get(key);
    if (!input) return void 0;
    if (input.type === "checkbox") return input.checked;
    return Number(input.value);
  }
  /** Programmatically set a control value and update the UI. */
  set(key, value) {
    const input = this.#inputs.get(key);
    if (!input) return;
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = String(value);
    }
    this.#syncBar(key);
    this.#emit(key);
  }
  /** Register a change listener: fn(key, value). */
  on(event, fn) {
    if (event === "change") this.#listeners.push(fn);
  }
  /** Remove all event listeners and undo DOM transforms. */
  destroy() {
    this.#ac.abort();
    this.#listeners.length = 0;
  }
  // -- Transforms --
  #transformRange(key, input, label) {
    const nameSpan = label?.querySelector("span");
    const name = nameSpan?.textContent ?? key;
    if (!this.#digits.has(key)) {
      const step = input.step || "1";
      const decimals = (step.split(".")[1] || "").length;
      this.#digits.set(key, decimals);
    }
    const bar = document.createElement("div");
    bar.className = "dc-bar";
    bar.dataset.bar = key;
    const fill = document.createElement("div");
    fill.className = "dc-fill";
    const labelDiv = document.createElement("div");
    labelDiv.className = "dc-label";
    const nameEl = document.createElement("span");
    nameEl.textContent = name;
    const valueEl = document.createElement("span");
    valueEl.className = "dc-value";
    valueEl.dataset.output = key;
    labelDiv.append(nameEl, valueEl);
    bar.append(fill, labelDiv, input);
    if (label) {
      label.replaceWith(bar);
    } else {
      this.#root.append(bar);
    }
    this.#bars.set(key, { bar, input });
    const oldOutput = this.#root.querySelector(`output[data-output="${key}"]`);
    if (oldOutput) oldOutput.remove();
    input.addEventListener("input", () => {
      this.#syncBar(key);
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }
  #transformCheckbox(key, input, label) {
    if (label) {
      label.className = "dc-toggle";
    }
    input.addEventListener("change", () => {
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }
  #transformSelect(key, input, label) {
    if (label) {
      label.className = "dc-select";
    }
    input.addEventListener("change", () => {
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }
  // -- Internal --
  #syncBar(key) {
    const entry = this.#bars.get(key);
    if (!entry) return;
    const { bar, input } = entry;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = (val - min) / (max - min) * 100;
    bar.style.setProperty("--fill", `${pct}%`);
    const digits = this.#digits.get(key) ?? 2;
    const valueEl = bar.querySelector(".dc-value");
    if (valueEl) valueEl.textContent = val.toFixed(digits);
  }
  #syncAllBars() {
    for (const key of this.#bars.keys()) {
      this.#syncBar(key);
    }
  }
  #emit(key) {
    const value = this.get(key);
    for (const fn of this.#listeners) {
      fn(key, value);
    }
  }
};

// core/glass_generator.ts
var GlassGenerator = class {
  device;
  pipeline;
  uniformBuffer;
  bindGroup;
  texture;
  constructor(device, shaderCode, config) {
    this.device = device;
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" }
    });
    this.texture = device.createTexture({
      size: [config.width, config.height, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: { buffer: this.uniformBuffer } }
      ]
    });
    this.updateConfig(config);
  }
  updateConfig(config) {
    const data = new Float32Array(8);
    data[0] = config.scale ?? 1;
    data[1] = config.pattern_type ?? 0;
    data[2] = config.frontOffset?.[0] ?? 0.1;
    data[3] = config.frontOffset?.[1] ?? -0.07;
    data[4] = config.backOffset?.[0] ?? -0.11;
    data[5] = config.backOffset?.[1] ?? 0.06;
    data[6] = config.distortion ?? 1;
    data[7] = config.roughness ?? 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }
  generate(commandEncoder) {
    const isInternalEncoder = !commandEncoder;
    const encoder = commandEncoder || this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.texture.width / 16),
      Math.ceil(this.texture.height / 16)
    );
    pass.end();
    if (isInternalEncoder) {
      this.device.queue.submit([encoder.finish()]);
    }
  }
  destroy() {
    this.texture.destroy();
    this.uniformBuffer.destroy();
  }
};

// algorithms/v1/glass_pipeline.ts
var RENDER_SIZE = 512;
var BACKGROUND_SIZE = 256;
var WORKGROUP_SIZE = 8;
async function v1GlassPipeline(device, canvas, shaderSource, config) {
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
  const glassGenSource = await glassGenResponse.text();
  const glassGenerator = new GlassGenerator(device, glassGenSource, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    scale: config.glassScale ?? 1,
    frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
    backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
    distortion: config.glassDistortion ?? 1,
    pattern_type: config.glassPatternType ?? 0,
    roughness: config.glassRoughness ?? 0
  });
  glassGenerator.generate();
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" }
  });
  const backgroundComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_background_compute" }
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_fullscreen"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_display",
      targets: [{ format: canvasFormat }]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  const stateStride = 32;
  const stateBufferSize = RENDER_SIZE * RENDER_SIZE * stateStride;
  const zeroState = new Uint8Array(stateBufferSize);
  const backgroundStateBufferSize = BACKGROUND_SIZE * BACKGROUND_SIZE * stateStride;
  const zeroBackgroundState = new Uint8Array(backgroundStateBufferSize);
  const statsBufferSize = 32;
  const zeroStats = new Uint32Array(8);
  const combinedStatsBufferSize = 64;
  const paramsBuffer = device.createBuffer({
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const stateBuffer = device.createBuffer({
    size: stateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const backgroundStateBuffer = device.createBuffer({
    size: backgroundStateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const statsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const backgroundStatsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const statsReadBuffer = device.createBuffer({
    size: combinedStatsBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const displayTexture = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const backgroundTexture = device.createTexture({
    size: [BACKGROUND_SIZE, BACKGROUND_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear"
  });
  const glassComputeBindGroup = device.createBindGroup({
    layout: glassComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: stateBuffer } },
      { binding: 2, resource: displayTexture.createView() },
      { binding: 3, resource: { buffer: statsBuffer } },
      { binding: 4, resource: backgroundTexture.createView() },
      { binding: 5, resource: glassGenerator.texture.createView() },
      { binding: 6, resource: linearSampler }
    ]
  });
  const backgroundComputeBindGroup = device.createBindGroup({
    layout: backgroundComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: backgroundStateBuffer } },
      { binding: 2, resource: backgroundTexture.createView() },
      { binding: 3, resource: { buffer: backgroundStatsBuffer } }
    ]
  });
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() },
      { binding: 1, resource: backgroundTexture.createView() }
    ]
  });
  const renderParamsBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } }
    ]
  });
  const debugIds = ["debug-r", "debug-g", "debug-b"];
  const debugContexts = [];
  let debugPipeline = null;
  let debugBindGroup = null;
  const debugUniforms = device.createBuffer({
    size: 32,
    // Safe uniform buffer size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  for (const id of debugIds) {
    const el = document.getElementById(id);
    if (el) {
      const ctx = el.getContext("webgpu");
      ctx.configure({ device, format: canvasFormat });
      debugContexts.push(ctx);
    }
  }
  if (debugContexts.length === 3) {
    const debugShader = `
      @vertex fn vs(@builtin(vertex_index) v_idx: u32) -> @builtin(position) vec4f {
        let pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(pos[v_idx], 0.0, 1.0);
      }
      @group(0) @binding(0) var tex: texture_2d<f32>;
      @group(0) @binding(1) var samp: sampler;
      struct Uniforms { channel: f32, pad: vec3f }
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;
      
      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let size = vec2f(textureDimensions(tex));
        var uv = pos.xy / size;
        uv.y = 1.0 - uv.y; // flip y for correct display
        let val = textureSampleLevel(tex, samp, uv, 0.0);
        var c = 0.0;
        if (uniforms.channel < 0.5) { c = val.r; }
        else if (uniforms.channel < 1.5) { c = val.g; }
        else { c = val.b; }
        return vec4f(vec3f(c), 1.0);
      }
    `;
    const debugModule = device.createShaderModule({ code: debugShader });
    debugPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: debugModule, entryPoint: "vs" },
      fragment: { module: debugModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
      primitive: { topology: "triangle-list" }
    });
    debugBindGroup = device.createBindGroup({
      layout: debugPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: glassGenerator.texture.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: debugUniforms } }
      ]
    });
  }
  const startTime = performance.now();
  let stats = {
    fps: 0,
    frameMs: 0,
    spp: 0,
    confident: 0,
    parked: 0,
    adaptive: 0,
    darkUnresolved: 0
  };
  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let backgroundFrozen = false;
  let frame = 0;
  let lastReadMs = 0;
  let readPending = false;
  function buildParamBlock() {
    const params = new Float32Array(28);
    params[0] = RENDER_SIZE;
    params[1] = RENDER_SIZE;
    params[2] = (performance.now() - startTime) / 1e3;
    params[3] = frame;
    params[4] = config.baseSamples ?? 2;
    params[5] = config.maxSamples ?? 8;
    params[6] = config.cloudSteps ?? 8;
    params[7] = config.sunShadowSteps ?? 3;
    params[8] = config.staticScene ? 1 : 0;
    params[9] = config.adaptiveSampling ? 1 : 0;
    params[10] = config.showConfidence ? 1 : 0;
    params[11] = config.targetError ?? 0.06;
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3;
    params[14] = config.exposure ?? 1.18;
    params[15] = config.showOutdoorOnly ? 1 : 0;
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19;
    params[23] = config.glassRoughness ?? 0.085;
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.splitView ? 1 : 0;
    params[26] = 0;
    params[27] = 0;
    return params;
  }
  return {
    name: "v1_refined",
    async render(timestamp) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1e3 / smoothedMs : 0;
      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock());
      device.queue.writeBuffer(statsBuffer, 0, zeroStats);
      const runBackgroundPass = !backgroundFrozen || !config.staticScene;
      if (runBackgroundPass) {
        device.queue.writeBuffer(backgroundStatsBuffer, 0, zeroStats);
      }
      const encoder = device.createCommandEncoder();
      glassGenerator.updateConfig({
        width: RENDER_SIZE,
        height: RENDER_SIZE,
        scale: config.glassScale ?? 1,
        frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
        backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
        distortion: config.glassDistortion ?? 1,
        pattern_type: config.glassPatternType ?? 0,
        roughness: config.glassRoughness ?? 0
      });
      glassGenerator.generate(encoder);
      if (runBackgroundPass) {
        const backgroundPass = encoder.beginComputePass();
        backgroundPass.setPipeline(backgroundComputePipeline);
        backgroundPass.setBindGroup(0, backgroundComputeBindGroup);
        backgroundPass.dispatchWorkgroups(
          Math.ceil(BACKGROUND_SIZE / WORKGROUP_SIZE),
          Math.ceil(BACKGROUND_SIZE / WORKGROUP_SIZE)
        );
        backgroundPass.end();
      }
      const glassPass = encoder.beginComputePass();
      glassPass.setPipeline(glassComputePipeline);
      glassPass.setBindGroup(0, glassComputeBindGroup);
      glassPass.dispatchWorkgroups(
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE),
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE)
      );
      glassPass.end();
      const colorView = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, renderParamsBindGroup);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();
      if (config.splitView && debugPipeline && debugBindGroup && debugContexts.length === 3) {
        for (let i = 0; i < 3; i++) {
          device.queue.writeBuffer(debugUniforms, 0, new Float32Array([i, 0, 0, 0]));
          const debugPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: debugContexts[i].getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store"
            }]
          });
          debugPass.setPipeline(debugPipeline);
          debugPass.setBindGroup(0, debugBindGroup);
          debugPass.draw(3);
          debugPass.end();
        }
      }
      const shouldReadStats = now - lastReadMs > 250 && !readPending;
      if (shouldReadStats) {
        readPending = true;
        if (runBackgroundPass) {
          encoder.copyBufferToBuffer(backgroundStatsBuffer, 0, statsReadBuffer, 0, statsBufferSize);
        }
        encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, statsBufferSize, statsBufferSize);
        lastReadMs = now;
        device.queue.submit([encoder.finish()]);
        statsReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
          const data = new Uint32Array(statsReadBuffer.getMappedRange());
          const copy = data.slice();
          statsReadBuffer.unmap();
          const totalPixels = RENDER_SIZE * RENDER_SIZE;
          stats.spp = copy[8] / totalPixels;
          stats.confident = copy[9] / totalPixels;
          stats.stable = copy[10] / totalPixels;
          stats.adaptive = copy[11] / totalPixels;
          stats.unresolved = copy[12] / totalPixels;
          stats.brightUnresolved = copy[13];
          stats.darkUnresolved = copy[14];
          readPending = false;
        }).catch((err) => {
          console.error("Stats readback failed", err);
          readPending = false;
        });
      } else {
        device.queue.submit([encoder.finish()]);
      }
      frame++;
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      glassGenerator.destroy();
      paramsBuffer.destroy();
      stateBuffer.destroy();
      backgroundStateBuffer.destroy();
      statsBuffer.destroy();
      backgroundStatsBuffer.destroy();
      statsReadBuffer.destroy();
      displayTexture.destroy();
      backgroundTexture.destroy();
    }
  };
}

// algorithms/v6/composite_pipeline.ts
var RENDER_SIZE2 = 512;
var SKY_SIZE = 512;
async function v6CompositePipeline(device, canvas, compositeShaderSource, config) {
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const skyviewSource = await fetch("./v6/skyview.wgsl").then((r) => r.text());
  const glassPrecomputeSource = await fetch("./v6/glass-precompute.wgsl").then((r) => r.text());
  const presentSource = await fetch("./v6/present.wgsl").then((r) => r.text());
  const skyviewModule = device.createShaderModule({ code: skyviewSource });
  const glassPrecomputeModule = device.createShaderModule({ code: glassPrecomputeSource });
  const compositeModule = device.createShaderModule({ code: compositeShaderSource });
  const presentModule = device.createShaderModule({ code: presentSource });
  const skyviewPipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: skyviewModule, entryPoint: "main" }
  });
  const glassPrecomputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: glassPrecomputeModule, entryPoint: "main" }
  });
  const compositePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: compositeModule, entryPoint: "main" }
  });
  const presentPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: presentModule, entryPoint: "vsMain" },
    fragment: { module: presentModule, entryPoint: "fsMain", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" }
  });
  const skyTex = device.createTexture({
    size: [SKY_SIZE, SKY_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const transport0 = device.createTexture({
    size: [RENDER_SIZE2, RENDER_SIZE2],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const transport1 = device.createTexture({
    size: [RENDER_SIZE2, RENDER_SIZE2],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const transport2 = device.createTexture({
    size: [RENDER_SIZE2, RENDER_SIZE2],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const hdrTex = device.createTexture({
    size: [RENDER_SIZE2, RENDER_SIZE2],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const dummy2D = device.createTexture({
    size: [1, 1],
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING
  });
  const dummy3D = device.createTexture({
    size: [1, 1, 1],
    dimension: "3d",
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING
  });
  const linearSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const skyParamsBuffer = device.createBuffer({
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const glassParamsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const frameParamsBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const skyviewBG = device.createBindGroup({
    layout: skyviewPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: dummy2D.createView() },
      { binding: 2, resource: dummy3D.createView() },
      { binding: 3, resource: dummy3D.createView() },
      { binding: 4, resource: skyTex.createView() },
      { binding: 5, resource: { buffer: skyParamsBuffer } }
    ]
  });
  const glassPrecomputeBG = device.createBindGroup({
    layout: glassPrecomputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: transport0.createView() },
      { binding: 1, resource: transport1.createView() },
      { binding: 2, resource: transport2.createView() },
      { binding: 3, resource: { buffer: glassParamsBuffer } }
    ]
  });
  const compositeBG = device.createBindGroup({
    layout: compositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: skyTex.createView() },
      { binding: 2, resource: transport0.createView() },
      { binding: 3, resource: transport1.createView() },
      { binding: 4, resource: transport2.createView() },
      { binding: 5, resource: hdrTex.createView() },
      { binding: 6, resource: { buffer: frameParamsBuffer } }
    ]
  });
  const presentBG = device.createBindGroup({
    layout: presentPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linearSampler },
      { binding: 1, resource: hdrTex.createView() }
    ]
  });
  let frameCount = 0;
  let lastTime = performance.now();
  const startTime = performance.now();
  const stats = { fps: 0, frameMs: 0, status: "V6 Running" };
  return {
    name: "v6_webgpu",
    async render(timestamp) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1e3 / delta : 0;
      frameCount++;
      const time = (now - startTime) / 1e3;
      const skyParams = new ArrayBuffer(96);
      const skyF32 = new Float32Array(skyParams);
      const skyU32 = new Uint32Array(skyParams);
      skyF32[0] = 6360;
      skyF32[1] = 6420;
      skyF32[2] = -0.2;
      skyF32[3] = 4675e-6;
      skyF32[4] = 0.8;
      skyF32[5] = 0.1;
      skyF32[6] = time;
      skyF32[7] = 0;
      skyF32[8] = 0.4;
      skyF32[9] = 0.08;
      skyF32[10] = 1;
      skyU32[12] = 256;
      skyU32[13] = 64;
      skyU32[16] = 32;
      skyU32[17] = 128;
      skyU32[18] = 32;
      skyU32[19] = 32;
      skyU32[20] = SKY_SIZE;
      skyU32[21] = SKY_SIZE;
      device.queue.writeBuffer(skyParamsBuffer, 0, skyParams);
      const glassParams = new Float32Array(16);
      const glassU32 = new Uint32Array(glassParams.buffer);
      glassU32[0] = RENDER_SIZE2;
      glassU32[1] = RENDER_SIZE2;
      glassParams[2] = 1 / RENDER_SIZE2;
      glassParams[3] = 1 / RENDER_SIZE2;
      glassParams[4] = 1;
      glassParams[5] = 1.65;
      glassParams[6] = config.thickness ?? 0.06;
      glassParams[7] = 0.1;
      glassParams[8] = 0.05;
      glassParams[9] = 0.1;
      glassParams[10] = 0.05;
      glassParams[11] = config.etaGlass ?? 1.52;
      device.queue.writeBuffer(glassParamsBuffer, 0, glassParams);
      const frameParams = new Float32Array(20);
      const frameU32 = new Uint32Array(frameParams.buffer);
      frameU32[0] = RENDER_SIZE2;
      frameU32[1] = RENDER_SIZE2;
      frameParams[2] = 1 / RENDER_SIZE2;
      frameParams[3] = 1 / RENDER_SIZE2;
      frameU32[4] = SKY_SIZE;
      frameU32[5] = SKY_SIZE;
      frameU32[6] = frameCount;
      frameParams[7] = 1;
      frameParams[8] = 1;
      frameParams[9] = 5;
      frameParams[10] = 0;
      frameParams[11] = 0;
      frameParams[12] = 0;
      frameParams[13] = 0;
      frameParams[14] = 0;
      frameParams[15] = 0;
      device.queue.writeBuffer(frameParamsBuffer, 0, frameParams);
      const encoder = device.createCommandEncoder();
      const pass1 = encoder.beginComputePass();
      pass1.setPipeline(skyviewPipeline);
      pass1.setBindGroup(0, skyviewBG);
      pass1.dispatchWorkgroups(Math.ceil(SKY_SIZE / 8), Math.ceil(SKY_SIZE / 8));
      pass1.end();
      const pass2 = encoder.beginComputePass();
      pass2.setPipeline(glassPrecomputePipeline);
      pass2.setBindGroup(0, glassPrecomputeBG);
      pass2.dispatchWorkgroups(Math.ceil(RENDER_SIZE2 / 8), Math.ceil(RENDER_SIZE2 / 8));
      pass2.end();
      const pass3 = encoder.beginComputePass();
      pass3.setPipeline(compositePipeline);
      pass3.setBindGroup(0, compositeBG);
      pass3.dispatchWorkgroups(Math.ceil(RENDER_SIZE2 / 8), Math.ceil(RENDER_SIZE2 / 8));
      pass3.end();
      const pass4 = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }]
      });
      pass4.setPipeline(presentPipeline);
      pass4.setBindGroup(0, presentBG);
      pass4.draw(3);
      pass4.end();
      device.queue.submit([encoder.finish()]);
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      skyTex.destroy();
      transport0.destroy();
      transport1.destroy();
      transport2.destroy();
      hdrTex.destroy();
      dummy2D.destroy();
      dummy3D.destroy();
      skyParamsBuffer.destroy();
      glassParamsBuffer.destroy();
      frameParamsBuffer.destroy();
    }
  };
}

// algorithms/v3/glass_pipeline.ts
async function v3GlassPipeline(device, canvas, shaderSource, config) {
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: canvasFormat }]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  const paramsBuffer = device.createBuffer({
    size: 32,
    // resolution(8), time(4), samples(4), microRoughness(4), etaR(4), etaG(4), etaB(4)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const bindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }]
  });
  let lastTime = performance.now();
  let frameCount = 0;
  const startTime = performance.now();
  const stats = { fps: 0, frameMs: 0, status: "Running WebGPU (Transcribed)" };
  return {
    name: "v3_glsl",
    async render(timestamp) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1e3 / delta : 0;
      frameCount++;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const paramsArray = new Float32Array([
        width,
        height,
        (now - startTime) / 1e3,
        config.samples ?? 32,
        config.microRoughness ?? 0.08,
        config.etaR ?? 1.48,
        config.etaG ?? 1.51,
        config.etaB ?? 1.54
      ]);
      device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store"
          }
        ]
      });
      pass.setPipeline(renderPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      paramsBuffer.destroy();
    }
  };
}

// algorithms/v4/glass_pipeline.ts
async function v4GlassPipeline(device, canvas, shaderSource, config) {
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: canvasFormat }]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  const paramsBuffer = device.createBuffer({
    size: 32,
    // resolution(8), time(4), samples(4), microRoughness(4), etaR(4), etaG(4), etaB(4)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const bindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }]
  });
  let lastTime = performance.now();
  let frameCount = 0;
  const startTime = performance.now();
  const stats = { fps: 0, frameMs: 0, status: "Running WebGPU (Transcribed)" };
  return {
    name: "v4_webgl2",
    async render(timestamp) {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      stats.frameMs = delta;
      stats.fps = delta > 0 ? 1e3 / delta : 0;
      frameCount++;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const paramsArray = new Float32Array([
        width,
        height,
        (now - startTime) / 1e3,
        config.samples ?? 32,
        config.microRoughness ?? 0.08,
        config.etaR ?? 1.48,
        config.etaG ?? 1.51,
        config.etaB ?? 1.54
      ]);
      device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store"
          }
        ]
      });
      pass.setPipeline(renderPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      paramsBuffer.destroy();
    }
  };
}

// algorithms/v7/glass_pipeline.ts
var RENDER_SIZE3 = 512;
var WORKGROUP_SIZE2 = 16;
async function v7GlassPipeline(device, canvas, config) {
  canvas.width = RENDER_SIZE3;
  canvas.height = RENDER_SIZE3;
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
  const glassGenSource = await glassGenResponse.text();
  const glassGenerator = new GlassGenerator(device, glassGenSource, {
    width: RENDER_SIZE3,
    height: RENDER_SIZE3,
    scale: config.glassScale ?? 1,
    frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
    backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
    distortion: config.glassDistortion ?? 1,
    pattern_type: config.glassPatternType ?? 0,
    roughness: config.glassRoughness ?? 0
  });
  glassGenerator.generate();
  const shaderResponse = await fetch("./algorithms/v7/renderer.wgsl");
  const shaderSource = await shaderResponse.text();
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" }
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_fullscreen"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_display",
      targets: [{ format: canvasFormat }]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  const paramsBuffer = device.createBuffer({
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const displayTexture = device.createTexture({
    size: [RENDER_SIZE3, RENDER_SIZE3],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const dummyBackground = device.createTexture({
    size: [1, 1],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });
  const glassComputeBindGroup = device.createBindGroup({
    layout: glassComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: displayTexture.createView() },
      { binding: 2, resource: glassGenerator.texture.createView() },
      { binding: 3, resource: linearSampler },
      { binding: 4, resource: dummyBackground.createView() }
    ]
  });
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() }
    ]
  });
  const startTime = performance.now();
  let stats = {
    fps: 0,
    frameMs: 0,
    spp: 1
    // Single pass
  };
  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let frame = 0;
  function buildParamBlock() {
    const params = new Float32Array(28);
    params[0] = RENDER_SIZE3;
    params[1] = RENDER_SIZE3;
    params[2] = (performance.now() - startTime) / 1e3;
    params[3] = frame;
    params[4] = 1;
    params[5] = 1;
    params[6] = 1;
    params[7] = 1;
    params[8] = 0;
    params[9] = 0;
    params[10] = 0;
    params[11] = config.showOutdoorOnly ? 1 : 0;
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3;
    params[14] = config.exposure ?? 1.18;
    params[15] = 0;
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19;
    params[23] = config.glassRoughness ?? 0.085;
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.splitView ? 1 : 0;
    params[26] = 0;
    params[27] = 0;
    return params;
  }
  return {
    name: "v7_fast_analytical",
    async render(timestamp) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1e3 / smoothedMs : 0;
      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock());
      const encoder = device.createCommandEncoder();
      glassGenerator.updateConfig({
        width: RENDER_SIZE3,
        height: RENDER_SIZE3,
        scale: config.glassScale ?? 1,
        frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
        backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
        distortion: config.glassDistortion ?? 1,
        pattern_type: config.glassPatternType ?? 0,
        roughness: config.glassRoughness ?? 0
      });
      glassGenerator.generate(encoder);
      const glassPass = encoder.beginComputePass();
      glassPass.setPipeline(glassComputePipeline);
      glassPass.setBindGroup(0, glassComputeBindGroup);
      glassPass.dispatchWorkgroups(
        Math.ceil(RENDER_SIZE3 / WORKGROUP_SIZE2),
        Math.ceil(RENDER_SIZE3 / WORKGROUP_SIZE2)
      );
      glassPass.end();
      const colorView = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, glassComputeBindGroup);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();
      device.queue.submit([encoder.finish()]);
      frame++;
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      paramsBuffer.destroy();
      displayTexture.destroy();
      dummyBackground.destroy();
    }
  };
}

// algorithms/v8_stochastic_pbr/glass_pipeline.ts
var RENDER_SIZE4 = 512;
var BACKGROUND_SIZE2 = 256;
var WORKGROUP_SIZE3 = 8;
async function v8GlassPipeline(device, canvas, shaderSource, config) {
  canvas.width = RENDER_SIZE4;
  canvas.height = RENDER_SIZE4;
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });
  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
  const glassGenSource = await glassGenResponse.text();
  const glassGenerator = new GlassGenerator(device, glassGenSource, {
    width: RENDER_SIZE4,
    height: RENDER_SIZE4,
    scale: config.glassScale ?? 1,
    frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
    backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
    distortion: config.glassDistortion ?? 1,
    pattern_type: config.glassPatternType ?? 0,
    roughness: config.glassRoughness ?? 0
  });
  glassGenerator.generate();
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" }
  });
  const backgroundComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_background_compute" }
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_fullscreen"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_display",
      targets: [{ format: canvasFormat }]
    },
    primitive: {
      topology: "triangle-list"
    }
  });
  const stateStride = 32;
  const stateBufferSize = RENDER_SIZE4 * RENDER_SIZE4 * stateStride;
  const zeroState = new Uint8Array(stateBufferSize);
  const backgroundStateBufferSize = BACKGROUND_SIZE2 * BACKGROUND_SIZE2 * stateStride;
  const zeroBackgroundState = new Uint8Array(backgroundStateBufferSize);
  const statsBufferSize = 32;
  const zeroStats = new Uint32Array(8);
  const combinedStatsBufferSize = 64;
  const paramsBuffer = device.createBuffer({
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const stateBuffer = device.createBuffer({
    size: stateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const backgroundStateBuffer = device.createBuffer({
    size: backgroundStateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const statsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const backgroundStatsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const statsReadBuffer = device.createBuffer({
    size: combinedStatsBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const displayTexture = device.createTexture({
    size: [RENDER_SIZE4, RENDER_SIZE4],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const backgroundTexture = device.createTexture({
    size: [BACKGROUND_SIZE2, BACKGROUND_SIZE2],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  });
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear"
  });
  const glassComputeBindGroup = device.createBindGroup({
    layout: glassComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: stateBuffer } },
      { binding: 2, resource: displayTexture.createView() },
      { binding: 3, resource: { buffer: statsBuffer } },
      { binding: 4, resource: backgroundTexture.createView() },
      { binding: 5, resource: glassGenerator.texture.createView() },
      { binding: 6, resource: linearSampler }
    ]
  });
  const backgroundComputeBindGroup = device.createBindGroup({
    layout: backgroundComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: backgroundStateBuffer } },
      { binding: 2, resource: backgroundTexture.createView() },
      { binding: 3, resource: { buffer: backgroundStatsBuffer } }
    ]
  });
  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() }
    ]
  });
  const startTime = performance.now();
  let stats = {
    fps: 0,
    frameMs: 0,
    spp: 0,
    confident: 0,
    parked: 0,
    adaptive: 0,
    darkUnresolved: 0
  };
  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let backgroundFrozen = false;
  let frame = 0;
  let lastReadMs = 0;
  let readPending = false;
  function buildParamBlock() {
    const params = new Float32Array(28);
    params[0] = RENDER_SIZE4;
    params[1] = RENDER_SIZE4;
    params[2] = (performance.now() - startTime) / 1e3;
    params[3] = frame;
    params[4] = config.baseSamples ?? 2;
    params[5] = config.maxSamples ?? 8;
    params[6] = config.cloudSteps ?? 8;
    params[7] = config.sunShadowSteps ?? 3;
    params[8] = config.staticScene ? 1 : 0;
    params[9] = config.adaptiveSampling ? 1 : 0;
    params[10] = config.showConfidence ? 1 : 0;
    params[11] = config.targetError ?? 0.06;
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3;
    params[14] = config.exposure ?? 1.18;
    params[15] = config.showOutdoorOnly ? 1 : 0;
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19;
    params[23] = config.glassRoughness ?? 0.085;
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.milkyScattering ? 1 : 0;
    params[26] = config.dispersion ? 1 : 0;
    params[27] = config.birefringence ? 1 : 0;
    return params;
  }
  let prevConfigStr = JSON.stringify(config);
  return {
    name: "v8_stochastic_pbr",
    async render(timestamp) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1e3 / smoothedMs : 0;
      const currentConfigStr = JSON.stringify(config);
      if (currentConfigStr !== prevConfigStr) {
        device.queue.writeBuffer(stateBuffer, 0, zeroState);
        device.queue.writeBuffer(statsBuffer, 0, zeroStats);
        prevConfigStr = currentConfigStr;
      }
      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock());
      device.queue.writeBuffer(statsBuffer, 0, zeroStats);
      const runBackgroundPass = !backgroundFrozen || !config.staticScene;
      if (runBackgroundPass) {
        device.queue.writeBuffer(backgroundStatsBuffer, 0, zeroStats);
      }
      const encoder = device.createCommandEncoder();
      glassGenerator.updateConfig({
        width: RENDER_SIZE4,
        height: RENDER_SIZE4,
        scale: config.glassScale ?? 1,
        frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
        backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
        distortion: config.glassDistortion ?? 1,
        pattern_type: config.glassPatternType ?? 0,
        roughness: config.glassRoughness ?? 0
      });
      glassGenerator.generate(encoder);
      if (runBackgroundPass) {
        const backgroundPass = encoder.beginComputePass();
        backgroundPass.setPipeline(backgroundComputePipeline);
        backgroundPass.setBindGroup(0, backgroundComputeBindGroup);
        backgroundPass.dispatchWorkgroups(
          Math.ceil(BACKGROUND_SIZE2 / WORKGROUP_SIZE3),
          Math.ceil(BACKGROUND_SIZE2 / WORKGROUP_SIZE3)
        );
        backgroundPass.end();
      }
      const glassPass = encoder.beginComputePass();
      glassPass.setPipeline(glassComputePipeline);
      glassPass.setBindGroup(0, glassComputeBindGroup);
      glassPass.dispatchWorkgroups(
        Math.ceil(RENDER_SIZE4 / WORKGROUP_SIZE3),
        Math.ceil(RENDER_SIZE4 / WORKGROUP_SIZE3)
      );
      glassPass.end();
      const colorView = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();
      const shouldReadStats = now - lastReadMs > 250 && !readPending;
      if (shouldReadStats) {
        readPending = true;
        if (runBackgroundPass) {
          encoder.copyBufferToBuffer(backgroundStatsBuffer, 0, statsReadBuffer, 0, statsBufferSize);
        }
        encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, statsBufferSize, statsBufferSize);
        lastReadMs = now;
        device.queue.submit([encoder.finish()]);
        statsReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
          const data = new Uint32Array(statsReadBuffer.getMappedRange());
          const copy = data.slice();
          statsReadBuffer.unmap();
          const totalPixels = RENDER_SIZE4 * RENDER_SIZE4;
          stats.spp = copy[8] / totalPixels;
          stats.confident = copy[9] / totalPixels;
          stats.stable = copy[10] / totalPixels;
          stats.adaptive = copy[11] / totalPixels;
          stats.unresolved = copy[12] / totalPixels;
          stats.brightUnresolved = copy[13];
          stats.darkUnresolved = copy[14];
          readPending = false;
        }).catch((err) => {
          console.error("Stats readback failed", err);
          readPending = false;
        });
      } else {
        device.queue.submit([encoder.finish()]);
      }
      frame++;
    },
    getStats() {
      return { ...stats };
    },
    dispose() {
      glassGenerator.destroy();
      paramsBuffer.destroy();
      stateBuffer.destroy();
      backgroundStateBuffer.destroy();
      statsBuffer.destroy();
      backgroundStatsBuffer.destroy();
      statsReadBuffer.destroy();
      displayTexture.destroy();
      backgroundTexture.destroy();
    }
  };
}

// app.ts
var ALGORITHMS = {
  v7_fast_analytical: {
    name: "v7_fast_analytical",
    label: "V7 Fast Analytical (Single Pass)",
    pipeline: (device, canvas, source, config) => v7GlassPipeline(device, canvas, config),
    shaderPath: "./algorithms/v7/renderer.wgsl",
    defaultConfig: {
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      cameraZ: 1.65,
      cameraFocal: 1.85,
      glassThickness: 0.06,
      glassHeightAmpl: 0.01,
      glassBump: 0.19,
      glassPatternType: 2,
      // Default to Pebbled
      glassScale: 1,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1,
      glassIor: 1.52,
      showOutdoorOnly: false
    },
    uiGroups: {
      "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Background & Camera": ["sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "showOutdoorOnly"]
    }
  },
  v8_stochastic_pbr: {
    name: "v8_stochastic_pbr",
    label: "V8 Stochastic PBR (Multi-Pass)",
    pipeline: v8GlassPipeline,
    shaderPath: "./algorithms/v8_stochastic_pbr/renderer.wgsl",
    defaultConfig: {
      baseSamples: 2,
      maxSamples: 8,
      targetError: 0.06,
      varianceBoost: 1.2,
      outlierK: 3,
      exposure: 1.18,
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      cameraZ: 1.65,
      cameraFocal: 1.85,
      glassThickness: 0.06,
      glassHeightAmpl: 0.01,
      glassBump: 0.19,
      glassRoughness: 0.085,
      glassPatternType: 2,
      glassScale: 1,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1,
      glassIor: 1.52,
      cloudSteps: 8,
      sunShadowSteps: 3,
      adaptiveSampling: true,
      staticScene: true,
      milkyScattering: false,
      dispersion: false,
      birefringence: false
    },
    uiGroups: {
      "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
      "Glass Physical": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Glass Optics": ["milkyScattering", "dispersion", "birefringence"],
      "Background & Camera": ["sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"]
    }
  },
  v1_refined: {
    name: "v1_refined",
    label: "V1 Refined (Adaptive)",
    pipeline: v1GlassPipeline,
    shaderPath: "./v1_refined_webgpu/renderer.wgsl",
    defaultConfig: {
      baseSamples: 2,
      maxSamples: 8,
      targetError: 0.06,
      varianceBoost: 1.2,
      outlierK: 3,
      exposure: 1.18,
      sunAzimuth: 0.58,
      sunElevation: 0.055,
      cameraZ: 1.65,
      cameraFocal: 1.85,
      glassThickness: 0.06,
      glassHeightAmpl: 0.01,
      glassBump: 0.19,
      glassRoughness: 0.085,
      glassPatternType: 2,
      glassScale: 1,
      glassFrontOffsetX: 0.1,
      glassFrontOffsetY: -0.07,
      glassBackOffsetX: -0.11,
      glassBackOffsetY: 0.06,
      glassDistortion: 1,
      glassIor: 1.52,
      cloudSteps: 8,
      sunShadowSteps: 3,
      adaptiveSampling: true,
      staticScene: true
    },
    uiGroups: {
      "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
      "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
      "Background & Camera": ["sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"]
    }
  },
  v6_webgpu: {
    name: "v6_webgpu",
    label: "V6 WebGPU (Bruneton)",
    pipeline: v6CompositePipeline,
    shaderPath: "./v6/composite.wgsl",
    defaultConfig: {
      exposure: 1
    }
  },
  v3_glsl: {
    name: "v3_glsl",
    label: "V3 WebGPU (Transcribed)",
    pipeline: v3GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {
      samples: 32,
      microRoughness: 0.08,
      etaR: 1.48,
      etaG: 1.51,
      etaB: 1.54
    }
  },
  v4_webgl2: {
    name: "v4_webgl2",
    label: "V4 WebGPU (Transcribed)",
    pipeline: v4GlassPipeline,
    shaderPath: "./v3/bathroom-glass-optical-simulator.wgsl",
    defaultConfig: {
      samples: 32,
      microRoughness: 0.08,
      etaR: 1.48,
      etaG: 1.51,
      etaB: 1.54
    }
  }
};
var state = {
  renderer: null,
  device: null,
  canvas: null,
  currentAlgo: "v1_refined",
  config: {},
  controls: null
};
async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  state.device = await adapter.requestDevice();
  state.canvas = document.querySelector("canvas");
  const viewModePicker = document.querySelector("#view-mode");
  const debugContainer = document.getElementById("debug-container");
  viewModePicker.addEventListener("change", (e) => {
    const isSplit = e.target.value === "split";
    state.config.splitView = isSplit;
    if (debugContainer) {
      debugContainer.style.display = isSplit ? "flex" : "none";
    }
  });
  const picker = document.querySelector("#algo-picker");
  for (const [algoName, meta] of Object.entries(ALGORITHMS)) {
    const option = document.createElement("option");
    option.value = algoName;
    option.textContent = meta.label;
    picker.appendChild(option);
  }
  picker.addEventListener("change", async (e) => {
    await switchAlgorithm(e.target.value);
  });
  await switchAlgorithm("v8_stochastic_pbr");
  renderLoop();
}
async function switchAlgorithm(algoName) {
  if (state.renderer) {
    state.renderer.dispose();
  }
  if (state.controls) {
    state.controls.destroy();
  }
  const oldCanvas = state.canvas;
  const newCanvas = document.createElement("canvas");
  newCanvas.id = "canvas";
  newCanvas.width = oldCanvas.width || 1440;
  newCanvas.height = oldCanvas.height || 720;
  oldCanvas.replaceWith(newCanvas);
  state.canvas = newCanvas;
  const meta = ALGORITHMS[algoName];
  try {
    const response = await fetch(`${meta.shaderPath}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`Failed to load shader: ${meta.shaderPath}`);
    const source = await response.text();
    const currentSplitView = state.config.splitView ?? false;
    state.config = { ...meta.defaultConfig, splitView: currentSplitView };
    const debugContainer = document.querySelector("#debug-container");
    if (debugContainer) {
      debugContainer.style.display = currentSplitView ? "flex" : "none";
    }
    state.renderer = await meta.pipeline(state.device, state.canvas, source, state.config);
    state.currentAlgo = algoName;
    const controlForm = document.querySelector("#controls");
    controlForm.innerHTML = "";
    const defaultConfig = meta.defaultConfig;
    const groups = meta.uiGroups || { "Settings": Object.keys(defaultConfig) };
    for (const [groupName, keys] of Object.entries(groups)) {
      const details = document.createElement("details");
      details.className = "control-group";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = groupName;
      details.appendChild(summary);
      for (const key of keys) {
        if (!(key in defaultConfig)) continue;
        const defaultValue = defaultConfig[key];
        const label = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = key;
        let input;
        if (typeof defaultValue === "boolean") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = defaultValue;
        } else if (key === "glassPatternType") {
          input = document.createElement("select");
          const options = [
            { value: 2, label: "Pebbled with slight frost" },
            { value: 0, label: "FBM Wavy" },
            { value: 1, label: "Frosted Flat" },
            { value: 3, label: "Ribbed/Fluted" }
          ];
          options.forEach((optData) => {
            const opt = document.createElement("option");
            opt.value = String(optData.value);
            opt.textContent = optData.label;
            if (optData.value === Number(defaultValue)) opt.selected = true;
            input.appendChild(opt);
          });
        } else {
          input = document.createElement("input");
          input.type = "range";
          const val = Number(defaultValue);
          if (val <= 1) {
            input.min = "0";
            input.max = "1";
            input.step = "0.01";
          } else if (val <= 10) {
            input.min = "0";
            input.max = "10";
            input.step = "0.1";
          } else {
            input.min = "0";
            input.max = "100";
            input.step = "1";
          }
          input.value = String(defaultValue);
        }
        input.setAttribute("data-setting", key);
        label.appendChild(span);
        label.appendChild(input);
        details.appendChild(label);
      }
      controlForm.appendChild(details);
    }
    state.controls = DenseControls.init(controlForm, {
      keyAttr: "setting"
    });
    state.controls.on("change", (key, value) => {
      state.config[key] = value;
    });
    const errorDiv = document.querySelector("#error");
    if (errorDiv) {
      errorDiv.textContent = "";
    }
  } catch (error) {
    const errorDiv = document.querySelector("#error");
    if (errorDiv) {
      errorDiv.textContent = `Error: ${error}`;
    }
    console.error(error);
  }
}
function renderLoop() {
  requestAnimationFrame(async (ts) => {
    if (state.renderer) {
      try {
        await state.renderer.render(ts);
        const stats = state.renderer.getStats();
        const statsContainer = document.querySelector("#stats-panel");
        statsContainer.innerHTML = "";
        for (const [key, value] of Object.entries(stats)) {
          const card = document.createElement("div");
          card.className = "stat-card";
          const label = document.createElement("span");
          label.className = "stat-label";
          label.textContent = key;
          const valueEl = document.createElement("strong");
          valueEl.className = "stat-value";
          if (typeof value === "number") {
            valueEl.textContent = value.toFixed(value > 10 ? 1 : 2);
          } else {
            valueEl.textContent = String(value);
          }
          card.appendChild(label);
          card.appendChild(valueEl);
          statsContainer.appendChild(card);
        }
      } catch (error) {
        console.error("Render error:", error);
      }
    }
    renderLoop();
  });
}
init().catch(console.error);
