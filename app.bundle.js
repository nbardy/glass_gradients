(() => {
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
    const dummyBackgroundForCompute = device.createTexture({
      size: [1, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING
    });
    const backgroundComputeBindGroup = device.createBindGroup({
      layout: backgroundComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: backgroundStateBuffer } },
        { binding: 2, resource: backgroundTexture.createView() },
        { binding: 3, resource: { buffer: backgroundStatsBuffer } },
        { binding: 4, resource: dummyBackgroundForCompute.createView() },
        { binding: 6, resource: linearSampler }
      ]
    });
    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: displayTexture.createView() }
      ]
    });
    const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
    const debugContexts = [];
    let debugPipeline = null;
    const debugBindGroups = [];
    for (const id of debugIds) {
      const el = document.getElementById(id);
      if (el) {
        const ctx = el.getContext("webgpu");
        ctx.configure({ device, format: canvasFormat });
        debugContexts.push(ctx);
      }
    }
    if (debugContexts.length === 4) {
      debugPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_fullscreen" },
        fragment: { module: shaderModule, entryPoint: "fs_debug", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" }
      });
      for (let i = 0; i < 4; i++) {
        const debugUniforms = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(debugUniforms, 0, new Float32Array([i, 0, 0, 0]));
        debugBindGroups.push(device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(2),
          entries: [{ binding: 0, resource: { buffer: debugUniforms } }]
        }));
      }
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
      params[26] = config.bgType ?? 0;
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
        const az = config.sunAzimuth ?? 0.58;
        const el = config.sunElevation ?? 0.055;
        const sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        const bgTex = await config.bgManager.getBackground(config.bgType ?? "math", sunDir, 1024);
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
        const dynamicGlassComputeBG = device.createBindGroup({
          layout: glassComputePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: stateBuffer } },
            { binding: 2, resource: displayTexture.createView() },
            { binding: 3, resource: { buffer: statsBuffer } },
            { binding: 4, resource: bgTex.createView() },
            { binding: 5, resource: glassGenerator.texture.createView() },
            { binding: 6, resource: linearSampler }
          ]
        });
        const dynamicRenderParamsBG = device.createBindGroup({
          layout: renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 4, resource: bgTex.createView() },
            { binding: 6, resource: linearSampler }
          ]
        });
        const glassPass = encoder.beginComputePass();
        glassPass.setPipeline(glassComputePipeline);
        glassPass.setBindGroup(0, dynamicGlassComputeBG);
        glassPass.dispatchWorkgroups(
          Math.ceil(RENDER_SIZE / WORKGROUP_SIZE),
          Math.ceil(RENDER_SIZE / WORKGROUP_SIZE)
        );
        glassPass.end();
        const dynamicRenderBG = device.createBindGroup({
          layout: renderPipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: displayTexture.createView() }
          ]
        });
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
        renderPass.setBindGroup(0, dynamicRenderParamsBG);
        renderPass.setBindGroup(1, dynamicRenderBG);
        renderPass.draw(3);
        renderPass.end();
        if (config.splitView && debugPipeline && debugBindGroups.length === 4 && debugContexts.length === 4) {
          const dynamicDebugGroup0 = device.createBindGroup({
            layout: debugPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: paramsBuffer } },
              { binding: 4, resource: bgTex.createView() },
              { binding: 5, resource: glassGenerator.texture.createView() },
              { binding: 6, resource: linearSampler }
            ]
          });
          const dynamicDebugGroup1 = device.createBindGroup({
            layout: debugPipeline.getBindGroupLayout(1),
            entries: [
              { binding: 0, resource: displayTexture.createView() }
            ]
          });
          for (let i = 0; i < 4; i++) {
            const debugPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: debugContexts[i].getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store"
              }]
            });
            debugPass.setPipeline(debugPipeline);
            debugPass.setBindGroup(0, dynamicDebugGroup0);
            debugPass.setBindGroup(1, dynamicDebugGroup1);
            debugPass.setBindGroup(2, debugBindGroups[i]);
            debugPass.draw(3);
            debugPass.end();
          }
        }
        const shouldReadStats = now - lastReadMs > 250 && !readPending;
        if (shouldReadStats) {
          readPending = true;
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

  // core/atmosphere_generator.ts
  var AtmosphereGenerator = class {
    device;
    transmittancePipeline;
    scatteringPipeline;
    uniformBuffer;
    bindGroup;
    transmittanceTexture;
    scatteringTexture;
    singleMieTexture;
    tSize;
    sSize;
    constructor(device, shaderCode, config) {
      this.device = device;
      const module = device.createShaderModule({ code: shaderCode });
      this.transmittancePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "compute_transmittance" }
      });
      this.scatteringPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "compute_single_scattering" }
      });
      this.tSize = config.transmittanceSize ?? [256, 64];
      this.sSize = config.scatteringSize ?? [8, 128, 32, 32];
      this.transmittanceTexture = device.createTexture({
        size: [this.tSize[0], this.tSize[1], 1],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.scatteringTexture = device.createTexture({
        size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.singleMieTexture = device.createTexture({
        size: [this.sSize[0] * this.sSize[1], this.sSize[2], this.sSize[3]],
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      this.uniformBuffer = device.createBuffer({
        size: 144,
        // 36 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } }
        ]
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      this.transmittancePipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: "compute_transmittance" }
      });
      this.scatteringPipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: "compute_single_scattering" }
      });
      this.bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.transmittanceTexture.createView() },
          { binding: 2, resource: this.scatteringTexture.createView() },
          { binding: 3, resource: this.singleMieTexture.createView() }
        ]
      });
      this.updateConfig(config);
    }
    updateConfig(config) {
      const data = new Float32Array(36);
      const u32Data = new Uint32Array(data.buffer);
      data[0] = config.bottomRadius ?? 6360;
      data[1] = config.topRadius ?? 6420;
      data[2] = config.rayleighDensityH ?? 8;
      data[3] = config.mieDensityH ?? 1.2;
      const rScat = config.rayleighScattering ?? [58e-4, 0.0135, 0.0331];
      data[4] = rScat[0];
      data[5] = rScat[1];
      data[6] = rScat[2];
      const mScat = config.mieScattering ?? [39e-4, 39e-4, 39e-4];
      data[8] = mScat[0];
      data[9] = mScat[1];
      data[10] = mScat[2];
      const mExt = config.mieExtinction ?? [44e-4, 44e-4, 44e-4];
      data[12] = mExt[0];
      data[13] = mExt[1];
      data[14] = mExt[2];
      const oAbs = config.ozoneAbsorption ?? [65e-5, 188e-5, 85e-6];
      data[16] = oAbs[0];
      data[17] = oAbs[1];
      data[18] = oAbs[2];
      data[19] = config.ozoneCenterH ?? 25;
      data[20] = config.ozoneWidth ?? 15;
      u32Data[28] = this.tSize[0];
      u32Data[29] = this.tSize[1];
      u32Data[32] = this.sSize[0];
      u32Data[33] = this.sSize[1];
      u32Data[34] = this.sSize[2];
      u32Data[35] = this.sSize[3];
      this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    generate(commandEncoder) {
      const isInternalEncoder = !commandEncoder;
      const encoder = commandEncoder || this.device.createCommandEncoder();
      const tPass = encoder.beginComputePass();
      tPass.setPipeline(this.transmittancePipeline);
      tPass.setBindGroup(0, this.bindGroup);
      tPass.dispatchWorkgroups(
        Math.ceil(this.tSize[0] / 8),
        Math.ceil(this.tSize[1] / 8)
      );
      tPass.end();
      const sPass = encoder.beginComputePass();
      sPass.setPipeline(this.scatteringPipeline);
      sPass.setBindGroup(0, this.bindGroup);
      sPass.dispatchWorkgroups(
        Math.ceil(this.sSize[0] * this.sSize[1] / 8),
        Math.ceil(this.sSize[2] / 8),
        Math.ceil(this.sSize[3] / 8)
      );
      sPass.end();
      if (isInternalEncoder) {
        this.device.queue.submit([encoder.finish()]);
      }
    }
    destroy() {
      this.transmittanceTexture.destroy();
      this.scatteringTexture.destroy();
      this.singleMieTexture.destroy();
      this.uniformBuffer.destroy();
    }
  };

  // algorithms/v6/composite_pipeline.ts
  var RENDER_SIZE2 = 512;
  var SKY_SIZE = 512;
  async function v6CompositePipeline(device, canvas, compositeShaderSource, config) {
    const context = canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat });
    const skyviewSource = await fetch(`./v6/skyview.wgsl?t=${Date.now()}`).then((r) => r.text());
    const proceduralSkyviewSource = await fetch(`./v6/procedural_skyview.wgsl?t=${Date.now()}`).then((r) => r.text());
    const glassPrecomputeSource = await fetch(`./v6/glass-precompute.wgsl?t=${Date.now()}`).then((r) => r.text());
    const presentSource = await fetch(`./v6/present.wgsl?t=${Date.now()}`).then((r) => r.text());
    const atmoPrecomputeSource = await fetch(`./v6/atmosphere_precompute.wgsl?t=${Date.now()}`).then((r) => r.text());
    const skyviewModule = device.createShaderModule({ code: skyviewSource });
    const proceduralSkyviewModule = device.createShaderModule({ code: proceduralSkyviewSource });
    const glassPrecomputeModule = device.createShaderModule({ code: glassPrecomputeSource });
    const compositeModule = device.createShaderModule({ code: compositeShaderSource });
    const presentModule = device.createShaderModule({ code: presentSource });
    const atmosphereGenerator = new AtmosphereGenerator(device, atmoPrecomputeSource, {
      bottomRadius: 6360,
      topRadius: 6420
    });
    atmosphereGenerator.generate();
    const skyviewPipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: skyviewModule, entryPoint: "main" }
    });
    const proceduralSkyviewPipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: proceduralSkyviewModule, entryPoint: "main" }
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
    const skyMipCount = Math.floor(Math.log2(SKY_SIZE)) + 1;
    const skyTex = device.createTexture({
      size: [SKY_SIZE, SKY_SIZE],
      format: "rgba16float",
      mipLevelCount: skyMipCount,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
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
    const linearSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
    const skyParamsBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const proceduralSkyParamsBuffer = device.createBuffer({
      size: 32,
      // sunDir(12)+pad(4), time(4), bgType(4), skySize(8)
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
    const mipmapShader = `
    @vertex fn vs(@builtin(vertex_index) v_idx: u32) -> @builtin(position) vec4f {
      let pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      return vec4f(pos[v_idx], 0.0, 1.0);
    }
    @group(0) @binding(0) var tex: texture_2d<f32>;
    @group(0) @binding(1) var samp: sampler;
    @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
      let size = vec2f(textureDimensions(tex));
      return textureSampleLevel(tex, samp, pos.xy / size, 0.0);
    }
  `;
    const mipmapModule = device.createShaderModule({ code: mipmapShader });
    const mipmapPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mipmapModule, entryPoint: "vs" },
      fragment: { module: mipmapModule, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" }
    });
    const skyviewBG = device.createBindGroup({
      layout: skyviewPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearSampler },
        { binding: 1, resource: atmosphereGenerator.transmittanceTexture.createView() },
        { binding: 2, resource: atmosphereGenerator.scatteringTexture.createView() },
        { binding: 3, resource: atmosphereGenerator.singleMieTexture.createView() },
        { binding: 4, resource: skyTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 5, resource: { buffer: skyParamsBuffer } }
      ]
    });
    const proceduralSkyviewBG = device.createBindGroup({
      layout: proceduralSkyviewPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: skyTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: proceduralSkyParamsBuffer } }
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
    let lastSkyConfig = "";
    let lastGlassConfig = "";
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
        const currentSkyConfig = JSON.stringify({
          bgType: config.bgType ?? 2,
          mieG: config.mieG,
          cameraHeight: config.cameraHeight,
          sunAzimuth: config.sunAzimuth,
          sunElevation: config.sunElevation
        });
        const skyDirty = currentSkyConfig !== lastSkyConfig;
        if (skyDirty) lastSkyConfig = currentSkyConfig;
        const currentGlassConfig = JSON.stringify({
          cameraDist: config.cameraDist,
          thickness: config.thickness,
          frontLfAmp: config.frontLfAmp,
          frontHfAmp: config.frontHfAmp,
          backLfAmp: config.backLfAmp,
          backHfAmp: config.backHfAmp,
          etaGlass: config.etaGlass
        });
        const glassDirty = currentGlassConfig !== lastGlassConfig;
        if (glassDirty) lastGlassConfig = currentGlassConfig;
        const encoder = device.createCommandEncoder();
        if (skyDirty) {
          const bgType = config.bgType ?? 2;
          const az = config.sunAzimuth ?? 0.58;
          const el = config.sunElevation ?? 0.055;
          const sx = Math.cos(az) * Math.cos(el);
          const sy = Math.sin(el);
          const sz = Math.sin(az) * Math.cos(el);
          if (bgType === 2) {
            const skyParams = new ArrayBuffer(96);
            const skyF32 = new Float32Array(skyParams);
            const skyU32 = new Uint32Array(skyParams);
            skyF32[0] = 6360;
            skyF32[1] = 6420;
            skyF32[2] = -0.2;
            skyF32[3] = 4675e-6;
            skyF32[4] = config.mieG ?? 0.8;
            skyF32[5] = config.cameraHeight ?? 0.1;
            skyF32[6] = time;
            skyF32[7] = 0;
            skyF32[8] = sx;
            skyF32[9] = sy;
            skyF32[10] = sz;
            skyU32[12] = 256;
            skyU32[13] = 64;
            skyU32[16] = 8;
            skyU32[17] = 128;
            skyU32[18] = 32;
            skyU32[19] = 32;
            skyU32[20] = SKY_SIZE;
            skyU32[21] = SKY_SIZE;
            device.queue.writeBuffer(skyParamsBuffer, 0, skyParams);
            const pass1 = encoder.beginComputePass();
            pass1.setPipeline(skyviewPipeline);
            pass1.setBindGroup(0, skyviewBG);
            pass1.dispatchWorkgroups(Math.ceil(SKY_SIZE / 8), Math.ceil(SKY_SIZE / 8));
            pass1.end();
          } else {
            const pSkyParams = new ArrayBuffer(32);
            const pF32 = new Float32Array(pSkyParams);
            const pU32 = new Uint32Array(pSkyParams);
            pF32[0] = sx;
            pF32[1] = sy;
            pF32[2] = sz;
            pF32[3] = time;
            pU32[4] = bgType;
            pU32[5] = 0;
            pU32[6] = SKY_SIZE;
            pU32[7] = SKY_SIZE;
            device.queue.writeBuffer(proceduralSkyParamsBuffer, 0, pSkyParams);
            const pass1 = encoder.beginComputePass();
            pass1.setPipeline(proceduralSkyviewPipeline);
            pass1.setBindGroup(0, proceduralSkyviewBG);
            pass1.dispatchWorkgroups(Math.ceil(SKY_SIZE / 8), Math.ceil(SKY_SIZE / 8));
            pass1.end();
          }
          for (let i = 1; i < skyMipCount; i++) {
            const mipBindGroup = device.createBindGroup({
              layout: mipmapPipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: skyTex.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) },
                { binding: 1, resource: linearSampler }
              ]
            });
            const mipPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: skyTex.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store"
              }]
            });
            mipPass.setPipeline(mipmapPipeline);
            mipPass.setBindGroup(0, mipBindGroup);
            mipPass.draw(3);
            mipPass.end();
          }
        }
        if (glassDirty) {
          const glassParams = new Float32Array(16);
          const glassU32 = new Uint32Array(glassParams.buffer);
          glassU32[0] = RENDER_SIZE2;
          glassU32[1] = RENDER_SIZE2;
          glassParams[2] = 1 / RENDER_SIZE2;
          glassParams[3] = 1 / RENDER_SIZE2;
          glassParams[4] = 1;
          glassParams[5] = config.cameraDist ?? 1.65;
          glassParams[6] = config.thickness ?? 0.06;
          glassParams[7] = config.frontLfAmp ?? 0.1;
          glassParams[8] = config.frontHfAmp ?? 0.05;
          glassParams[9] = config.backLfAmp ?? 0.1;
          glassParams[10] = config.backHfAmp ?? 0.05;
          glassParams[11] = config.etaGlass ?? 1.52;
          device.queue.writeBuffer(glassParamsBuffer, 0, glassParams);
          const pass2 = encoder.beginComputePass();
          pass2.setPipeline(glassPrecomputePipeline);
          pass2.setBindGroup(0, glassPrecomputeBG);
          pass2.dispatchWorkgroups(Math.ceil(RENDER_SIZE2 / 8), Math.ceil(RENDER_SIZE2 / 8));
          pass2.end();
        }
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
        atmosphereGenerator.destroy();
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
    const glassGenResponse = await fetch(`./core/glass_generator.wgsl?t=${Date.now()}`);
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
    const shaderResponse = await fetch(`./algorithms/v7/renderer.wgsl?t=${Date.now()}`);
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
      size: 128,
      // 8 * 4 * 4 bytes
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
        { binding: 3, resource: linearSampler }
      ]
    });
    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: displayTexture.createView() }
      ]
    });
    const renderParamsBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } }
      ]
    });
    let debugParamsBindGroup = null;
    const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
    const debugContexts = [];
    let debugPipeline = null;
    const debugBindGroups = [];
    for (const id of debugIds) {
      const el = document.getElementById(id);
      if (el) {
        const ctx = el.getContext("webgpu");
        ctx.configure({ device, format: canvasFormat });
        debugContexts.push(ctx);
      }
    }
    if (debugContexts.length === 4) {
      debugPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_fullscreen" },
        fragment: { module: shaderModule, entryPoint: "fs_debug", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" }
      });
      debugParamsBindGroup = device.createBindGroup({
        layout: debugPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 2, resource: glassGenerator.texture.createView() },
          { binding: 3, resource: linearSampler }
        ]
      });
      for (let i = 0; i < 4; i++) {
        const buf = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(buf, 0, new Float32Array([i, 0, 0, 0]));
        debugBindGroups.push(device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(2),
          entries: [
            { binding: 0, resource: { buffer: buf } }
          ]
        }));
      }
    }
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
      const params = new Float32Array(32);
      params[0] = RENDER_SIZE3;
      params[1] = RENDER_SIZE3;
      params[2] = (performance.now() - startTime) / 1e3;
      params[3] = frame;
      params[4] = 1;
      params[5] = 1;
      params[6] = 1;
      params[7] = 1;
      params[8] = 0;
      params[9] = config.bgType ?? 0;
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
      params[28] = config.splitView ? 1 : 0;
      params[29] = 0;
      params[30] = 0;
      params[31] = 0;
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
        renderPass.setBindGroup(0, renderParamsBindGroup);
        renderPass.setBindGroup(1, renderBindGroup);
        renderPass.draw(3);
        renderPass.end();
        if (config.splitView && debugPipeline && debugBindGroups.length === 4 && debugContexts.length === 4) {
          for (let i = 0; i < 4; i++) {
            const debugPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: debugContexts[i].getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store"
              }]
            });
            debugPass.setPipeline(debugPipeline);
            debugPass.setBindGroup(0, debugParamsBindGroup);
            debugPass.setBindGroup(2, debugBindGroups[i]);
            debugPass.draw(3);
            debugPass.end();
          }
        }
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
    const glassGenResponse = await fetch(`./core/glass_generator.wgsl?t=${Date.now()}`);
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
      size: 128,
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
    const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
    const debugContexts = [];
    let debugPipeline = null;
    const debugBindGroups = [];
    for (const id of debugIds) {
      const el = document.getElementById(id);
      if (el) {
        const ctx = el.getContext("webgpu");
        ctx.configure({ device, format: canvasFormat });
        debugContexts.push(ctx);
      }
    }
    if (debugContexts.length === 4) {
      debugPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_fullscreen" },
        fragment: { module: shaderModule, entryPoint: "fs_debug", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" }
      });
      for (let i = 0; i < 4; i++) {
        const buf = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(buf, 0, new Float32Array([i, 0, 0, 0]));
        debugBindGroups.push(device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(2),
          entries: [
            { binding: 0, resource: { buffer: buf } }
          ]
        }));
      }
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
      const params = new Float32Array(32);
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
      params[28] = config.splitView ? 1 : 0;
      params[29] = config.bgType ?? 0;
      params[30] = 0;
      params[31] = 0;
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
        if (config.splitView && debugPipeline && debugBindGroups.length === 4 && debugContexts.length === 4) {
          for (let i = 0; i < 4; i++) {
            const debugPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: debugContexts[i].getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store"
              }]
            });
            debugPass.setPipeline(debugPipeline);
            debugPass.setBindGroup(0, glassComputeBindGroup);
            debugPass.setBindGroup(2, debugBindGroups[i]);
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

  // core/background_manager.ts
  var BackgroundManager = class {
    device;
    texture = null;
    sampler;
    mathPipeline = null;
    mathBindGroup = null;
    mathUniforms = null;
    brunetonPipeline = null;
    atmosphere = null;
    constructor(device) {
      this.device = device;
      this.sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        // Equirectangular wraps horizontally
        addressModeV: "clamp-to-edge"
      });
    }
    async getBackground(type, sunDir, resolution = 1024) {
      const height = resolution / 2;
      if (!this.texture || this.texture.width !== resolution) {
        if (this.texture) this.texture.destroy();
        this.texture = this.device.createTexture({
          size: [resolution, height, 1],
          format: "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        this.mathPipeline = null;
      }
      if (type === "math") {
        await this.renderMathSky(sunDir, resolution, height);
      } else {
        await this.renderBrunetonSky(sunDir, resolution, height);
      }
      return this.texture;
    }
    async renderMathSky(sunDir, width, height) {
      if (!this.mathPipeline) {
        const response = await fetch("./core/math_sky_generator.wgsl");
        const shader = await response.text();
        const module = this.device.createShaderModule({ code: shader });
        this.mathPipeline = this.device.createComputePipeline({
          layout: "auto",
          compute: { module, entryPoint: "main" }
        });
        this.mathUniforms = this.device.createBuffer({
          size: 48,
          // 12 floats
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.mathBindGroup = this.device.createBindGroup({
          layout: this.mathPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.texture.createView() },
            { binding: 1, resource: { buffer: this.mathUniforms } }
          ]
        });
      }
      const data = new Float32Array([
        width,
        height,
        performance.now() / 1e3,
        0,
        sunDir[0],
        sunDir[1],
        0,
        8,
        3,
        0,
        0,
        0
      ]);
      this.device.queue.writeBuffer(this.mathUniforms, 0, data);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.mathPipeline);
      pass.setBindGroup(0, this.mathBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    async renderBrunetonSky(sunDir, width, height) {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.texture.createView(),
          clearValue: { r: 0.1, g: 0.2, b: 0.8, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }]
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    getSampler() {
      return this.sampler;
    }
    destroy() {
      if (this.texture) this.texture.destroy();
      if (this.mathUniforms) this.mathUniforms.destroy();
      if (this.atmosphere) this.atmosphere.destroy();
    }
  };

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
        showOutdoorOnly: false,
        bgType: 0
      },
      uiGroups: {
        "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
        "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "showOutdoorOnly"]
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
        birefringence: false,
        bgType: 0
      },
      uiGroups: {
        "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
        "Glass Physical": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
        "Glass Optics": ["milkyScattering", "dispersion", "birefringence"],
        "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"]
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
        staticScene: true,
        bgType: 0
      },
      uiGroups: {
        "Renderer": ["baseSamples", "maxSamples", "targetError", "varianceBoost", "outlierK", "exposure", "adaptiveSampling", "staticScene"],
        "Glass": ["glassPatternType", "glassThickness", "glassHeightAmpl", "glassBump", "glassRoughness", "glassScale", "glassFrontOffsetX", "glassFrontOffsetY", "glassBackOffsetX", "glassBackOffsetY", "glassDistortion", "glassIor"],
        "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraZ", "cameraFocal", "cloudSteps", "sunShadowSteps"]
      }
    },
    v6_webgpu: {
      name: "v6_webgpu",
      label: "V6 WebGPU (Bruneton)",
      pipeline: v6CompositePipeline,
      shaderPath: "./v6/composite.wgsl",
      defaultConfig: {
        sunAzimuth: 0.58,
        sunElevation: 0.055,
        mieG: 0.8,
        cameraHeight: 0.1,
        cameraDist: 1.65,
        thickness: 0.06,
        frontLfAmp: 0.1,
        frontHfAmp: 0.05,
        backLfAmp: 0.1,
        backHfAmp: 0.05,
        etaGlass: 1.52,
        dispersionScale: 5e-3,
        sigmaToLod: 512,
        bgType: 2
      },
      uiGroups: {
        "Background & Camera": ["bgType", "sunAzimuth", "sunElevation", "cameraHeight", "cameraDist", "mieG"],
        "Glass": ["thickness", "etaGlass", "dispersionScale", "sigmaToLod", "frontLfAmp", "frontHfAmp", "backLfAmp", "backHfAmp"]
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
    controls: null,
    bgManager: null
  };
  async function init() {
    const adapter = await navigator.gpu.requestAdapter();
    state.device = await adapter.requestDevice();
    state.canvas = document.querySelector("#canvas");
    state.bgManager = new BackgroundManager(state.device);
    const viewModePicker = document.querySelector("#view-mode");
    const bgPicker = document.querySelector("#bg-picker");
    const debugLeft = document.getElementById("debug-left");
    const debugRight = document.getElementById("debug-right");
    const debugMainTitle = document.getElementById("debug-main-title");
    viewModePicker.addEventListener("change", (e) => {
      const isSplit = e.target.value === "split";
      state.config.splitView = isSplit;
      if (debugLeft) debugLeft.style.display = isSplit ? "flex" : "none";
      if (debugRight) debugRight.style.display = isSplit ? "flex" : "none";
      if (debugMainTitle) debugMainTitle.style.display = isSplit ? "block" : "none";
    });
    bgPicker.addEventListener("change", (e) => {
      state.config.bgType = e.target.value;
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
    await switchAlgorithm("v1_refined");
    renderLoop();
  }
  async function switchAlgorithm(algoName) {
    if (state.renderer) {
      state.renderer.dispose();
      state.renderer = null;
    }
    if (state.controls) {
      state.controls.destroy();
      state.controls = null;
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
      const currentBgType = state.config.bgType ?? "math";
      state.config = {
        ...meta.defaultConfig,
        splitView: currentSplitView,
        bgType: currentBgType,
        bgManager: state.bgManager
      };
      const debugLeft = document.getElementById("debug-left");
      const debugRight = document.getElementById("debug-right");
      const debugMainTitle = document.getElementById("debug-main-title");
      if (debugLeft) debugLeft.style.display = currentSplitView ? "flex" : "none";
      if (debugRight) debugRight.style.display = currentSplitView ? "flex" : "none";
      if (debugMainTitle) debugMainTitle.style.display = currentSplitView ? "block" : "none";
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
          } else if (key === "glassPatternType" || key === "bgType") {
            input = document.createElement("select");
            let options = [];
            if (key === "glassPatternType") {
              options = [
                { value: 2, label: "Pebbled with slight frost" },
                { value: 0, label: "FBM Wavy" },
                { value: 1, label: "Frosted Flat" },
                { value: 3, label: "Ribbed/Fluted" }
              ];
            } else if (key === "bgType") {
              options = [
                { value: 0, label: "City Skyline" },
                { value: 1, label: "Beach Sunset" },
                { value: 2, label: "Bruneton Physical Atmosphere" }
              ];
            }
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
        if (key === "glassPatternType") {
          const type = Number(value);
          let updates = {};
          if (type === 0) {
            updates = { glassHeightAmpl: 0.05, glassBump: 0.2, glassScale: 1, glassDistortion: 1 };
          } else if (type === 1) {
            updates = { glassHeightAmpl: 0, glassBump: 0, glassScale: 1, glassDistortion: 0.1, glassRoughness: 0.8 };
          } else if (type === 2) {
            updates = { glassHeightAmpl: 0.01, glassBump: 0.19, glassScale: 1, glassDistortion: 1 };
          } else if (type === 3) {
            updates = { glassHeightAmpl: 0.03, glassBump: 0.1, glassScale: 2, glassDistortion: 1 };
          }
          for (const [k, v] of Object.entries(updates)) {
            if (k in state.config) {
              state.config[k] = v;
              state.controls.set(k, v);
            }
          }
        }
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
})();
//# sourceMappingURL=app.bundle.js.map
