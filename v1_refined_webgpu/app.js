const RENDER_SIZE = 512;
const BACKGROUND_SIZE = 256;
const WORKGROUP_SIZE = 8;
const BACKGROUND_AFFECTING_KEYS = new Set([
  "staticScene",
  "sunAzimuth",
  "sunElevation",
  "cloudSteps",
  "sunShadowSteps",
]);
const NON_RESET_KEYS = new Set([
  "showConfidence",
  "showOutdoorOnly",
  "exposure",
]);

const FLOAT_OUTPUTS = [
  ["targetError", 3],
  ["varianceBoost", 2],
  ["outlierK", 1],
  ["exposure", 2],
  ["sunAzimuth", 2],
  ["sunElevation", 3],
  ["glassThickness", 3],
  ["glassBump", 3],
  ["glassRoughness", 3],
];

const DEFAULT_CONFIG = {
  adaptiveSampling: true,
  staticScene: true,
  showConfidence: false,
  showOutdoorOnly: false,
  baseSamples: 2,
  maxSamples: 8,
  cloudSteps: 8,
  sunShadowSteps: 3,
  targetError: 0.06,
  varianceBoost: 1.2,
  outlierK: 3.0,
  exposure: 1.18,
  sunAzimuth: 0.58,
  sunElevation: 0.055,
  cameraZ: 1.65,
  cameraFocal: 1.85,
  glassThickness: 0.06,
  glassHeightAmpl: 0.01,
  glassBump: 0.19,
  glassRoughness: 0.085,
  glassIor: 1.52,
};

const app = {
  canvas: document.querySelector("#gpu-canvas"),
  form: document.querySelector("#controls-form"),
  errorLog: document.querySelector("#error-log"),
  summaryCopy: document.querySelector("#summary-copy"),
  detailCopy: document.querySelector("#detail-copy"),
  statusBackend: document.querySelector("#status-backend"),
  statusResolution: document.querySelector("#status-resolution"),
  statusBackground: document.querySelector("#status-background"),
  statusFrame: document.querySelector("#status-frame"),
  resetButton: document.querySelector("#reset-button"),
  metrics: {
    fps: document.querySelector("#metric-fps"),
    ms: document.querySelector("#metric-ms"),
    spp: document.querySelector("#metric-spp"),
    confident: document.querySelector("#metric-confident"),
    stable: document.querySelector("#metric-stable"),
    adaptive: document.querySelector("#metric-adaptive"),
    bright: document.querySelector("#metric-bright"),
    dark: document.querySelector("#metric-dark"),
  },
  config: { ...DEFAULT_CONFIG },
  gpu: null,
  frame: 0,
  startedAt: performance.now(),
  shaderSource: "",
  rafId: 0,
  perf: {
    lastFrameTime: performance.now(),
    smoothedMs: 0,
    fps: 0,
  },
  stats: {
    readPending: false,
    lastReadMs: 0,
    gpu: {
      totalSamples: 0,
      confidentPixels: 0,
      stablePixels: 0,
      adaptivePixels: 0,
      unresolvedPixels: 0,
      brightUnresolved: 0,
      darkUnresolved: 0,
    },
    background: {
      totalSamples: 0,
      confidentTexels: 0,
      stableTexels: 0,
      adaptiveTexels: 0,
    },
  },
};

bindControls();
updateOutputs();

void boot();

