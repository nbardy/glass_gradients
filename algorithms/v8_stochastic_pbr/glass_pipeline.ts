import { AlgoRenderer } from "../../core/renderer";
import { GlassGenerator } from "../../core/glass_generator";

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

  const glassGenResponse = await fetch("./core/glass_generator.wgsl");
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
    ],
  });

  // --- Debug Canvases Setup ---
  const debugIds = ["debug-r", "debug-g", "debug-b", "debug-bg"];
  const debugContexts: GPUCanvasContext[] = [];
  let debugPipeline: GPURenderPipeline | null = null;
  let debugBindGroupGbuffer: GPUBindGroup | null = null;
  let debugBindGroupBg: GPUBindGroup | null = null;
  const debugUniforms = device.createBuffer({
    size: 32, // Safe uniform buffer size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  for (const id of debugIds) {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      const ctx = el.getContext("webgpu") as GPUCanvasContext;
      ctx.configure({ device, format: canvasFormat });
      debugContexts.push(ctx);
    }
  }

  if (debugContexts.length === 4) {
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
        
        if (uniforms.channel > 2.5) {
          // aces tonemap for background to match
          let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
          var col = clamp((val.rgb * (a * val.rgb + b)) / (val.rgb * (c * val.rgb + d) + e), vec3f(0.0), vec3f(1.0));
          return vec4f(pow(col, vec3f(1.0/2.2)), 1.0);
        }
        
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
      primitive: { topology: "triangle-list" },
    });
    debugBindGroupGbuffer = device.createBindGroup({
      layout: debugPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: glassGenerator.texture.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: debugUniforms } },
      ],
    });
    debugBindGroupBg = device.createBindGroup({
      layout: debugPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: backgroundTexture.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: debugUniforms } },
      ],
    });
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

      const currentConfigStr = JSON.stringify(config);
      if (currentConfigStr !== prevConfigStr) {
         device.queue.writeBuffer(stateBuffer, 0, zeroState);
         device.queue.writeBuffer(statsBuffer, 0, zeroStats);
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
            view: colorView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(1, renderBindGroup);
      renderPass.draw(3);
      renderPass.end();

      if (config.splitView && debugPipeline && debugBindGroupGbuffer && debugBindGroupBg && debugContexts.length === 4) {
        for (let i = 0; i < 4; i++) {
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
          debugPass.setBindGroup(0, i === 3 ? debugBindGroupBg : debugBindGroupGbuffer);
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
