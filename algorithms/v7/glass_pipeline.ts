import { AlgoRenderer } from "../../core/renderer";
import { GlassGenerator } from "../../core/glass_generator";
import { resolveBackgroundType, UNIFIED_SKY_DEFAULTS } from "../../core/background_manager";
import type { UnifiedSkyConfig } from "../../core/background_manager";

declare const GPUBufferUsage: any;
declare const GPUMapMode: any;
declare const GPUTextureUsage: any;

const RENDER_SIZE = 512;
const WORKGROUP_SIZE = 16;

export async function v7GlassPipeline(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  config: Record<string, any>
): Promise<AlgoRenderer> {
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  // Load glass generator shader
  const glassGenResponse = await fetch(`./core/glass_generator.wgsl?t=${Date.now()}`);
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

  // Load V7 shader
  const shaderResponse = await fetch(`./algorithms/v7/renderer.wgsl?t=${Date.now()}`);
  const shaderSource = await shaderResponse.text();

  // Compile shader module
  const shaderModule = device.createShaderModule({ code: shaderSource });

  // Create pipelines (glass compute, render)
  const glassComputePipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main_compute" },
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
  const paramsBuffer = device.createBuffer({
    size: 128, // 8 * 4 * 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const displayTexture = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  
  // Dummy background cache to satisfy binding layout if we want to add it later
  const dummyBackground = device.createTexture({
    size: [1, 1],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Create bind groups
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: displayTexture.createView() },
    ],
  });

  const renderParamsBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
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
  }
  // ----------------------------

  // Runtime state
  const startTime = performance.now();
  let stats: Record<string, any> = {
    fps: 0,
    frameMs: 0,
    spp: 1, // Single pass
  };

  let lastFrameTime = performance.now();
  let smoothedMs = 0;
  let frame = 0;

  function buildParamBlock(): Float32Array {
    const params = new Float32Array(32);

    // resolution_time: vec4f
    params[0] = RENDER_SIZE;  
    params[1] = RENDER_SIZE;  
    params[2] = (performance.now() - startTime) / 1000.0;  
    params[3] = frame;

    // sampling: vec4f (unused)
    params[4] = 1;
    params[5] = 1;
    params[6] = 1;
    params[7] = 1;

    // flags: vec4f
    params[8] = 0.0;
    params[9] = config.bgType ?? 0.0;
    params[10] = 0.0;
    params[11] = config.showOutdoorOnly ? 1.0 : 0.0;

    // tuning: vec4f
    params[12] = config.varianceBoost ?? 1.2;
    params[13] = config.outlierK ?? 3.0;
    params[14] = config.exposure ?? 1.18;
    params[15] = 0.0;

    // sun_camera: vec4f
    params[16] = config.sunAzimuth ?? 0.58;
    params[17] = config.sunElevation ?? 0.055;
    params[18] = config.cameraZ ?? 1.65;
    params[19] = config.cameraFocal ?? 1.85;

    // glass_a: vec4f
    params[20] = config.glassThickness ?? 0.06;
    params[21] = config.glassHeightAmpl ?? 0.01;
    params[22] = config.glassBump ?? 0.19; // Passed to map normal scale
    params[23] = config.glassRoughness ?? 0.085; // Ignored by analytical

    // glass_b: vec4f
    params[24] = config.glassIor ?? 1.52;
    params[25] = config.splitView ? 1.0 : 0.0;
    params[26] = 0.0;
    params[27] = 0.0;

    // debug: vec4f
    params[28] = config.splitView ? 1.0 : 0.0;
    params[29] = 0.0;
    params[30] = 0.0;
    params[31] = 0.0;

    return params;
  }

  // Return renderer object
  return {
    name: "v7_fast_analytical",

    async render(timestamp: number) {
      const now = performance.now();
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      smoothedMs = smoothedMs === 0 ? frameDelta : smoothedMs * 0.9 + frameDelta * 0.1;
      stats.frameMs = smoothedMs;
      stats.fps = smoothedMs > 0 ? 1000 / smoothedMs : 0;

      const az = config.sunAzimuth ?? 0.58;
      const el = config.sunElevation ?? 0.055;
      const sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const bgType = resolveBackgroundType(config.bgType ?? "math");
      const unifiedCfg: Partial<UnifiedSkyConfig> = {};
      for (const key of Object.keys(UNIFIED_SKY_DEFAULTS) as (keyof UnifiedSkyConfig)[]) {
        if (key in config) unifiedCfg[key] = config[key];
      }
      const bgTex = await config.bgManager.getBackground(bgType, sunDir, 1024, unifiedCfg);

      device.queue.writeBuffer(paramsBuffer, 0, buildParamBlock() as any);

      const encoder = device.createCommandEncoder();

      // Update and generate glass texture if needed
      // For peak perf in V7, we only do this when config changes, but we'll do it every frame here for simplicity of the port
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
      glassGenerator.generate(encoder);

      // We dynamically create the compute bind group to inject the updated background texture
      const dynamicGlassComputeBindGroup = device.createBindGroup({
        layout: glassComputePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: displayTexture.createView() },
          { binding: 2, resource: glassGenerator.texture.createView() },
          { binding: 3, resource: linearSampler },
          { binding: 4, resource: bgTex.createView() },
        ],
      });

      // Glass compute pass
      const glassPass = encoder.beginComputePass();
      glassPass.setPipeline(glassComputePipeline);
      glassPass.setBindGroup(0, dynamicGlassComputeBindGroup);
      glassPass.dispatchWorkgroups(
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE),
        Math.ceil(RENDER_SIZE / WORKGROUP_SIZE)
      );
      glassPass.end();

      // Render pass
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

      if (config.splitView && debugPipeline && debugBindGroups.length === 4 && debugContexts.length === 4) {
        const dynamicDebugParamsBindGroup = device.createBindGroup({
          layout: debugPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 2, resource: glassGenerator.texture.createView() },
            { binding: 3, resource: linearSampler },
            { binding: 4, resource: bgTex.createView() },
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
          debugPass.setBindGroup(0, dynamicDebugParamsBindGroup);
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
    },
  };
}