async function boot() {
  if (!navigator.gpu) {
    fail("WebGPU is not available in this browser.");
    return;
  }

  try {
    app.shaderSource = await fetchText("./renderer.wgsl");
    await initGpu();
    resetAccumulation();
    app.rafId = requestAnimationFrame(frameLoop);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function initGpu() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("Failed to acquire a WebGPU adapter.");
  }

  const device = await adapter.requestDevice();
  const context = app.canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to acquire a WebGPU canvas context.");
  }

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  app.canvas.width = RENDER_SIZE;
  app.canvas.height = RENDER_SIZE;

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "opaque",
  });

  const shaderModule = device.createShaderModule({ code: app.shaderSource });
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main_compute",
    },
  });

  const backgroundComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main_background_compute",
    },
  });

  const renderPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_fullscreen",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_display",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
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
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const stateBuffer = device.createBuffer({
    size: stateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const backgroundStateBuffer = device.createBuffer({
    size: backgroundStateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const statsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const backgroundStatsBuffer = device.createBuffer({
    size: statsBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const statsReadBuffer = device.createBuffer({
    size: combinedStatsBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const displayTexture = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const backgroundTexture = device.createTexture({
    size: [BACKGROUND_SIZE, BACKGROUND_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const glassComputeBindGroup = device.createBindGroup({
    layout: glassComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: stateBuffer } },
      { binding: 2, resource: displayTexture.createView() },
      { binding: 3, resource: { buffer: statsBuffer } },
      { binding: 4, resource: backgroundTexture.createView() },
    ],
  });

  const backgroundComputeBindGroup = device.createBindGroup({
    layout: backgroundComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: backgroundStateBuffer } },
      { binding: 2, resource: backgroundTexture.createView() },
      { binding: 3, resource: { buffer: backgroundStatsBuffer } },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() },
      { binding: 1, resource: backgroundTexture.createView() },
    ],
  });

  const renderParamsBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });

  app.gpu = {
    adapter,
    device,
    context,
    glassComputePipeline,
    backgroundComputePipeline,
    renderPipeline,
    paramsBuffer,
    stateBuffer,
    backgroundStateBuffer,
    displayTexture,
    backgroundTexture,
    glassComputeBindGroup,
    backgroundComputeBindGroup,
    renderBindGroup,
    renderParamsBindGroup,
    zeroState,
    zeroBackgroundState,
    statsBuffer,
    backgroundStatsBuffer,
    statsReadBuffer,
    zeroStats,
    statsBufferSize,
    combinedStatsBufferSize,
    backgroundFrozen: false,
  };

  device.lost.then((info) => {
    fail(`WebGPU device lost: ${info.message}`);
  });

  app.statusBackend.textContent = "WebGPU compute";
  app.statusResolution.textContent = `${RENDER_SIZE} x ${RENDER_SIZE}`;
}

function bindControls() {
  app.form.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;
    const eventName = input.type === "range" ? "input" : "change";

    input.addEventListener(eventName, () => {
      if (input.type === "checkbox") {
        app.config[key] = input.checked;
      } else {
        app.config[key] = Number(input.value);
      }

      if (key === "maxSamples" && app.config.maxSamples < app.config.baseSamples) {
        app.config.maxSamples = app.config.baseSamples;
        const maxSamplesInput = app.form.querySelector('[data-setting="maxSamples"]');
        maxSamplesInput.value = String(app.config.maxSamples);
      }

      if (key === "baseSamples" && app.config.baseSamples > app.config.maxSamples) {
        app.config.maxSamples = app.config.baseSamples;
        const maxSamplesInput = app.form.querySelector('[data-setting="maxSamples"]');
        maxSamplesInput.value = String(app.config.maxSamples);
      }

      updateOutputs();
      if (NON_RESET_KEYS.has(key)) {
        return;
      }

      if (BACKGROUND_AFFECTING_KEYS.has(key)) {
        resetAccumulation();
      } else {
        resetGlassAccumulation();
      }
    });
  });

  app.resetButton.addEventListener("click", () => {
    resetAccumulation();
  });
}

function updateOutputs() {
  for (const [key, digits] of FLOAT_OUTPUTS) {
    const output = document.querySelector(`[data-output="${key}"]`);
    if (!output) continue;
    const value = Number(app.config[key]).toFixed(digits);
    output.value = value;
    output.textContent = value;
  }
}

function resetAccumulation() {
  resetBackgroundAccumulation();
  resetGlassAccumulation();
}

function resetBackgroundAccumulation() {
  if (!app.gpu) {
    return;
  }

  app.gpu.backgroundFrozen = false;
  app.gpu.device.queue.writeBuffer(app.gpu.backgroundStateBuffer, 0, app.gpu.zeroBackgroundState);
  app.gpu.device.queue.writeBuffer(app.gpu.backgroundStatsBuffer, 0, app.gpu.zeroStats);
  app.stats.background = {
    totalSamples: 0,
    confidentTexels: 0,
    stableTexels: 0,
    adaptiveTexels: 0,
  };
}

