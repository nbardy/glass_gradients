import { AlgoRenderer } from "../../core/renderer";
import { GlassGenerator } from "../../core/glass_generator";
import { resolveBackgroundType, UNIFIED_SKY_DEFAULTS } from "../../core/background_manager";
import type { UnifiedSkyConfig } from "../../core/background_manager";

declare const GPUBufferUsage: any;
declare const GPUMapMode: any;
declare const GPUTextureUsage: any;

const RENDER_SIZE = 512;
const BACKGROUND_SIZE = 256;
const WORKGROUP_SIZE = 8;

export async function v8GlassPipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  shaderSource: string,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const glassGenResponse = await fetch(`./core/glass_generator.wgsl?t=${Date.now()}`);
  const glassGenSource = await glassGenResponse.text();

  const glassGenerator = new GlassGenerator(device, glassGenSource, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    scale: config.glassScale ?? 1.0,
    frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
    backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
    distortion: config.glassDistortion ?? 1.0,
    pattern_type: config.glassPatternType ?? 0.0,
    roughness: config.glassRoughness ?? 0.0,
  });

  glassGenerator.generate();

  const shaderModule = device.createShaderModule({ code: shaderSource });

  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" },
  });

  const backgroundComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_background_compute" },
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
    size: 128,
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

  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear'
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
      { binding: 6, resource: linearSampler },
    ],
  });

  // backgroundComputeBindGroup is created dynamically each frame to inject bgTex from bgManager.
  // main_background_compute reads sky via sample_outdoor (equirectangular) from background_sample_tex,
  // then accumulates into backgroundTexture. Without the real sky texture, it accumulates black.

  // Render pipeline auto-layout group(0) only sees params (via dummy read in fs_display).
  // Can't reuse glassComputeBindGroup — different auto-layout = incompatible.
  const renderGroup0 = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() },
    ],
  });

  // --- Debug Canvases Setup ---
  const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
  const debugContexts: GPUCanvasContext[] = [];
  let debugPipeline: GPURenderPipeline | null = null;
  const debugBindGroups: GPUBindGroup[] = [];

  for (const id of debugIds) {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      const ctx = el.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format: canvasFormat });
      debugContexts.push(ctx);
    }
  }

  if (debugContexts.length === 4) {
    debugPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs_fullscreen" },
      fragment: { module: shaderModule, entryPoint: "fs_debug", targets: [{ format: canvasFormat }] },
      primitive: { topology: "triangle-list" },
    });
    for (let i = 0; i < 4; i++) {
      const buf = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, new Float32Array([i, 0, 0, 0]));
      debugBindGroups.push(device.createBindGroup({
        layout: debugPipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: buf } },
        ],
      }));
    }

    // debugGroup0 is created dynamically each frame to inject bgTex from bgManager
  }
  // ----------------------------

  const startTime = performance.now();
  let stats: Record<string, any> = {
    fps: 0,
    frameMs: 0,
    spp: 0,
    confident: 0,
    parked: 0,
    adaptive: 0,
    darkUnresolved: 0,
  };

  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let backgroundFrozen = false;
  let frame = 0;
  let lastReadMs = 0;
  let readPending = false;

  function buildParamBlock(): Float32Array {
    const params = new Float32Array(32);

    params[0] = RENDER_SIZE;
    params[1] = RENDER_SIZE;
    params[2] = (performance.now() - startTime) / 1000.0;
    params[3] = frame;

    params[4] = config.baseSamples ?? 2;
    params[5] = config.maxSamples ?? 8;
    params[6] = config.cloudSteps ?? 8;
    params[7] = config.sunShadowSteps ?? 3;

    params[8] = config.staticScene ? 1.0 : 0.0;
    params[9] = config.adaptiveSampling ? 1.0 : 0.0;
    params[10] = config.showConfidence ? 1.0 : 0.0;
    params[11] = config.targetError ?? 0.06;

    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3.0;
    params[14] = config.exposure ?? 1.18;
    params[15] = config.showOutdoorOnly ? 1.0 : 0.0;

    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;

    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19;
    params[23] = config.glassRoughness ?? 0.085;

    params[24] = config.glassIor ?? 1.52;
    params[25] = config.milkyScattering ? 1.0 : 0.0;
    params[26] = config.dispersion ? 1.0 : 0.0;
    params[27] = config.birefringence ? 1.0 : 0.0;

    params[28] = config.splitView ? 1.0 : 0.0;
    params[29] = config.bgType ?? 0.0;
    params[30] = 0.0;
    params[31] = 0.0;

    return params;
  }

  // To properly clear accumulation when config changes
  let prevConfigStr = JSON.stringify(config);

  return {
    name: "v8_stochastic_pbr",

    async render(timestamp: number) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1000 / smoothedMs : 0;

      // Ensure bgManager is excluded from stringify loop to prevent circular reference errors
      const { bgManager, ...safeConfig } = config;
      const currentConfigStr = JSON.stringify(safeConfig);
      if (currentConfigStr !== prevConfigStr) {
         device.queue.writeBuffer(stateBuffer, 0, zeroState);
         device.queue.writeBuffer(backgroundStateBuffer, 0, zeroBackgroundState);
         device.queue.writeBuffer(statsBuffer, 0, zeroStats);
         device.queue.writeBuffer(backgroundStatsBuffer, 0, zeroStats);
         prevConfigStr = currentConfigStr;
      }

      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock() as any);
      device.queue.writeBuffer(statsBuffer, 0, zeroStats);

      const runBackgroundPass = !backgroundFrozen || !config.staticScene;
      if (runBackgroundPass) {
        device.queue.writeBuffer(backgroundStatsBuffer, 0, zeroStats);
      }

      const encoder = device.createCommandEncoder();

      glassGenerator.updateConfig({
        width: RENDER_SIZE,
        height: RENDER_SIZE,
        scale: config.glassScale ?? 1.0,
        frontOffset: [config.glassFrontOffsetX ?? 0.1, config.glassFrontOffsetY ?? -0.07],
        backOffset: [config.glassBackOffsetX ?? -0.11, config.glassBackOffsetY ?? 0.06],
        distortion: config.glassDistortion ?? 1.0,
        pattern_type: config.glassPatternType ?? 0.0,
        roughness: config.glassRoughness ?? 0.0,
        dropletProfile: config.glassDropletProfile ?? 2.5,
      });
      glassGenerator.generate(encoder);

      // Get external sky texture (equirectangular) from bgManager
      const az = config.sunAzimuth ?? 0.58;
      const el = config.sunElevation ?? 0.055;
      const sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const bgType = resolveBackgroundType(config.bgType ?? "math");
      const unifiedCfg: Partial<UnifiedSkyConfig> = {};
      for (const key of Object.keys(UNIFIED_SKY_DEFAULTS) as (keyof UnifiedSkyConfig)[]) {
        if (key in config) unifiedCfg[key] = config[key];
      }
      const bgTex = await config.bgManager.getBackground(bgType, az, el, 1024, unifiedCfg);

      if (runBackgroundPass) {
        // Dynamic bind group: inject bgTex so main_background_compute reads real sky
        // via sample_outdoor (equirectangular) and accumulates into backgroundTexture.
        const dynamicBgComputeBG = device.createBindGroup({
          layout: backgroundComputePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: backgroundStateBuffer } },
            { binding: 2, resource: backgroundTexture.createView() },
            { binding: 3, resource: { buffer: backgroundStatsBuffer } },
            { binding: 4, resource: bgTex.createView() },
            { binding: 6, resource: linearSampler },
          ],
        });
        const backgroundPass = encoder.beginComputePass();
        backgroundPass.setPipeline(backgroundComputePipeline);
        backgroundPass.setBindGroup(0, dynamicBgComputeBG);
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
      renderPass.setBindGroup(0, renderGroup0);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();

      if (config.splitView && debugPipeline && debugBindGroups.length === 4 && debugContexts.length === 4) {
        // Dynamic debug group: inject bgTex so fs_debug background channel shows real sky
        const dynamicDebugGroup0 = device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 4, resource: bgTex.createView() },
            { binding: 5, resource: glassGenerator.texture.createView() },
            { binding: 6, resource: linearSampler },
          ],
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
          debugPass.setBindGroup(2, debugBindGroups[i]);
          debugPass.draw(3);
          debugPass.end();
        }
      }

      const shouldReadStats = (now - lastReadMs > 250) && !readPending;
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
    },
  };
}
