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
    const glassComputeBindGroup = device.createBindGroup({
      layout: glassComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: stateBuffer } },
        { binding: 2, resource: displayTexture.createView() },
        { binding: 3, resource: { buffer: statsBuffer } },
        { binding: 4, resource: backgroundTexture.createView() }
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
      entries: [{ binding: 0, resource: { buffer: paramsBuffer } }]
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
      params[25] = 0;
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
        const shouldReadStats = now - lastReadMs > 250;
        if (shouldReadStats) {
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
  async function v6CompositePipeline(device, canvas, shaderSource, config) {
    let frameCount = 0;
    const stats = {
      fps: 0,
      frameMs: 0,
      status: "v6 not yet fully implemented"
    };
    let lastFrameTime = performance.now();
    return {
      name: "v6_webgpu",
      async render(timestamp) {
        const now = performance.now();
        const frameDelta = now - lastFrameTime;
        lastFrameTime = now;
        stats.frameMs = frameDelta;
        stats.fps = frameDelta > 0 ? 1e3 / frameDelta : 0;
        frameCount++;
      },
      getStats() {
        return { ...stats };
      },
      dispose() {
      }
    };
  }

  // algorithms/v3/glass_pipeline.ts
  async function v3GlassPipeline(device, canvas, shaderSource, config) {
    return {
      name: "v3_glsl",
      async render(timestamp) {
      },
      getStats() {
        return { status: "Not yet integrated (requires GLSL to WGSL transcription)" };
      },
      dispose() {
      }
    };
  }

  // algorithms/v4/glass_pipeline.ts
  async function v4GlassPipeline(device, canvas, shaderSource, config) {
    return {
      name: "v4_webgl2",
      async render(timestamp) {
      },
      getStats() {
        return { status: "Not yet integrated (requires WebGL2 context setup)" };
      },
      dispose() {
      }
    };
  }

  // app.ts
  var ALGORITHMS = {
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
        glassPatternType: 0,
        glassIor: 1.52,
        cloudSteps: 8,
        sunShadowSteps: 3,
        adaptiveSampling: true,
        staticScene: true
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
      label: "V3 GLSL (Stub)",
      pipeline: v3GlassPipeline,
      shaderPath: "./v3/bathroom-glass-optical-simulator.glsl",
      defaultConfig: {}
    },
    v4_webgl2: {
      name: "v4_webgl2",
      label: "V4 WebGL2 (Stub)",
      pipeline: v4GlassPipeline,
      shaderPath: "./v4/README.md",
      defaultConfig: {}
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
    }
    if (state.controls) {
      state.controls.destroy();
    }
    const meta = ALGORITHMS[algoName];
    try {
      const response = await fetch(meta.shaderPath);
      if (!response.ok) throw new Error(`Failed to load shader: ${meta.shaderPath}`);
      const source = await response.text();
      state.config = { ...meta.defaultConfig };
      state.renderer = await meta.pipeline(state.device, state.canvas, source, state.config);
      state.currentAlgo = algoName;
      const controlForm = document.querySelector("#controls");
      controlForm.innerHTML = "";
      const defaultConfig = meta.defaultConfig;
      for (const [key, defaultValue] of Object.entries(defaultConfig)) {
        const label = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = key;
        let input;
        if (typeof defaultValue === "boolean") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = defaultValue;
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
        controlForm.appendChild(label);
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
})();
//# sourceMappingURL=app.bundle.js.map