function resetGlassAccumulation() {
  if (!app.gpu) {
    return;
  }

  app.frame = 0;
  app.startedAt = performance.now();
  app.perf.lastFrameTime = performance.now();
  app.gpu.device.queue.writeBuffer(app.gpu.stateBuffer, 0, app.gpu.zeroState);
  app.gpu.device.queue.writeBuffer(app.gpu.statsBuffer, 0, app.gpu.zeroStats);
  app.stats.gpu = {
    totalSamples: 0,
    confidentPixels: 0,
    stablePixels: 0,
    adaptivePixels: 0,
    unresolvedPixels: 0,
    brightUnresolved: 0,
    darkUnresolved: 0,
  };
  updateMetricCards();
}

function frameLoop() {
  app.rafId = 0;

  if (!app.gpu) {
    return;
  }

  const now = performance.now();
  const frameDelta = now - app.perf.lastFrameTime;
  app.perf.lastFrameTime = now;
  app.perf.smoothedMs = app.perf.smoothedMs === 0 ? frameDelta : app.perf.smoothedMs * 0.9 + frameDelta * 0.1;
  app.perf.fps = app.perf.smoothedMs > 0 ? 1000 / app.perf.smoothedMs : 0;

  const {
    device,
    context,
    glassComputePipeline,
    backgroundComputePipeline,
    renderPipeline,
    glassComputeBindGroup,
    backgroundComputeBindGroup,
    renderBindGroup,
    renderParamsBindGroup,
    paramsBuffer,
    statsBuffer,
    backgroundStatsBuffer,
    statsReadBuffer,
    zeroStats,
    statsBufferSize,
    combinedStatsBufferSize,
  } = app.gpu;
  device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock());
  device.queue.writeBuffer(statsBuffer, 0, zeroStats);
  const runBackgroundPass = !app.gpu.backgroundFrozen || !app.config.staticScene;
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
        storeOp: "store",
      },
    ],
  });
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, renderParamsBindGroup);
  renderPass.setBindGroup(1, renderBindGroup);
  renderPass.draw(3);
  renderPass.end();

  const shouldReadStats = !app.stats.readPending && now - app.stats.lastReadMs > 250;
  if (shouldReadStats) {
    if (runBackgroundPass) {
      encoder.copyBufferToBuffer(backgroundStatsBuffer, 0, statsReadBuffer, 0, statsBufferSize);
    }
    encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, statsBufferSize, statsBufferSize);
    app.stats.readPending = true;
    app.stats.lastReadMs = now;
  }

  device.queue.submit([encoder.finish()]);

  if (shouldReadStats) {
    readGpuStats(runBackgroundPass);
  }

  app.frame += 1;
  app.statusFrame.textContent = `frame ${app.frame}`;
  updateMetricCards();
  clearError();
  app.rafId = requestAnimationFrame(frameLoop);
}

function buildParamBlock() {
  const values = new Float32Array(28);
  values.set([RENDER_SIZE, RENDER_SIZE, elapsedSeconds(), app.frame], 0);
  values.set([app.config.baseSamples, app.config.maxSamples, app.config.cloudSteps, app.config.sunShadowSteps], 4);
  values.set([
    app.config.staticScene ? 1 : 0,
    app.config.adaptiveSampling ? 1 : 0,
    app.config.showConfidence ? 1 : 0,
    app.config.targetError,
  ], 8);
  values.set([
    app.config.varianceBoost,
    app.config.outlierK,
    app.config.exposure,
    app.config.showOutdoorOnly ? 1 : 0,
  ], 12);
  values.set([app.config.sunAzimuth, app.config.sunElevation, app.config.cameraZ, app.config.cameraFocal], 16);
  values.set([app.config.glassThickness, app.config.glassHeightAmpl, app.config.glassBump, app.config.glassRoughness], 20);
  values.set([app.config.glassIor, 0, 0, 0], 24);
  return values;
}

function elapsedSeconds() {
  return (performance.now() - app.startedAt) * 0.001;
}

