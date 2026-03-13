/**
 * V1 Refined Glass Gradient Pipeline
 * Extracts all v1_refined_webgpu logic into a single function.
 * Uses GlassGenerator to decouple glass generation from rendering.
 * Returns AlgoRenderer that manages its own GPU state.
 */
import { AlgoRenderer } from "../../core/renderer";
import { GlassGenerator } from "../../core/glass_generator";

declare const GPUBufferUsage: any;
declare const GPUMapMode: any;
declare const GPUTextureUsage: any;

const RENDER_SIZE = 512;
const BACKGROUND_SIZE = 256;
const WORKGROUP_SIZE = 8;

export async function v1GlassPipeline(
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

  // Load glass generator shader
  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
  const glassGenSource = await glassGenResponse.text();

  // Initialize glass generator (precompute glass texture)
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

  // Generate initial glass texture
  glassGenerator.generate();

  // Compile shader module
  const shaderModule = device.createShaderModule({ code: shaderSource });

  // Create pipelines (glass compute, background compute, render)
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

  // Create GPU buffers and textures
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

  // Create bind groups
  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear'
  });

  const dummyBackgroundForCompute = device.createTexture({
    size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING
  });

  const backgroundComputeBindGroup = device.createBindGroup({
    layout: backgroundComputePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: backgroundStateBuffer } },
      { binding: 2, resource: backgroundTexture.createView() },
      { binding: 3, resource: { buffer: backgroundStatsBuffer } },
      { binding: 4, resource: dummyBackgroundForCompute.createView() },
      { binding: 6, resource: linearSampler },
    ],
  });

  // We dynamically recreate bind groups in the render loop

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
      const debugUniforms = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(debugUniforms, 0, new Float32Array([i, 0, 0, 0]));
      
      debugBindGroups.push(device.createBindGroup({
        layout: debugPipeline.getBindGroupLayout(2),
        entries: [{ binding: 0, resource: { buffer: debugUniforms } }],
      }));
    }
  }
  // ----------------------------

  // Runtime state
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
    // Construct 112-byte (28 f32) parameter block matching shader Params struct:
    // struct Params {
    //   resolution_time: vec4f,  [0-3]
    //   sampling: vec4f,         [4-7]
    //   flags: vec4f,            [8-11]
    //   tuning: vec4f,           [12-15]
    //   sun_camera: vec4f,       [16-19]
    //   glass_a: vec4f,          [20-23]
    //   glass_b: vec4f,          [24-27]
    // };
    const params = new Float32Array(28);

    // resolution_time: vec4f
    params[0] = RENDER_SIZE;  // resolution.x
    params[1] = RENDER_SIZE;  // resolution.y
    params[2] = (performance.now() - startTime) / 1000.0;  // time
    params[3] = frame;

    // sampling: vec4f
    params[4] = config.baseSamples ?? 2;
    params[5] = config.maxSamples ?? 8;
    params[6] = config.cloudSteps ?? 8;
    params[7] = config.sunShadowSteps ?? 3;

    // flags: vec4f
    params[8] = config.staticScene ? 1.0 : 0.0;
    params[9] = config.adaptiveSampling ? 1.0 : 0.0;
    params[10] = config.showConfidence ? 1.0 : 0.0;
    params[11] = config.targetError ?? 0.06;

    // tuning: vec4f
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3.0;
    params[14] = config.exposure ?? 1.18;
    params[15] = config.showOutdoorOnly ? 1.0 : 0.0;

    // sun_camera: vec4f
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;

    // glass_a: vec4f
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19;
    params[23] = config.glassRoughness ?? 0.085;

    // glass_b: vec4f
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.splitView ? 1.0 : 0.0;
    params[26] = config.bgType ?? 0.0;
    params[27] = 0.0;

    return params;
  }

  // Return renderer object
  return {
    name: "v1_refined",

    async render(timestamp: number) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1000 / smoothedMs : 0;

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
      });
      
      const az = config.sunAzimuth ?? 0.58;
      const el = config.sunElevation ?? 0.055;
      const sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const bgTex = await config.bgManager.getBackground(config.bgType ?? "math", sunDir, 1024);

      glassGenerator.generate(encoder);

      // Background compute pass
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

      // We need to dynamically create the compute bind group to inject the updated background texture
      const dynamicGlassComputeBG = device.createBindGroup({
        layout: glassComputePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: stateBuffer } },
          { binding: 2, resource: displayTexture.createView() },
          { binding: 3, resource: { buffer: statsBuffer } },
          { binding: 4, resource: bgTex.createView() },
          { binding: 5, resource: glassGenerator.texture.createView() },
          { binding: 6, resource: linearSampler },
        ],
      });

      const dynamicRenderParamsBG = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 4, resource: bgTex.createView() },
          { binding: 6, resource: linearSampler },
        ],
      });

      // Glass compute pass
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
          { binding: 0, resource: displayTexture.createView() },
        ],
      });

      // Render pass
      const colorView = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
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
            { binding: 6, resource: linearSampler },
          ],
        });
        const dynamicDebugGroup1 = device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: displayTexture.createView() },
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
          debugPass.setBindGroup(1, dynamicDebugGroup1);
          debugPass.setBindGroup(2, debugBindGroups[i]);
          debugPass.draw(3);
          debugPass.end();
        }
      }

      // Async stats readback
      const shouldReadStats = (now - lastReadMs > 250) && !readPending;
      if (shouldReadStats) {
        readPending = true;
        encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, statsBufferSize, statsBufferSize);
        lastReadMs = now;

        device.queue.submit([encoder.finish()]);

        // Async read (non-blocking)
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