async function readGpuStats(didReadBackgroundStats) {
  try {
    await app.gpu.statsReadBuffer.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(app.gpu.statsReadBuffer.getMappedRange()).slice();
    app.gpu.statsReadBuffer.unmap();
    app.stats.readPending = false;
    if (didReadBackgroundStats) {
      app.stats.background = {
        totalSamples: copy[0],
        confidentTexels: copy[1],
        stableTexels: copy[2],
        adaptiveTexels: copy[3],
      };
    }
    app.stats.gpu = {
      totalSamples: copy[8],
      confidentPixels: copy[9],
      stablePixels: copy[10],
      adaptivePixels: copy[11],
      unresolvedPixels: copy[12],
      brightUnresolved: copy[13],
      darkUnresolved: copy[14],
    };
    updateBackgroundStatus();
  } catch (error) {
    app.stats.readPending = false;
    showError(error instanceof Error ? error.message : String(error));
  }
}

function updateMetricCards() {
  const totalPixels = RENDER_SIZE * RENDER_SIZE;
  const gpuStats = app.stats.gpu;
  const avgSpp = gpuStats.totalSamples > 0 ? gpuStats.totalSamples / totalPixels : 0;
  const parkedRatio = gpuStats.stablePixels / totalPixels;
  const activeRatio = Math.max(0, 1 - parkedRatio);

  app.metrics.fps.textContent = app.perf.fps.toFixed(1);
  app.metrics.ms.textContent = app.perf.smoothedMs.toFixed(2);
  app.metrics.spp.textContent = avgSpp.toFixed(2);
  app.metrics.confident.textContent = formatPercent(gpuStats.confidentPixels / totalPixels);
  app.metrics.stable.textContent = formatPercent(parkedRatio);
  app.metrics.adaptive.textContent = formatPercent(gpuStats.adaptivePixels / totalPixels);
  app.metrics.bright.textContent = formatPercent(gpuStats.brightUnresolved / totalPixels);
  app.metrics.dark.textContent = formatPercent(gpuStats.darkUnresolved / totalPixels);
  updateBottleneckSummary(activeRatio);
}

function updateBackgroundStatus() {
  const totalTexels = BACKGROUND_SIZE * BACKGROUND_SIZE;
  const bg = app.stats.background;
  const stableRatio = bg.stableTexels / totalTexels;
  const confidentRatio = bg.confidentTexels / totalTexels;
  const activeRatio = Math.max(0, 1 - stableRatio);

  if (app.config.staticScene && stableRatio >= 0.985) {
    app.gpu.backgroundFrozen = true;
  }

  if (app.gpu.backgroundFrozen && app.config.staticScene) {
    app.statusBackground.textContent = `BG frozen ${(stableRatio * 100).toFixed(1)}%`;
    app.summaryCopy.textContent = "WebGPU compute path with a frozen outdoor cache and confidence-based parking for glass pixels that have already converged.";
    updateBottleneckSummary();
    return;
  }

  const mode = app.config.staticScene ? "BG baking" : "BG live";
  app.statusBackground.textContent = `${mode} ${(confidentRatio * 100).toFixed(1)}% conf`;
  app.summaryCopy.textContent = `WebGPU compute path with a cached outdoor bake, confidence-based glass parking, and a live bottleneck readout. BG active ${formatPercent(activeRatio)}.`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function updateBottleneckSummary(glassActiveRatio) {
  const totalTexels = BACKGROUND_SIZE * BACKGROUND_SIZE;
  const bgStableRatio = totalTexels > 0 ? app.stats.background.stableTexels / totalTexels : 0;
  const bgActiveRatio = Math.max(0, 1 - bgStableRatio);
  const resolvedGlass = formatPercent(1 - (glassActiveRatio ?? Math.max(0, 1 - app.stats.gpu.stablePixels / (RENDER_SIZE * RENDER_SIZE))));
  const activeGlass = formatPercent(glassActiveRatio ?? Math.max(0, 1 - app.stats.gpu.stablePixels / (RENDER_SIZE * RENDER_SIZE)));
  const bgMode = app.gpu?.backgroundFrozen && app.config.staticScene
    ? "BG frozen"
    : `BG active ${formatPercent(bgActiveRatio)}`;
  app.detailCopy.textContent = `${bgMode}. Glass active ${activeGlass}. Glass parked ${resolvedGlass}.`;
}

async function fetchText(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function fail(message) {
  showError(message);
  app.statusBackend.textContent = "WebGPU unavailable";
}

function showError(message) {
  app.errorLog.hidden = false;
  app.errorLog.textContent = message;
}

function clearError() {
  app.errorLog.hidden = true;
  app.errorLog.textContent = "";
}
